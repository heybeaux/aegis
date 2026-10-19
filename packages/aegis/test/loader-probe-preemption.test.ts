import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Separate OS process protects this test runner if synchronous loadPack hangs.
// Exercise the published artifact (release:check builds before test).
const artifact = new URL('../dist/index.js', import.meta.url).href;
function run(pattern: string, budget = '25', extra: Record<string, unknown> = {}) {
  const script = `import {loadPack,RulePackError} from ${JSON.stringify(artifact)};
const rule={id:'guard',category:'bash',severity:'critical',description:'test',match:{kind:'regex',pattern:${JSON.stringify(pattern)},target:'command'},appliesTo:['Bash'],...${JSON.stringify(extra)}};
let result;try{const c=loadPack({packId:'test',version:'1',rules:[rule]});result={outcome:'loaded',source:c[0].regex?.source,flags:c[0].regex?.flags};}catch(e){result={outcome:'error',typed:e instanceof RulePackError,packId:e.packId,ruleId:e.ruleId,message:e.message};}
try{const c=loadPack({packId:'later',version:'1',rules:[{...rule,match:{kind:'regex',pattern:'^SAFE$',target:'command'}}]});result.recovery=c[0].regex.test('SAFE')&&!c[0].regex.test('unsafe');}catch{result.recovery=false;}
console.log(JSON.stringify(result));`;
  try { return JSON.parse(execFileSync(process.execPath, ['--input-type=module','-e',script], { encoding:'utf8',timeout:2000,env:{...process.env,AEGIS_REDOS_BUDGET_MS:budget}})); }
  catch(e) { return {outcome:'child-failed',message:String(e)}; }
}

describe('loader probe deadline preemption (public artifact)', () => {
  for(const [name,pattern] of [['nested-a','^(a+)+b$'],['alternation','^(a|aa)+b$'],['nested-slash','^(/+)+x$']]) {
    it(`interrupts ${name} before parent watchdog and recovers`,()=>{
      const r=run(pattern);expect(r.outcome).toBe('error');expect(r.typed).toBe(true);expect(r.packId).toBe('test');expect(r.ruleId).toBe('guard');expect(r.message).toMatch(/ReDoS.*budget/i);expect(r.recovery).toBe(true);
    });
  }
  it('still validates disabled regex rules',()=>{expect(run('^(a+)+b$','25',{enabled:false})).toMatchObject({outcome:'error',typed:true,recovery:true});});
  for(const pattern of ['^SAFE+$','(?<=S)A(F)E\\1','^DANGER$']) it(`keeps valid regex ${pattern}`,()=>{expect(run(pattern)).toMatchObject({outcome:'loaded',source:pattern,recovery:true});});
  for(const budget of ['0','-1','NaN','Infinity','1.5','2147483648','']) it(`normalizes budget ${JSON.stringify(budget)} safely`,()=>{expect(run('^SAFE$',budget)).toMatchObject({outcome:'loaded',recovery:true});});
  it('invalid budget cannot disable preemption',()=>{expect(run('^(a+)+b$','NaN')).toMatchObject({outcome:'error',typed:true,recovery:true});});
  it('preserves compile error identity',()=>{expect(run('[')).toMatchObject({outcome:'error',typed:true,packId:'test',ruleId:'guard',recovery:true});});
  it('preserves disallowed flag rejection',()=>{const r=run('SAFE','25',{match:{kind:'regex',pattern:'SAFE',flags:'g',target:'command'}});expect(r).toMatchObject({outcome:'error',typed:true,recovery:true});expect(r.message).toContain('disallowed regex flag');});
  it('substring text is not evaluated as regex',()=>{expect(run('^(a+)+b$','25',{match:{kind:'substring',pattern:'^(a+)+b$',target:'command'}})).toMatchObject({outcome:'loaded',recovery:true});});
});
