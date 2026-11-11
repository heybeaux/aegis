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
const mutations: [string, (s: ApprovalExecutionSnapshot) => void][] = [
 ['revoked', s => { s.revoked = true; }],
 ['digest', s => { s.authorizationDigest = 'wrong'; }],
 ['link', s => { s.links![0]!.revoked = true; }],
 ['unchecked', s => { s.revocationChecked = false; }],
];
describe('resume/start caller authority binding', () => {
 for (const api of ['resolve', 'begin'] as const) {
  const invoke = (f: Awaited<ReturnType<typeof fixture>>) => (api === 'resolve' ? resolveExecutionEffect : beginExecutionEffect)(f.permit, f.current, 'op_test', f.store);
  for (const [name, invalidate] of mutations) it(`${api} rejects ${name} repaired during read and burns`, async () => {
   const f=await fixture();invalidate(f.current);const read=f.store.readEffect;
   f.store.readEffect=async (...args)=>{await Promise.resolve();Object.assign(f.current,structuredClone(f.clean));return read(...args);};
   expect(await invoke(f)).toEqual({status:api==='resolve'?'not_executed':'blocked',retryable:false,reason:'invalid_snapshot'});
   expect(f.state().effect?.state).toBe('burned');
   expect(await f.begin()).toMatchObject({status:'blocked',reason:'authorization_burned'});
   expect(f.current).toEqual(f.clean);expect(Object.isFrozen(f.current)).toBe(false);
  });
  it(`${api} preserves equivalent nested data and valid lifecycle`,async()=>{
   const f=await fixture(),read=f.store.readEffect;
   f.store.readEffect=async (...args)=>{f.current.links=structuredClone(f.current.links);return read(...args);};
   expect(await invoke(f)).toEqual(api==='resolve'?{status:'not_executed',retryable:true,reason:'not_started'}:execute);
   if(api==='resolve')expect(await f.begin()).toEqual(execute);
   expect(await f.begin()).toMatchObject({status:'blocked',reason:'effect_started'});
  });
  it(`${api} rejects handle drift using the original record binding`,async()=>{
   const f=await fixture(),read=f.store.readEffect;
   f.store.readEffect=async (...args)=>{f.permit.id='permit_000000000000000000000000';return read(...args);};
   expect(await invoke(f)).toMatchObject({retryable:false,reason:'invalid_snapshot'});
   expect(f.state().effect?.state).toBe('burned');
  });
 }
 for(const stage of ['cas','post-read','cas-restored-at-read'] as const) it(`blocks revocation at ${stage} without rolling back start`,async()=>{
  const f=await fixture(),begin=f.store.beginEffect,read=f.store.readEffect;let reads=0;
  f.store.beginEffect=async (...args)=>{if(stage!=='post-read')f.current.revoked=true;return begin(...args);};
  f.store.readEffect=async (...args)=>{reads++;if(reads===2)f.current.revoked=stage!=='cas-restored-at-read';return read(...args);};
  expect(await beginExecutionEffect(f.permit,f.current,'op_test',f.store)).toEqual({status:'blocked',retryable:false,reason:'invalid_snapshot'});
  expect(f.state().effect?.state).toBe('started');
  expect(await f.begin()).toMatchObject({status:'blocked',reason:'effect_started'});
 });
});
