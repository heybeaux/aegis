import { describe, expect, it } from 'vitest';
import { evaluate, loadPack, evaluateWithSourcePolicyRosterCheckpoint } from '../src/index.js';
import type { CompiledRule, Rule } from '../src/index.js';
const HIT='swarmlab.rt52.compiled-rule-requires-bound-stateless-matcher';
const rule:Rule={id:'binding.guard',category:'bash',severity:'critical',description:'binding guard',appliesTo:['Bash'],match:{kind:'regex',pattern:'BLOCK',flags:'i',target:'command'}};
const compile=()=>loadPack({packId:'binding',version:'1',rules:[structuredClone(rule)]});
const call={tool:'Bash',command:'BLOCK'};
const mutations:[string,(r:CompiledRule[])=>void][]=[
 ['declared pattern',r=>{r[0]!.rule.match.pattern='OTHER';}],
 ['declared flags',r=>{r[0]!.rule.match.flags=undefined;}],
 ['cache source',r=>{r[0]!.regex!.compile('OTHER','i');}],
 ['cache flags',r=>{r[0]!.regex!.compile('BLOCK','');}],
 ['global cache',r=>{r[0]!.regex!.compile('BLOCK','gi');r[0]!.regex!.lastIndex=99;}],
 ['sticky cache',r=>{r[0]!.regex!.compile('BLOCK','iy');r[0]!.regex!.lastIndex=99;}],
 ['missing cache',r=>{r[0]!.regex=undefined;}],
 ['disallowed declaration',r=>{r[0]!.rule.match.flags='gi';}],
];
describe('RT52 compiled matcher binding at invocation',()=>{
 it.each(mutations)('refuses %s without using or mutating the invalid cache',(name,mutate)=>{
  const r=compile();mutate(r);const before=r[0]!.regex?.lastIndex;
  for(let i=0;i<3;i++){
   const result=evaluate(call,r,{severityTable:{critical:'allow',high:'allow',medium:'allow',low:'allow'}});
   expect(result.action).toBe('ask');expect(result.matches.map(h=>h.id)).toEqual([HIT]);
   expect(r[0]!.regex?.lastIndex).toBe(before);
  }
 });
 it.each(mutations)('retains independent deny and predictor deny for %s',(name,mutate)=>{
  const r=compile();mutate(r);const valid=compile();valid[0]!.rule.id='binding.independent';
  const result=evaluate(call,[...r,...valid]);expect(result.action).toBe('deny');
  expect(result.matches.map(h=>h.id)).toEqual([HIT,'binding.independent']);
  expect(evaluate(call,r,{prediction:{pFailure:.9,confidence:.8,source:'awm'}}).action).toBe('deny');
 });
 it.each(mutations)('strict API refuses %s before store access',async(name,mutate)=>{
  const r=compile();mutate(r);let io=0;const result=await evaluateWithSourcePolicyRosterCheckpoint(call,r,{async read(){io++;return null;},async observe(){io++;}},{monotonicNowMs:()=>100});
  expect(result.action).toBe('ask');expect(result.matches.map(h=>h.id)).toContain(HIT);expect(io).toBe(0);
 });
 it('accepts loader-normalized slash/newline/empty syntax and flag order without changing lastIndex',()=>{
  for(const pattern of ['BLOCK','a/b','\n','(?:)']){
   const r=compile();r[0]!.rule.match.pattern=pattern;r[0]!.rule.match.flags='mi';r[0]!.regex=new RegExp(pattern,'im');r[0]!.regex.lastIndex=99;
   const result=evaluate({tool:'Bash',command:pattern==='(?:)'?'safe':pattern},r);
   expect(result.action).toBe('deny');expect(result.matches.map(h=>h.id)).not.toContain(HIT);expect(r[0]!.regex!.lastIndex).toBe(99);
  }
 });
 it('leaves disabled, foreign-tool and incidental nonregex caches inert',()=>{
  const disabled=compile();disabled[0]!.rule.enabled=false;disabled[0]!.regex=/OTHER/g;
  const foreign=compile();foreign[0]!.rule.appliesTo=['Other'];foreign[0]!.regex=undefined;
  const substring=compile();substring[0]!.rule.match.kind='substring';substring[0]!.rule.severity='low';substring[0]!.regex=/OTHER/g;
  expect(evaluate(call,[...disabled,...foreign,...substring]).action).toBe('allow');
 });
 it('deduplicates invalid diagnostics across rules and preprocessing variants',()=>{
  const r=compile();r[0]!.regex=undefined;const r2=compile();r2[0]!.rule.id='binding.other';r2[0]!.regex=/OTHER/;
  const result=evaluate({tool:'Bash',command:`echo QkxPQ0s= | base64 -d`},[...r,...r2],{preprocess:true});
  expect(result.action).toBe('ask');expect(result.matches.map(h=>h.id)).toEqual([HIT]);
 });
 it('preserves valid matching, empty target allowance and duplicate path hit order',()=>{
  const r=compile();expect(evaluate({tool:'Bash',command:''},r).action).toBe('allow');
  r[0]!.rule.match.target='path';const result=evaluate({tool:'Bash',paths:['safe','BLOCK','BLOCK']},r);
  expect(result.action).toBe('deny');expect(result.matches.map(h=>h.id)).toEqual(['binding.guard']);
 });
});
