import { describe, expect, it } from 'vitest';
import { evaluate, evaluateWithSourcePolicyRosterCheckpoint, loadPack, type EvaluateOptions, type Prediction } from '../src/index.js';
const plain={tool:'Bash',command:'echo safe'};
const opts=(p=.1):EvaluateOptions=>({prediction:{pFailure:p,confidence:.8,source:'awm'},ruleVersions:['pack@1']});
describe('RT-49 Evaluation metadata reference ownership',()=>{
 it.each([.1,.5,.9])('detaches producer and consumer references at p=%s',p=>{
  const options=opts(p),saved=structuredClone(options),result=evaluate(plain,[],options),receipt=structuredClone(result);
  expect(result.prediction).not.toBe(options.prediction);expect(result.ruleVersions).not.toBe(options.ruleVersions);
  options.prediction!.pFailure=.99;options.prediction!.confidence=.2;options.prediction!.source='prior';options.ruleVersions!.push('pack@2');expect(result).toEqual(receipt);
  const shared=opts(p),a=evaluate(plain,[],shared);a.prediction!.pFailure=.01;a.ruleVersions[0]='wrong';expect(shared).toEqual(saved);expect(evaluate(plain,[],shared)).toEqual(receipt);
 });
 it('isolates sibling outputs without freezing public mutable records',()=>{
  const options=opts(),a=evaluate(plain,[],options),b=evaluate(plain,[],options),saved=structuredClone(b);
  a.prediction!.pFailure=.99;a.ruleVersions.push('local');expect(b).toEqual(saved);expect(Object.isFrozen(options.prediction)).toBe(false);expect(Object.isFrozen(a)).toBe(false);
 });
 it('supports frozen inputs while output stays independently writable',()=>{
  const prediction:Prediction=Object.freeze({pFailure:.1,confidence:.8,source:'awm'});const versions=['pack@1'];Object.freeze(versions);
  const options=Object.freeze({prediction,ruleVersions:versions});const result=evaluate(plain,[],options);result.prediction!.pFailure=.99;result.ruleVersions.push('local');expect(prediction.pFailure).toBe(.1);expect(versions).toEqual(['pack@1']);
 });
 it('keeps optional prediction and empty defaults independent',()=>{
  const a=evaluate(plain,[]),b=evaluate(plain,[]);expect(a.prediction).toBeUndefined();a.ruleVersions.push('local');a.matches.push({id:'local',severity:'low',category:'bash',target:'command'});expect(b.ruleVersions).toEqual([]);expect(b.matches).toEqual([]);
 });
 it('preserves ordered deduplicated rule hits and isolates compiled rules',()=>{
  const rules=loadPack({packId:'test',version:'1',rules:[{id:'hit',category:'bash',severity:'low',description:'safe',match:{kind:'substring',target:'command',pattern:'safe'},appliesTo:['Bash']}]});
  const a=evaluate(plain,rules);a.matches[0]!.id='local';const b=evaluate(plain,rules);rules[0]!.rule.id='producer';expect(b.matches[0]!.id).toBe('hit');expect(a.matches[0]!.id).toBe('local');
 });
 it.each(['no-roster','offline'])('isolates async ask path %s',async mode=>{
  const options=opts(),original=structuredClone(options);const input=mode==='offline'?{tool:'Act',sourceFreshness:{}}:plain;
  const result=await evaluateWithSourcePolicyRosterCheckpoint(input,[],{async read(){throw new Error('offline');},async observe(){}},options);
  expect(result.action).toBe('ask');expect(result.prediction).not.toBe(options.prediction);result.prediction!.pFailure=.99;result.ruleVersions.push('local');expect(options).toEqual(original);
 });
 it('isolates async initial predictor-deny without I/O',async()=>{
  const options=opts(.9);let reads=0;const result=await evaluateWithSourcePolicyRosterCheckpoint(plain,[],{async read(){reads++;return null;},async observe(){}},options);
  expect(result.action).toBe('deny');expect(reads).toBe(0);options.prediction!.pFailure=.01;options.ruleVersions![0]='other';expect(result.prediction!.pFailure).toBe(.9);expect(result.ruleVersions).toEqual(['pack@1']);
 });
});
