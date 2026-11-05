import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluate, loadPack, type ToolCall } from '@heybeaux/lattice-aegis';
import { requestApproval, approvePending, consumeApproval, createExecutionPermit, finalizeExecutionPermit, approvalId } from '../src/approval.js';
const rules=loadPack({packId:'test',version:'1',rules:[{id:'test.ask',category:'secrets',severity:'high',description:'review',appliesTo:['*'],match:{kind:'substring',target:'content',pattern:'REVIEW'}}]});
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'aegis-issuance-'));
 const call:ToolCall={tool:'Bash',command:'pwd',content:'REVIEW',approvalProvenance:{actorId:'root',authorizationDigest:'epoch1'},approvalDelegation:{effectiveConsumerId:'root',declaredScope:'none',maxDepth:0,links:[{actorId:'root',authorityLevel:1,verified:true}],revoked:false,revocationChecked:true,structurallyValid:true}};
 const evaluation=evaluate(call,rules),id=approvalId(call,evaluation);
 const current={approvalId:id,authorizationDigest:'epoch1',effectiveConsumerId:'root',links:call.approvalDelegation!.links,revoked:false,revocationChecked:true,structurallyValid:true};
 const consume=()=>{const p=requestApproval(call,evaluation,dir);approvePending(p.id,dir);expect(consumeApproval(call,evaluation,dir)).toBe(true);};
 return {dir,call,evaluation,id,current,consume,mint:()=>createExecutionPermit(call,evaluation,id,dir),clean:()=>rmSync(dir,{recursive:true,force:true})};
}
describe('local permit issuance lifetime',()=>{
 it.each([false,true])('cannot recreate a finalized issuance (revoked=%s)',revoked=>{const f=fixture();try{f.consume();const p=f.mint();expect(finalizeExecutionPermit(p,{...f.current,revoked},f.dir)).toBe(!revoked);expect(()=>f.mint()).toThrow();expect(existsSync(join(f.dir,`${p.id}.issued.json`))).toBe(true);}finally{f.clean();}});
 it.each([false,true])('fresh same-call consumption grants a different one-shot handle (revoked=%s)',revoked=>{const f=fixture();try{f.consume();const old=f.mint();finalizeExecutionPermit(old,{...f.current,revoked},f.dir);f.consume();const fresh=f.mint();expect(fresh.approvalId).toBe(old.approvalId);expect(fresh.id).not.toBe(old.id);expect(finalizeExecutionPermit(old,f.current,f.dir)).toBe(false);expect(finalizeExecutionPermit(fresh,f.current,f.dir)).toBe(true);expect(()=>f.mint()).toThrow();}finally{f.clean();}});
 it('does not refresh issuance for pending, approved or failed consumption',()=>{const f=fixture();try{f.consume();const p=f.mint();finalizeExecutionPermit(p,f.current,f.dir);const path=join(f.dir,`${f.id}.consumption.json`),before=readFileSync(path,'utf8');const pending=requestApproval(f.call,f.evaluation,f.dir);expect(consumeApproval(f.call,f.evaluation,f.dir)).toBe(false);expect(()=>f.mint()).toThrow();approvePending(pending.id,f.dir);expect(()=>f.mint()).toThrow();expect(readFileSync(path,'utf8')).toBe(before);}finally{f.clean();}});
 it('retains legacy initial issuance, but never resurrects it',()=>{const f=fixture();try{const p=f.mint();expect(finalizeExecutionPermit(p,f.current,f.dir)).toBe(true);expect(()=>f.mint()).toThrow();f.consume();const fresh=f.mint();expect(fresh.id).not.toBe(p.id);expect(finalizeExecutionPermit(fresh,f.current,f.dir)).toBe(true);}finally{f.clean();}});
 it.each(['null','[]','{}','{broken'])('fails closed on malformed existing consumption history %s',bytes=>{const f=fixture();try{f.consume();writeFileSync(join(f.dir,`${f.id}.consumption.json`),bytes);expect(()=>f.mint()).toThrow();}finally{f.clean();}});
 it('rejects a generation with another signature',()=>{const f=fixture();try{f.consume();const path=join(f.dir,`${f.id}.consumption.json`);const r=JSON.parse(readFileSync(path,'utf8'));r.signature='wrong';writeFileSync(path,JSON.stringify(r));expect(()=>f.mint()).toThrow(/invalid/);}finally{f.clean();}});
 it('does not overwrite an existing outstanding permit',()=>{const f=fixture();try{f.consume();const p=f.mint();const path=join(f.dir,`${p.id}.ready.json`),before=readFileSync(path,'utf8');expect(()=>f.mint()).toThrow();expect(readFileSync(path,'utf8')).toBe(before);expect(finalizeExecutionPermit(p,f.current,f.dir)).toBe(true);}finally{f.clean();}});
});
