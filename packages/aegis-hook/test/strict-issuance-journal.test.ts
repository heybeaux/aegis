import { describe, expect, it } from 'vitest';
import { evaluate, loadPack, type ToolCall } from '@heybeaux/lattice-aegis';
import {
  approvalId, createExecutionPermitWithStore, finalizeExecutionPermitWithEffectJournal,
  resolveExecutionEffect, beginExecutionEffect,
  type ApprovalExecutionPermitRecord, type ApprovalExecutionEffectRecord,
  type ApprovalExecutionSnapshot,
} from '../src/approval.js';

async function fixture(strict = true, process = false) {
  const target = { hostId: 'host', sessionId: 'session', generationId: 'generation', verified: true };
  const call: ToolCall = process
    ? { tool: 'ProcessInput', content: 'pwd', processTarget: target }
    : { tool: 'Bash', command: 'pwd' };
  call.approvalProvenance = { actorId: 'root', authorizationDigest: 'epoch' };
  call.approvalDelegation = { effectiveConsumerId: 'root', declaredScope: 'none', maxDepth: 0,
    links: [{ actorId: 'root', authorityLevel: 1, verified: true, revoked: false }] };
  const evaluation = evaluate(call, loadPack({ packId: 'test', version: '1', rules: [] }));
  const id = approvalId(call, evaluation);
  const current: ApprovalExecutionSnapshot = { approvalId: id, revoked: false,
    authorizationDigest: 'epoch', effectiveConsumerId: 'root', links: structuredClone(call.approvalDelegation.links),
    revocationChecked: true, structurallyValid: true, ...(process ? { processTarget: target } : {}) };
  let record: ApprovalExecutionPermitRecord | undefined;
  let effect: ApprovalExecutionEffectRecord | undefined;
  const markers = new Set<string>();
  const store = {
    async create(r: ApprovalExecutionPermitRecord) { if (record) return false; record = structuredClone(r); return true; },
    async createOnce(r: ApprovalExecutionPermitRecord) { if (markers.has(r.id)) return false; markers.add(r.id); record = structuredClone(r); return true; },
    async readIssuedPermit() { return record && structuredClone(record); },
    async take() { const r = record; record = undefined; return r; },
    async prepareEffect(permitId: string, operationId: string) {
      if (effect) return effect.permit.id === permitId;
      if (!record || record.id !== permitId) return false;
      effect = { operationId, permit: structuredClone(record), state: 'authorized', claimed: false };
      record = undefined; return true;
    },
    async claimPreparedEffect() { if (!effect || effect.claimed) return undefined; effect.claimed = true; return structuredClone(effect.permit); },
    async readEffect() { return effect && structuredClone(effect); },
    async burnEffect() { if (!effect || effect.state !== 'authorized') return false; effect.state = 'burned'; return true; },
    async beginEffect() { if (!effect || !effect.claimed || effect.state !== 'authorized') return false; effect.state = 'started'; return true; },
    async commitEffect() { if (!effect || effect.state !== 'started') return false; effect.state = 'committed'; return true; },
  };
  const permit = await createExecutionPermitWithStore(call, evaluation, id, store, strict ? { issuanceId: 'grant-1' } : undefined);
  return { permit, store, current, call, evaluation, record: () => record!, effect: () => effect!,
    finish: () => finalizeExecutionPermitWithEffectJournal(permit, current, 'op_unit', store),
    resolve: () => resolveExecutionEffect(permit, current, 'op_unit', store),
    begin: () => beginExecutionEffect(permit, current, 'op_unit', store) };
}
const execute = { status: 'execute', retryable: false };
describe('shared issuance identity across effect journals', () => {
  for (const strict of [false, true]) for (const process of [false, true]) {
    it(`authorizes, starts once and resolves terminal truth (strict=${strict}, process=${process})`, async () => {
      const f = await fixture(strict, process);
      expect(await f.finish()).toEqual(execute);
      expect(await f.resolve()).toEqual({ status: 'not_executed', retryable: true, reason: 'not_started' });
      expect(await f.begin()).toEqual(execute);
      expect(await f.begin()).toMatchObject({ status: 'blocked', reason: 'effect_started' });
      expect(await f.store.commitEffect()).toBe(true);
      expect(await f.resolve()).toEqual({ status: 'executed', retryable: false, reason: 'effect_committed' });
    });
  }
  for (const mode of ['removed', 'changed', 'blank', 'number', 'too-long', 'signature'] as const) {
    for (const stage of ['finalize', 'read'] as const) it(`rejects ${mode} identity at ${stage}`, async () => {
      const f = await fixture();
      if (stage === 'read') { await f.store.prepareEffect(f.permit.id, 'op_unit'); await f.store.claimPreparedEffect(); }
      const record = (stage === 'read' ? f.effect().permit : f.record()) as unknown as Record<string, unknown>;
      if (mode === 'removed') delete record['issuanceId'];
      else if (mode === 'signature') record['signature'] = `${record['signature']}tampered`;
      else record['issuanceId'] = { changed: 'grant-2', blank: ' ', number: 42, 'too-long': 'x'.repeat(257) }[mode];
      if (stage === 'finalize') {
        expect(await f.finish()).toMatchObject({ status: 'blocked', reason: 'invalid_snapshot' });
        expect(f.effect().state).toBe('burned');
      }
      expect(await f.resolve()).toMatchObject({ status: 'indeterminate', retryable: false });
      expect(await f.begin()).toMatchObject({ status: 'blocked' });
    });
  }
  it('rejects a fresh issuance record relabeled with an old handle', async () => {
    const f = await fixture(); const old = f.permit;
    await f.store.take();
    const fresh = await createExecutionPermitWithStore(f.call, f.evaluation, old.approvalId, f.store, { issuanceId: 'grant-2' });
    expect(fresh.id).not.toBe(old.id); f.record().id = old.id;
    expect(await f.finish()).toMatchObject({ status: 'blocked', reason: 'invalid_snapshot' });
  });
  it('recovers the same strict handle then authorizes once', async () => {
    const f = await fixture();
    expect(await createExecutionPermitWithStore(f.call, f.evaluation, f.permit.approvalId, f.store,
      { issuanceId: 'grant-1', recoverExisting: true })).toEqual(f.permit);
    expect(await f.finish()).toEqual(execute);
    expect(await f.finish()).toMatchObject({ status: 'blocked' });
  });
  it('does not downgrade a legacy record carrying malformed strict metadata', async () => {
    const f = await fixture(false);
    Object.assign(f.record(), { issuanceId: '' });
    expect(await f.finish()).toMatchObject({ status: 'blocked', reason: 'invalid_snapshot' });
  });
  it('still rejects changed legacy signatures', async () => {
    const f = await fixture(false); f.record().signature += 'changed';
    expect(await f.finish()).toMatchObject({ status: 'blocked', reason: 'invalid_snapshot' });
  });
});
