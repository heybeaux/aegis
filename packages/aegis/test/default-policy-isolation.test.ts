import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SEVERITY_TABLE, DEFAULT_PREDICTION_THRESHOLDS, DEFAULT_SAFE,
  evaluate, evaluateWithSourcePolicyRosterCheckpoint, isSafeCommand, loadPack } from '../src/index.js';
import type { Severity, GateAction } from '../src/index.js';
const severity = { ...DEFAULT_SEVERITY_TABLE }, thresholds = { ...DEFAULT_PREDICTION_THRESHOLDS }, safe = [...DEFAULT_SAFE];
afterEach(() => { Object.assign(DEFAULT_SEVERITY_TABLE, severity); Object.assign(DEFAULT_PREDICTION_THRESHOLDS, thresholds); DEFAULT_SAFE.clear(); for (const c of safe) DEFAULT_SAFE.add(c); });
const call = { tool: 'Bash', command: 'classified-operation' };
const rules = (s: Severity) => loadPack({packId:'test',version:'1',rules:[{id:'classified',severity:s,category:'bash',description:'test',appliesTo:['Bash'],match:{target:'command',kind:'substring',pattern:'classified-operation'}}]});
const prediction = (p: number) => ({pFailure:p,confidence:.8,source:'awm' as const});
describe('implicit defaults are private policy, exports are editable templates', () => {
  for (const [s,expected] of Object.entries(severity) as [Severity, GateAction][]) {
    it(`does not let another consumer edit the implicit ${s} floor`, () => {
      const compiled = rules(s), before = evaluate(call, compiled);
      DEFAULT_SEVERITY_TABLE[s] = expected === 'allow' ? 'deny' : 'allow';
      expect(evaluate(call, compiled)).toEqual(before);
      expect(evaluate(call, compiled, {severityTable:DEFAULT_SEVERITY_TABLE}).action).toBe(DEFAULT_SEVERITY_TABLE[s]);
      expect(DEFAULT_SEVERITY_TABLE[s]).not.toBe(expected);
    });
  }
  it.each([[.9,'deny','denyAtOrAbove',1],[.5,'ask','askAtOrAbove',.7]] as const)('isolates implicit prediction %s', (p,expected,key,value) => {
    DEFAULT_PREDICTION_THRESHOLDS[key] = value;
    expect(evaluate(call, [], {prediction:prediction(p)}).action).toBe(expected);
    expect(evaluate(call, [], {prediction:prediction(p),predictionThresholds:DEFAULT_PREDICTION_THRESHOLDS}).action).toBe(p===.9?'ask':'allow');
  });
  it('isolates safe allowlist addition', () => { DEFAULT_SAFE.add('dangerous-op'); expect(isSafeCommand('dangerous-op')).toBe(false); expect(isSafeCommand('dangerous-op',DEFAULT_SAFE)).toBe(true); });
  it('isolates safe allowlist deletion', () => { DEFAULT_SAFE.delete('ls'); expect(isSafeCommand('ls')).toBe(true); expect(isSafeCommand('ls',DEFAULT_SAFE)).toBe(false); });
  it('isolates safe allowlist clear', () => { DEFAULT_SAFE.clear(); expect(isSafeCommand('echo safe')).toBe(true); expect(isSafeCommand('echo safe',DEFAULT_SAFE)).toBe(false); });
  it('keeps shell boundary and combinator checks under explicit sets', () => { DEFAULT_SAFE.add('catastrophe'); expect(isSafeCommand('catastrophe')).toBe(false); expect(isSafeCommand('catastrophe',DEFAULT_SAFE)).toBe(true); expect(isSafeCommand('ls; dangerous-op',DEFAULT_SAFE)).toBe(false); expect(isSafeCommand('',DEFAULT_SAFE)).toBe(false); });
  it('does not freeze explicit host policies', () => { const opts={severityTable:{...severity},predictionThresholds:{...thresholds},prediction:prediction(.1)}; evaluate(call,[],opts); opts.severityTable.critical='allow';opts.predictionThresholds.askAtOrAbove=.2;opts.prediction.pFailure=.3;expect(evaluate(call,[],opts).action).toBe('ask'); });
  it('strict entry uses private severity floor without host I/O', async () => { DEFAULT_SEVERITY_TABLE.critical='allow';let reads=0;const result=await evaluateWithSourcePolicyRosterCheckpoint(call,rules('critical'),{async read(){reads++;return null;},async observe(){}},{monotonicNowMs:()=>0});expect(result.action).toBe('deny');expect(reads).toBe(0);expect(result.matches[0]?.id).toBe('classified'); });
  it('strict entry uses private thresholds without host I/O', async () => { DEFAULT_PREDICTION_THRESHOLDS.askAtOrAbove=.7;let reads=0;const result=await evaluateWithSourcePolicyRosterCheckpoint(call,[],{async read(){reads++;return null;},async observe(){}},{prediction:prediction(.5),monotonicNowMs:()=>0});expect(result.action).toBe('ask');expect(reads).toBe(0); });
  it('explicit edited templates still reach strict entry classification', async () => { DEFAULT_SEVERITY_TABLE.critical='allow';const result=await evaluateWithSourcePolicyRosterCheckpoint(call,rules('critical'),{async read(){throw new Error('not reached');},async observe(){}},{severityTable:DEFAULT_SEVERITY_TABLE,monotonicNowMs:()=>0});expect(result.action).toBe('ask');expect(result.matches.some(m=>m.id.includes('rt45'))).toBe(true); });
});
