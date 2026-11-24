import {describe,expect,it,vi} from 'vitest';
import {evaluate,loadPack,type ToolCall} from '@heybeaux/lattice-aegis';
import {
  approvalId,createExecutionPermitWithStore,finalizeExecutionPermitWithStore,
  finalizeExecutionPermitWithReconciliation,
  type ApprovalExecutionPermitRecord,type ApprovalExecutionFinalizationOptions,
} from '../src/approval.js';
const rules=loadPack({packId:'test',version:'1',rules:[]});
async function fixture(api:'simple'|'reconciled') {
  const call:ToolCall={tool:'Bash',command:'pwd',approvalProvenance:{actorId:'root',authorizationDigest:'epoch'},approvalDelegation:{effectiveConsumerId:'root',declaredScope:'none',maxDepth:0,links:[{actorId:'root',authorityLevel:1,verified:true,revoked:false}]}};
  const evaluation=evaluate(call,rules),id=approvalId(call,evaluation);
  const current={approvalId:id,authorizationDigest:'epoch',effectiveConsumerId:'root',links:structuredClone(call.approvalDelegation!.links),revoked:false,revocationChecked:true,structurallyValid:true};
  let ready:ApprovalExecutionPermitRecord|undefined,prepared:ApprovalExecutionPermitRecord|undefined;
  let prepare=()=>{},claim=()=>{};
  const store={async create(r:ApprovalExecutionPermitRecord){ready=structuredClone(r);return true;},async take(){claim();const r=ready;ready=undefined;return r;},async prepareTake(){if(!ready)return false;prepared=ready;ready=undefined;prepare();return true;},async claimPreparedTake(){claim();const r=prepared;prepared=undefined;return r;}};
  const permit=await createExecutionPermitWithStore(call,evaluation,id,store);
  return {current,permit,store,setPrepare:(fn:()=>void)=>{prepare=fn;},setClaim:(fn:()=>void)=>{claim=fn;},state:()=>({ready,prepared}),finish:(options?:ApprovalExecutionFinalizationOptions)=>api==='simple'?finalizeExecutionPermitWithStore(permit,current,store,options):finalizeExecutionPermitWithReconciliation(permit,current,'op_lease',store,options)};
}
for(const api of ['simple','reconciled'] as const)describe(`${api} execution authority lease`,()=>{
 const allowed=api==='simple'?true:{status:'execute',retryable:false};
 const blocked=api==='simple'?false:{status:'blocked',retryable:false,reason:'invalid_snapshot'};
 it.each([150,200])('allows time %s within inclusive lease',async end=>{const f=await fixture(api);let now=100;f.setClaim(()=>{now=end;});expect(await f.finish({validUntilMs:200,nowMs:()=>now})).toEqual(allowed);expect(await f.finish()).not.toEqual(allowed);});
 it.each([201,99,NaN,Infinity])('burns invalid clock/deadline at claim %s',async end=>{const f=await fixture(api);let now=100;f.setClaim(()=>{now=end;});expect(await f.finish({validUntilMs:200,nowMs:()=>now})).toEqual(blocked);expect(f.state()).toEqual({ready:undefined,prepared:undefined});expect(await f.finish()).not.toEqual(allowed);});
 it('burns already expired entry',async()=>{const f=await fixture(api);expect(await f.finish({validUntilMs:200,nowMs:()=>201})).toEqual(blocked);expect(await f.finish()).not.toEqual(allowed);});
 it('contains throwing clock',async()=>{const f=await fixture(api);let fail=false;f.setClaim(()=>{fail=true;});expect(await f.finish({validUntilMs:200,nowMs:()=>{if(fail)throw Error('clock');return 100;}})).toEqual(blocked);expect(f.state()).toEqual({ready:undefined,prepared:undefined});});
 it.each([NaN,Infinity,200.5,-1])('rejects malformed deadline %s',async deadline=>{const f=await fixture(api);expect(await f.finish({validUntilMs:deadline,nowMs:()=>100})).toEqual(blocked);});
 it('captures deadline and clock without freezing producer values',async()=>{const f=await fixture(api);let now=100;const opts={validUntilMs:200,nowMs:()=>now};f.setClaim(()=>{now=201;opts.validUntilMs=1000;opts.nowMs=()=>0;});expect(await f.finish(opts)).toEqual(blocked);expect(opts.validUntilMs).toBe(1000);expect(Object.isFrozen(opts)).toBe(false);expect(f.current.revoked).toBe(false);});
 it('uses real epoch clock by default',async()=>{const f=await fixture(api);const clock=vi.spyOn(Date,'now').mockReturnValue(100);try{f.setClaim(()=>{clock.mockReturnValue(201);});expect(await f.finish({validUntilMs:200})).toEqual(blocked);}finally{clock.mockRestore();}});
 it('never samples the clock when options omitted',async()=>{const f=await fixture(api);const clock=vi.spyOn(Date,'now').mockImplementation(()=>{throw Error('must not sample');});try{expect(await f.finish()).toEqual(allowed);expect(clock).not.toHaveBeenCalled();}finally{clock.mockRestore();}});
 it('does not override revoked authority',async()=>{const f=await fixture(api);f.current.revoked=true;expect(await f.finish({validUntilMs:200,nowMs:()=>100})).toEqual(blocked);});
 it('rejects null options and invalid clock',async()=>{for(const opts of [null,{validUntilMs:200,nowMs:42}]){const f=await fixture(api);expect(await f.finish(opts as unknown as ApprovalExecutionFinalizationOptions)).toEqual(blocked);}});
});
it.each([false,true])('remembers expiry through prepare acknowledgement loss=%s',async loseAck=>{const f=await fixture('reconciled');let now=100;f.setPrepare(()=>{now=201;if(loseAck)throw Error('lost ack');});f.setClaim(()=>{now=100;});expect(await f.finish({validUntilMs:200,nowMs:()=>now})).toEqual({status:'blocked',retryable:false,reason:'invalid_snapshot'});expect(f.state()).toEqual({ready:undefined,prepared:undefined});});
