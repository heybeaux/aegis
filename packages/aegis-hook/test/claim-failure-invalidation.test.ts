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
    async burnEffect() { if (!effect) return false; effect.state = 'burned'; return true; },
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
describe('claim transport failure retains observed invalidation', () => {
  for (const fault of ['before', 'after']) {
    for (const mode of ['revoke', 'repair', 'restore', 'handle']) {
      it(`${fault}-commit claim failure burns ${mode} drift before clean recovery`, async () => {
        const f = await fixture(), originalClaim = f.store.claimPreparedEffect;
        if (mode === 'repair') f.current.revoked = true;
        if (mode === 'restore') f.prepare(() => { f.current.revoked = true; });
        f.store.claimPreparedEffect = async () => {
          if (mode === 'revoke') f.current.revoked = true;
          if (mode === 'repair' || mode === 'restore') f.current.revoked = false;
          if (mode === 'handle') f.permit.id = 'changed';
          if (fault === 'after') await originalClaim();
          throw Error('claim acknowledgement unavailable');
        };
        expect(await f.finish()).toEqual(blocked);
        expect(f.state().effect).toMatchObject({ state: 'burned', claimed: fault === 'after' });
        expect(await f.resolve()).toEqual({ status: 'not_executed', retryable: false, reason: 'authorization_burned' });
        expect(await f.begin()).toEqual({ status: 'blocked', retryable: false, reason: 'authorization_burned' });
      });
    }
    for (const equivalent of [false, true]) {
      it(`${fault}-commit unchanged claim failure permits fenced recovery (clone ${equivalent})`, async () => {
        const f = await fixture(), originalClaim = f.store.claimPreparedEffect;
        f.store.claimPreparedEffect = async () => {
          if (equivalent) f.current.links = structuredClone(f.current.links);
          if (fault === 'after') await originalClaim();
          throw Error('lost');
        };
        expect(await f.finish()).toEqual(uncertain);
        expect(f.state().effect).toMatchObject({ state: 'authorized', claimed: fault === 'after' });
        f.store.claimPreparedEffect = originalClaim;
        expect(await f.finish()).toEqual(fault === 'before' ? execute : { status: 'blocked', retryable: false, reason: 'not_taken' });
        expect(await f.begin()).toEqual(execute);
        expect(await f.begin()).toEqual({ status: 'blocked', retryable: false, reason: 'effect_started' });
      });
    }
    for (const burn of ['false', 'throw']) {
      it(`${fault}-commit drift with failed burn ${burn} remains indeterminate`, async () => {
        const f = await fixture(), originalClaim = f.store.claimPreparedEffect;
        let burns = 0;
        f.store.claimPreparedEffect = async () => {
          f.current.revoked = true;
          if (fault === 'after') await originalClaim();
          throw Error('lost');
        };
        f.store.burnEffect = async () => { burns++; if (burn === 'throw') throw Error('unavailable'); return false; };
        expect(await f.finish()).toEqual(uncertain);
        expect(burns).toBe(1);
        expect(f.state().effect).toMatchObject({ state: 'authorized', claimed: fault === 'after' });
      });
    }
  }
});
