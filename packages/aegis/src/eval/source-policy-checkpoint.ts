import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
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

/** Additional timing contract for the strict async boundary only; pure evaluate is unchanged. */
export interface SourcePolicyRosterCheckpointOptions extends EvaluateOptions {
  /** Trusted monotonic milliseconds. Defaults to performance.now; capture once per invocation. */
  monotonicNowMs?: () => number;
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

/** Refuse authorization detached from the caller's currently observable action/evidence. */
function inputChanged(base: Evaluation, call: ToolCall, rules: CompiledRule[], options: EvaluateOptions): Evaluation {
  const current = evaluate(call, rules, options);
  const floor = base.action === 'deny' ? base : current.action === 'deny' ? current : base;
  return {
    ...floor,
    action: floor.action === 'deny' ? 'deny' : 'ask',
    decidedBy: floor.action === 'deny' ? floor.decidedBy : 'severity',
    reason: floor.action === 'deny' ? floor.reason : 'SwarmLab RT-46: async source-policy gate input changed during evaluation',
    matches: [...floor.matches, { id: 'swarmlab.rt46.async-source-policy-gate-requires-stable-input', severity: 'medium', category: 'swarmlab', target: 'argv' }],
  };
}

function observationExpired(base: Evaluation, call: ToolCall, rules: CompiledRule[], options: EvaluateOptions): Evaluation {
  const current = evaluate(call, rules, options);
  const floor = base.action === 'deny' ? base : current.action === 'deny' ? current : base;
  return {
    ...floor,
    action: floor.action === 'deny' ? 'deny' : 'ask',
    decidedBy: floor.action === 'deny' ? floor.decidedBy : 'severity',
    reason: floor.action === 'deny' ? floor.reason : 'SwarmLab RT-47: source observation expired during async checkpoint I/O or monotonic clock is invalid',
    matches: [...floor.matches, { id: 'swarmlab.rt47.async-source-policy-gate-requires-unexpired-observation', severity: 'medium', category: 'swarmlab', target: 'argv' }],
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
  options: SourcePolicyRosterCheckpointOptions = {},
): Promise<Evaluation> {
  // Capture the clock function and entry sample before synchronous work. A broken clock must
  // not weaken an initial deny/ask; classify its validity only once initial evaluation allows.
  const now = options.monotonicNowMs ?? (() => performance.now());
  let started: number = NaN;
  try { started = now(); } catch { /* fail closed below, while preserving the initial floor */ }
  // Snapshot plain ToolCall data before any host callback. Do not freeze or alter caller-owned data.
  // The live caller input is compared after every await; equivalent deep copies remain valid.
  let snapshot: ToolCall;
  try { snapshot = structuredClone(call); } catch { return inputChanged(evaluate(call, rules, options), call, rules, options); }
  const base = evaluate(snapshot, rules, options);
  if (base.action !== 'allow') return base;
  const stable = () => isDeepStrictEqual(call, snapshot);
  const proposal = requestedCheckpoint(snapshot);
  if (!proposal) return ask(base);
  const freshness = snapshot.sourceFreshness!;
  const age = freshness.actionAtMs! - freshness.checkedAtMs!;
  const remaining = freshness.maxAgeMs! - age;
  // Use subtraction rather than adding large timestamps (which can overflow safe precision).
  if (!Number.isFinite(started) || started < 0 ||
    !Number.isSafeInteger(freshness.actionAtMs) || !Number.isSafeInteger(freshness.checkedAtMs) ||
    !Number.isSafeInteger(freshness.maxAgeMs) || freshness.checkedAtMs! < 0 ||
    freshness.maxAgeMs! < 0 || age < 0 || remaining < 0) return observationExpired(base, call, rules, options);
  let last = started;
  const unexpired = () => {
    try {
      const current = now();
      if (!Number.isFinite(current) || current < last || current < started) return false;
      last = current;
      return current - started <= remaining;
    } catch { return false; }
  };
  try {
    const prior: unknown = await store.read(proposal.rosterId);
    if (!stable()) return inputChanged(base, call, rules, options);
    if (!unexpired()) return observationExpired(base, call, rules, options);
    if (prior !== null) {
      if (!validCheckpoint(prior, proposal.rosterId) || prior.rosterEpoch > proposal.rosterEpoch ||
        prior.rosterEpoch === proposal.rosterEpoch && prior.rosterDigest !== proposal.rosterDigest) return ask(base);
    }
    try { await store.observe(Object.freeze({ ...proposal })); } catch { /* possibly committed; attest through readback */ }
    if (!stable()) return inputChanged(base, call, rules, options);
    if (!unexpired()) return observationExpired(base, call, rules, options);
    const retained: unknown = await store.read(proposal.rosterId);
    if (!stable()) return inputChanged(base, call, rules, options);
    if (!unexpired()) return observationExpired(base, call, rules, options);
    if (!validCheckpoint(retained, proposal.rosterId) || retained.rosterEpoch !== proposal.rosterEpoch || retained.rosterDigest !== proposal.rosterDigest) return ask(base);
    return base;
  } catch {
    if (!stable()) return inputChanged(base, call, rules, options);
    return unexpired() ? ask(base) : observationExpired(base, call, rules, options);
  }
}
