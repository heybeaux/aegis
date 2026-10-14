import { describe, it, expect } from 'vitest';
import { mergeLayers, loadPack, evaluate, type Rule } from '../src/index.js';
const base = (): Rule => ({id:'guard.coverage',category:'bash',severity:'critical',description:'guard',match:{kind:'regex',pattern:'BLOCK\\b',flags:'i',target:'command'},appliesTo:['Bash','Shell']});
const copy = (rule: Rule, fields: Partial<Rule> = {}): Rule => ({...structuredClone(rule),...fields});
describe('mergeLayers coverage authority', () => {
  it.each([
    ['pattern', (b:Rule)=>copy(b,{match:{...b.match,pattern:'OTHER'}})],
    ['flags', (b:Rule)=>copy(b,{match:{...b.match,flags:''}})],
    ['kind', (b:Rule)=>copy(b,{match:{...b.match,kind:'substring'}})],
    ['target', (b:Rule)=>copy(b,{match:{...b.match,target:'content'}})],
    ['scope', (b:Rule)=>copy(b,{appliesTo:['Shell']})],
  ] as const)('rejects unconsented %s changes',(_,change)=>{
    const b=base(),o=change(b),input=structuredClone([b,o]);
    const merged=mergeLayers([[b],[o]]);
    expect(merged.rules).toEqual([b]);expect(merged.warnings).toEqual([{ruleId:b.id,message:expect.stringContaining('allowDowngrade')}]);
    expect(evaluate({tool:'Bash',command:'block'},loadPack({packId:'test',version:'1',rules:merged.rules})).action).toBe('deny');
    expect([b,o]).toEqual(input);
  });
  it('protects substring patterns and finite empty scope',()=>{
    const b=copy(base(),{match:{kind:'substring',pattern:'BLOCK',target:'command'}});
    for(const o of [copy(b,{match:{...b.match,pattern:'OTHER'}}),copy(b,{appliesTo:[]})])expect(mergeLayers([[b],[o]]).rules).toEqual([b]);
  });
  it('protects wildcard scope from finite replacement',()=>{
    const b=copy(base(),{appliesTo:['*']});expect(mergeLayers([[b],[copy(b,{appliesTo:['Bash','Shell']})]]).warnings).toHaveLength(1);
  });
  it('does not let higher severity hide changed coverage',()=>{
    const b=copy(base(),{severity:'high'}),o=copy(b,{severity:'critical',match:{...b.match,pattern:'OTHER'}});
    expect(mergeLayers([[b],[o]]).rules).toEqual([b]);
  });
  it('retains immediate preceding rule and insertion order',()=>{
    const b=base(),added=copy(b,{id:'guard.second'}),user=copy(b,{description:'user',appliesTo:['Bash','Shell','Run']});
    const result=mergeLayers([[b,added],[user],[copy(user,{appliesTo:['Shell']})]]);
    expect(result.rules).toEqual([user,added]);expect(result.warnings).toHaveLength(1);
  });
  it('requires consent on THIS overlay, never inherited from prior effective rule',()=>{
    const b=copy(base(),{allowDowngrade:true});const o=copy(b,{match:{...b.match,pattern:'OTHER'}});delete o.allowDowngrade;
    expect(mergeLayers([[b],[o]]).rules).toEqual([b]);
    expect(mergeLayers([[b],[copy(o,{allowDowngrade:true})]]).rules).toEqual([{...b,...o,allowDowngrade:true}]);
  });
  it('allows only explicit true consent; false and runtime truthy values are not authority',()=>{
    const b=base(),o=copy(b,{appliesTo:['Shell']});
    for(const consent of [false,'true',1])expect(mergeLayers([[b],[{...o,allowDowngrade:consent} as Rule]]).warnings).toHaveLength(1);
    expect(mergeLayers([[b],[copy(o,{allowDowngrade:true})]]).warnings).toHaveLength(0);
  });
  it('allows set-equivalent or expanded scope and wildcard freely',()=>{
    const b=base();for(const appliesTo of [['Shell','Bash','Bash'],['Bash','Shell','Run'],['*'],['Shell','*']]){
      const o=copy(b,{appliesTo});expect(mergeLayers([[b],[o]])).toEqual({rules:[o],warnings:[]});
    }
  });
  it('uses case-sensitive tool names',()=>{
    const b=base();expect(mergeLayers([[b],[copy(b,{appliesTo:['bash','Shell']})]]).warnings).toHaveLength(1);
  });
  it('normalizes regex flag order and absent/empty equivalence',()=>{
    const b=base();b.match.flags='imu';const o=copy(b,{match:{...b.match,flags:'uim'}});
    expect(mergeLayers([[b],[o]]).warnings).toHaveLength(0);
    delete b.match.flags;expect(mergeLayers([[b],[copy(b,{match:{...b.match,flags:''}})]]).warnings).toHaveLength(0);
  });
  it('does not attempt regex inclusion proof even for real broadening',()=>{
    const b=base();expect(mergeLayers([[b],[copy(b,{match:{...b.match,pattern:'BLOCK\\b|OTHER'}})]]).warnings).toHaveLength(1);
  });
  it('allows metadata updates and severity escalation with identical coverage',()=>{
    const b=copy(base(),{severity:'medium'}),o=copy(b,{severity:'high',description:'revised',remediation:'review',references:['doc']});
    expect(mergeLayers([[b],[o]])).toEqual({rules:[o],warnings:[]});
  });
  it('permits re-enabling disabled base with changed coverage',()=>{
    const b=copy(base(),{enabled:false}),o=copy(b,{enabled:true,appliesTo:['Run'],match:{...b.match,pattern:'OTHER'}});
    expect(mergeLayers([[b],[o]])).toEqual({rules:[o],warnings:[]});
  });
  it('preserves existing disable/severity protections for disabled bases',()=>{
    const b=copy(base(),{enabled:false});expect(mergeLayers([[b],[copy(b,{severity:'low'})]]).warnings).toHaveLength(1);
    const enabled=base();expect(mergeLayers([[enabled],[copy(enabled,{enabled:false})]]).warnings).toHaveLength(1);
  });
  it('allows explicitly reviewed disabling of an enabled base',()=>{
    const b=base(),o=copy(b,{enabled:false,allowDowngrade:true});
    expect(mergeLayers([[b],[o]])).toEqual({rules:[o],warnings:[]});
    expect(evaluate({tool:'Bash',command:'BLOCK'},loadPack({packId:'test',version:'1',rules:[o]})).action).toBe('allow');
  });
  it('treats mixed wildcard base as unbounded, not a finite tool list',()=>{
    const b=copy(base(),{appliesTo:['Bash','*']});
    expect(mergeLayers([[b],[copy(b,{appliesTo:['Bash','Shell']})]]).warnings).toHaveLength(1);
    expect(mergeLayers([[b],[copy(b,{appliesTo:['*']})]]).warnings).toHaveLength(0);
  });
  it('returns empty for empty layers and adds unseen rules without review',()=>{
    expect(mergeLayers([[],[]])).toEqual({rules:[],warnings:[]});const b=base();expect(mergeLayers([[],[b]])).toEqual({rules:[b],warnings:[]});
  });
});
