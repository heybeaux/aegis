import {describe,it,expect} from 'vitest';
import {openClawToolCall} from '../src/openclaw.js';
import {approvalSignature} from '../src/approval.js';
import {actionKeyFor} from '../src/predictor.js';
import {evaluate,loadPack,type Evaluation} from '@heybeaux/lattice-aegis';
const ask:Evaluation={action:'ask',reason:'fixed',matches:[],decidedBy:'severity',ruleVersions:[]};
describe('OpenClaw structured edit projection',()=>{
 it('retains independent replacements including duplicates, empties and scalar',()=>{
  const event={toolName:'edit',params:{path:'/lab/a',newText:'scalar',edits:[{oldText:'OLD',newText:''},{oldText:'old',newText:'DANGER'},{oldText:'old',newText:'DANGER'}]}};
  const copy=structuredClone(event),call=openClawToolCall(event);
  expect(call).toEqual({tool:'Edit',paths:['/lab/a'],content:'scalar',contentFragments:['','DANGER','DANGER']});
  expect(event).toEqual(copy);
  const rules=loadPack({packId:'test',version:'1',rules:[{id:'secret',category:'secrets',severity:'critical',description:'secret',appliesTo:['Edit'],match:{target:'content',kind:'substring',pattern:'DANGER'}}]});
  expect(evaluate(call,rules).action).toBe('deny');
  expect(evaluate(openClawToolCall({toolName:'edit',params:{edits:[{oldText:'DANGER',newText:'safe'}]}}),rules).action).toBe('allow');
 });
 it('binds order, boundaries and every replacement into identities',()=>{
  const call={tool:'Edit',contentFragments:['a','bc']};
  for(const fragments of [['ab','c'],['bc','a'],['a','bc changed'],[]]){
   expect(approvalSignature({...call,contentFragments:fragments},ask)).not.toBe(approvalSignature(call,ask));
   expect(actionKeyFor({...call,contentFragments:fragments})).not.toBe(actionKeyFor(call));
  }
  expect(approvalSignature(structuredClone(call),ask)).toBe(approvalSignature(call,ask));
 });
 it('leaves wrong-tool batches and absent scalar contracts unchanged',()=>{
  expect(openClawToolCall({toolName:'read',params:{edits:[{newText:'DANGER'}]}})).toEqual({tool:'Read'});
  expect(openClawToolCall({toolName:'edit',params:{newText:'legacy'}})).toEqual({tool:'Edit',content:'legacy'});
 });
});
