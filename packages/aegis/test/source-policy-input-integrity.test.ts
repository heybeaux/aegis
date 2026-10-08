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


describe('RT-46 async gate input integrity', () => {
  it.each(['first','last'])('refuses stale live evidence changed during %s read', async phase => {
    const input = call(); const store = new Store(cp()); let reads = 0;
    store.read = async () => { if (++reads === (phase === 'first' ? 1 : 2)) input.sourceFreshness!.actionAtMs = 1101; return cp(); };
    const result = await gate(input, store);
    expect(result.action).toBe('ask');
    expect(result.matches.map(m => m.id)).toContain('swarmlab.rt46.async-source-policy-gate-requires-stable-input');
    if (phase === 'first') expect(store.writes).toBe(0);
  });
  it('detects mutation during observe before allowing, without freezing caller objects', async () => {
    const input=call(); const store=new Store(cp()); const save=store.observe.bind(store);
    store.observe=async p => { await save(p); input.sourceFreshness!.observedSourceVersion=8; };
    expect((await gate(input,store)).action).toBe('ask');
    expect(Object.isFrozen(input)).toBe(false); expect(Object.isFrozen(input.sourceFreshness)).toBe(false);
  });
  it('accepts equivalent deep-cloned evidence and does not mutate the original', async () => {
    const input=call();const original=structuredClone(input);const store=new Store(cp());
    store.read=async()=>{ input.sourceFreshness=structuredClone(input.sourceFreshness);return cp(); };
    expect((await gate(input,store)).action).toBe('allow');expect(input).toEqual(original);
  });
  it('preserves newly observed critical deny instead of merely asking', async () => {
    const input=call();const store=new Store(cp());
    const deny=loadPack({packId:'deny',version:'1',rules:[{id:'critical',description:'critical',severity:'critical',category:'destructive',appliesTo:['*'],match:{target:'command',kind:'substring',pattern:'danger'}}]});
    store.read=async()=>{input.command='danger';return cp();};
    const result=await evaluateWithSourcePolicyRosterCheckpoint(input,deny,store);
    expect(result.action).toBe('deny');expect(store.writes).toBe(0);
    expect(result.matches.map(m=>m.id)).toContain('critical');
  });
  it('cannot lower the integrity gate via a permissive severity table', async () => {
    const input=call();const store=new Store(cp());store.read=async()=>{input.sourceFreshness!.actionAtMs=1101;return cp();};
    expect((await evaluateWithSourcePolicyRosterCheckpoint(input,rules,store,{severityTable:{critical:'deny',high:'allow',medium:'allow',low:'allow'}})).action).toBe('ask');
  });
  it('detects authority array and fact lifecycle mutation, not just scalar roster drift', async () => {
    for(const mode of ['authority','fact']) {
      const input=call(); input.factLifecycle={factClass:'deployment_target',usageKind:'deploy',basisStatus:'supported',latestStatus:'supported',superseded:false};
      const store=new Store(cp());store.read=async()=>{if(mode==='authority') input.sourceFreshness!.policyAuthorities![1]!.policyVersion=4;else input.factLifecycle!.latestStatus='revoked';return cp();};
      expect((await gate(input,store)).action).toBe('ask');expect(store.writes).toBe(0);
    }
  });
  it('retains initial deny floor without touching the store', async () => {
    const input=call();input.command='danger';const store=new Store(cp());
    const deny=loadPack({packId:'deny',version:'1',rules:[{id:'critical',description:'critical',severity:'critical',category:'destructive',appliesTo:['*'],match:{target:'command',kind:'substring',pattern:'danger'}}]});
    expect((await evaluateWithSourcePolicyRosterCheckpoint(input,deny,store)).action).toBe('deny');expect(store.writes).toBe(0);
  });
  it('rejects unsupported unsnapshotable data rather than authorizing it', async () => {
    const input=call(); const store=new Store(cp()); Object.assign(input,{extension:()=>undefined});
    expect((await gate(input,store)).action).toBe('ask');expect(store.writes).toBe(0);
  });
});
