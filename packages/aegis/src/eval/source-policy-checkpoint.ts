import { createHash } from 'node:crypto';
import type { CompiledRule, Evaluation, ToolCall } from '../types.js';
import { evaluate, type EvaluateOptions } from './evaluate.js';

/** Independently authenticated durable high-water for one source-policy roster. */
export interface SourcePolicyRosterCheckpoint {
  rosterId: string;
  rosterEpoch: number;
  rosterDigest: string;
  authenticated: boolean;
}

/**
 * Host-owned shared, linearizable store retained across restart/handoff, outside the roster's
 * rollback domain. observe is atomic: create if absent; advance only to a greater epoch;
 * retain same-epoch conflicting digests without replacing them. Aegis proposals are NOT
 * authenticated; the host authenticates persisted truth returned by read. Exceptions may
 * mean acknowledgement loss, so Aegis always reconciles through independent exact readback.
 */
export interface SourcePolicyRosterCheckpointStore {
  read(rosterId: string): Promise<SourcePolicyRosterCheckpoint | null>;
  observe(proposal: SourcePolicyRosterCheckpoint): Promise<void>;
}

const HIT = 'swarmlab.rt45.source-policy-roster-requires-monotonic-checkpoint';
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v;
const hash = (v: unknown): v is string => typeof v === 'string' && /^sha256:[a-f0-9]{64}$/.test(v);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
function validCheckpoint(v: unknown, rosterId: string): v is SourcePolicyRosterCheckpoint {
  return object(v) && v['authenticated'] === true && id(v['rosterId']) && v['rosterId'] === rosterId &&
    Number.isSafeInteger(v['rosterEpoch']) && (v['rosterEpoch'] as number) > 0 && hash(v['rosterDigest']);
}
function requestedCheckpoint(call: ToolCall): SourcePolicyRosterCheckpoint | null {
  const f: unknown = call.sourceFreshness;
  if (!object(f) || f['checkStatus'] !== 'fresh' || !object(f['policyAuthorityRoster'])) return null;
  const r = f['policyAuthorityRoster'];
  if (!id(f['expectedPolicyAuthorityRosterId']) || !validCheckpoint(r, f['expectedPolicyAuthorityRosterId']) ||
    r['rosterEpoch'] !== f['expectedPolicyAuthorityRosterEpoch'] || r['rosterDigest'] !== f['expectedPolicyAuthorityRosterDigest']) return null;
  const members = r['memberIds'];
  const expected = f['expectedPolicyAuthorityIds'];
  if (!Array.isArray(members) || members.length === 0 || members.some(m => !id(m)) || new Set(members).size !== members.length ||
    !Array.isArray(expected) || expected.length !== members.length || expected.some(m => !id(m)) || new Set(expected).size !== expected.length) return null;
  const sorted = [...members].sort();
  const wanted = [...expected].sort();
  if (sorted.some((m, i) => m !== wanted[i])) return null;
  const digest = `sha256:${createHash('sha256').update(JSON.stringify({ memberIds: sorted, rosterEpoch: r['rosterEpoch'], rosterId: r['rosterId'] })).digest('hex')}`;
  if (digest !== r['rosterDigest']) return null;
  return { rosterId: r['rosterId'], rosterEpoch: r['rosterEpoch'], rosterDigest: r['rosterDigest'], authenticated: false } as SourcePolicyRosterCheckpoint;
}
function ask(base: Evaluation): Evaluation {
  return {
    ...base,
    action: base.action === 'deny' ? 'deny' : 'ask',
    decidedBy: base.action === 'deny' ? base.decidedBy : 'severity',
    reason: base.action === 'deny' ? base.reason : 'SwarmLab RT-45: source-policy roster requires authenticated monotonic checkpoint and exact durable readback',
    matches: [...base.matches, { id: HIT, severity: 'medium', category: 'swarmlab', target: 'argv' }],
  };
}

/**
 * Strict source-policy boundary. Pure evaluate remains backward compatible, but cannot promise
 * cross-call rollback safety. Never invoke the action before this async gate returns allow.
 * No API can prove checkpoint retention/independence or prevent a race after its final read.
 */
export async function evaluateWithSourcePolicyRosterCheckpoint(
  call: ToolCall,
  rules: CompiledRule[],
  store: SourcePolicyRosterCheckpointStore,
  options: EvaluateOptions = {},
): Promise<Evaluation> {
  const base = evaluate(call, rules, options);
  if (base.action !== 'allow') return base;
  const proposal = requestedCheckpoint(call);
  if (!proposal) return ask(base);
  try {
    const prior: unknown = await store.read(proposal.rosterId);
    if (prior !== null) {
      if (!validCheckpoint(prior, proposal.rosterId) || prior.rosterEpoch > proposal.rosterEpoch ||
        prior.rosterEpoch === proposal.rosterEpoch && prior.rosterDigest !== proposal.rosterDigest) return ask(base);
    }
    try { await store.observe(Object.freeze({ ...proposal })); } catch { /* possibly committed; attest through readback */ }
    const retained: unknown = await store.read(proposal.rosterId);
    if (!validCheckpoint(retained, proposal.rosterId) || retained.rosterEpoch !== proposal.rosterEpoch || retained.rosterDigest !== proposal.rosterDigest) return ask(base);
    return base;
  } catch { return ask(base); }
}
