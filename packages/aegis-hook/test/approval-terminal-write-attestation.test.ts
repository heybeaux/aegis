import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { completeExecutionEffect, failExecutionEffect, type ApprovalExecutionTerminalProof } from '../src/approval.js';

const approvalId = `aegis_${'f'.repeat(16)}`;
const operationId = 'op_terminal_attestation';
const signature = 'terminal-write-attestation-signature';
const permit = { id: `permit_${createHash('sha256').update(`${approvalId}:${signature}`).digest('hex').slice(0, 24)}`, approvalId };
const permitRecord = {
  ...permit, signature, authorizationDigest: 'auth:attestation', effectiveConsumerId: 'agent:direct',
  links: [{ actorId: 'agent:root', authorityLevel: 10, verified: true }, { actorId: 'agent:direct', authorityLevel: 8, verified: true }],
  declaredScope: 'direct' as const, maxDepth: 1,
};
const success = { permitId: permit.id, approvalId, operationId, receiptDigest: `sha256:${'a'.repeat(64)}`, verified: true };
const failure = { ...success, receiptDigest: `sha256:${'b'.repeat(64)}`, failureCode: 'external_rejected' };
const differentSuccess = { ...success, receiptDigest: `sha256:${'c'.repeat(64)}` };
const differentFailure = { ...failure, receiptDigest: `sha256:${'d'.repeat(64)}` };
const reorderedSuccess = { verified: true, operationId, approvalId, receiptDigest: success.receiptDigest, permitId: permit.id };

type Mode = 'exact' | 'reordered-exact' | 'different' | 'no-write' | 'nonterminal' | 'read-down' | 'conflict' | 'not-started';
function storeFor(kind: 'success' | 'failure', result: 'first' | 'already', mode: Mode) {
  let effect: any = { operationId, permit: permitRecord, state: 'started', claimed: true };
  const write = (receipt: any) => {
    if (mode === 'conflict') return 'conflict';
    if (mode === 'not-started') return 'not_started';
    if (mode === 'exact' || mode === 'reordered-exact' || mode === 'different') {
      effect = kind === 'success'
        ? { ...effect, state: 'committed', successReceipt: mode === 'different' ? differentSuccess : mode === 'reordered-exact' ? reorderedSuccess : receipt }
        : { ...effect, state: 'failed', failureReceipt: mode === 'different' ? differentFailure : receipt };
    }
    return kind === 'success'
      ? (result === 'already' ? 'already_committed' : 'committed')
      : (result === 'already' ? 'already_failed' : 'failed');
  };
  return {
    async create() { return true; }, async take() { return permitRecord; },
    async prepareEffect() { return true; }, async claimPreparedEffect() { return permitRecord; },
    async beginEffect() { return true; }, async commitEffect() { return false; }, async burnEffect() { return true; },
    async completeEffect(_operationId: string, receipt: any) { return write(receipt) as any; },
    async failEffect(_operationId: string, receipt: any) { return write(receipt) as any; },
    async readEffect() { if (mode === 'read-down') throw new Error('read unavailable'); return structuredClone(effect); },
  };
}

describe('terminal write result attestation', () => {
  it('preserves exact first and idempotent terminal writes', async () => {
    await expect(completeExecutionEffect(permit, operationId, success, storeFor('success', 'first', 'exact'))).resolves.toEqual({ status: 'executed' });
    await expect(completeExecutionEffect(permit, operationId, success, storeFor('success', 'already', 'exact'))).resolves.toEqual({ status: 'executed' });
    await expect(failExecutionEffect(permit, operationId, failure, storeFor('failure', 'first', 'exact'))).resolves.toEqual({ status: 'failed' });
    await expect(failExecutionEffect(permit, operationId, failure, storeFor('failure', 'already', 'exact'))).resolves.toEqual({ status: 'failed' });
  });

  it('does not convert positive enums without exact durable proof into terminal certainty', async () => {
    for (const mode of ['no-write', 'nonterminal'] as const) {
      await expect(completeExecutionEffect(permit, operationId, success, storeFor('success', 'first', mode))).resolves.toEqual({ status: 'indeterminate', reason: 'receipt_unverified' });
      await expect(failExecutionEffect(permit, operationId, failure, storeFor('failure', 'first', mode))).resolves.toEqual({ status: 'indeterminate', reason: 'receipt_unverified' });
    }
  });


  it('matches semantic receipts independent of object key order', async () => {
    await expect(completeExecutionEffect(permit, operationId, success, storeFor('success', 'already', 'reordered-exact'))).resolves.toEqual({ status: 'executed' });
  });

  it('rejects a different retained terminal receipt even after an already result', async () => {
    await expect(completeExecutionEffect(permit, operationId, success, storeFor('success', 'already', 'different'))).resolves.toEqual({ status: 'blocked', reason: 'receipt_conflict' });
    await expect(failExecutionEffect(permit, operationId, failure, storeFor('failure', 'already', 'different'))).resolves.toEqual({ status: 'blocked', reason: 'receipt_conflict' });
  });

  it('keeps unavailable readback indeterminate and preserves definite negative enums', async () => {
    await expect(completeExecutionEffect(permit, operationId, success, storeFor('success', 'first', 'read-down'))).resolves.toEqual({ status: 'indeterminate', reason: 'store_unavailable' });
    await expect(failExecutionEffect(permit, operationId, failure, storeFor('failure', 'first', 'read-down'))).resolves.toEqual({ status: 'indeterminate', reason: 'store_unavailable' });
    await expect(completeExecutionEffect(permit, operationId, success, storeFor('success', 'first', 'conflict'))).resolves.toEqual({ status: 'blocked', reason: 'receipt_conflict' });
    await expect(failExecutionEffect(permit, operationId, failure, storeFor('failure', 'first', 'not-started'))).resolves.toEqual({ status: 'blocked', reason: 'effect_not_started' });
  });

  it('attests positive terminal writes after immediate compaction through the exact proof', async () => {
    const compactedStore = (kind: 'success' | 'failure', proof: ApprovalExecutionTerminalProof) => ({
      async create() { return true; }, async take() { return permitRecord; },
      async prepareEffect() { return true; }, async claimPreparedEffect() { return permitRecord; },
      async beginEffect() { return true; }, async commitEffect() { return false; }, async burnEffect() { return true; },
      async completeEffect() { return 'committed' as const; }, async failEffect() { return 'failed' as const; },
      async readEffect() { return undefined; }, async readEffectRevision() { return 3; },
      async readEffectTerminalProof() { return proof; },
    });
    const successProof: ApprovalExecutionTerminalProof = { ...success, outcome: 'committed', revision: 3 };
    const failureProof: ApprovalExecutionTerminalProof = { ...failure, outcome: 'failed', revision: 3 };
    await expect(completeExecutionEffect(permit, operationId, success, compactedStore('success', successProof))).resolves.toEqual({ status: 'executed' });
    await expect(failExecutionEffect(permit, operationId, failure, compactedStore('failure', failureProof))).resolves.toEqual({ status: 'failed' });
    await expect(completeExecutionEffect(permit, operationId, success, compactedStore('success', { ...successProof, receiptDigest: differentSuccess.receiptDigest }))).resolves.toEqual({ status: 'blocked', reason: 'receipt_conflict' });
  });
});
