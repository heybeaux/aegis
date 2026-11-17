import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluate, loadPack, type ToolCall } from '@heybeaux/lattice-aegis';
import {
  approvalId, createExecutionPermitWithStore, finalizeExecutionPermitWithEffectJournal,
  resolveExecutionEffect, beginExecutionEffect, resolveDurableStrictRosterPolicyExecutionEffect,
  beginDurableStrictRosterPolicyExecutionEffect, beginStrictRosterContinuityExecutionEffect,
  selectDurableStrictRosterPolicy,
  type ApprovalExecutionPermitRecord, type ApprovalExecutionSnapshot,
  type ApprovalExecutionEffectRecord, type DurableStrictRosterPolicyMarker,
} from '../src/approval.js';

const rules = loadPack({ packId: 'test', version: '1', rules: [] });
const op = 'op_wrapper';
type Api = 'resolve' | 'durable' | 'continuity';
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
  let record: ApprovalExecutionPermitRecord | undefined, effect: ApprovalExecutionEffectRecord | undefined;
  let marker: DurableStrictRosterPolicyMarker | undefined, revision = 1, rosterReads = 0, markerReads = 0, begins = 0;
  let hook = (_stage: string, _count: number) => {};
  let burnFailure: 'false' | 'throw' | undefined;
  const rosterDigest = `sha256:${createHash('sha256').update(JSON.stringify({minimumRequiredAuthorities:1,operationId:op,requiredAuthorityIds:['witness-a'],rosterEpoch:1})).digest('hex')}`;
  const store = {
    async create(r: ApprovalExecutionPermitRecord) { record = structuredClone(r); return true; },
    async take() { const r = record; record = undefined; return r; },
    async prepareEffect(_id: string, operationId: string) {
      if (effect) return true; if (!record) return false;
      effect = { operationId, permit: structuredClone(record), state: 'authorized', claimed: false };
      record = undefined; return true;
    },
    async claimPreparedEffect() {
      if (!effect || effect.claimed || effect.state !== 'authorized') return undefined;
      effect.claimed = true; return structuredClone(effect.permit);
    },
    async readEffect() { return effect && { ...structuredClone(effect), revision }; },
    async burnEffect() {
      if (burnFailure === 'throw') throw new Error('unavailable');
      if (burnFailure === 'false' || !effect || effect.state !== 'authorized') return false;
      effect.state = 'burned'; revision++; return true;
    },
    async beginEffect() { begins++; if (!effect || !effect.claimed || effect.state !== 'authorized') return false; effect.state = 'started'; revision++; return true; },
    async commitEffect() { return false; },
    async readEffectRevision() { return revision; },
    async readEffectRevisionCheckpoint() { return { operationId: op, revision, verified: true }; },
    async readEffectRevisionCheckpoints() { return [{ authorityId: 'witness-a', operationId: op, revision, verified: true, historyDigest: rosterDigest }]; },
    async readEffectRevisionWitnessSet() { return { operationId: op, requiredAuthorityIds: ['witness-a'], minimumRequiredAuthorities: 1, verified: true }; },
    async readEffectRevisionWitnessRoster() { await Promise.resolve(); hook('roster', ++rosterReads); return { operationId: op, requiredAuthorityIds: ['witness-a'], minimumRequiredAuthorities: 1, rosterEpoch: 1, rosterDigest, verified: true }; },
  };
  const policy = {
    async bindStrictRosterPolicy(_op: string, value: DurableStrictRosterPolicyMarker) { marker = structuredClone(value); return true; },
    async readStrictRosterPolicy() { await Promise.resolve(); hook('marker', ++markerReads); return marker && structuredClone(marker); },
  };
  const permit = await createExecutionPermitWithStore(call, evaluation, id, store);
  const original = structuredClone(permit);
  expect(await finalizeExecutionPermitWithEffectJournal(permit, clean, op, store)).toEqual({ status: 'execute', retryable: false });
  expect(await selectDurableStrictRosterPolicy(permit, clean, op, policy)).toBeDefined();
  markerReads = 0; rosterReads = 0;
  return { current, clean, permit, store,
    invoke: (api: Api) => api === 'resolve'
      ? resolveDurableStrictRosterPolicyExecutionEffect(permit, current, op, store, policy)
      : api === 'durable' ? beginDurableStrictRosterPolicyExecutionEffect(permit, current, op, store, policy)
        : beginStrictRosterContinuityExecutionEffect(permit, current, op, store),
    hook: (fn: typeof hook) => { hook = fn; },
    burnFailure: (failure: typeof burnFailure) => { burnFailure = failure; },
    begin: () => beginExecutionEffect(original, clean, op, store),
    resolve: () => resolveExecutionEffect(original, clean, op, store),
    state: () => ({ state: effect?.state, begins }),
  };
}

