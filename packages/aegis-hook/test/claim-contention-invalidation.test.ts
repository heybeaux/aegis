import { describe, expect, it } from 'vitest';
import { evaluate, loadPack, type ToolCall } from '@heybeaux/lattice-aegis';
import {
  approvalId, createExecutionPermitWithStore, finalizeExecutionPermitWithEffectJournal,
  resolveExecutionEffect, beginExecutionEffect,
  type ApprovalExecutionPermitRecord, type ApprovalExecutionSnapshot,
  type ApprovalExecutionEffectRecord,
} from '../src/approval.js';

const rules = loadPack({ packId: 'test', version: '1', rules: [] });
async function fixture() {
  const call: ToolCall = { tool: 'Bash', command: 'pwd',
    approvalProvenance: { actorId: 'root', authorizationDigest: 'epoch' },
    approvalDelegation: { effectiveConsumerId: 'root', declaredScope: 'none', maxDepth: 0,
      links: [{ actorId: 'root', authorityLevel: 1, verified: true, revoked: false }] } };
  const evaluation = evaluate(call, rules), id = approvalId(call, evaluation);
  const clean: ApprovalExecutionSnapshot = { approvalId: id, authorizationDigest: 'epoch',
    effectiveConsumerId: 'root', links: structuredClone(call.approvalDelegation!.links),
    revoked: false, revocationChecked: true, structurallyValid: true };
  const current = structuredClone(clean);
  let record: ApprovalExecutionPermitRecord | undefined;
  let effect: ApprovalExecutionEffectRecord | undefined;
  let duringPrepare = () => {}, duringClaim = () => {};
  const store = {
    async create(r: ApprovalExecutionPermitRecord) { record = structuredClone(r); return true; },
    async take() { const r = record; record = undefined; return r; },
    async prepareEffect(_id: string, operationId: string) {
      duringPrepare(); if (effect) return true; if (!record) return false;
      effect = { operationId, permit: structuredClone(record), state: 'authorized', claimed: false };
      record = undefined; return true;
    },
    async claimPreparedEffect() {
      duringClaim(); if (!effect || effect.claimed || effect.state !== 'authorized') return undefined;
      effect.claimed = true; return structuredClone(effect.permit);
    },
    async readEffect() { return effect && structuredClone(effect); },
    async burnEffect() { if (!effect || effect.state === 'started' || effect.state === 'committed') return false; effect.state = 'burned'; return true; },
    async beginEffect() { if (!effect || !effect.claimed || effect.state !== 'authorized') return false; effect.state = 'started'; return true; },
    async commitEffect() { return false; },
  };
  const permit = await createExecutionPermitWithStore(call, evaluation, id, store);
  const original = structuredClone(permit);
  return { current, clean, permit, store,
    finish: () => finalizeExecutionPermitWithEffectJournal(permit, current, 'op_test', store),
    resolve: () => resolveExecutionEffect(original, clean, 'op_test', { ...store }),
    begin: () => beginExecutionEffect(original, clean, 'op_test', { ...store }),
    prepare: (f: () => void) => { duringPrepare = f; },
    claim: (f: () => void) => { duringClaim = f; }, state: () => ({ record, effect }) };
}
const blocked = { status: 'blocked', retryable: false, reason: 'invalid_snapshot' };
const execute = { status: 'execute', retryable: false };
const uncertain = { status: 'indeterminate', retryable: false, reason: 'status_unavailable' };
describe('claim contention retains observed invalidation', () => {
  for (const lostPrepareAck of [false, true]) {
    for (const mode of ['revoke', 'repair', 'restore', 'handle', 'equivalent', 'unchanged', 'burn-false', 'burn-throw', 'started']) {
      it(`prepare ack lost=${lostPrepareAck}, competing claim with ${mode}`, async () => {
        const f = await fixture();
        const original = structuredClone(f.permit);
        const originalPrepare = f.store.prepareEffect;
        const originalClaim = f.store.claimPreparedEffect;
        const originalBurn = f.store.burnEffect;
        const cleanAdapter = { ...f.store };
        if (mode === 'repair') f.current.revoked = true;
        f.store.prepareEffect = async (id, operationId) => {
          const prepared = await originalPrepare(id, operationId);
          if (mode === 'restore') f.current.revoked = true;
          if (lostPrepareAck) throw Error('prepare acknowledgement lost');
          return prepared;
        };
        let burns = 0;
        f.store.burnEffect = async () => {
          burns++;
          if (mode === 'burn-false') return false;
          if (mode === 'burn-throw') throw Error('burn unavailable');
          return originalBurn();
        };
        f.store.claimPreparedEffect = async () => {
          // Independent public API caller wins. The outer claim genuinely loses.
          expect(await finalizeExecutionPermitWithEffectJournal(original, f.clean, 'op_test', cleanAdapter)).toEqual(execute);
          if (mode === 'started') expect(await beginExecutionEffect(original, f.clean, 'op_test', cleanAdapter)).toEqual(execute);
          if (['revoke', 'burn-false', 'burn-throw', 'started'].includes(mode)) f.current.revoked = true;
          if (mode === 'repair' || mode === 'restore') f.current.revoked = false;
          if (mode === 'handle') f.permit.id = 'changed';
          if (mode === 'equivalent') f.current.links = structuredClone(f.current.links);
          const claimed = await originalClaim();
          expect(claimed).toBeUndefined();
          return claimed;
        };
        const result = await f.finish();
        if (['revoke', 'repair', 'restore', 'handle'].includes(mode)) {
          expect(result).toEqual(blocked);
          expect(burns).toBe(1);
          expect(f.state().effect).toMatchObject({ state: 'burned', claimed: true });
          expect(await beginExecutionEffect(original, f.clean, 'op_test', cleanAdapter)).toEqual({ status: 'blocked', retryable: false, reason: 'authorization_burned' });
        } else {
          const unchanged = ['equivalent', 'unchanged'].includes(mode);
          expect(result).toEqual(unchanged ? { status: 'blocked', retryable: lostPrepareAck, reason: 'not_taken' } : uncertain);
          expect(burns).toBe(unchanged ? 0 : 1);
          expect(f.state().effect).toMatchObject({ state: mode === 'started' ? 'started' : 'authorized', claimed: true });
          const begin = () => beginExecutionEffect(original, f.clean, 'op_test', cleanAdapter);
          expect(await begin()).toEqual(mode === 'started' ? { status: 'blocked', retryable: false, reason: 'effect_started' } : execute);
          expect(await begin()).toEqual({ status: 'blocked', retryable: false, reason: 'effect_started' });
        }
      });
    }
  }
});
