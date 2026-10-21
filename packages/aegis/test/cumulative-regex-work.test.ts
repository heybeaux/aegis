import { describe, it, expect } from 'vitest';
import { evaluate, loadPack, type Rule } from '../src/index.js';
import { boundedRegexMatchMany, regexTotalBudgetMs } from '../src/eval/regex-budget.js';
const input='q'.repeat(48)+'!';
const rule=(id:string, extra:Partial<Rule>={}):Rule=>({id,category:'bash',severity:'low',description:id,match:{kind:'regex',pattern:'^(q+)+r$',target:'command'},appliesTo:['*'],...extra});
const pack=(rules:Rule[])=>loadPack({packId:'rt58',version:'1',rules});
const many=()=>Array.from({length:20},(_,i)=>rule(`slow${i}`));
describe('RT58 cumulative native matching budget',()=>{
 it('bounds independent timeouts and resets deadline for the next invocation',()=>{
  const rules=pack(many()),before=structuredClone(rules.map(c=>c.rule));
  const opts={regexMatchBudgetMs:20,regexTotalBudgetMs:60,severityTable:{critical:'allow',high:'allow',medium:'allow',low:'allow'} as const};
  const t=performance.now(),out=evaluate({tool:'Bash',command:input},rules,opts);
  expect(performance.now()-t).toBeLessThan(1500);expect(out.action).toBe('ask');expect(out.matches).toEqual([]);expect(out.reason).toMatch(/cumulative regex work budget/);expect(out.reason.match(/cumulative/g)).toHaveLength(1);
  expect(rules.map(c=>c.rule)).toEqual(before);expect(Object.isFrozen(opts)).toBe(false);
  expect(evaluate({tool:'Bash',command:'qr'},rules).matches).toHaveLength(20);
  expect(evaluate({tool:'Bash',command:'safe'},rules).action).toBe('allow');
 });
 it.each([true,false])('preserves independent substring deny first=%s',first=>{
  const critical=rule('known',{severity:'critical',match:{kind:'substring',pattern:'!',target:'command'}});
  const rules=pack(first?[critical,...many()]:[...many(),critical]);
  const out=evaluate({tool:'Bash',command:input},rules,{regexMatchBudgetMs:20,regexTotalBudgetMs:50});
  expect(out.action).toBe('deny');expect(out.matches.map(m=>m.id)).toEqual(['known']);expect(out.reason).toMatch(/cumulative/);
 });
 it('retains proven regex hit, skips later regex as unknown and preserves predictor deny',()=>{
  const positive=rule('known',{severity:'critical',match:{kind:'regex',pattern:'q!$',target:'command'}});
  const out=evaluate({tool:'Bash',command:input},pack([positive,...many(),rule('unreached',{severity:'critical',match:{kind:'regex',pattern:'q!$',target:'command'}})]),{regexMatchBudgetMs:20,regexTotalBudgetMs:50});
  expect(out.action).toBe('deny');expect(out.matches.map(m=>m.id)).toEqual(['known']);expect(out.reason).toMatch(/unreached/);
  const predicted=evaluate({tool:'Bash',command:input},pack(many()),{regexMatchBudgetMs:20,regexTotalBudgetMs:50,prediction:{pFailure:.95,confidence:.8,source:'test'}});
  expect(predicted.action).toBe('deny');expect(predicted.decidedBy).toBe('prediction');expect(predicted.reason).toContain('predicted');
 });
 it.each(['path','argv','content'] as const)('shares budget across %s rules',target=>{
  const rules=pack(many().map(r=>({...r,match:{...r.match,target}})));
  const call={tool:'Bash',...(target==='path'?{paths:[input]}:target==='argv'?{argv:[input]}:{content:input})};
  expect(evaluate(call,rules,{regexMatchBudgetMs:20,regexTotalBudgetMs:50}).reason).toMatch(/cumulative/);
 });
 it('decoded variants share a single total allowance',()=>{
  const command=`echo ${Buffer.from(input).toString('base64')} | base64 -d | sh`;
  expect(evaluate({tool:'Bash',command},pack(many()),{preprocess:true,regexMatchBudgetMs:20,regexTotalBudgetMs:50}).reason).toMatch(/cumulative/);
 });
 it('caps a single native execution when total is smaller than per-match budget',()=>{
  const t=performance.now(),out=evaluate({tool:'Bash',command:input},pack([rule('one')]),{regexMatchBudgetMs:1000,regexTotalBudgetMs:20});
  expect(performance.now()-t).toBeLessThan(1000);expect(out.action).toBe('ask');expect(out.reason).toMatch(/cumulative/);
 });
 it('does not turn skipped matched-group jobs into fabricated unknowns',()=>{
  const jobs=[{rule:0,group:0,source:'q',flags:'',input},...Array.from({length:500},()=>({rule:0,group:0,source:'^(q+)+r$',flags:'',input}))];
  const out=boundedRegexMatchMany(jobs,100,100);expect(out[0]).toBe(true);expect(out.slice(1).every(x=>x===undefined)).toBe(true);expect(out.cumulativeBudgetExceeded).toBeUndefined();
 });
 it.each([undefined,0,-1,NaN,Infinity,1001])('invalid total option %s uses finite default',value=>expect(regexTotalBudgetMs(value)).toBe(250));
 it.each([[.1,1],[1.5,2],[1000,1000]])('normalizes total %s to %s',(x,y)=>expect(regexTotalBudgetMs(x)).toBe(y));
});