describe('strict wrappers retain invocation authority across outer awaits', () => {
  for (const api of ['resolve', 'durable', 'continuity'] as const) {
    for (const field of ['revoked', 'link', 'digest'] as const) it(`${api}: refuses repaired entry ${field}`, async () => {
      const f = await fixture();
      if (field === 'revoked') f.current.revoked = true;
      if (field === 'link') f.current.links![0]!.revoked = true;
      if (field === 'digest') f.current.authorizationDigest = 'wrong';
      f.hook(() => Object.assign(f.current, structuredClone(f.clean)));
      expect(await f.invoke(api)).toEqual({ status: api === 'resolve' ? 'not_executed' : 'blocked', retryable: false, reason: 'invalid_snapshot' });
      expect(f.state()).toEqual({ state: 'burned', begins: 0 });
      expect(await f.begin()).toMatchObject({ status: 'blocked', reason: 'authorization_burned' });
      expect(f.current).toEqual(f.clean); expect(Object.isFrozen(f.current)).toBe(false);
    });
    it(`${api}: equivalent nested clones remain valid`, async () => {
      const f = await fixture(); f.hook(() => { f.current.links = structuredClone(f.current.links); });
      expect(await f.invoke(api)).toEqual(api === 'resolve' ? { status: 'not_executed', retryable: true, reason: 'not_started' } : { status: 'execute', retryable: false });
      if (api === 'resolve') expect(await f.begin()).toEqual({ status: 'execute', retryable: false });
      expect(await f.begin()).toMatchObject({ status: 'blocked', reason: 'effect_started' });
    });
    for (const failure of ['false', 'throw'] as const) it(`${api}: exposes failed burn after preflight drift (${failure})`, async () => {
      const f = await fixture(); f.current.revoked = true;
      f.hook(() => { f.current.revoked = false; }); f.burnFailure(failure);
      expect(await f.invoke(api)).toEqual({ status: 'indeterminate', retryable: false, reason: api === 'resolve' ? 'journal_unavailable' : 'status_unavailable' });
      expect(f.state()).toEqual({ state: 'authorized', begins: 0 });
    });
    it(`${api}: retains live input guard inside the inner call`, async () => {
      const f = await fixture(); const read = f.store.readEffect;
      f.store.readEffect = async () => { f.current.revoked = true; return read(); };
      expect(await f.invoke(api)).toMatchObject({ retryable: false, reason: 'invalid_snapshot' });
      expect(f.state()).toEqual({ state: 'burned', begins: 0 });
    });
    if (api !== 'continuity') it(`${api}: retains observed marker drift restored during roster`, async () => {
      const f = await fixture(); f.hook((stage, count) => { if (count === 1) f.current.revoked = stage === 'marker'; });
      expect(await f.invoke(api)).toMatchObject({ retryable: false, reason: 'invalid_snapshot' });
      expect(f.state()).toEqual({ state: 'burned', begins: 0 });
    });
    if (api !== 'resolve') {
      it(`${api}: rejects revocation in final wrapper check, keeps started fence`, async () => {
        const f = await fixture(); f.hook((stage, count) => { if (stage === 'roster' && count === 4) f.current.revoked = true; });
        expect(await f.invoke(api)).toEqual({ status: 'blocked', retryable: false, reason: 'invalid_snapshot' });
        expect(f.state()).toEqual({ state: 'started', begins: 1 });
        expect(await f.begin()).toMatchObject({ status: 'blocked', reason: 'effect_started' });
        expect(await f.resolve()).toMatchObject({ status: 'indeterminate', retryable: false, reason: 'effect_started' });
      });
      it(`${api}: rejects handle drift during final wrapper check`, async () => {
        const f = await fixture(); f.hook((stage, count) => { if (stage === 'roster' && count === 4) f.permit.id = 'permit_' + '0'.repeat(24); });
        expect(await f.invoke(api)).toMatchObject({ status: 'blocked', retryable: false, reason: 'invalid_snapshot' });
        expect(f.state()).toEqual({ state: 'started', begins: 1 });
      });
    }
  }
  it('durable begin remembers post-marker drift repaired at final roster', async () => {
    const f = await fixture(); f.hook((stage, count) => { if (stage === 'marker' && count === 2) f.current.revoked = true; if (stage === 'roster' && count === 4) f.current.revoked = false; });
    expect(await f.invoke('durable')).toEqual({ status: 'blocked', retryable: false, reason: 'invalid_snapshot' });
    expect(f.state()).toEqual({ state: 'started', begins: 1 });
  });
});
