import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginExecutionEffect } from '../src/approval.js';

const approvalId = `aegis_${'d'.repeat(16)}`;
const operationId = 'op_integrity_cas_race';
const signature = 'integrity-cas-race-signature';
const permit = {
  id: `permit_${createHash('sha256').update(`${approvalId}:${signature}`).digest('hex').slice(0, 24)}`,
  approvalId,
};
const links = [
  { actorId: 'agent:root', authorityLevel: 10, verified: true },
  { actorId: 'agent:direct', authorityLevel: 8, verified: true },
];
const permitRecord = {
  ...permit,
  signature,
  authorizationDigest: 'auth:integrity-cas-race',
  effectiveConsumerId: 'agent:direct',
  links,
  declaredScope: 'direct' as const,
  maxDepth: 1,
};
const current = {
  approvalId,
  revocationChecked: true,
  revoked: false,
  structurallyValid: true,
  authorizationDigest: permitRecord.authorizationDigest,
  effectiveConsumerId: permitRecord.effectiveConsumerId,
  links,
};
const successReceipt = {
  permitId: permit.id,
  approvalId,
  operationId,
  receiptDigest: `sha256:${'a'.repeat(64)}`,
  verified: true,
};
const failureReceipt = {
  ...successReceipt,
  receiptDigest: `sha256:${'b'.repeat(64)}`,
  failureCode: 'external_rejected',
};

function racingStore(latest: Record<string, unknown>) {
  let reads = 0;
  const authorized = { operationId, permit: permitRecord, state: 'authorized', claimed: true };
  return {
    async create() { return true; },
    async take() { return permitRecord; },
    async prepareEffect() { return true; },
    async claimPreparedEffect() { return permitRecord; },
    async beginEffect() { return false; },
    async commitEffect() { return false; },
    async readEffect() { return structuredClone(reads++ === 0 ? authorized : latest); },
    async burnEffect() { return true; },
    async completeEffect() { return 'not_started' as const; },
    async failEffect() { return 'not_started' as const; },
  };
}

describe('terminal journal integrity after a lost start race', () => {
  it('revalidates the post-CAS read instead of trusting torn terminal state', async () => {
    const malformed = [
      { operationId, permit: permitRecord, state: 'committed', claimed: true },
      { operationId, permit: permitRecord, state: 'failed', claimed: true },
      { operationId, permit: permitRecord, state: 'committed', claimed: true, failureReceipt },
      { operationId, permit: permitRecord, state: 'failed', claimed: true, successReceipt },
      { operationId, permit: permitRecord, state: 'authorized', claimed: true, successReceipt },
    ];
    for (const latest of malformed) {
      await expect(beginExecutionEffect(permit, current, operationId, racingStore(latest)))
        .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_inconsistent' });
    }
  });

  it('reports coherent concurrent terminal outcomes explicitly', async () => {
    const committed = { operationId, permit: permitRecord, state: 'committed', claimed: true, successReceipt };
    const failed = { operationId, permit: permitRecord, state: 'failed', claimed: true, failureReceipt };
    await expect(beginExecutionEffect(permit, current, operationId, racingStore(committed)))
      .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'effect_committed' });
    await expect(beginExecutionEffect(permit, current, operationId, racingStore(failed)))
      .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'effect_failed' });
  });
});
