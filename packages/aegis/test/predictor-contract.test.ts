import { describe, expect, it } from 'vitest';
import { evaluate, evaluateWithSourcePolicyRosterCheckpoint, loadPack, type EvaluateOptions } from '../src/index.js';
const call={tool:'Bash',command:'echo safe'};
const HIT='swarmlab.rt50.predictor-requires-valid-numeric-contract';
const prediction=()=>({pFailure:.1,confidence:.8,source:'awm'});
const thresholds=()=>({askAtOrAbove:.4,denyAtOrAbove:.8});
const malformed:any[]=[];
for(const field of ['pFailure','confidence'])for(const value of [NaN,Infinity,-Infinity,-.01,1.01,'0.1',null,undefined])malformed.push({prediction:{...prediction(),[field]:value}});
for(const value of [null,[],{},'bad',{...prediction(),source:'unknown'}])malformed.push({prediction:value});
for(const field of ['askAtOrAbove','denyAtOrAbove'])for(const value of [NaN,Infinity,-Infinity,-.01,1.01,'0.4',null,undefined])malformed.push({prediction:prediction(),predictionThresholds:{...thresholds(),[field]:value}});
for(const value of [null,[],{},'bad',{askAtOrAbove:.8,denyAtOrAbove:.4}])malformed.push({prediction:prediction(),predictionThresholds:value});
const critical=loadPack({packId:'numeric',version:'1',rules:[{id:'numeric.critical',severity:'critical',category:'bash',description:'critical floor',appliesTo:['Bash'],match:{target:'command',kind:'substring',pattern:'safe'}}]});
describe('RT-50 predictor numeric contract',()=>{
 it.each(malformed.map((opts,index)=>[index,opts] as const))('rejects malformed contract %s before pure and strict I/O',async(_index,raw)=>{
  const opts=raw as EvaluateOptions,saved=structuredClone(opts);
  for(const entry of ['pure','strict']){let io=0;const store={async read(){io++;return null;},async observe(){io++;}};
   const result=entry==='pure'?evaluate(call,[],opts):await evaluateWithSourcePolicyRosterCheckpoint(call,[],store,opts);
   expect(result.action).toBe('ask');expect(result.matches.some(h=>h.id===HIT)).toBe(true);expect(result.reason).toContain('RT-50');expect(io).toBe(0);expect(opts).toEqual(saved);expect(Object.isFrozen(opts)).toBe(false);
   expect(()=>JSON.stringify(result)).not.toThrow();
   const denied=evaluate(call,critical,opts);expect(denied.action).toBe('deny');expect(denied.reason).toBe('critical floor');expect(denied.matches.map(h=>h.id)).toContain(HIT);
  }
 });
 it('checks explicitly invalid thresholds without a prediction and despite a custom severity downgrade',()=>{
  const options={predictionThresholds:{askAtOrAbove:NaN,denyAtOrAbove:.8}};
  expect(evaluate(call,[],options).action).toBe('ask');
  const r=evaluate(call,[],{...options,severityTable:{critical:'deny',high:'ask',medium:'allow',low:'allow'}});expect(r.action).toBe('ask');
 });
 it.each([[0,'allow'],[.399,'allow'],[.4,'ask'],[.799,'ask'],[.8,'deny'],[1,'deny']] as const)('keeps inclusive defaults at %s', (pFailure,expected)=>{
  for(const confidence of [0,1])for(const source of ['awm','prior'] as const)expect(evaluate(call,[],{prediction:{pFailure,confidence,source}}).action).toBe(expected);
 });
 it('keeps equality/endpoints, no-prediction legacy, and valid frozen inputs',()=>{
  expect(evaluate(call,[],{prediction:undefined,predictionThresholds:undefined}).action).toBe('allow');
  expect(evaluate(call,[],{prediction:{pFailure:.5,confidence:1,source:'awm'},predictionThresholds:{askAtOrAbove:.5,denyAtOrAbove:.5}}).action).toBe('deny');
  expect(evaluate(call,[],{prediction:{pFailure:0,confidence:0,source:'prior'},predictionThresholds:{askAtOrAbove:0,denyAtOrAbove:1}}).action).toBe('ask');
  const opts=Object.freeze({prediction:Object.freeze({pFailure:.1,confidence:.8,source:'awm' as const}),predictionThresholds:Object.freeze(thresholds())});expect(evaluate(call,[],opts).action).toBe('allow');
 });
 it('omits malformed predictor metadata instead of returning a typed invalid receipt',()=>{
  expect(evaluate(call,[],{prediction:null} as unknown as EvaluateOptions).prediction).toBeUndefined();
  expect(evaluate(call,[],{prediction:{...prediction(),pFailure:NaN}} as EvaluateOptions).prediction).toBeUndefined();
 });
});
