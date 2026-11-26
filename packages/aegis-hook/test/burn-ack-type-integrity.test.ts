import { describe, expect, it } from 'vitest';
import { evaluate, loadPack, type ToolCall } from '@heybeaux/lattice-aegis';
import {
  approvalId, createExecutionPermitWithStore, finalizeExecutionPermitWithEffectJournal,
  resolveExecutionEffect, beginExecutionEffect,
  type ApprovalExecutionPermitRecord, type ApprovalExecutionSnapshot,
  type ApprovalExecutionEffectRecord,
} from '../src/approval.js';

const rules = loadPack({ packId: 'test', version: '1', rules: [] });
async function fixture(finalize = true) {
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
  if (finalize) await finalizeExecutionPermitWithEffectJournal(permit, clean, 'op_test', store);
  return { current, clean, permit, store,
    finish: () => finalizeExecutionPermitWithEffectJournal(permit, current, 'op_test', store),
    resolve: () => resolveExecutionEffect(original, clean, 'op_test', { ...store }),
    begin: () => beginExecutionEffect(original, clean, 'op_test', { ...store }),
    prepare: (f: () => void) => { duringPrepare = f; },
    claim: (f: () => void) => { duringClaim = f; }, state: () => ({ record, effect }) };
}
const execute = { status: 'execute', retryable: false };
describe('burn acknowledgement type integrity (SwarmLab RT-86)', () => {
 for (const api of ['finalize','resolve','begin'] as const) {
  for (const [label,value] of [['false',false],['string false','false'],['string true','true'],['one',1],['object',{ok:false}],['array',[]],['null',null],['undefined',undefined],['boxed true',new Boolean(true)]] as const) {
   it(`${api} requires literal true, not ${label}`, async () => {
    const f=await fixture(api!=='finalize');f.current.revoked=true;let calls=0;
    f.store.burnEffect=async()=>{calls++;return value as boolean;};
    const invoke=api==='finalize'?finalizeExecutionPermitWithEffectJournal:api==='resolve'?resolveExecutionEffect:beginExecutionEffect;
    expect(await invoke(f.permit,f.current,'op_test',f.store)).toEqual({status:'indeterminate',retryable:false,reason:api==='resolve'?'journal_unavailable':'status_unavailable'});
    expect(calls).toBe(1);expect(f.state().effect?.state).toBe('authorized');
    // Unconfirmed invalidation requires host quarantine; the store still permits a clean start.
    expect(await f.begin()).toEqual(execute);
    expect(await f.begin()).toEqual({status:'blocked',retryable:false,reason:'effect_started'});
   });
  }
  it(`${api} accepts a confirmed burn and reports a lost acknowledgement honestly`,async()=>{
   const invoke=api==='finalize'?finalizeExecutionPermitWithEffectJournal:api==='resolve'?resolveExecutionEffect:beginExecutionEffect;
   for(const lost of [false,true]){
    const f=await fixture(api!=='finalize');f.current.revoked=true;
    const burn=f.store.burnEffect;f.store.burnEffect=async()=>{const result=await burn();if(lost)throw Error('lost acknowledgement');return result;};
    expect(await invoke(f.permit,f.current,'op_test',f.store)).toEqual(lost?{status:'indeterminate',retryable:false,reason:api==='resolve'?'journal_unavailable':'status_unavailable'}:{status:api==='resolve'?'not_executed':'blocked',retryable:false,reason:'invalid_snapshot'});
    expect(f.state().effect?.state).toBe('burned');expect(await f.begin()).toEqual({status:'blocked',retryable:false,reason:'authorization_burned'});
   }
  });
 }
});
