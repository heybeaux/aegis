import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
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
const gate = (input: ToolCall, store: SourcePolicyRosterCheckpointStore) => evaluateWithSourcePolicyRosterCheckpoint(input, rules, store);

describe('RT-45 durable source policy roster checkpoint', () => {
  it('initializes only host-authenticated truth, advances and preserves same-epoch/order replay', async () => {
    const store = new Store();
    expect((await gate(call(1), store)).action).toBe('allow');
    expect(store.proposals[0]?.authenticated).toBe(false);
    expect((await gate(call(2), store)).action).toBe('allow');
    expect((await gate(call(2, [...members].reverse()), store)).action).toBe('allow');
    expect(store.state).toEqual(cp(2));
  });
  it('blocks coherent rollback after serialized restart while pure evaluate stays compatible', async () => {
    const original = new Store(); await gate(call(2), original);
    const restarted = new Store(JSON.parse(JSON.stringify(original.state)));
    expect(evaluate(call(1), rules).action).toBe('allow');
    const result = await gate(call(1), restarted);
    expect(result.action).toBe('ask');
    expect(result.matches.map(m => m.id)).toContain('swarmlab.rt45.source-policy-roster-requires-monotonic-checkpoint');
    expect(restarted.writes).toBe(0); expect(restarted.state).toEqual(cp(2));
  });
  it('blocks same-epoch membership fork without overwriting the checkpoint', async () => {
    const store = new Store(cp(2));
    expect((await gate(call(2, ['north', 'south']), store)).action).toBe('ask');
    expect(store.writes).toBe(0); expect(store.state).toEqual(cp(2));
  });
  it.each([null, [], 1, { ...cp(), authenticated: false }, { ...cp(), rosterId: 'foreign' }, { ...cp(), rosterEpoch: 0 }, { ...cp(), rosterEpoch: Number.MAX_SAFE_INTEGER + 1 }, { ...cp(), rosterDigest: 'bad' }])('rejects malformed retained checkpoint %j', async bad => {
    const store = new Store(bad as SourcePolicyRosterCheckpoint);
    // A genuinely absent checkpoint is allowed to initialize, unlike malformed truth.
    expect((await gate(call(), store)).action).toBe(bad === null ? 'allow' : 'ask');
    if (bad !== null) expect(store.writes).toBe(0);
  });
  it('recovers post-commit acknowledgement loss using exact independent readback', async () => {
    const store = new Store(); const save = store.observe.bind(store);
    store.observe = async p => { await save(p); throw new Error('lost ack'); };
    expect((await gate(call(), store)).action).toBe('allow');
  });
  it('refuses false acknowledgement, precommit error and unverified self-certification', async () => {
    for (const mode of ['false-ack', 'precommit-error', 'self-certify']) {
      const store = new Store();
      store.observe = async p => { if (mode === 'precommit-error') throw new Error('offline'); if (mode === 'self-certify') store.state = p; };
      expect((await gate(call(), store)).action).toBe('ask');
    }
  });
  it('refuses disappearing checkpoint and a newer epoch racing exact readback', async () => {
    for (const state of [null, cp(3)]) {
      const store = new Store(cp(1)); store.observe = async () => { store.state = state; };
      expect((await gate(call(), store)).action).toBe('ask');
    }
  });
  it('fails closed on either read outage, without writing after initial outage', async () => {
    for (const failingRead of [1, 2]) {
      const store = new Store(); let reads = 0;
      store.read = async () => { if (++reads === failingRead) throw new Error('offline'); return store.state; };
      expect((await gate(call(), store)).action).toBe('ask');
      if (failingRead === 1) expect(store.writes).toBe(0);
    }
  });
  it('requires explicit complete roster on strict boundary; preserves earlier rules and deny floor', async () => {
    const input = call(); delete input.sourceFreshness?.policyAuthorityRoster;
    expect((await gate(input, new Store())).action).toBe('ask');
    expect((await gate({ tool: 'Other' }, new Store())).action).toBe('ask');
    const stale = call(); stale.sourceFreshness!.actionAtMs = 1101;
    const store = new Store(); const r = await gate(stale, store);
    expect(r.action).toBe('ask'); expect(store.writes).toBe(0);
    expect(r.matches.map(m => m.id)).toContain('swarmlab.rt41.consequential-fact-use-requires-source-freshness');
    const deny = loadPack({ packId: 'deny', version: '1', rules: [{ id: 'critical', description: 'critical', severity: 'critical', category: 'destructive', appliesTo: ['*'], match: { target: 'command', kind: 'substring', pattern: 'danger' } }] });
    expect((await evaluateWithSourcePolicyRosterCheckpoint({ ...call(), command: 'danger' }, deny, store)).action).toBe('deny');
  });
  it('does not bypass explicit strict checkpoint checks via a permissive severity table', async () => {
    expect((await evaluateWithSourcePolicyRosterCheckpoint(call(1), rules, new Store(cp(2)), { severityTable: { critical: 'deny', high: 'ask', medium: 'allow', low: 'allow' } })).action).toBe('ask');
  });
});

