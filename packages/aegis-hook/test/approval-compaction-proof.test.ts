import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  beginExecutionEffect,
  resolveCompactedExecutionEffect,
  resolveExecutionEffect,
  type ApprovalExecutionTerminalProof,
} from '../src/approval.js';

const operationId = 'op_compaction_proof';
const approvalId = `aegis_${'a'.repeat(16)}`;
const signature = 'compaction-proof-signature';
const permit = { id: `permit_${createHash('sha256').update(`${approvalId}:${signature}`).digest('hex').slice(0, 24)}`, approvalId };
const permitRecord = { ...permit, signature, authorizationDigest: 'auth:compaction', effectiveConsumerId: 'agent:direct', links: [{ actorId: 'agent:direct', authorityLevel: 8, verified: true }], declaredScope: 'direct' as const, maxDepth: 1 };
const current = { approvalId, authorizationDigest: 'auth:compaction', effectiveConsumerId: 'agent:direct', links: permitRecord.links, revoked: false, revocationChecked: true, structurallyValid: true };
const successProof: ApprovalExecutionTerminalProof = { operationId, permitId: permit.id, approvalId, outcome: 'committed', receiptDigest: `sha256:${'c'.repeat(64)}`, revision: 3, verified: true };
const failureProof: ApprovalExecutionTerminalProof = { operationId, permitId: permit.id, approvalId, outcome: 'failed', receiptDigest: `sha256:${'d'.repeat(64)}`, failureCode: 'external_rejected', revision: 3, verified: true };

function storeFor(options: { proof?: unknown; proofThrows?: boolean; revision?: number; effect?: unknown } = {}) {
  return {
    async create() { return false; }, async take() { return undefined; },
    async prepareEffect() { return false; }, async claimPreparedEffect() { return undefined; },
    async beginEffect() { return false; }, async commitEffect() { return false; },
    async readEffect() { return options.effect; }, async burnEffect() { return true; },
    async readEffectRevision() { return options.revision ?? 3; },
    async readEffectTerminalProof() { if (options.proofThrows) throw new Error('down'); return options.proof; },
  };
}

const executed = { status: 'executed', retryable: false, reason: 'effect_committed' };
const failed = { status: 'not_executed', retryable: false, reason: 'effect_failed' };
const stale = { status: 'indeterminate', retryable: false, reason: 'journal_stale' };
const inconsistent = { status: 'indeterminate', retryable: false, reason: 'journal_inconsistent' };

describe('terminal receipt compaction proof', () => {
  it('recovers exact host-authenticated success and failure after full-record pruning', async () => {
    await expect(resolveCompactedExecutionEffect(permit, current, operationId, storeFor({ proof: successProof }) as any)).resolves.toEqual(executed);
    await expect(resolveCompactedExecutionEffect(permit, current, operationId, storeFor({ proof: failureProof }) as any)).resolves.toEqual(failed);
    await expect(resolveExecutionEffect(permit, current, operationId, storeFor({ proof: successProof }) as any)).resolves.toEqual(executed);
  });

  it('strictly rejects malformed, unauthenticated, misbound, and contradictory proofs', async () => {
    const invalid = [
      { ...successProof, verified: false }, { ...successProof, revision: '3' },
      { ...successProof, operationId: 'op_other' }, { ...successProof, permitId: `permit_${'f'.repeat(24)}` },
      { ...successProof, approvalId: `aegis_${'f'.repeat(16)}` },
      { ...successProof, outcome: 'committed', failureCode: 'impossible' },
      { ...successProof, receiptDigest: 'sha256:bad' }, { ...successProof, outcome: 'unknown' },
    ];
    for (const proof of invalid) {
      await expect(resolveCompactedExecutionEffect(permit, current, operationId, storeFor({ proof }) as any)).resolves.toEqual(inconsistent);
    }
  });

  it('distinguishes missing, stale, future, and unavailable proof truth', async () => {
    await expect(resolveCompactedExecutionEffect(permit, current, operationId, storeFor() as any)).resolves.toEqual(stale);
    await expect(resolveCompactedExecutionEffect(permit, current, operationId, storeFor({ proof: { ...successProof, revision: 2 } }) as any)).resolves.toEqual(stale);
    await expect(resolveCompactedExecutionEffect(permit, current, operationId, storeFor({ proof: { ...successProof, revision: 4 } }) as any)).resolves.toEqual(inconsistent);
    await expect(resolveCompactedExecutionEffect(permit, current, operationId, storeFor({ proofThrows: true }) as any)).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_unavailable' });
  });

  it('lets current full records win and terminal proof override only stale replica state', async () => {
    const receipt = { permitId: permit.id, approvalId, operationId, receiptDigest: successProof.receiptDigest, verified: true };
    const committed = { operationId, permit: permitRecord, state: 'committed', claimed: true, successReceipt: receipt, revision: 3 };
    await expect(resolveCompactedExecutionEffect(permit, current, operationId, storeFor({ proof: failureProof, effect: committed }) as any)).resolves.toEqual(executed);
    const staleAuthorized = { operationId, permit: permitRecord, state: 'authorized', claimed: true, revision: 1 };
    await expect(resolveCompactedExecutionEffect(permit, current, operationId, storeFor({ proof: successProof, effect: staleAuthorized }) as any)).resolves.toEqual(executed);
    await expect(beginExecutionEffect(permit, current, operationId, storeFor({ proof: successProof, effect: staleAuthorized }) as any)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'effect_committed' });
  });
});
