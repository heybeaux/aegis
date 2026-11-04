import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluate, type ToolCall } from '@heybeaux/lattice-aegis';
import * as api from '../src/approval.js';
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const target = () => ({ hostId: 'host', sessionId: 'session', generationId: 'g1', verified: true });
const call = (): ToolCall => ({ tool: 'ProcessInput', processTarget: target(), processInputDigest: 'payload',
  approvalProvenance: { actorId: 'root', sessionId: 'agent', workspaceId: 'lab', taskIntentId: 'write', authorizationDigest: 'epoch1', grantScope: 'exact_session' },
  approvalDelegation: { effectiveConsumerId: 'root', declaredScope: 'none', maxDepth: 0, links: [{ actorId: 'root', authorityLevel: 1, verified: true }], revoked: false, revocationChecked: true, structurallyValid: true } });
function fixture() {
  const c = call(), e = evaluate(c, []), id = api.approvalId(c, e);
  const dir = mkdtempSync(join(tmpdir(), 'aegis-process-permit-')); dirs.push(dir);
  const pending = api.requestApproval(c, e, dir); api.approvePending(pending.id, dir);
  expect(api.consumeApproval(c, e, dir)).toBe(true);
  const current = { approvalId: id, authorizationDigest: 'epoch1', effectiveConsumerId: 'root', links: c.approvalDelegation!.links, revoked: false, revocationChecked: true, structurallyValid: true, processTarget: target() };
  const records = new Map<string, api.ApprovalExecutionPermitRecord>();
  const prepared = new Map<string, api.ApprovalExecutionPermitRecord>();
  const effects = new Map<string, api.ApprovalExecutionEffectRecord>();
  const store = {
    async create(r: api.ApprovalExecutionPermitRecord) { if (records.has(r.id)) return false; records.set(r.id, structuredClone(r)); return true; },
    async take(id: string) { const r = records.get(id); records.delete(id); return r; },
    async prepareTake(id: string, op: string) { const r = records.get(id); if (!r) return false; records.delete(id); prepared.set(op, r); return true; },
    async claimPreparedTake(op: string) { const r = prepared.get(op); prepared.delete(op); return r; },
    async prepareEffect(id: string, op: string) { if (effects.has(op)) return effects.get(op)!.permit.id === id; const r = records.get(id); if (!r) return false; records.delete(id); effects.set(op, { operationId: op, permit: r, state: 'authorized', claimed: false }); return true; },
    async claimPreparedEffect(op: string) { const e = effects.get(op); if (!e || e.claimed || e.state !== 'authorized') return undefined; e.claimed = true; return structuredClone(e.permit); },
    async beginEffect(op: string) { const e = effects.get(op); if (!e || !e.claimed || e.state !== 'authorized') return false; e.state = 'started'; return true; },
    async commitEffect(op: string) { const e = effects.get(op); if (!e || e.state !== 'started') return false; e.state = 'committed'; return true; },
    async readEffect(op: string) { const e = effects.get(op); return e ? structuredClone(e) : undefined; },
    async burnEffect(op: string) { const e = effects.get(op); if (!e || e.state === 'committed') return false; e.state = 'burned'; return true; },
  };
  return { c, e, id, dir, current, store, records, effects };
}
describe('process lifetime at the execution boundary', () => {
  it.each(['hostId', 'sessionId', 'generationId'] as const)('local finalization burns drifted %s and replay', field => {
    const f = fixture(), permit = api.createExecutionPermit(f.c, f.e, f.id, f.dir);
    const current = structuredClone(f.current); current.processTarget[field] += '-new';
    expect(api.finalizeExecutionPermit(permit, current, f.dir)).toBe(false);
    expect(api.finalizeExecutionPermit(permit, f.current, f.dir)).toBe(false);
  });
  it.each([undefined, null, [], {}, { ...target(), verified: false }, { ...target(), generationId: ' ' }])('shared finalizer rejects invalid target %j', async evidence => {
    const f = fixture(), permit = await api.createExecutionPermitWithStore(f.c, f.e, f.id, f.store);
    const current = { ...f.current, processTarget: evidence } as unknown as api.ApprovalExecutionSnapshot;
    expect(await api.finalizeExecutionPermitWithStore(permit, current, f.store)).toBe(false);
    expect(await api.finalizeExecutionPermitWithStore(permit, f.current, f.store)).toBe(false);
  });
  it('detaches creation evidence and accepts equivalent fresh identity once', () => {
    const f = fixture(), permit = api.createExecutionPermit(f.c, f.e, f.id, f.dir);
    f.c.processTarget!.generationId = 'mutated';
    const stored = JSON.parse(readFileSync(join(f.dir, `${permit.id}.ready.json`), 'utf8'));
    expect(stored.processTarget).toEqual(target()); expect(stored.tool).toBe('ProcessInput');
    expect(api.finalizeExecutionPermit(permit, f.current, f.dir)).toBe(true);
    expect(api.finalizeExecutionPermit(permit, f.current, f.dir)).toBe(false);
  });
  it('rejects missing target at both permit creation APIs before store writes', async () => {
    const f = fixture(); delete f.c.processTarget; const id = api.approvalId(f.c, f.e);
    expect(() => api.createExecutionPermit(f.c, f.e, id, f.dir)).toThrow(/process target/);
    await expect(api.createExecutionPermitWithStore(f.c, f.e, id, f.store)).rejects.toThrow(/process target/);
    expect(f.records.size).toBe(0);
  });
  it.each(['reconcile', 'journal', 'begin', 'resolve'] as const)('uses target binding at %s boundary', async stage => {
    const f = fixture(), permit = await api.createExecutionPermitWithStore(f.c, f.e, f.id, f.store);
    const changed = structuredClone(f.current); changed.processTarget.generationId = 'g2';
    if (stage === 'reconcile') expect(await api.finalizeExecutionPermitWithReconciliation(permit, changed, 'op_test', f.store)).toMatchObject({ status: 'blocked', reason: 'invalid_snapshot' });
    if (stage === 'journal') expect(await api.finalizeExecutionPermitWithEffectJournal(permit, changed, 'op_test', f.store)).toMatchObject({ status: 'blocked', reason: 'invalid_snapshot' });
    if (stage === 'begin' || stage === 'resolve') {
      expect(await api.finalizeExecutionPermitWithEffectJournal(permit, f.current, 'op_test', f.store)).toMatchObject({ status: 'execute' });
      if (stage === 'begin') expect(await api.beginExecutionEffect(permit, changed, 'op_test', f.store)).toMatchObject({ status: 'blocked', reason: 'invalid_snapshot' });
      else expect(await api.resolveExecutionEffect(permit, changed, 'op_test', f.store)).toMatchObject({ status: 'not_executed', retryable: false, reason: 'invalid_snapshot' });
    }
  });
  it('preserves independent revocation and one-shot stable effect start', async () => {
    const f = fixture(), permit = await api.createExecutionPermitWithStore(f.c, f.e, f.id, f.store);
    expect(await api.finalizeExecutionPermitWithEffectJournal(permit, f.current, 'op_test', f.store)).toMatchObject({ status: 'execute' });
    expect(await api.beginExecutionEffect(permit, f.current, 'op_test', f.store)).toMatchObject({ status: 'execute' });
    expect(await api.beginExecutionEffect(permit, f.current, 'op_test', f.store)).not.toMatchObject({ status: 'execute' });
    const g = fixture(), p = await api.createExecutionPermitWithStore(g.c, g.e, g.id, g.store);
    expect(await api.finalizeExecutionPermitWithStore(p, { ...g.current, revoked: true }, g.store)).toBe(false);
  });
  it('rejects a target missing from a process-tagged stored permit', async () => {
    const f = fixture(), permit = await api.createExecutionPermitWithStore(f.c, f.e, f.id, f.store);
    const record = f.records.get(permit.id)! as api.ApprovalExecutionPermitRecord & { processTarget?: unknown; tool?: string };
    record.tool = 'ProcessInput'; delete record.processTarget;
    expect(await api.finalizeExecutionPermitWithStore(permit, f.current, f.store)).toBe(false);
  });
});
