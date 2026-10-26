import {mkdtempSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect,afterEach} from 'vitest';
import {openClawToolCall,createOpenClawAdapter} from '../src/openclaw.js';
import {approvalSignature} from '../src/approval.js';
import {actionKeyFor} from '../src/predictor.js';
import {runHook} from '../src/runtime.js';
import type {Evaluation} from '@heybeaux/lattice-aegis';
const fixed:Evaluation={action:'ask',reason:'identity probe',matches:[],decidedBy:'severity',ruleVersions:[]};
const event=(action='write')=>({toolName:'process',params:{action,sessionId:'session-a',data:'safe',keys:['x'],hex:['61'],literal:'x',text:'safe',bracketed:false,eof:false}});
afterEach(()=>{delete process.env['AEGIS_HOME'];delete process.env['AEGIS_COLLECT_DIR'];});
describe('process input adapter and runtime',()=>{
 it.each(['write','send-keys','submit','paste'])('classifies %s even benign/empty/decoy input',action=>{
  const e=event(action),before=structuredClone(e),call=openClawToolCall(e);expect(call.tool).toBe('ProcessInput');expect(call.processInputDigest).toMatch(/^[a-f0-9]{64}$/);expect(e).toEqual(before);
  expect(openClawToolCall({toolName:'PrOcEsS',params:{action}}).tool).toBe('ProcessInput');
 });
 it.each(['list','poll','log','kill','clear','remove','unknown'])('preserves %s management behavior',action=>{expect(openClawToolCall(event(action)).tool).toBe('process');expect(openClawToolCall(event(action)).processInputDigest).toBeUndefined();});
 it('binds every payload field, session and action; no retained references',()=>{
  const e=event(),call=openClawToolCall(e),sig=approvalSignature(call,fixed),key=actionKeyFor(call);
  for(const k of ['action','sessionId','data','keys','hex','literal','text','bracketed','eof'] as const){const changed=structuredClone(e);if(k==='action')changed.params[k]='paste';else if(k==='keys'||k==='hex')changed.params[k].push('other');else if(k==='bracketed'||k==='eof')changed.params[k]=true;else changed.params[k]+='other';const other=openClawToolCall(changed);expect(approvalSignature(other,fixed)).not.toBe(sig);expect(actionKeyFor(other)).not.toBe(key);}
  expect(approvalSignature(openClawToolCall(structuredClone(e)),fixed)).toBe(sig);expect(actionKeyFor(openClawToolCall(structuredClone(e)))).toBe(key);e.params.keys.push('changed');e.params.sessionId='other';expect(approvalSignature(call,fixed)).toBe(sig);expect(actionKeyFor(call)).toBe(key);
 });
 it('ignores a caller-authored digest/approval and cannot downgrade process input via scalar command',()=>{const call=openClawToolCall({toolName:'process',params:{action:'write',data:'x',command:'pwd',processInputDigest:'approved',safe:true,approved:true}});expect(call.tool).toBe('ProcessInput');expect(call.processInputDigest).not.toBe('approved');});
 it('enforces review but shadow is observation-only',async()=>{const home=mkdtempSync(join(tmpdir(),'aegis-process-input-'));process.env['AEGIS_HOME']=home;process.env['AEGIS_COLLECT_DIR']=home;const adapter=createOpenClawAdapter(event('submit'));const shadow=await runHook(adapter,'',{shadow:true});expect(shadow.exitCode).toBe(0);expect(JSON.parse(shadow.stdout).action).toBe('ask');expect(readdirSync(home).some(f=>f.includes('pending'))).toBe(false);const enforced=await runHook(adapter,'',{shadow:false});expect(enforced.exitCode).toBe(2);expect(JSON.parse(enforced.stdout).action).toBe('ask');expect(JSON.parse(enforced.stdout).approvalId).toMatch(/^aegis_/);});
});
