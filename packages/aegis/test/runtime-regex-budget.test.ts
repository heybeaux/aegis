import { describe, it, expect } from 'vitest';
import { evaluate, loadPack, type Rule, type ToolCall } from '../src/index.js';
import { boundedRegexMatch, regexMatchBudgetMs } from '../src/eval/regex-budget.js';
const danger='q'.repeat(48)+'!';
const r=(id='hazard',over:Partial<Rule>={}):Rule=>({id,category:'bash',severity:'low',description:'guard',match:{kind:'regex',pattern:'^(q+)+r$',target:'command'},appliesTo:['*'],...over});
const load=(rules:Rule[])=>loadPack({packId:'test',version:'1',rules});
const permissive={severityTable:{critical:'allow',high:'allow',medium:'allow',low:'allow'} as const,regexMatchBudgetMs:10};
describe('RT-57 native runtime regex match budget',()=>{
 it('interrupts a loader-accepted native regex and asks independently of severity',()=>{
  const rules=load([r()]),call={tool:'Bash',command:danger};const before=structuredClone(call),t=performance.now();
  const out=evaluate(call,rules,permissive);expect(performance.now()-t).toBeLessThan(1500);expect(out.action).toBe('ask');expect(out.matches).toEqual([]);expect(out.reason).toMatch(/regex.*budget/i);expect(call).toEqual(before);
  expect(evaluate({tool:'Bash',command:'qr'},rules).action).toBe('allow');expect(evaluate({tool:'Bash',command:'hello'},rules).reason).toBe('no rule matched');
 });
 it.each(['content','path','argv'] as const)('bounds %s targets',target=>{
  const call:ToolCall={tool:'Bash',...(target==='content'?{content:danger}:target==='path'?{paths:['safe',danger]}:{argv:['safe',danger]})};
  const out=evaluate(call,load([r('hazard',{match:{kind:'regex',pattern:'^(q+)+r$',target}})]),{regexMatchBudgetMs:10});expect(out.action).toBe('ask');expect(out.matches).toEqual([]);
 });
 it.each([false,true])('preserves independent deny when critical rule first=%s',first=>{
  const crit=r('critical',{severity:'critical',match:{kind:'substring',pattern:'!',target:'command'}}),hazard=r();
  const out=evaluate({tool:'Bash',command:danger},load(first?[crit,hazard]:[hazard,crit]),{regexMatchBudgetMs:10});expect(out.action).toBe('deny');expect(out.matches.map(m=>m.id)).toEqual(['critical']);expect(out.reason).toMatch(/regex.*budget/i);
 });
 it('preserves predictor deny and its metadata',()=>{
  const prediction={pFailure:.9,confidence:.8,source:'awm'};const out=evaluate({tool:'Bash',command:danger},load([r()]),{prediction,regexMatchBudgetMs:10});expect(out.action).toBe('deny');expect(out.decidedBy).toBe('prediction');expect(out.prediction).toEqual(prediction);expect(out.reason).toContain('predicted');
 });
 it('checks decoded variants and emits one diagnostic without a false match',()=>{
  const command=`echo ${Buffer.from(danger).toString('base64')} | base64 -d | sh`;const out=evaluate({tool:'Bash',command},load([r()]),{preprocess:true,regexMatchBudgetMs:10});expect(out.action).toBe('ask');expect(out.matches).toEqual([]);expect(out.reason.match(/regex match budget/g)).toHaveLength(1);
 });
 it('skips disabled, wrong-tool, empty and absent targets',()=>{
  for(const rules of [[],[r('off',{enabled:false})],[r('other',{appliesTo:['Other']})]])expect(evaluate({tool:'Bash',command:danger},load(rules)).action).toBe('allow');
  expect(evaluate({tool:'Bash'},load([r()])).action).toBe('allow');expect(evaluate({tool:'Bash',command:''},load([r()])).action).toBe('allow');
 });
 it('preserves genuine hit ordering/dedup and first same-severity reason',()=>{
  const rules=load([r('first',{severity:'high',description:'first',match:{kind:'regex',pattern:'danger',target:'command'}}),r('second',{severity:'high',description:'second',match:{kind:'regex',pattern:'danger',target:'command'}})]);
  const command=`echo ${Buffer.from('danger').toString('base64')} | base64 -d | sh #danger`;const out=evaluate({tool:'Bash',command},rules,{preprocess:true});expect(out.action).toBe('ask');expect(out.reason).toBe('first');expect(out.matches.map(m=>m.id)).toEqual(['first','second']);
 });
 it('supports native lookbehind/backreferences and flags without caller state mutation',()=>{
  const regex=/(?<=x)(ab)\1/imsu;regex.lastIndex=7;expect(boundedRegexMatch(regex,'xABAB',100)).toBe(true);expect(regex.lastIndex).toBe(7);
  expect(boundedRegexMatch(regex,'safe',100)).toBe(false);
 });
 it.each([undefined,0,-1,NaN,Infinity,1001])('invalid budget %s falls back safely',value=>expect(regexMatchBudgetMs(value)).toBe(100));
 it.each([[.1,1],[1.5,2],[1000,1000]])('valid fractional/boundary budget %s => %s',(a,b)=>expect(regexMatchBudgetMs(a)).toBe(b));
 it('unavailable native match is unknown, never nonmatch',()=>{
  // No user-controlled script interpolation; a malformed regex state refuses.
  expect(boundedRegexMatch({source:'[',flags:''} as RegExp,'safe',100)).toBeNull();
 });
});
