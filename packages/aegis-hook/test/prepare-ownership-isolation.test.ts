import { describe, expect, it } from 'vitest';
import { evaluate, loadPack, type ToolCall } from '@heybeaux/lattice-aegis';
import { approvalId, createExecutionPermitWithStore, finalizeExecutionPermitWithEffectJournal as finalize,
  beginExecutionEffect as begin, type ApprovalExecutionPermitRecord, type ApprovalExecutionEffectRecord,
  type ApprovalExecutionSnapshot } from '../src/approval.js';
const rules=loadPack({packId:'test',version:'1',rules:[]});
const execute={status:'execute',retryable:false};
const uncertain={status:'indeterminate',retryable:false,reason:'status_unavailable'};
async function fixture(){
 const records=new Map<string,ApprovalExecutionPermitRecord>(),effects=new Map<string,ApprovalExecutionEffectRecord>();
 const issued=new Set<string>(),operations:string[]=[];
 const store={
  async create(r:ApprovalExecutionPermitRecord){records.set(r.id,structuredClone(r));return true;},
  async createOnce(r:ApprovalExecutionPermitRecord){if(issued.has(r.id))return false;issued.add(r.id);records.set(r.id,structuredClone(r));return true;},
  async take(id:string){const r=records.get(id);records.delete(id);return r;},
  async prepareEffect(id:string,op:string){const e=effects.get(op);if(e)return e.permit.id===id;const r=records.get(id);if(!r)return false;records.delete(id);effects.set(op,{operationId:op,permit:structuredClone(r),state:'authorized',claimed:false});return true;},
  async claimPreparedEffect(op:string){operations.push('claim');const e=effects.get(op);if(!e||e.claimed||e.state!=='authorized')return;e.claimed=true;return structuredClone(e.permit);},
  async readEffect(op:string){const e=effects.get(op);return e&&structuredClone(e);},
  async burnEffect(op:string){operations.push('burn');const e=effects.get(op);if(!e||['started','committed'].includes(e.state))return false;e.state='burned';return true;},
  async beginEffect(op:string){operations.push('begin');const e=effects.get(op);if(!e||!e.claimed||e.state!=='authorized')return false;e.state='started';return true;},
  async commitEffect(){return false;}
 };
 async function issue(issuanceId:string,command='pwd'){
  const call:ToolCall={tool:'Bash',command,approvalProvenance:{actorId:'root',authorizationDigest:'epoch'},approvalDelegation:{effectiveConsumerId:'root',declaredScope:'none',maxDepth:0,links:[{actorId:'root',authorityLevel:1,verified:true,revoked:false}]}};
  const evaluation=evaluate(call,rules),id=approvalId(call,evaluation);
  const current:ApprovalExecutionSnapshot={approvalId:id,authorizationDigest:'epoch',effectiveConsumerId:'root',links:structuredClone(call.approvalDelegation!.links),revoked:false,revocationChecked:true,structurallyValid:true};
  const permit=await createExecutionPermitWithStore(call,evaluation,id,store,{requireAtomicIssuance:true,issuanceId});
  return {permit,current};
 }
 return {store,records,effects,operations,issue};
}
describe('ambiguous preparation preserves operation ownership',()=>{
 for(const sameApproval of [false,true])for(const occupancy of ['unclaimed','claimed','started'])for(const lost of [false,true]){
  it(`same approval=${sameApproval} victim=${occupancy} lost ack=${lost}`,async()=>{
   const f=await fixture(),a=await f.issue('first'),b=await f.issue('second',sameApproval?'pwd':'ls');
   if(occupancy==='unclaimed')expect(await f.store.prepareEffect(a.permit.id,'op_shared')).toBe(true);
   else expect(await finalize(a.permit,a.current,'op_shared',f.store)).toEqual(execute);
   if(occupancy==='started')expect(await begin(a.permit,a.current,'op_shared',f.store)).toEqual(execute);
   const before=structuredClone(f.effects.get('op_shared')),offset=f.operations.length;
   const adapter={...f.store,async prepareEffect(id:string,op:string){expect(await f.store.prepareEffect(id,op)).toBe(false);if(lost)throw Error('response lost');return false;}};
   expect(await finalize(b.permit,b.current,'op_shared',adapter)).toEqual({status:'blocked',retryable:true,reason:'not_taken'});
   expect(f.effects.get('op_shared')).toEqual(before);expect(f.operations.slice(offset)).toEqual([]);expect(f.records.has(b.permit.id)).toBe(true);
   expect(await finalize(a.permit,a.current,'op_shared',f.store)).toEqual(occupancy==='unclaimed'?execute:{status:'blocked',retryable:false,reason:'not_taken'});
   expect(await begin(a.permit,a.current,'op_shared',f.store)).toEqual(occupancy==='started'?{status:'blocked',retryable:false,reason:'effect_started'}:execute);
   expect(await finalize(b.permit,b.current,'op_new',f.store)).toEqual(execute);
  });
 }
 for(const read of ['available','throws','missing','malformed','drift','drift-restored'])it(`own lost ack read=${read}`,async()=>{
  const f=await fixture(),a=await f.issue('first');
  const adapter={...f.store,async prepareEffect(id:string,op:string){await f.store.prepareEffect(id,op);throw Error('response lost');},async readEffect(op:string){if(read==='throws')throw Error('unavailable');if(read==='missing')return undefined;const e=await f.store.readEffect(op);if(read==='malformed')return {...e!,permit:{...e!.permit,signature:'tampered'}};if(read.startsWith('drift'))a.current.revoked=true;return e;},async claimPreparedEffect(op:string){if(read==='drift-restored')a.current.revoked=false;return f.store.claimPreparedEffect(op);}};
  const result=await finalize(a.permit,a.current,'op_own',adapter);
  if(read==='available')expect(result).toEqual(execute);
  else if(read.startsWith('drift')){expect(result).toEqual({status:'blocked',retryable:false,reason:'invalid_snapshot'});expect(f.effects.get('op_own')?.state).toBe('burned');}
  else {expect(result).toEqual(read==='missing'?{status:'blocked',retryable:true,reason:'not_taken'}:uncertain);expect(f.operations).toEqual([]);expect(f.effects.get('op_own')?.claimed).toBe(false);}
 });
});
