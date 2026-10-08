import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import { evaluate, evaluateWithSourcePolicyRosterCheckpoint, loadPack, type SourcePolicyRosterCheckpoint, type SourcePolicyRosterCheckpointStore, type ToolCall } from '../src/index.js';

const rules = loadPack({ packId: 'empty', version: '1', rules: [] });
const members = ['authority:east', 'authority:west'];
const digest = (epoch: number, ids = members) => `sha256:${createHash('sha256').update(JSON.stringify({ memberIds: [...ids].sort(), rosterEpoch: epoch, rosterId: 'roster:deploy' })).digest('hex')}`;
const cp = (epoch = 2, ids = members): SourcePolicyRosterCheckpoint => ({ rosterId: 'roster:deploy', rosterEpoch: epoch, rosterDigest: digest(epoch, ids), authenticated: true });
const call = (epoch = 2, ids = members): ToolCall => ({ tool: 'ActOnRememberedFact', sourceFreshness: {
  risk: 'high', checkStatus: 'fresh', authenticated: true, sourceId: 's', expectedSourceId: 's', cachedSourceVersion: 7, observedSourceVersion: 7,
  checkedAtMs: 1000, actionAtMs: 1010, maxAgeMs: 100, policyId: 'p', expectedPolicyId: 'p', policyVersion: 5, expectedPolicyVersion: 5,
  policyAuthenticated: true, sourceVersionNamespace: 'v', expectedSourceVersionNamespace: 'v', expectedMaxAgeMs: 100,
  expectedPolicyAuthorityIds: ids, policyAuthorities: ids.map(authorityId => ({ authorityId, authenticated: true, policyId: 'p', policyVersion: 5, sourceVersionNamespace: 'v', maxAgeMs: 100 })),
  expectedPolicyAuthorityRosterId: 'roster:deploy', expectedPolicyAuthorityRosterEpoch: epoch, expectedPolicyAuthorityRosterDigest: digest(epoch, ids), policyAuthorityRoster: { ...cp(epoch, ids), memberIds: ids },
} });
class Store implements SourcePolicyRosterCheckpointStore {
  writes = 0;
  proposals: SourcePolicyRosterCheckpoint[] = [];
  constructor(public state: SourcePolicyRosterCheckpoint | null = null) {}
  async read() { return this.state ? { ...this.state } : null; }
  async observe(proposal: SourcePolicyRosterCheckpoint) {
    this.writes++; this.proposals.push({ ...proposal });
    if (!this.state || proposal.rosterEpoch > this.state.rosterEpoch) this.state = { ...proposal, authenticated: true };
  }
}
describe('RT-47 immutable observation lifetime during awaited I/O', () => {
  it.each([['first',91,'ask',0,1],['observe',91,'ask',1,1],['last',91,'ask',1,2],['first',90,'allow',1,2],['last',90,'allow',1,2]] as const)('checks %s elapsed %s inclusively', async (phase,elapsed,action,writes,expectedReads) => {
    const input=call(); const original=structuredClone(input);const store=new Store(cp());let tick=0,reads=0;const save=store.observe.bind(store);
    store.read=async()=>{if(++reads===(phase==='first'?1:2)&&phase!=='observe')tick=elapsed;return cp();};
    store.observe=async p=>{await save(p);if(phase==='observe')tick=elapsed;};
    const result=await evaluateWithSourcePolicyRosterCheckpoint(input,rules,store,{monotonicNowMs:()=>10000+tick});
    expect(result.action).toBe(action);expect(store.writes).toBe(writes);expect(reads).toBe(expectedReads);expect(input).toEqual(original);expect(Object.isFrozen(input)).toBe(false);
    if(action==='ask')expect(result.matches.map(m=>m.id)).toContain('swarmlab.rt47.async-source-policy-gate-requires-unexpired-observation');
  });
  it('accounts for cumulative latency, not just the last operation',async()=>{
    const store=new Store(cp());let tick=0,reads=0;store.read=async()=>{tick=++reads===1?30:91;return cp();};store.observe=async()=>{tick=60;};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(call(),rules,store,{monotonicNowMs:()=>tick})).action).toBe('ask');
  });
  it.each([NaN,Infinity,-1])('fails closed for invalid entry clock %s before store access',async value=>{
    const store=new Store(cp());const read=vi.spyOn(store,'read');
    expect((await evaluateWithSourcePolicyRosterCheckpoint(call(),rules,store,{monotonicNowMs:()=>value})).action).toBe('ask');expect(read).not.toHaveBeenCalled();expect(store.writes).toBe(0);
  });
  it.each([NaN,Infinity,-1])('fails closed for nonfinite/regressing clock %s after first read',async value=>{
    const store=new Store(cp());let tick=0;store.read=async()=>{tick=value;return cp();};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(call(),rules,store,{monotonicNowMs:()=>tick})).action).toBe('ask');expect(store.writes).toBe(0);
  });
  it('rejects backwards clock movement even when still after entry',async()=>{
    const store=new Store(cp());let tick=0;store.read=async()=>{tick=20;return cp();};store.observe=async()=>{tick=19;};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(call(),rules,store,{monotonicNowMs:()=>tick})).action).toBe('ask');
  });
  it('preserves initial deny with a throwing clock and makes no store calls',async()=>{
    const deny=loadPack({packId:'deny',version:'1',rules:[{id:'critical',description:'critical',severity:'critical',category:'destructive',appliesTo:['*'],match:{target:'command',kind:'substring',pattern:'danger'}}]});
    const store=new Store(cp());const read=vi.spyOn(store,'read');
    expect((await evaluateWithSourcePolicyRosterCheckpoint({...call(),command:'danger'},deny,store,{monotonicNowMs:()=>{throw Error('clock');}})).action).toBe('deny');expect(read).not.toHaveBeenCalled();
  });
  it('retains current deny when an expired read also changes the live command',async()=>{
    const deny=loadPack({packId:'deny',version:'1',rules:[{id:'critical',description:'critical',severity:'critical',category:'destructive',appliesTo:['*'],match:{target:'command',kind:'substring',pattern:'danger'}}]});const input=call();const store=new Store(cp());let tick=0;store.read=async()=>{input.command='danger';tick=91;return cp();};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(input,deny,store,{monotonicNowMs:()=>tick})).action).toBe('deny');expect(store.writes).toBe(0);
  });
  it('cannot allow expiry through a permissive severity table',async()=>{
    const store=new Store(cp());let tick=0;store.read=async()=>{tick=91;return cp();};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(call(),rules,store,{monotonicNowMs:()=>tick,severityTable:{critical:'deny',high:'allow',medium:'allow',low:'allow'}})).action).toBe('ask');
  });
  it('does not reconcile an expired acknowledged-or-not write with another read',async()=>{
    const store=new Store(cp());let tick=0;const read=vi.spyOn(store,'read');store.observe=async()=>{tick=91;throw Error('lost ack');};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(call(),rules,store,{monotonicNowMs:()=>tick})).action).toBe('ask');expect(read).toHaveBeenCalledTimes(1);
  });
  it('reports expiry on a throwing first store read without observes',async()=>{
    const store=new Store(cp());let tick=0;store.read=async()=>{tick=91;throw Error('read failed');};
    const result=await evaluateWithSourcePolicyRosterCheckpoint(call(),rules,store,{monotonicNowMs:()=>tick});expect(result.action).toBe('ask');expect(result.matches.map(m=>m.id)).toContain('swarmlab.rt47.async-source-policy-gate-requires-unexpired-observation');expect(store.writes).toBe(0);
  });
  it('captures the clock reference; caller options are not frozen or modified',async()=>{
    const store=new Store(cp());let tick=0;const options={monotonicNowMs:()=>tick};store.read=async()=>{tick=91;options.monotonicNowMs=()=>0;return cp();};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(call(),rules,store,options)).action).toBe('ask');expect(Object.isFrozen(options)).toBe(false);
  });
  it('uses a real monotonic default clock, not synthetic action timestamps as live time',async()=>{
    const clock=vi.spyOn(performance,'now');let tick=0;clock.mockImplementation(()=>tick);const store=new Store(cp());store.read=async()=>{tick=91;return cp();};
    try{expect((await evaluateWithSourcePolicyRosterCheckpoint(call(),rules,store)).action).toBe('ask');expect(store.writes).toBe(0);}finally{clock.mockRestore();}
  });
  it.each([0,1])('zero budget allows only zero elapsed (%s)',async elapsed=>{
    const input=call();const f=input.sourceFreshness!;f.checkedAtMs=f.actionAtMs=1000;f.maxAgeMs=f.expectedMaxAgeMs=0;f.policyAuthorities!.forEach(a=>a.maxAgeMs=0);const store=new Store(cp());let tick=0;store.read=async()=>{tick=elapsed;return cp();};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(input,rules,store,{monotonicNowMs:()=>tick})).action).toBe(elapsed===0?'allow':'ask');
  });
  it('leaves pure evaluate legacy behavior unchanged',()=>{expect(evaluate(call(),rules).action).toBe('allow');});
});
