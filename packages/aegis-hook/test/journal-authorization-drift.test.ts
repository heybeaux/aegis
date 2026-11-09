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
const mutations: [string, (s: ApprovalExecutionSnapshot) => void][] = [
  ['revoked', s => { s.revoked = true; }],
  ['unchecked', s => { s.revocationChecked = false; }],
  ['structure', s => { s.structurallyValid = false; }],
  ['digest', s => { s.authorizationDigest = 'wrong'; }],
  ['link', s => { s.links![0]!.revoked = true; }],
];
async function expectBurned(f: Awaited<ReturnType<typeof fixture>>) {
  expect(await f.finish()).toEqual(blocked);
  expect(f.state().record).toBeUndefined();
  expect(f.state().effect).toMatchObject({ state: 'burned', claimed: true });
  expect(await f.resolve()).toEqual({ status: 'not_executed', retryable: false, reason: 'authorization_burned' });
  expect(await f.begin()).toEqual({ status: 'blocked', retryable: false, reason: 'authorization_burned' });
  expect(await f.finish()).toEqual({ status: 'blocked', retryable: false, reason: 'not_taken' });
}
describe('journal finalization durable invalidation', () => {
  for (const stage of ['prepare', 'claim'] as const) {
    for (const [name, invalidate] of mutations) it(`burns ${name} repaired during ${stage}`, async () => {
      const f = await fixture(); invalidate(f.current); f[stage](() => Object.assign(f.current, structuredClone(f.clean)));
      await expectBurned(f);
      expect(f.current).toEqual(f.clean); // caller data remains owned by the caller
      expect(Object.isFrozen(f.current)).toBe(false);
    });
  }
  for (const ackLost of [false, true]) it(`remembers prepare drift restored during claim (ack lost ${ackLost})`, async () => {
    const f = await fixture(); f.prepare(() => { f.current.revoked = true; });
    f.claim(() => { f.current.revoked = false; });
    if (ackLost) {
      const prepare = f.store.prepareEffect; let lost = false;
      f.store.prepareEffect = async (...args) => {
        const prepared = await prepare(...args);
        if (!lost) { lost = true; throw Error('ack lost'); }
        return prepared;
      };
    }
    await expectBurned(f);
  });
  it('burns a mutated handle using the original binding', async () => {
    const f = await fixture(); f.claim(() => { f.permit.id = 'permit_000000000000000000000000'; });
    expect(await f.finish()).toEqual(blocked);
    expect(f.state().effect?.state).toBe('burned');
    expect(await f.begin()).toMatchObject({ status: 'blocked', reason: 'authorization_burned' });
  });
  for (const fail of ['false', 'throw'] as const) it(`reports indeterminate when durable burn ${fail}`, async () => {
    const f = await fixture(); f.current.revoked = true; f.claim(() => { f.current.revoked = false; });
    f.store.burnEffect = async () => { if (fail === 'throw') throw Error('unavailable'); return false; };
    expect(await f.finish()).toEqual(uncertain);
    expect(f.state().effect?.state).toBe('authorized');
  });
  it('allows equivalent authority and one legitimate start', async () => {
    const f = await fixture(); f.claim(() => { f.current.links = structuredClone(f.current.links); });
    expect(await f.finish()).toEqual(execute);
    expect(await f.resolve()).toMatchObject({ status: 'not_executed', retryable: true });
    expect(await f.begin()).toEqual(execute);
    expect(await f.begin()).toMatchObject({ status: 'blocked', reason: 'effect_started' });
  });
  it('reconciles unchanged lost prepare acknowledgement', async () => {
    const f = await fixture(), prepare = f.store.prepareEffect;
    f.store.prepareEffect = async (...args) => { await prepare(...args); throw Error('ack lost'); };
    expect(await f.finish()).toEqual(execute);
  });
  it('retains retry after claim is unavailable before commit', async () => {
    const f = await fixture(), claim = f.store.claimPreparedEffect;
    f.store.claimPreparedEffect = async () => { throw Error('unavailable'); };
    expect(await f.finish()).toEqual(uncertain);
    expect(f.state().effect).toMatchObject({ state: 'authorized', claimed: false });
    f.store.claimPreparedEffect = claim;
    expect(await f.finish()).toEqual(execute);
  });
  it('rejects non-cloneable authority before storage', async () => {
    const f = await fixture(); Object.assign(f.current, { callback: () => 1 });
    expect(await f.finish()).toEqual(blocked);
    expect(f.state().record).toBeDefined(); expect(f.state().effect).toBeUndefined();
  });
});
