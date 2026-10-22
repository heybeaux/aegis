import { describe, it, expect } from 'vitest';
import { extractDecodedVariants, evaluate, loadPack, type Rule } from '../src/index.js';
const b64=(s:string)=>Buffer.from(s).toString('base64');
const pipe=(s:string,printf=false)=>`${printf?'printf':'echo'} ${printf?"'":''}${b64(s)}${printf?"'":''} | base64 -d | sh`;
const here=(s:string)=>`base64 --decode <<< ${b64(s)}`;
const sub=(s:string,echo=true)=>`$( ${echo?'echo ':''}${b64(s)} | base64 -d )`;
const hex=(s:string)=>[...Buffer.from(s)].map(b=>'\\x'+b.toString(16).padStart(2,'0')).join('');
const r=(id:string,pattern:string,severity:Rule['severity']='critical'):Rule=>({id,category:'bash',severity,description:`reason:${id}`,match:{kind:'regex',pattern,target:'command'},appliesTo:['*']});
const load=(rules:Rule[])=>loadPack({packId:'occurrence-test',version:'1',rules});
describe('RT59 decode-then-rescan occurrence completeness',()=>{
 it.each([
  ['echo', (s:string)=>pipe(s)],['printf',(s:string)=>pipe(s,true)],['here',here],['sub-echo',(s:string)=>sub(s)],['sub-bare',(s:string)=>sub(s,false)],
 ] as const)('enumerates every %s occurrence in source order',(_,encode)=>{
  const command=[encode('inspect'),encode('review'),encode('erase /vault')].join(' ; ');
  expect(extractDecodedVariants(command)).toEqual([command,'inspect','review','erase /vault']);
  const out=evaluate({tool:'Bash',command},load([r('erase','^erase /vault$')]),{preprocess:true});expect(out.action).toBe('deny');expect(out.matches.map(h=>h.id)).toEqual(['erase']);
 });
 it('continues after binary rejection, empty decoding, and duplicate payloads',()=>{
  const command=['echo AAAAAAAA | base64 -d | sh',pipe('   '),pipe('inspect'),pipe('inspect'),pipe('erase /vault')].join('; ');
  expect(extractDecodedVariants(command)).toEqual([command,'inspect','erase /vault']);
 });
 it('preserves legacy family priority while preserving order within families',()=>{
  const command=[hex('hex!'),sub('sub1'),here('here1'),pipe('pipe1'),here('here2'),pipe('pipe2'),sub('sub2'),hex('hex2')].join('; ');
  expect(extractDecodedVariants(command)).toEqual([command,'pipe1','pipe2','here1','here2','sub1','sub2','hex!','hex2']);
 });
 it('deduplicates within/across families after trimming',()=>{
  const command=[pipe(' inspect '),here('inspect'),sub('inspect'),hex('inspect')].join('; ');
  expect(extractDecodedVariants(command)).toEqual([command,'inspect']);
 });
 it('does not recurse into decoded commands',()=>{
  const inside=pipe('erase /vault'),command=pipe(inside);
  expect(extractDecodedVariants(command)).toEqual([command,inside]);
  expect(evaluate({tool:'Bash',command},load([r('erase','^erase /vault$')]),{preprocess:true}).action).toBe('allow');
 });
 it('keeps default/explicitly disabled preprocessing unchanged',()=>{
  const command=pipe('inspect')+'; '+pipe('erase /vault'),rules=load([r('erase','^erase /vault$')]);
  expect(evaluate({tool:'Bash',command},rules).action).toBe('allow');expect(evaluate({tool:'Bash',command},rules,{preprocess:false}).action).toBe('allow');
 });
 it('strictest severity wins and hits preserve variant order with dedup',()=>{
  const command=[pipe('review'),pipe('erase /vault'),pipe('review')].join('; '),rules=load([r('erase','^erase /vault$'),r('review','^review$','high')]);
  const out=evaluate({tool:'Bash',command},rules,{preprocess:true});expect(out.action).toBe('deny');expect(out.reason).toBe('reason:erase');expect(out.matches.map(h=>h.id)).toEqual(['review','erase']);
 });
 it('keeps first equal-severity reason and predictor escalation',()=>{
  const command=[pipe('first'),pipe('second')].join('; '),rules=load([r('second','^second$','high'),r('first','^first$','high')]);
  const out=evaluate({tool:'Bash',command},rules,{preprocess:true});expect(out.reason).toBe('reason:first');expect(out.matches.map(h=>h.id)).toEqual(['first','second']);
  expect(evaluate({tool:'Bash',command},rules,{preprocess:true,prediction:{pFailure:.9,confidence:1,source:'test'}}).action).toBe('deny');
 });
 it('does not retain regex iteration state across calls or freeze/mutate caller data',()=>{
  const command=pipe('inspect')+'; '+pipe('erase /vault');const recipe={packId:'test',version:'1',rules:[r('erase','^erase /vault$')]};const before=structuredClone(recipe),rules=loadPack(recipe);const call=Object.freeze({tool:'Bash',command});const opts=Object.freeze({preprocess:true});
  for(let i=0;i<3;i++){expect(extractDecodedVariants(command)).toEqual([command,'inspect','erase /vault']);expect(extractDecodedVariants('ok')).toEqual(['ok']);expect(evaluate(call,rules,opts).action).toBe('deny');}
  expect(recipe).toEqual(before);expect(rules.map(c=>c.rule)).toEqual(before.rules);expect(Object.isFrozen(rules)).toBe(false);expect(Object.isFrozen(rules[0]!.rule)).toBe(false);
 });
 it('accepts empty, malformed and ordinary strings without inventing variants',()=>{
  for(const s of ['', 'echo', 'echo !!! | base64 -d | sh','echo AAAAAAAA | base64 -d | sh','plain'])expect(extractDecodedVariants(s)).toEqual([s]);
  expect(evaluate({tool:'Bash'},load([]),{preprocess:true}).action).toBe('allow');
 });
 it('retains case-insensitive recognizers',()=>{
  const command=pipe('inspect')+'; '+pipe('erase /vault').replace('echo','ECHO').replace('base64','BASE64');
  expect(extractDecodedVariants(command)).toEqual([command,'inspect','erase /vault']);
 });
 it('supports mixed quoted echo and printf pipe forms',()=>{
  const command=`echo '${b64('inspect')}' | base64 -d | sh ; printf "${b64('erase /vault')}" | base64 -d | bash`;
  // Quoted echo was never recognized; retain grammar, but later supported printf must be seen.
  expect(extractDecodedVariants(command)).toEqual([command,'erase /vault']);
 });
 it('does not manufacture matches for disabled or wrong-tool rules',()=>{
  const command=pipe('inspect')+'; '+pipe('erase /vault');for(const rule of [{...r('erase','^erase /vault$'),enabled:false},{...r('erase','^erase /vault$'),appliesTo:['Other']}]){
   const out=evaluate({tool:'Bash',command},load([rule]),{preprocess:true});expect(out.action).toBe('allow');expect(out.matches).toEqual([]);
  }
 });
});
