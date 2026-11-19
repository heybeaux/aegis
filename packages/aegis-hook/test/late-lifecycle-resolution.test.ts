import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  resolveRetiredDurableStrictRosterPolicyExecutionEffect as retired,
  resolveCompactedDurableStrictRosterPolicyExecutionEffect as compact,
  resolveMultiAuthorityCompactedDurableStrictRosterPolicyExecutionEffect as plural,
  type MultiAuthorityCompactableDurableStrictRosterPolicyStore,
  type DurableStrictRosterPolicyRetirement,
  type DurableStrictRosterPolicyRetirementCheckpoint,
} from '../src/approval.js';
const op = 'op_late_test', receiptDigest = `sha256:${'a'.repeat(64)}`;
const entry = { id: `permit_${'1'.repeat(24)}`, approvalId: `aegis_${'1'.repeat(16)}` };
const other = { id: `permit_${'2'.repeat(24)}`, approvalId: `aegis_${'2'.repeat(16)}` };
const blocked = { status: 'blocked', retryable: false, reason: 'policy_lifecycle_inconsistent' };
type Outcome = 'committed' | 'failed';
type Route = 'retired' | 'legacy' | 'auto' | 'explicit';
function fixture(route: Route, outcome: Outcome, foreign = false, full = route === 'retired') {
  const permit = { ...entry }, p = foreign ? other : entry;
  const record: DurableStrictRosterPolicyRetirement | DurableStrictRosterPolicyRetirementCheckpoint = full
    ? { operationId: op, permitId: p.id, approvalId: p.approvalId, status: 'retired', outcome, receiptDigest, terminalRevision: 3 }
    : { operationId: op, status: 'retirement_compacted', outcome, receiptDigest, terminalRevision: 3, verified: true,
        checkpointDigest: `sha256:${createHash('sha256').update(JSON.stringify({ approvalId: p.approvalId, operationId: op, outcome, permitId: p.id, receiptDigest, terminalRevision: 3 })).digest('hex')}` };
  let hook = async (_phase: string) => {};
  const calls: string[] = [];
  const store = {
    async readStrictRosterPolicy() { calls.push('read'); const value = structuredClone(record); await hook('read'); return value; },
    ...(['auto', 'explicit'].includes(route) ? {
      async readCompactRetirementCheckpointAuthorities() {
        calls.push('authority');
        const { status: _status, ...fields } = structuredClone(record);
        const values = ['authority-A', 'authority-B'].map(authorityId => ({ authorityId, ...fields }));
        await hook('authority'); return values;
      },
    } : {}),
  } as MultiAuthorityCompactableDurableStrictRosterPolicyStore;
  const resolve = route === 'retired' ? retired : route === 'explicit' ? plural : compact;
  return { permit, calls, record, hook: (fn: typeof hook) => { hook = fn; }, run: () => resolve(permit, op, store) };
}
describe('late lifecycle resolution binds entry identity', () => {
  for (const route of ['retired', 'legacy', 'auto', 'explicit'] as const) for (const outcome of ['committed', 'failed'] as const) {
    const success = { status: 'retired', retryable: false, reason: `effect_${outcome}` };
    it(`${route}/${outcome}: exact and equivalent identities remain mutable`, async () => {
      const f = fixture(route, outcome);
      f.hook(async () => { await Promise.resolve(); Object.assign(f.permit, entry); });
      expect(await f.run()).toEqual(success); expect(Object.isFrozen(f.permit)).toBe(false);
    });
    it(`${route}/${outcome}: foreign proof cannot repair caller identity`, async () => {
      const f = fixture(route, outcome, true), before = structuredClone(f.record);
      expect(await f.run()).toEqual(blocked);
      f.hook(async () => { await Promise.resolve(); Object.assign(f.permit, other); });
      expect(await f.run()).toEqual(blocked); expect(f.record).toEqual(before); expect(f.permit).toEqual(other);
    });
    for (const field of ['id', 'approvalId'] as const) it(`${route}/${outcome}: detects ${field} drift before a later restore`, async () => {
      const f = fixture(route, outcome);
      f.hook(async phase => { await Promise.resolve(); if (phase === 'read') f.permit[field] = other[field]; else Object.assign(f.permit, entry); });
      expect(await f.run()).toEqual(blocked); expect(f.calls).not.toContain('authority');
      f.hook(async () => {}); Object.assign(f.permit, entry); expect(await f.run()).toEqual(success);
    });
    it(`${route}/${outcome}: read outage preserves uncertainty then recovers`, async () => {
      const f = fixture(route, outcome); f.hook(async () => { throw Error('unavailable'); });
      expect(await f.run()).toEqual({ status: 'indeterminate', retryable: false, reason: 'policy_unavailable' });
      f.hook(async () => {}); expect(await f.run()).toEqual(success);
    });
    if (route === 'auto' || route === 'explicit') {
      it(`${route}/${outcome}: authority-await drift rejects without mutating caller`, async () => {
        const f = fixture(route, outcome); f.hook(async phase => { if (phase === 'authority') Object.assign(f.permit, other); });
        expect(await f.run()).toEqual(blocked); expect(f.permit).toEqual(other);
      });
      it(`${route}/${outcome}: full tombstone bypass still binds entry`, async () => {
        const f = fixture(route, outcome, true, true); f.hook(async () => { Object.assign(f.permit, other); });
        expect(await f.run()).toEqual(blocked); expect(f.calls).not.toContain('authority');
      });
    }
  }
});
