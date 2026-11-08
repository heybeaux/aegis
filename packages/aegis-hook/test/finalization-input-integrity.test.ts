import { describe, expect, it } from 'vitest';
import { evaluate, loadPack, type ToolCall } from '@heybeaux/lattice-aegis';
import {
  approvalId, createExecutionPermitWithStore, finalizeExecutionPermitWithStore,
  finalizeExecutionPermitWithReconciliation,
  type ApprovalExecutionPermitRecord, type ApprovalExecutionSnapshot,
} from '../src/approval.js';

const rules = loadPack({ packId: 'test', version: '1', rules: [] });
async function fixture(api: 'simple' | 'reconciled') {
  const call: ToolCall = { tool: 'Bash', command: 'pwd',
    approvalProvenance: { actorId: 'root', authorizationDigest: 'epoch' },
    approvalDelegation: { effectiveConsumerId: 'root', declaredScope: 'none', maxDepth: 0,
      links: [{ actorId: 'root', authorityLevel: 1, verified: true, revoked: false }] } };
  const evaluation = evaluate(call, rules), id = approvalId(call, evaluation);
  const current: ApprovalExecutionSnapshot = { approvalId: id, authorizationDigest: 'epoch',
    effectiveConsumerId: 'root', links: structuredClone(call.approvalDelegation!.links),
    revoked: false, revocationChecked: true, structurallyValid: true };
  let record: ApprovalExecutionPermitRecord | undefined;
  let prepared: ApprovalExecutionPermitRecord | undefined;
  let duringTake = () => {}, duringPrepare = () => {};
  const store = {
    async create(r: ApprovalExecutionPermitRecord) { record = structuredClone(r); return true; },
    async take() { duringTake(); const r = record; record = undefined; return r; },
    async prepareTake() { duringPrepare(); if (!record) return false; prepared = record; record = undefined; return true; },
    async claimPreparedTake() { duringTake(); const r = prepared; prepared = undefined; return r; },
  };
  const permit = await createExecutionPermitWithStore(call, evaluation, id, store);
  const finish = () => api === 'simple'
    ? finalizeExecutionPermitWithStore(permit, current, store)
    : finalizeExecutionPermitWithReconciliation(permit, current, 'op_test', store);
  return { current, permit, store, finish, take: (f: () => void) => { duringTake = f; },
    prepare: (f: () => void) => { duringPrepare = f; }, state: () => ({ record, prepared }) };
}
const mutations: [string, (s: ApprovalExecutionSnapshot) => void, (s: ApprovalExecutionSnapshot) => void][] = [
  ['revoked', s => { s.revoked = true; }, s => { s.revoked = false; }],
  ['unchecked', s => { s.revocationChecked = false; }, s => { s.revocationChecked = true; }],
  ['structure', s => { s.structurallyValid = false; }, s => { s.structurallyValid = true; }],
  ['digest', s => { s.authorizationDigest = 'wrong'; }, s => { s.authorizationDigest = 'epoch'; }],
  ['link', s => { s.links![0]!.revoked = true; }, s => { s.links![0]!.revoked = false; }],
];
for (const api of ['simple', 'reconciled'] as const) describe(`${api} finalization input ownership`, () => {
  const blocked = api === 'simple' ? false : { status: 'blocked', retryable: false, reason: 'invalid_snapshot' };
  const execute = api === 'simple' ? true : { status: 'execute', retryable: false };
  for (const [name, invalidate, repair] of mutations) it(`burns ${name} repaired during storage`, async () => {
    const f = await fixture(api); invalidate(f.current); f.take(() => repair(f.current));
    expect(await f.finish()).toEqual(blocked);
    expect(f.state()).toEqual({ record: undefined, prepared: undefined });
    expect(await f.finish()).not.toEqual(execute);
    // No caller freeze or rollback: the host's mutation remains its own.
    expect(f.current.revoked).toBe(false);
  });
  it('accepts structurally equivalent caller replacement', async () => {
    const f = await fixture(api); f.take(() => { f.current.links = structuredClone(f.current.links); });
    expect(await f.finish()).toEqual(execute);
  });
  it('blocks revocation arriving during storage', async () => {
    const f = await fixture(api); f.take(() => { f.current.revoked = true; });
    expect(await f.finish()).toEqual(blocked);
  });
  it('blocks mutated permit handles after consuming the original record', async () => {
    const f = await fixture(api); f.take(() => { f.permit.id = 'permit_000000000000000000000000'; });
    expect(await f.finish()).toEqual(blocked);
    expect(f.state()).toEqual({ record: undefined, prepared: undefined });
  });
  it('rejects unsnapshotable input without touching storage', async () => {
    const f = await fixture(api); Object.assign(f.current, { unsupported: () => 1 });
    expect(await f.finish()).toEqual(blocked);
    expect(f.state().record).toBeDefined();
  });
  it('rejects null snapshot without throwing', async () => {
    const f = await fixture(api);
    const result = api === 'simple'
      ? finalizeExecutionPermitWithStore(f.permit, null as unknown as ApprovalExecutionSnapshot, f.store)
      : finalizeExecutionPermitWithReconciliation(f.permit, null as unknown as ApprovalExecutionSnapshot, 'op_test', f.store);
    expect(await result).toEqual(blocked);
  });
});
it('remembers observed drift after prepare even if restored during claim', async () => {
  const f = await fixture('reconciled'); f.prepare(() => { f.current.revoked = true; });
  f.take(() => { f.current.revoked = false; });
  expect(await f.finish()).toEqual({ status: 'blocked', retryable: false, reason: 'invalid_snapshot' });
  expect(f.state()).toEqual({ record: undefined, prepared: undefined });
});
