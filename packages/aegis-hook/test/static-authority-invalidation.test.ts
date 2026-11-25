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

describe('static authority invalidation without a returned claim record', () => {
  const faults = ['before', 'after', 'contended'] as const;
  const mutations: Record<string, (s: ApprovalExecutionSnapshot) => void> = {
    revoked: s => { s.revoked = true; },
    unchecked: s => { s.revocationChecked = false; },
    structural: s => { s.structurallyValid = false; },
    digest: s => { s.authorizationDigest = 'changed'; },
    consumer: s => { s.effectiveConsumerId = 'other'; },
    links: s => { s.links![0].verified = false; },
  };
  async function failing(fault: typeof faults[number]) {
    const f = await fixture(), claim = f.store.claimPreparedEffect;
    f.store.claimPreparedEffect = async () => {
      if (fault !== 'before') await claim();
      if (fault === 'contended') return undefined;
      throw Error('lost claim');
    };
    return { ...f, restore: () => { f.store.claimPreparedEffect = claim; } };
  }
  for (const fault of faults) {
    for (const [name, mutate] of Object.entries(mutations)) {
      it(`${fault}: immutable ${name} invalidates the owned retained grant`, async () => {
        const f = await failing(fault); mutate(f.current);
        const before = structuredClone(f.current);
        expect(await f.finish()).toEqual(blocked);
        expect(f.current).toEqual(before); expect(Object.isFrozen(f.current)).toBe(false);
        expect(f.state().effect).toMatchObject({ state: 'burned', claimed: fault !== 'before' });
        f.restore();
        expect(await f.resolve()).toMatchObject({ reason: 'authorization_burned', retryable: false });
        expect(await f.begin()).toMatchObject({ status: 'blocked', reason: 'authorization_burned' });
      });
    }
    it(`${fault}: valid static authority retains fenced recovery`, async () => {
      const f = await failing(fault);
      expect(await f.finish()).toEqual(fault === 'contended' ? { status: 'blocked', retryable: false, reason: 'not_taken' } : uncertain);
      f.restore();
      expect(await f.finish()).toEqual(fault === 'before' ? execute : { status: 'blocked', retryable: false, reason: 'not_taken' });
      expect(await f.begin()).toEqual(execute);
      expect(await f.begin()).toMatchObject({ status: 'blocked', reason: 'effect_started' });
    });
    for (const failure of ['false', 'throw', 'started']) {
      it(`${fault}: ${failure} burn cannot attest invalidation`, async () => {
        const f = await failing(fault); f.current.revoked = true; let burns = 0;
        f.store.burnEffect = async () => { burns++; if (failure === 'throw') throw Error('burn lost'); if (failure === 'started') f.state().effect!.state = 'started'; return false; };
        expect(await f.finish()).toEqual(uncertain); expect(burns).toBe(1);
        expect(f.state().effect!.state).toBe(failure === 'started' ? 'started' : 'authorized');
      });
    }
    for (const read of ['throw', 'missing', 'foreign', 'malformed']) {
      it(`${fault}: ${read} readback cannot authorize a burn`, async () => {
        const f = await failing(fault); f.current.revoked = true; let burns = 0;
        const original = f.store.readEffect;
        f.store.readEffect = async () => {
          if (read === 'throw') throw Error('unavailable');
          if (read === 'missing') return undefined;
          const e = (await original())!;
          if (read === 'foreign') e.permit.id = 'permit_' + 'f'.repeat(24);
          if (read === 'malformed') e.operationId = 'other';
          return e;
        };
        f.store.burnEffect = async () => { burns++; return true; };
        const result = await f.finish();
        expect(result.status).not.toBe('execute'); expect(burns).toBe(0);
        if (read !== 'missing' || fault !== 'contended') expect(result).toEqual(uncertain);
      });
    }
    it(`${fault}: drift during retained read is also invalidation`, async () => {
      const f = await failing(fault), read = f.store.readEffect;
      f.store.readEffect = async () => { f.current.revoked = true; return read(); };
      expect(await f.finish()).toEqual(blocked);
      expect(f.state().effect!.state).toBe('burned');
    });
  }
});
