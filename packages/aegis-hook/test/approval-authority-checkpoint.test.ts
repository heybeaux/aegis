import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  beginExecutionEffect,
  resolveAnchoredExecutionEffect,
  resolveExecutionEffect,
  type ApprovalExecutionPermit,
  type ApprovalExecutionRevisionCheckpoint,
} from '../src/approval.js';

const signature = 'authority-checkpoint-signature';
const approvalId = `aegis_${'b'.repeat(16)}`;
const permit: ApprovalExecutionPermit = { id: `permit_${createHash('sha256').update(`${approvalId}:${signature}`).digest('hex').slice(0, 24)}`, approvalId };
const operationId = 'op_authority_checkpoint_test';
const current = { approvalId: permit.approvalId };
const permitRecord = { ...permit, signature };

function store(options: {
  highWater?: number;
  checkpoint?: ApprovalExecutionRevisionCheckpoint | Record<string, unknown>;
  checkpointError?: boolean;
  postCasRollback?: boolean;
} = {}) {
  const value = {
    operationId,
    permit: permitRecord,
    state: 'authorized',
    claimed: true,
    revision: options.highWater ?? 1,
  };
  return {
    async create() { return true; }, async take() { return permitRecord; },
    async prepareEffect() { return true; }, async claimPreparedEffect() { return permitRecord; },
    async beginEffect() { return options.postCasRollback ? false : true; },
    async commitEffect() { return false; }, async burnEffect() { return true; },
    async readEffect() { return structuredClone(value); },
    async readEffectRevision() { return options.postCasRollback ? 1 : (options.highWater ?? 1); },
    async readEffectRevisionCheckpoint() {
      if (options.checkpointError) throw new Error('checkpoint unavailable');
      return options.checkpoint === undefined
        ? { operationId, revision: 1, verified: true }
        : structuredClone(options.checkpoint);
    },
  };
}

describe('independent authority revision checkpoints', () => {
  it('blocks coherent host authority rollback below a verified checkpoint', async () => {
    await expect(resolveAnchoredExecutionEffect(permit, current, operationId, store({
      highWater: 1,
      checkpoint: { operationId, revision: 3, verified: true },
    }))).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_stale' });
  });

  it('treats a lagging checkpoint as a lower bound rather than an equality lock', async () => {
    const s = store({ highWater: 3, checkpoint: { operationId, revision: 2, verified: true } });
    s.readEffect = async () => ({ operationId, permit: permitRecord, state: 'committed', claimed: true, revision: 3,
      successReceipt: { permitId: permit.id, approvalId: permit.approvalId, operationId, receiptDigest: `sha256:${'c'.repeat(64)}`, verified: true } });
    await expect(resolveExecutionEffect(permit, current, operationId, s)).resolves.toMatchObject({ status: 'executed', reason: 'effect_committed' });
  });

  it.each([
    ['absent', undefined],
    ['unverified', { operationId, revision: 1, verified: false }],
    ['misbound', { operationId: 'op_other', revision: 1, verified: true }],
    ['unsafe revision', { operationId, revision: Number.MAX_SAFE_INTEGER + 1, verified: true }],
    ['extra property', { operationId, revision: 1, verified: true, extra: true }],
  ])('fails closed for %s checkpoint truth', async (_label, checkpoint) => {
    const s = store({ checkpoint: checkpoint as ApprovalExecutionRevisionCheckpoint | Record<string, unknown> });
    if (checkpoint === undefined) s.readEffectRevisionCheckpoint = async () => undefined as never;
    const result = await resolveExecutionEffect(permit, current, operationId, s);
    expect(result.retryable).toBe(false);
    expect(result.status).toBe('indeterminate');
    expect(result.reason).toBe(checkpoint === undefined ? 'journal_unavailable' : 'journal_inconsistent');
  });

  it('fails closed when the checkpoint read is unavailable', async () => {
    await expect(resolveExecutionEffect(permit, current, operationId, store({ checkpointError: true })))
      .resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_unavailable' });
  });

  it('rechecks the checkpoint after a losing begin CAS', async () => {
    const s = store({ postCasRollback: true, checkpoint: { operationId, revision: 3, verified: true } });
    await expect(beginExecutionEffect(permit, current, operationId, s))
      .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_stale' });
  });
});
