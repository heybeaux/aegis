import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginExecutionEffect, resolveExecutionEffect } from '../src/approval.js';

const approvalId = `aegis_${'e'.repeat(16)}`;
const operationId = 'op_revision_integrity';
const signature = 'revision-integrity-signature';
const permit = { id: `permit_${createHash('sha256').update(`${approvalId}:${signature}`).digest('hex').slice(0, 24)}`, approvalId };
const links = [{ actorId: 'agent:root', authorityLevel: 10, verified: true }, { actorId: 'agent:direct', authorityLevel: 8, verified: true }];
const permitRecord = { ...permit, signature, authorizationDigest: 'auth:revision', effectiveConsumerId: 'agent:direct', links, declaredScope: 'direct' as const, maxDepth: 1 };
const current = { approvalId, revocationChecked: true, revoked: false, structurallyValid: true, authorizationDigest: permitRecord.authorizationDigest, effectiveConsumerId: permitRecord.effectiveConsumerId, links };
const successReceipt = { permitId: permit.id, approvalId, operationId, receiptDigest: `sha256:${'a'.repeat(64)}`, verified: true };
const failureReceipt = { ...successReceipt, receiptDigest: `sha256:${'b'.repeat(64)}`, failureCode: 'external_rejected' };
const effect = (state: string, revision?: number) => ({ operationId, permit: permitRecord, state, claimed: true, ...(revision === undefined ? {} : { revision }), ...(state === 'committed' ? { successReceipt } : {}), ...(state === 'failed' ? { failureReceipt } : {}) });

function storeFor(visible: unknown, highWater: number | undefined, options: { unavailable?: boolean; begin?: boolean; latest?: unknown } = {}) {
  let reads = 0;
  return {
    async create() { return true; }, async take() { return permitRecord; }, async prepareEffect() { return true; }, async claimPreparedEffect() { return permitRecord; },
    async beginEffect() { return options.begin ?? true; }, async commitEffect() { return false; },
    async readEffect() { return structuredClone(reads++ === 0 || options.latest === undefined ? visible : options.latest); },
    async readEffectRevision() { if (options.unavailable) throw new Error('unavailable'); return highWater; },
    async burnEffect() { return true; }, async completeEffect() { return 'not_started' as const; }, async failEffect() { return 'not_started' as const; },
  };
}

describe('monotonic effect journal revisions', () => {
  it('preserves current coherent revisions', async () => {
    await expect(resolveExecutionEffect(permit, current, operationId, storeFor(effect('authorized', 1), 1))).resolves.toEqual({ status: 'not_executed', retryable: true, reason: 'not_started' });
    await expect(resolveExecutionEffect(permit, current, operationId, storeFor(effect('started', 2), 2))).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'effect_started' });
    await expect(resolveExecutionEffect(permit, current, operationId, storeFor(effect('committed', 3), 3))).resolves.toEqual({ status: 'executed', retryable: false, reason: 'effect_committed' });
    await expect(resolveExecutionEffect(permit, current, operationId, storeFor(effect('failed', 3), 3))).resolves.toEqual({ status: 'not_executed', retryable: false, reason: 'effect_failed' });
  });

  it('fails closed on coherent stale records and retained tombstones', async () => {
    for (const visible of [effect('authorized', 1), effect('started', 2), effect('burned', 2), undefined]) {
      await expect(resolveExecutionEffect(permit, current, operationId, storeFor(visible, 3))).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_stale' });
    }
  });

  it('rejects malformed or causally impossible revision truth', async () => {
    await expect(resolveExecutionEffect(permit, current, operationId, storeFor(effect('authorized'), 1))).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_inconsistent' });
    await expect(resolveExecutionEffect(permit, current, operationId, storeFor(effect('committed', 4), 3))).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_inconsistent' });
    await expect(resolveExecutionEffect(permit, current, operationId, storeFor(effect('authorized', 1), 1, { unavailable: true }))).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_unavailable' });
  });

  it('revalidates revision truth after a failed start CAS', async () => {
    const store = storeFor(effect('authorized', 1), 3, { begin: false, latest: effect('authorized', 1) });
    // Initial read is already stale here, so it blocks before CAS.
    await expect(beginExecutionEffect(permit, current, operationId, store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_stale' });

    let watermarkReads = 0;
    const racing = storeFor(effect('authorized', 1), 1, { begin: false, latest: effect('authorized', 1) });
    racing.readEffectRevision = async () => ++watermarkReads === 1 ? 1 : 3;
    await expect(beginExecutionEffect(permit, current, operationId, racing)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_stale' });
  });

  it('keeps legacy unrevisioned stores backward compatible', async () => {
    const legacy = storeFor(effect('authorized'), undefined) as any;
    delete legacy.readEffectRevision;
    await expect(resolveExecutionEffect(permit, current, operationId, legacy)).resolves.toEqual({ status: 'not_executed', retryable: true, reason: 'not_started' });
  });
});
