import { describe, it, expect } from 'vitest';
import { evaluate, loadPack, type Rule } from '../src/index.js';
const rule: Rule = { id:'content.guard',category:'secrets',severity:'critical',description:'guard',appliesTo:['Edit'],match:{target:'content',kind:'substring',pattern:'DANGER'}};
const compiled = (regex=false) => loadPack({packId:'fragments',version:'1',rules:[{...rule,match:{...rule.match,kind:regex?'regex':'substring'}}]});
describe('independent content fragments',()=>{
 for(const regex of [false,true]) {
  it(`checks every fragment, original scalar, dedup hits (${regex})`,()=>{
   const r=compiled(regex);
   expect(evaluate({tool:'Edit',content:'safe',contentFragments:['','DANGER','DANGER']},r)).toMatchObject({action:'deny',matches:[{id:'content.guard'}]});
   expect(evaluate({tool:'Edit',content:'DANGER',contentFragments:['safe']},r).action).toBe('deny');
   expect(evaluate({tool:'Edit',contentFragments:['DAN','GER']},r).action).toBe('allow');
   expect(evaluate({tool:'Read',contentFragments:['DANGER']},r).action).toBe('allow');
  });
 }
 it('does not mutate frozen input, preserves disabled and scalar behavior',()=>{
  const call=Object.freeze({tool:'Edit',contentFragments:Object.freeze(['safe','DANGER'])});
  expect(evaluate(call as unknown as Parameters<typeof evaluate>[0],compiled()).action).toBe('deny');
  const rules=compiled();rules[0]!.rule.enabled=false;
  expect(evaluate({tool:'Edit',contentFragments:['DANGER']},rules).action).toBe('allow');
  expect(evaluate({tool:'Edit',content:'safe'},compiled()).action).toBe('allow');
 });
});
