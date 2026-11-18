import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  retireDurableStrictRosterPolicy as retire,
  compactDurableStrictRosterPolicyRetirement as compact,
  type ApprovalExecutionPermit,
  type ApprovalExecutionEffectRecord,
  type JournaledApprovalExecutionPermitStore,
  type CompactableDurableStrictRosterPolicyStore,
  type DurableStrictRosterPolicyLifecycleRecord,
  type DurableStrictRosterPolicyRetirement,
  type DurableStrictRosterPolicyRetirementCheckpoint,
} from '../src/approval.js';

const operationId = 'op_lifecycle_test';
const receiptDigest = `sha256:${'e'.repeat(64)}`;
const signature = 'lifecycle-test';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const permitFor = (digit: string): ApprovalExecutionPermit => {
  const approvalId = `aegis_${digit.repeat(16)}`;
  return { id: `permit_${hash(`${approvalId}:${signature}`).slice(0, 24)}`, approvalId };
};
const active = (p: ApprovalExecutionPermit) => ({ operationId, permitId: p.id, approvalId: p.approvalId });
type Outcome = 'committed' | 'failed';
const retired = (p: ApprovalExecutionPermit, outcome: Outcome): DurableStrictRosterPolicyRetirement => ({ ...active(p), status: 'retired', outcome, receiptDigest, terminalRevision: 3 });
const checkpoint = (p: ApprovalExecutionPermit, outcome: Outcome): DurableStrictRosterPolicyRetirementCheckpoint => ({
  operationId, status: 'retirement_compacted', outcome, receiptDigest, terminalRevision: 3,
  checkpointDigest: `sha256:${hash(JSON.stringify({ approvalId: p.approvalId, operationId, outcome, permitId: p.id, receiptDigest, terminalRevision: 3 }))}`, verified: true,
});
const success = { status: 'retired', retryable: false, reason: 'policy_retired' };
const blocked = { status: 'blocked', retryable: false, reason: 'policy_lifecycle_inconsistent' };
function fixture(api: 'retire' | 'compact', outcome: Outcome, foreign = false) {
  const entry = permitFor('1'), other = permitFor('2'), permit = { ...entry };
  let record: DurableStrictRosterPolicyLifecycleRecord = foreign
    ? (api === 'retire' ? retired(other, outcome) : checkpoint(other, outcome))
    : (api === 'retire' ? active(entry) : retired(entry, outcome));
  let terminalPermit = entry;
  let hook = async (_phase: string) => {};
  const calls: string[] = [];
  const store: CompactableDurableStrictRosterPolicyStore = {
    async bindStrictRosterPolicy() { return false; },
    async readStrictRosterPolicy() { calls.push('read'); const value = structuredClone(record); await hook('read'); return value; },
    async retireStrictRosterPolicy(_op, expected, next) {
      calls.push('cas'); const applied = isDeepStrictEqual(record, expected);
      if (applied) record = structuredClone(next);
      await hook('cas'); return applied;
    },
    async compactStrictRosterPolicyRetirement(_op, expected, next) {
      calls.push('cas'); const applied = isDeepStrictEqual(record, expected);
      if (applied) record = { ...next, verified: true };
      await hook('cas'); return applied;
    },
  };
  const journal = { async readEffect(): Promise<ApprovalExecutionEffectRecord> {
    calls.push('journal');
    const value: ApprovalExecutionEffectRecord = {
      operationId, permit: { ...terminalPermit, signature }, state: outcome, claimed: true, revision: 3,
      ...(outcome === 'committed'
        ? { successReceipt: { ...active(terminalPermit), receiptDigest, verified: true } }
        : { failureReceipt: { ...active(terminalPermit), receiptDigest, verified: true, failureCode: 'verified_failure' } }),
    };
    await hook('journal'); return value;
  } } as JournaledApprovalExecutionPermitStore;
  return {
    entry, other, permit, calls, store,
    get: () => structuredClone(record), set: (r: DurableStrictRosterPolicyLifecycleRecord) => { record = r; },
    terminal: (p: ApprovalExecutionPermit) => { terminalPermit = p; },
    hook: (fn: typeof hook) => { hook = fn; },
    run: () => api === 'retire'
      ? retire(permit, operationId, outcome, receiptDigest, 3, store, journal)
      : compact(permit, operationId, outcome, receiptDigest, 3, store),
  };
}

describe('lifecycle transitions retain entry identity', () => {
  for (const api of ['retire', 'compact'] as const) for (const outcome of ['committed', 'failed'] as const) {
    it(`${api}/${outcome}: preserves exact, idempotent, equivalent identity and caller mutability`, async () => {
      const f = fixture(api, outcome);
      f.hook(async () => { await Promise.resolve(); Object.assign(f.permit, { ...f.entry }); });
      expect(await f.run()).toEqual(success);
      expect(await f.run()).toEqual(success);
      expect(f.get()).toEqual(api === 'retire' ? retired(f.entry, outcome) : checkpoint(f.entry, outcome));
      expect(Object.isFrozen(f.permit)).toBe(false);
    });
    it(`${api}/${outcome}: rejects stable foreign retained truth`, async () => {
      const f = fixture(api, outcome, true), before = f.get();
      expect(await f.run()).toEqual(blocked); expect(f.get()).toEqual(before);
    });
    for (const phase of ['cas', 'read']) {
      it(`${api}/${outcome}: rejects foreign proof after caller switch at ${phase}`, async () => {
        const f = fixture(api, outcome, true), before = f.get();
        f.hook(async at => { await Promise.resolve(); if (at === phase) Object.assign(f.permit, f.other); });
        expect(await f.run()).toEqual(blocked); expect(f.get()).toEqual(before);
        expect(f.permit).toEqual(f.other);
      });
    }
    for (const field of ['id', 'approvalId'] as const) {
      it(`${api}/${outcome}: stops at observed ${field} drift before a later repair`, async () => {
        const f = fixture(api, outcome);
        f.hook(async at => {
          await Promise.resolve();
          if (at === 'cas') f.permit[field] = f.other[field];
          if (at === 'read') Object.assign(f.permit, f.entry);
        });
        expect(await f.run()).toEqual(blocked);
        expect(f.calls).not.toContain('read');
        expect(f.get()).toEqual(api === 'retire' ? retired(f.entry, outcome) : checkpoint(f.entry, outcome));
        expect(Object.isFrozen(f.permit)).toBe(false);
        f.hook(async () => {}); Object.assign(f.permit, f.entry);
        expect(await f.run()).toEqual(success);
      });
    }
    for (const phase of ['cas', 'read']) {
      it(`${api}/${outcome}: retains transition despite ${phase} outage and recovers`, async () => {
        const f = fixture(api, outcome);
        f.hook(async at => { if (at === phase) throw Error('unavailable'); });
        expect(await f.run()).toEqual({ status: 'indeterminate', retryable: false, reason: 'policy_unavailable' });
        expect(f.get()).toEqual(api === 'retire' ? retired(f.entry, outcome) : checkpoint(f.entry, outcome));
        f.hook(async () => {}); expect(await f.run()).toEqual(success);
      });
    }
  }
  for (const outcome of ['committed', 'failed'] as const) {
    it(`retire/${outcome}: foreign journal cannot repair caller identity before terminal validation`, async () => {
      const f = fixture('retire', outcome); f.set(active(f.other)); f.terminal(f.other);
      const before = f.get();
      f.hook(async at => { await Promise.resolve(); if (at === 'journal') Object.assign(f.permit, f.other); });
      expect(await f.run()).toEqual(blocked); expect(f.get()).toEqual(before);
      expect(f.calls).toEqual(['journal']);
    });
  }
});
