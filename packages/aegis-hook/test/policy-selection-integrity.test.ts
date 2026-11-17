import { describe, expect, it } from 'vitest';
import {
  selectDurableStrictRosterPolicy as select,
  type ApprovalExecutionPermit,
  type ApprovalExecutionSnapshot,
  type DurableStrictRosterPolicyLifecycleRecord,
} from '../src/approval.js';

const operationId = 'op_selection';
function fixture() {
  const permit: ApprovalExecutionPermit = { id: `permit_${'1'.repeat(24)}`, approvalId: `aegis_${'1'.repeat(16)}` };
  const current = { approvalId: permit.approvalId } as ApprovalExecutionSnapshot;
  const entry = { operationId, permitId: permit.id, approvalId: permit.approvalId };
  const records = new Map<string, DurableStrictRosterPolicyLifecycleRecord>();
  const store = {
    async bindStrictRosterPolicy(id: string, marker: DurableStrictRosterPolicyLifecycleRecord) {
      if (records.has(id)) return false;
      records.set(id, structuredClone(marker));
      return true;
    },
    async readStrictRosterPolicy(id: string) { return structuredClone(records.get(id)); },
  };
  return { permit, current, entry, records, store };
}

describe('strict policy selection entry binding', () => {
  for (const distinctApproval of [false, true]) for (const phase of ['bind', 'read']) {
    it(`rejects foreign readback despite caller repair: distinct=${distinctApproval}, phase=${phase}`, async () => {
      const f = fixture();
      const foreign = { ...f.entry, permitId: `permit_${'2'.repeat(24)}`, approvalId: distinctApproval ? `aegis_${'2'.repeat(16)}` : f.entry.approvalId };
      f.records.set(operationId, foreign);
      const change = async (at: string) => {
        await Promise.resolve();
        if (at === phase) { f.permit.id = foreign.permitId; f.permit.approvalId = foreign.approvalId; f.current.approvalId = foreign.approvalId; }
      };
      const adapter = {
        async bindStrictRosterPolicy(id: string, marker: DurableStrictRosterPolicyLifecycleRecord) {
          const result = await f.store.bindStrictRosterPolicy(id, marker); await change('bind'); return result;
        },
        async readStrictRosterPolicy(id: string) { const result = await f.store.readStrictRosterPolicy(id); await change('read'); return result; },
      };
      expect(await select(f.permit, f.current, operationId, adapter)).toBeUndefined();
      expect(f.records.get(operationId)).toEqual(foreign);
      expect(f.permit.id).toBe(foreign.permitId);
      expect(await select({ id: f.entry.permitId, approvalId: f.entry.approvalId }, { approvalId: f.entry.approvalId } as ApprovalExecutionSnapshot, operationId, f.store)).toBeUndefined();
    });
  }

  for (const field of ['permitId', 'permitApproval', 'currentApproval']) for (const phase of ['bind', 'read', 'bind-restore']) {
    it(`rejects observed ${field} drift at ${phase} without deleting a committed marker`, async () => {
      const f = fixture(), originalPermit = structuredClone(f.permit), originalCurrent = structuredClone(f.current);
      let reads = 0;
      const change = async (at: string) => {
        await Promise.resolve();
        if (phase === at || (phase === 'bind-restore' && at === 'bind')) {
          if (field === 'permitId') f.permit.id = `permit_${'2'.repeat(24)}`;
          else if (field === 'permitApproval') f.permit.approvalId = `aegis_${'2'.repeat(16)}`;
          else f.current.approvalId = `aegis_${'2'.repeat(16)}`;
        }
        if (phase === 'bind-restore' && at === 'read') { Object.assign(f.permit, originalPermit); Object.assign(f.current, originalCurrent); }
      };
      const adapter = {
        async bindStrictRosterPolicy(id: string, marker: DurableStrictRosterPolicyLifecycleRecord) {
          const result = await f.store.bindStrictRosterPolicy(id, marker); await change('bind'); return result;
        },
        async readStrictRosterPolicy(id: string) { reads++; const result = await f.store.readStrictRosterPolicy(id); await change('read'); return result; },
      };
      expect(await select(f.permit, f.current, operationId, adapter)).toBeUndefined();
      expect(f.records.get(operationId)).toEqual(f.entry);
      if (phase !== 'read') expect(reads).toBe(0);
      expect(Object.isFrozen(f.permit)).toBe(false);
      expect(Object.isFrozen(f.current)).toBe(false);
      expect(await select(originalPermit, originalCurrent, operationId, f.store)).toEqual(f.entry);
    });
  }

  it('preserves fresh selection, exact duplicates and detached return values', async () => {
    const f = fixture();
    const first = await select(f.permit, f.current, operationId, f.store);
    expect(first).toEqual(f.entry);
    first!.permitId = 'caller-edit';
    expect(f.records.get(operationId)).toEqual(f.entry);
    expect(await select({ ...f.permit }, { ...f.current }, operationId, f.store)).toEqual(f.entry);
  });

  it.each(['bind', 'read'])('returns no receipt on %s outage without removing storage truth', async (phase) => {
    const f = fixture();
    const adapter = { ...f.store,
      async bindStrictRosterPolicy(id: string, marker: DurableStrictRosterPolicyLifecycleRecord) {
        const result = await f.store.bindStrictRosterPolicy(id, marker); if (phase === 'bind') throw Error('ack lost'); return result;
      },
      async readStrictRosterPolicy(id: string) { if (phase === 'read') throw Error('unavailable'); return f.store.readStrictRosterPolicy(id); },
    };
    expect(await select(f.permit, f.current, operationId, adapter)).toBeUndefined();
    expect(f.records.get(operationId)).toEqual(f.entry);
    expect(await select(f.permit, f.current, operationId, f.store)).toEqual(f.entry);
  });
});
