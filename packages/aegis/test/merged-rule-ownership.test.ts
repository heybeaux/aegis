import {describe,it,expect} from 'vitest';
import {mergeLayers,loadPack,evaluate} from '../src/index.js';
import type {Rule} from '../src/index.js';
const rule=(id='guard'):Rule=>({id,category:'bash',severity:'high',description:'guard',enabled:true,match:{kind:'substring',pattern:'DANGER',target:'command'},appliesTo:['Bash'],references:['CWE-77']});
const action=(rules:Rule[])=>evaluate({tool:'Bash',command:'DANGER'},loadPack({packId:'test',version:'1',rules}),{severityTable:{low:'allow',medium:'ask',high:'deny',critical:'deny'}}).action;
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
describe('mergeLayers value ownership — exp64',()=>{
 for(const mode of ['new','accepted','rejected'] as const)for(const field of ['top','match','scope','references'] as const){
  it(`isolates ${mode} ${field} producer writes`,()=>{
   const base=rule(),overlay=rule();overlay.description='reviewed';if(mode==='rejected')overlay.severity='low';
   const layers=mode==='new'?[[base]]:[[base],[overlay]],out=mergeLayers(layers),before=structuredClone(out),producer=mode==='accepted'?overlay:base;
   if(field==='top'){producer.id='producer';producer.severity='low';producer.enabled=false;}else if(field==='match')producer.match.pattern='NEVER';else if(field==='scope')producer.appliesTo.splice(0,1,'Other');else producer.references!.push('changed');
   expect(out).toEqual(before);expect(action(out.rules)).toBe('deny');expect(Object.isFrozen(producer)).toBe(false);
  });
 }
 it('isolates optional references inherited from a lower layer',()=>{const a=rule(),b=rule();delete b.references;const out=mergeLayers([[a],[b]]);a.references!.push('edit');expect(out.rules[0]!.references).toEqual(['CWE-77']);});
 it('consumer output writes never edit producer layers',()=>{const a=rule(),b=rule(),before=structuredClone([a,b]),out=mergeLayers([[a],[b]]);out.rules[0]!.enabled=false;out.rules[0]!.match.pattern='NEVER';out.rules[0]!.appliesTo.push('Other');out.rules[0]!.references!.push('edit');expect([a,b]).toEqual(before);expect(action(out.rules)).toBe('allow');});
 it('isolates separate results and distinct ids sharing original nested members',()=>{const a=rule(),b={...a,id:'second'},first=mergeLayers([[a,b]]),second=mergeLayers([[a,b]]),before=structuredClone(second);first.rules[0]!.match.pattern='NEVER';first.rules[0]!.appliesTo.push('Other');first.rules[0]!.references!.push('edit');expect(second).toEqual(before);expect(first.rules[1]).toEqual(b);expect(a.match.pattern).toBe('DANGER');expect(action([first.rules[1]!])).toBe('deny');});
 it('does not leak frozen input containers into mutable output',()=>{const a=freeze(rule()),out=mergeLayers([[a]]);out.rules[0]!.match.pattern='NEVER';out.rules[0]!.appliesTo.push('Other');out.rules[0]!.references!.push('edit');expect(a).toEqual(rule());expect(action(out.rules)).toBe('allow');});
 it('requires remerge to apply producer edits while supporting direct owned output edits',()=>{const a=rule(),old=mergeLayers([[a]]);a.match.pattern='NEVER';const next=mergeLayers([[a]]);expect(action(old.rules)).toBe('deny');expect(action(next.rules)).toBe('allow');old.rules[0]!.enabled=false;expect(action(old.rules)).toBe('allow');});
 it('preserves empty inputs, order, id collapse and optional-property shape',()=>{expect(mergeLayers([[],[]])).toEqual({rules:[],warnings:[]});const a=rule('__proto__');delete a.references;const b=rule('other'),c=rule('__proto__');delete c.references;c.description='latest';const out=mergeLayers([[a,b],[c]]);expect(out.rules.map(r=>r.id)).toEqual(['__proto__','other']);expect(out.rules[0]).toEqual(c);expect('references' in out.rules[0]!).toBe(false);});
 it('preserves explicit undefined optional member and disable/consent semantics',()=>{const a=rule(),b={...rule(),references:undefined} as unknown as Rule;const out=mergeLayers([[a],[b]]);expect('references' in out.rules[0]!).toBe(true);expect(out.rules[0]!.references).toBeUndefined();const disabled={...rule(),enabled:false};expect(mergeLayers([[a],[disabled]]).warnings).toHaveLength(1);expect(mergeLayers([[a],[{...disabled,allowDowngrade:true}]]).rules[0]!.enabled).toBe(false);});
 it('preserves warnings ownership and ordinary tightening',()=>{const a=rule(),b={...rule(),severity:'low' as const},x=mergeLayers([[a],[b]]),y=mergeLayers([[a],[b]]);x.warnings[0]!.message='edit';expect(y.warnings[0]!.message).not.toBe('edit');expect(mergeLayers([[a],[{...a,severity:'critical'}]]).warnings).toHaveLength(0);});
});
