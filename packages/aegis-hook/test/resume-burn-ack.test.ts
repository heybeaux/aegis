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
  await finalizeExecutionPermitWithEffectJournal(permit, clean, 'op_test', store);
  return { current, clean, permit, store,
    finish: () => finalizeExecutionPermitWithEffectJournal(permit, current, 'op_test', store),
    resolve: () => resolveExecutionEffect(original, clean, 'op_test', { ...store }),
    begin: () => beginExecutionEffect(original, clean, 'op_test', { ...store }),
    prepare: (f: () => void) => { duringPrepare = f; },
    claim: (f: () => void) => { duringClaim = f; }, state: () => ({ record, effect }) };
}
const execute = { status: 'execute', retryable: false };
describe('resume invalidation acknowledgement (SwarmLab RT-72)', () => {
 for (const api of ['resolve', 'begin'] as const) {
  const invoke = (f: Awaited<ReturnType<typeof fixture>>) => (api === 'resolve' ? resolveExecutionEffect : beginExecutionEffect)(f.permit, f.current, 'op_test', f.store);
  for (const mode of ['valid','confirmed','false','throw-before','throw-after','concurrent-start'] as const) {
   it(`${api} reports ${mode} without inventing durable invalidation`, async () => {
    const f=await fixture();if(mode!=='valid')f.current.revoked=true;
    const burn=f.store.burnEffect;let calls=0;
    f.store.burnEffect=async()=>{
     calls++;
     if(mode==='false')return false;
     if(mode==='throw-before')throw Error('unavailable');
     if(mode==='concurrent-start'){
      expect(await f.begin()).toEqual(execute);
      return false;
     }
     const result=await burn();
     if(mode==='throw-after')throw Error('ack lost');
     return result;
    };
    const result=await invoke(f);
    if(mode==='valid'){
     expect(result).toEqual(api==='resolve'?{status:'not_executed',retryable:true,reason:'not_started'}:execute);
     expect(calls).toBe(0);
    }else if(mode==='confirmed'){
     expect(result).toEqual({status:api==='resolve'?'not_executed':'blocked',retryable:false,reason:'invalid_snapshot'});
     expect(calls).toBe(1);
    }else{
     expect(result).toEqual({status:'indeterminate',retryable:false,reason:api==='resolve'?'journal_unavailable':'status_unavailable'});
     expect(calls).toBe(1);
    }
    const state=mode==='confirmed'||mode==='throw-after'?'burned':mode==='concurrent-start'||(mode==='valid'&&api==='begin')?'started':'authorized';
    expect(f.state().effect?.state).toBe(state);
    expect(await f.begin()).toEqual(state==='authorized'?execute:{status:'blocked',retryable:false,reason:state==='burned'?'authorization_burned':'effect_started'});
    expect(await f.begin()).toMatchObject({status:'blocked',retryable:false});
   });
  }
  it(`${api} reports uncertainty for a failed drift-triggered burn`,async()=>{
   const f=await fixture(),read=f.store.readEffect;
   f.store.readEffect=async()=>{f.current.revoked=true;return read();};
   f.store.burnEffect=async()=>false;
   expect(await invoke(f)).toEqual({status:'indeterminate',retryable:false,reason:api==='resolve'?'journal_unavailable':'status_unavailable'});
   expect(f.state().effect?.state).toBe('authorized');
  });
 }
});
