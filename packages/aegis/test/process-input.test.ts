import {describe,it,expect} from 'vitest';
import {evaluate,loadPack} from '../src/index.js';
describe('interactive process input review boundary',()=>{
 it('asks without metadata or rule matches and cannot be waived by severity or predictor',()=>{
  for(const processInputDigest of [undefined,'','safe']){const r=evaluate({tool:'ProcessInput',processInputDigest},[],{severityTable:{critical:'allow',high:'allow',medium:'allow',low:'allow'},prediction:{pFailure:0,confidence:1,source:'test'}});expect(r.action).toBe('ask');expect(r.reason).toContain('process input requires review');expect(r.matches).toEqual([]);}
 });
 it('retains independent critical deny and predictor deny with diagnostic',()=>{
  const rules=loadPack({packId:'test',version:'1',rules:[{id:'deny',category:'secrets',severity:'critical',description:'deny reason',appliesTo:['*'],match:{kind:'substring',target:'content',pattern:'SECRET'}}]});
  const r=evaluate({tool:'ProcessInput',content:'SECRET'},rules);expect(r.action).toBe('deny');expect(r.matches.map(m=>m.id)).toEqual(['deny']);expect(r.reason).toContain('deny reason');expect(r.reason).toContain('process input requires review');
  const p=evaluate({tool:'ProcessInput'},[],{prediction:{pFailure:.99,confidence:1,source:'test'}});expect(p.action).toBe('deny');expect(p.decidedBy).toBe('prediction');expect(p.reason).toContain('process input requires review');
 });
 it('does not contaminate subsequent legacy calls or mutate caller',()=>{const call=Object.freeze({tool:'ProcessInput'});expect(evaluate(call,[]).action).toBe('ask');for(const tool of ['process','Bash','Read','Other'])expect(evaluate({tool},[]).action).toBe('allow');expect(call).toEqual({tool:'ProcessInput'});});
});