describe('RT-48 async evaluator configuration integrity', () => {
  const critical = () => loadPack({packId:'config',version:'1',rules:[{id:'config-critical',description:'critical',severity:'critical',category:'bash',appliesTo:['*'],enabled:false,match:{target:'command',kind:'substring',pattern:'danger'}}]});
  it.each(['first','observe','last'] as const)('detects nested rule tightening after %s, preserving current deny and early I/O discipline', async phase => {
    const input = {...call(),command:'danger'}; const mutable = critical(); const store = new Store(cp()); let reads = 0;
    store.read = async () => {reads++; if(phase === (reads===1?'first':'last'))mutable[0]!.rule.enabled=true; return {...cp()};};
    store.observe = async () => {store.writes++;if(phase==='observe')mutable[0]!.rule.enabled=true;};
    const result=await evaluateWithSourcePolicyRosterCheckpoint(input,mutable,store);
    expect(result.action).toBe('deny');expect(result.matches.map(m=>m.id)).toContain('swarmlab.rt48.async-source-policy-gate-requires-stable-configuration');
    if(phase==='first')expect(store.writes).toBe(0);if(phase==='observe')expect(reads).toBe(1);
  });
  it('preserves captured critical deny when live policy and input are weakened together',async()=>{
    const mutable=critical();mutable[0]!.rule.enabled=true;const input={...call(),command:'safe'};const store=new Store(cp());
    store.read=async()=>{mutable[0]!.rule.enabled=false;input.command='danger';return cp();};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(input,mutable,store)).action).toBe('deny');expect(store.writes).toBe(0);
  });
  it.each(['severity','prediction','thresholds','versions','preprocess'] as const)('fails closed on option %s drift without freezing the owner',async mode=>{
    const input={...call(),command:'danger'};const mutable=critical();const options={severityTable:{critical:'deny' as const,high:'ask' as const,medium:'ask' as const,low:'allow' as const},prediction:{pFailure:.1},predictionThresholds:{denyAtOrAbove:.8,askAtOrAbove:.4},ruleVersions:['v1'],preprocess:false};const store=new Store(cp());
    store.read=async()=>{switch(mode){case 'severity':options.severityTable.medium='ask';options.severityTable.low='deny' as 'allow';break;case 'prediction':options.prediction.pFailure=.9;break;case 'thresholds':options.predictionThresholds.denyAtOrAbove=.05;break;case 'versions':options.ruleVersions.push('v2');break;case 'preprocess':options.preprocess=true;break;}return cp();};
    const result=await evaluateWithSourcePolicyRosterCheckpoint(input,mutable,store,options);
    expect(result.action).toBe(mode==='prediction'||mode==='thresholds'?'deny':'ask');expect(store.writes).toBe(0);
    expect(()=>options.ruleVersions.push('still-owned')).not.toThrow();expect(()=>mutable[0]!.rule.enabled=true).not.toThrow();
  });
  it('detects regex source/flag drift, ignores incidental stateless lastIndex, and permits equivalent config',async()=>{
    const mutable=loadPack({packId:'regex',version:'1',rules:[{id:'regex-critical',description:'critical',severity:'critical',category:'bash',appliesTo:['*'],match:{target:'command',kind:'regex',pattern:'danger',flags:'i'}}]});const input={...call(),command:'safe'};
    const store=new Store(cp());store.read=async()=>{mutable[0]!.regex=/safe/i;return cp();};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(input,mutable,store)).action).toBe('deny');
    const unchanged=critical();const ok=new Store(cp());ok.read=async()=>{unchanged[0]!.rule=structuredClone(unchanged[0]!.rule);return cp();};expect((await evaluateWithSourcePolicyRosterCheckpoint(input,unchanged,ok)).action).toBe('allow');
    const stateless=loadPack({packId:'regex',version:'1',rules:[{id:'regex-critical',description:'critical',severity:'critical',category:'bash',appliesTo:['*'],match:{target:'command',kind:'regex',pattern:'danger',flags:'i'}}]});const lastIndex=new Store(cp());lastIndex.read=async()=>{stateless[0]!.regex!.lastIndex=7;return cp();};expect((await evaluateWithSourcePolicyRosterCheckpoint(input,stateless,lastIndex)).action).toBe('allow');
  });
  it('detects mutation on rejected I/O, and cannot lower ask through permissive severity',async()=>{
    const mutable=critical();const store=new Store(cp());store.read=async()=>{mutable[0]!.rule.description='changed';throw new Error('offline');};
    const result=await evaluateWithSourcePolicyRosterCheckpoint(call(),mutable,store,{severityTable:{critical:'allow',high:'allow',medium:'allow',low:'allow'}});
    expect(result.action).toBe('ask');expect(result.matches.map(m=>m.id)).toContain('swarmlab.rt48.async-source-policy-gate-requires-stable-configuration');expect(store.writes).toBe(0);
  });
  it('fails closed on unsnapshotable options; initial deny remains deny',async()=>{
    const options={ruleVersions:['v1'],unexpectedFunction:()=>true};const mutable=critical();mutable[0]!.rule.enabled=true;
    const store=new Store(cp());expect((await evaluateWithSourcePolicyRosterCheckpoint({...call(),command:'safe'},mutable,store,options)).action).toBe('ask');
    expect((await evaluateWithSourcePolicyRosterCheckpoint({...call(),command:'danger'},mutable,store,options)).action).toBe('deny');expect(store.writes).toBe(0);
  });
});
