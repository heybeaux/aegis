import {describe,expect,it} from 'vitest';
import {evaluate,loadPack,type ToolCall} from '@heybeaux/lattice-aegis';
import {approvalId,createExecutionPermitWithStore,finalizeExecutionPermitWithStore,type ApprovalExecutionPermitRecord} from '../src/approval.js';
const rules=loadPack({packId:'test',version:'1',rules:[{id:'test.ask',category:'secrets',severity:'high',description:'review',appliesTo:['*'],match:{kind:'substring',target:'content',pattern:'REVIEW'}}]});
function fixture(){
 const call:ToolCall={tool:'Bash',command:'pwd',content:'REVIEW',approvalProvenance:{actorId:'root',authorizationDigest:'epoch1'},approvalDelegation:{effectiveConsumerId:'root',declaredScope:'none',maxDepth:0,links:[{actorId:'root',authorityLevel:1,verified:true}],revoked:false,revocationChecked:true,structurallyValid:true}};
 const evaluation=evaluate(call,rules),id=approvalId(call,evaluation),options={issuanceId:'grant-1',recoverExisting:true};
 const current={approvalId:id,authorizationDigest:'epoch1',effectiveConsumerId:'root',links:call.approvalDelegation!.links,revoked:false,revocationChecked:true,structurallyValid:true};
 const ready=new Map<string,ApprovalExecutionPermitRecord>(),issued=new Set<string>();let fault='',creates=0,reads=0;
 const adapter=()=>({
  async create(){throw Error('legacy must not be used');},
  async createOnce(r:ApprovalExecutionPermitRecord){creates++;if(fault==='before')throw Error('before');if(issued.has(r.id))return false;issued.add(r.id);ready.set(r.id,structuredClone(r));if(fault==='after')throw Error('ack lost');return true;},
  async readIssuedPermit(key:string){reads++;return issued.has(key)?structuredClone(ready.get(key)):undefined;},
  async take(key:string){const r=ready.get(key);ready.delete(key);return r;}
 });
 const mint=(store=adapter(),opts=options)=>createExecutionPermitWithStore(call,evaluation,id,store,opts);
 return {call,evaluation,id,options,current,ready,issued,adapter,mint,counts:()=>({creates,reads}),fault:(x:string)=>{fault=x;}};
}
describe('shared issuance acknowledgement recovery',()=>{
 it('recovers committed create after lost acknowledgement and never remints',async()=>{const f=fixture();f.fault('after');const p=await f.mint();expect(f.counts()).toEqual({creates:1,reads:1});expect(await finalizeExecutionPermitWithStore(p,f.current,f.adapter())).toBe(true);f.fault('');await expect(f.mint()).rejects.toThrow();expect(f.issued.size).toBe(1);});
 it('two recovered handles authorize only one concurrent finalizer',async()=>{const f=fixture();const original=await f.mint();const [a,b]=await Promise.all([f.mint(),f.mint()]);expect(a).toEqual(original);expect(b).toEqual(original);expect(await Promise.all([finalizeExecutionPermitWithStore(a,f.current,f.adapter()),finalizeExecutionPermitWithStore(b,f.current,f.adapter())])).toEqual([true,false]);});
 it('recovered handle still burns against revoked authority',async()=>{const f=fixture();await f.mint();const p=await f.mint();expect(await finalizeExecutionPermitWithStore(p,{...f.current,revoked:true},f.adapter())).toBe(false);await expect(f.mint()).rejects.toThrow();});
 it('fresh grant remains distinct after recovery and stale handle cannot steal it',async()=>{const f=fixture();await f.mint();const p=await f.mint();expect(await finalizeExecutionPermitWithStore(p,f.current,f.adapter())).toBe(true);const q=await f.mint(f.adapter(),{issuanceId:'grant-2',recoverExisting:true});expect(p.id).not.toBe(q.id);expect(await finalizeExecutionPermitWithStore(p,f.current,f.adapter())).toBe(false);expect(await finalizeExecutionPermitWithStore(q,f.current,f.adapter())).toBe(true);});
 it('precommit failure rejects but permits a healthy retry',async()=>{const f=fixture();f.fault('before');await expect(f.mint()).rejects.toThrow();expect(f.issued.size).toBe(0);f.fault('');expect(await finalizeExecutionPermitWithStore(await f.mint(),f.current,f.adapter())).toBe(true);});
 it('requires readback capability before any storage mutation',async()=>{const f=fixture(),a=f.adapter();const {readIssuedPermit:_,...incapable}=a;await expect(createExecutionPermitWithStore(f.call,f.evaluation,f.id,incapable,f.options)).rejects.toThrow(/capability/);expect(f.counts()).toEqual({creates:0,reads:0});});
 it.each(['id','approvalId','signature','authorizationDigest','effectiveConsumerId','links','declaredScope','maxDepth','tool','processTarget'])('rejects mismatched readback %s',async field=>{const f=fixture();await f.mint();const a=f.adapter(),read=a.readIssuedPermit;a.readIssuedPermit=async key=>{const r=await read(key);return {...r,[field]:'wrong'} as ApprovalExecutionPermitRecord;};await expect(f.mint(a)).rejects.toThrow();expect(f.ready.size).toBe(1);});
 it.each(['missing','throws'])('fails closed when readback %s',async mode=>{const f=fixture();await f.mint();const a=f.adapter();a.readIssuedPermit=async()=>{if(mode==='throws')throw Error('unavailable');return undefined;};await expect(f.mint(a)).rejects.toThrow();expect(f.ready.size).toBe(1);});
 it.each([null,'true',1,{}])('rejects malformed recovery mode %j before storage',async value=>{const f=fixture();await expect(f.mint(f.adapter(),{issuanceId:'grant-1',recoverExisting:value as boolean})).rejects.toThrow();expect(f.counts()).toEqual({creates:0,reads:0});});
 it('default and explicit false still reject duplicates without reading',async()=>{const f=fixture(),a=f.adapter();await f.mint();await expect(createExecutionPermitWithStore(f.call,f.evaluation,f.id,a,{issuanceId:'grant-1'})).rejects.toThrow();await expect(f.mint(a,{issuanceId:'grant-1',recoverExisting:false})).rejects.toThrow();expect(f.counts().reads).toBe(0);});
 it('captures mode, expected record and readback method before await',async()=>{const f=fixture(),a=f.adapter();await f.mint();let release:()=>void=()=>{};const wait=new Promise<void>(resolve=>{release=resolve;});a.createOnce=async r=>{r.authorizationDigest='tampered';await wait;return false;};const pending=f.mint(a);f.options.recoverExisting=false;f.call.approvalProvenance!.authorizationDigest='changed';a.readIssuedPermit=async()=>undefined;release();const p=await pending;expect(await finalizeExecutionPermitWithStore(p,f.current,f.adapter())).toBe(true);});
});
