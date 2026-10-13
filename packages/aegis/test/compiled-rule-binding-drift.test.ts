import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluate, evaluateWithSourcePolicyRosterCheckpoint, loadPack } from '../src/index.js';
import type { Rule, ToolCall } from '../src/index.js';

const DIAG='swarmlab.rt52.compiled-rule-requires-bound-stateless-matcher';
const CONFIG='swarmlab.rt48.async-source-policy-gate-requires-stable-configuration';
const members=['authority:east','authority:west'];
const rosterId='roster:binding-drift';
const digest=`sha256:${createHash('sha256').update(JSON.stringify({memberIds:members,rosterEpoch:2,rosterId})).digest('hex')}`;
const checkpoint=()=>({rosterId,rosterEpoch:2,rosterDigest:digest,authenticated:true});
const call=():ToolCall=>({tool:'Bash',command:'safe',sourceFreshness:{
 risk:'high',checkStatus:'fresh',authenticated:true,sourceId:'source:binding',expectedSourceId:'source:binding',cachedSourceVersion:1,observedSourceVersion:1,checkedAtMs:1000,actionAtMs:1010,maxAgeMs:100,
 policyId:'p',expectedPolicyId:'p',policyVersion:1,expectedPolicyVersion:1,policyAuthenticated:true,sourceVersionNamespace:'v',expectedSourceVersionNamespace:'v',expectedMaxAgeMs:100,
 expectedPolicyAuthorityIds:members,policyAuthorities:members.map(authorityId=>({authorityId,authenticated:true,policyId:'p',policyVersion:1,sourceVersionNamespace:'v',maxAgeMs:100})),
 expectedPolicyAuthorityRosterId:rosterId,expectedPolicyAuthorityRosterEpoch:2,expectedPolicyAuthorityRosterDigest:digest,policyAuthorityRoster:{...checkpoint(),memberIds:members},
}});
const rules=(severity:Rule['severity']='low')=>loadPack({packId:'binding-drift',version:'1',rules:[
 {id:'binding.mutable',description:'mutable matcher',category:'bash',severity,appliesTo:['Bash'],match:{kind:'regex',target:'command',pattern:'OTHER',flags:'i'}},
 {id:'binding.valid-critical',description:'unrelated valid critical matcher',category:'bash',severity:'critical',appliesTo:['Bash'],match:{kind:'regex',target:'command',pattern:'DANGER',flags:'i'}},
]});

describe('RT52 invalid cache attribution during RT48 drift',()=>{
 it.each(['first','observe','last','reject'] as const)('keeps invalid low cache refusal at ask after %s I/O',async phase=>{
  const r=rules(),input=call();let reads=0,observes=0;
  const mutate=()=>{r[0]!.regex=/safe/i;};
  const result=await evaluateWithSourcePolicyRosterCheckpoint(input,r,{
   async read(){reads++;if(phase==='first'&&reads===1||phase==='last'&&reads===2||phase==='reject'){mutate();if(phase==='reject')throw new Error('offline');}return checkpoint();},
   async observe(){observes++;if(phase==='observe')mutate();},
  },{monotonicNowMs:()=>100});
  expect(result.action).toBe('ask');
  expect(result.matches.map(h=>h.id)).toContain(CONFIG);
  expect(result.matches.map(h=>h.id)).toContain(DIAG);
  // An unbound low cache is not evidence that a different valid critical rule fired.
  expect(result.matches.map(h=>h.id)).not.toContain('binding.valid-critical');
  expect(reads).toBe(phase==='last'?2:1);expect(observes).toBe(phase==='first'||phase==='reject'?0:1);
 });
 it('retains conservative deny only for invalid critical coverage',async()=>{
  const r=rules('critical');let reads=0;
  const result=await evaluateWithSourcePolicyRosterCheckpoint(call(),r,{async read(){reads++;r[0]!.regex=/safe/i;return checkpoint();},async observe(){throw new Error('must not observe');}},{monotonicNowMs:()=>100});
  expect(result.action).toBe('deny');expect(result.matches.map(h=>h.id)).toContain(DIAG);expect(result.matches.map(h=>h.id)).toContain(CONFIG);expect(reads).toBe(1);
 });
 it('retains genuine valid critical deny when low cache drifts at the same time',async()=>{
  const input=call(),r=rules();
  const result=await evaluateWithSourcePolicyRosterCheckpoint(input,r,{async read(){r[0]!.regex=/safe/i;input.command='DANGER';return checkpoint();},async observe(){throw new Error('must not observe');}},{monotonicNowMs:()=>100});
  expect(result.action).toBe('deny');expect(result.matches.map(h=>h.id)).toContain('binding.valid-critical');
 });
 it('does not add a conservative critical deny under explicit critical->ask mapping',async()=>{
  const r=rules('critical');
  const result=await evaluateWithSourcePolicyRosterCheckpoint(call(),r,{async read(){r[0]!.regex=/safe/i;return checkpoint();},async observe(){}},{monotonicNowMs:()=>100,severityTable:{critical:'ask',high:'ask',medium:'ask',low:'allow'}});
  expect(result.action).toBe('ask');expect(result.matches.map(h=>h.id)).toContain(CONFIG);
 });
});

describe('RT52 additional entry contract edges',()=>{
 it.each(['ii','[syntax]','g','y','d','v'])('refuses invalid or unsupported declared flags %s',flags=>{
  const r=rules();r[0]!.rule.match.flags=flags;
  const result=evaluate(call(),r);expect(result.action).toBe('ask');expect(result.matches.map(h=>h.id)).toContain(DIAG);
 });
 it('refuses an invalid declared pattern and a plain wrong-type cache',async()=>{
  for(const malformed of ['pattern','cache']){
   const r=rules();if(malformed==='pattern')r[0]!.rule.match.pattern='[';else r[0]!.regex={} as RegExp;
   expect(evaluate(call(),r).action).toBe('ask');let io=0;
   expect((await evaluateWithSourcePolicyRosterCheckpoint(call(),r,{async read(){io++;return checkpoint();},async observe(){io++;}},{monotonicNowMs:()=>100})).action).toBe('ask');expect(io).toBe(0);
  }
 });
 it('works with deeply frozen valid caller rule fields and regex',()=>{
  const r=rules();for(const entry of r){Object.freeze(entry.rule.match);Object.freeze(entry.rule.appliesTo);Object.freeze(entry.rule);Object.freeze(entry.regex);Object.freeze(entry);}
  expect(evaluate(call(),r).action).toBe('allow');
 });
});
