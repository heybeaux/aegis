/**
 * The evaluator: match rules, take the deterministic severity floor, optionally
 * escalate with an AWM prediction, return the strictest action.
 *
 * Combination rule (the heart of Aegis):
 *   action = strictest_of(severity_floor, prediction_overlay)
 *   order: deny > ask > allow
 * The predictor can only ESCALATE — it can never turn a critical match into allow.
 * See docs/aegis-rulepack-spec-2026-06-14.md §4.
 */

import type {
  CompiledRule,
  Evaluation,
  GateAction,
  Prediction,
  PredictionThresholds,
  RuleHit,
  Severity,
  SeverityTable,
  ToolCall,
} from '../types.js';
import { extractDecodedVariants } from './preprocess.js';

export const DEFAULT_SEVERITY_TABLE: SeverityTable = {
  critical: 'deny',
  high: 'ask',
  medium: 'ask',
  low: 'allow',
};

export const DEFAULT_PREDICTION_THRESHOLDS: PredictionThresholds = {
  denyAtOrAbove: 0.8,
  askAtOrAbove: 0.4,
};

const ACTION_RANK: Record<GateAction, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

function strictest(a: GateAction, b: GateAction): GateAction {
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}

function targetString(call: ToolCall, target: CompiledRule['rule']['match']['target']): string[] {
  switch (target) {
    case 'command':
      return call.command ? [call.command] : [];
    case 'content':
      return call.content ? [call.content] : [];
    case 'path':
      return call.paths ?? [];
    case 'argv':
      return call.argv ?? [];
  }
}

function ruleApplies(appliesTo: string[], tool: string): boolean {
  return appliesTo.includes('*') || appliesTo.includes(tool);
}

function matchesRule(compiled: CompiledRule, call: ToolCall): boolean {
  const { rule, regex } = compiled;
  if (!ruleApplies(rule.appliesTo, call.tool)) return false;
  if (rule.enabled === false) return false;

  const strings = targetString(call, rule.match.target);
  for (const s of strings) {
    if (rule.match.kind === 'regex' && regex) {
      if (regex.test(s)) return true;
    } else if (rule.match.kind === 'substring') {
      if (s.includes(rule.match.pattern)) return true;
    }
  }
  return false;
}

function swarmlabPolicyHits(call: ToolCall): RuleHit[] {
  const hits: RuleHit[] = [];
  const h = call.handoff;
  if (h) {
    const depth = h.delegationDepth ?? 0;
    const tier = h.manifestTier ?? 'none';
    if (depth >= 2 && tier !== 'value-echo') {
      hits.push({
        id: 'swarmlab.rt07.deep-handoff-requires-value-echo',
        severity: 'medium',
        category: 'swarmlab',
        target: 'argv',
      });
    }
  }

  const v = call.verification;
  if (
    v?.highRiskAudit === true &&
    v.status === 'supported' &&
    (v.tier === 'cross_model_adversarial' || v.tier === 'unsupported_claim_only')
  ) {
    hits.push({
      id: 'swarmlab.rt08.high-risk-audit-requires-grounded-support',
      severity: 'medium',
      category: 'swarmlab',
      target: 'argv',
    });
  }

  if (v?.highRiskAudit === true && v.status === 'supported' && v.tier === 'retrieval_grounded') {
    const sameModelOrProvider =
      v.panelDiversity === 'single_model' ||
      v.panelDiversity === 'same_model_n' ||
      v.panelDiversity === 'same_provider';
    const unpinnedCriterion = v.criterionPinned === false;
    const sharedPremiseWithoutIndependentCheck =
      v.sharedPremiseRisk === true &&
      v.adversarialVerifierPresent !== true &&
      v.specialistVerifierPresent !== true;
    const singleSourceWithoutSpecialist =
      v.sourceDiversity === 'single_source' &&
      v.specialistVerifierPresent !== true;
    if (
      sameModelOrProvider ||
      unpinnedCriterion ||
      sharedPremiseWithoutIndependentCheck ||
      singleSourceWithoutSpecialist
    ) {
      hits.push({
        id: 'swarmlab.rt14.panel-certification-requires-independent-checks',
        severity: 'medium',
        category: 'swarmlab',
        target: 'argv',
      });
    }
  }

  const c = call.completion;
  if (
    c !== undefined &&
    (c.claim === 'done' || c.claim === 'failed') &&
    c.desiredStateVerified !== true
  ) {
    hits.push({
      id: 'swarmlab.rt09.completion-claims-require-desired-state-receipts',
      severity: 'medium',
      category: 'swarmlab',
      target: 'argv',
    });
  }

  if (
    c !== undefined &&
    c.claim === 'retry' &&
    c.ambiguousSideEffect === true &&
    c.idempotencyKeyPresent !== true
  ) {
    hits.push({
      id: 'swarmlab.rt09.ambiguous-external-retries-require-idempotency',
      severity: 'medium',
      category: 'swarmlab',
      target: 'argv',
    });
  }

  const r = call.recall;
  if (
    r !== undefined &&
    r.responseMode === 'answer' &&
    r.sourceScope === 'private' &&
    r.targetScope !== 'private'
  ) {
    hits.push({
      id: 'swarmlab.rt10.private-memory-cross-scope-disclosure',
      severity: 'medium',
      category: 'swarmlab',
      target: 'argv',
    });
  }

  if (
    r !== undefined &&
    r.responseMode === 'answer' &&
    r.exactClaim === true &&
    r.source !== 'raw_context' &&
    r.citationsPresent !== true
  ) {
    hits.push({
      id: 'swarmlab.rt10.exact-recall-requires-grounded-citation',
      severity: 'medium',
      category: 'swarmlab',
      target: 'argv',
    });
  }

  if (
    r !== undefined &&
    r.responseMode === 'answer' &&
    r.exactClaim === true &&
    r.latestEvidence !== true
  ) {
    hits.push({
      id: 'swarmlab.rt10.exact-recall-requires-fresh-evidence',
      severity: 'medium',
      category: 'swarmlab',
      target: 'argv',
    });
  }

  const b = call.contentBoundary;
  if (b !== undefined && b.trust === 'untrusted' && b.parserMode !== 'structured') {
    const signals = new Set(b.instructionSignals ?? []);
    const authoritySpoofed =
      signals.has('authority_spoof') || signals.has('tool_output_spoof');
    const riskyRedirect =
      signals.has('action_request') ||
      signals.has('secret_request') ||
      signals.has('completion_override');
    if (authoritySpoofed && riskyRedirect) {
      hits.push({
        id: 'swarmlab.rt11.untrusted-boundaries-require-structured-extraction',
        severity: 'medium',
        category: 'swarmlab',
        target: 'argv',
      });
    }
  }

  const f = call.factLifecycle;
  if (f !== undefined) {
    const latestRevoked = f.latestStatus === 'revoked';
    const latestNeedsRevalidation = f.latestStatus === 'needs_revalidation';
    const lifecycleSuperseded = f.superseded === true;
    const replacementAvailable = f.replacementAvailable === true;
    const recoveryObserved = f.recoveryObserved === true;
    if (
      lifecycleSuperseded &&
      (latestRevoked || latestNeedsRevalidation || replacementAvailable || recoveryObserved)
    ) {
      hits.push({
        id: 'swarmlab.rt12.superseded-facts-require-lifecycle-refresh',
        severity: 'medium',
        category: 'swarmlab',
        target: 'argv',
      });
    } else if (latestRevoked || latestNeedsRevalidation) {
      hits.push({
        id: 'swarmlab.rt12.superseded-facts-require-lifecycle-refresh',
        severity: 'medium',
        category: 'swarmlab',
        target: 'argv',
      });
    }
  }

  const m = call.coordination;
  if (m !== undefined) {
    const missingTextCoordination =
      m.overlapClass === 'text_conflict' &&
      m.fileLockPresent !== true &&
      m.mergeQueuePresent !== true;
    const missingDuplicateCoordination =
      m.overlapClass === 'duplicate_intent' &&
      m.taskLeasePresent !== true &&
      m.intentLedgerPresent !== true &&
      m.semanticReviewPresent !== true;
    const missingApiDriftCoordination =
      m.overlapClass === 'api_drift' &&
      m.branchFreshness === 'stale' &&
      m.mergeQueuePresent !== true;
    const missingInvariantCoordination =
      m.overlapClass === 'shared_invariant' &&
      m.semanticReviewPresent !== true &&
      m.verificationCoverage !== 'semantic';
    if (
      missingTextCoordination ||
      missingDuplicateCoordination ||
      missingApiDriftCoordination ||
      missingInvariantCoordination
    ) {
      hits.push({
        id: 'swarmlab.rt13.risky-merges-require-coordination',
        severity: 'medium',
        category: 'swarmlab',
        target: 'argv',
      });
    }
  }

  return hits;
}

function swarmlabReason(id: string): string {
  if (id.includes('rt14')) {
    return 'SwarmLab RT-14: high-risk panel certifications need pinned criteria plus adversarial or specialist independence when model diversity can still share a premise or source';
  }
  if (id.includes('rt13')) {
    return 'SwarmLab RT-13: stale overlapping merges, duplicate intent, and shared invariants require queue, lease, or semantic-review coordination before land';
  }
  if (id.includes('rt12')) {
    return 'SwarmLab RT-12: superseded, revoked, or revalidation-needed fact lifecycles require a fresh lifecycle check before routing, deployment, approval, or execution relies on them';
  }
  if (id.includes('rt11.untrusted-boundaries')) {
    return 'SwarmLab RT-11: untrusted authority-bearing content requires structured extraction before it can redirect the task';
  }
  if (id.includes('rt10.private-memory')) {
    return 'SwarmLab RT-10: private memory cannot be disclosed into a broader scope';
  }
  if (id.includes('rt10.exact-recall-requires-grounded-citation')) {
    return 'SwarmLab RT-10: exact recall claims after compaction require grounded citations or raw context';
  }
  if (id.includes('rt10.exact-recall-requires-fresh-evidence')) {
    return 'SwarmLab RT-10: exact recall claims require fresh evidence, not stale or summary-only memory';
  }
  if (id.includes('rt09.completion-claims')) {
    return 'SwarmLab RT-09: completion claims require desired-state receipts, not process or success-text alone';
  }
  if (id.includes('rt09.ambiguous-external-retries')) {
    return 'SwarmLab RT-09: ambiguous external retries require idempotency evidence before they are safe to repeat';
  }
  if (id.includes('rt08')) {
    return 'SwarmLab RT-08: high-risk audits require grounded support, not cross-model-only agreement';
  }
  return 'SwarmLab RT-07: delegation depth >= 2 requires a value-echo handoff manifest';
}

function predictionAction(
  prediction: Prediction | undefined,
  thresholds: PredictionThresholds,
): GateAction {
  if (!prediction) return 'allow';
  if (prediction.pFailure >= thresholds.denyAtOrAbove) return 'deny';
  if (prediction.pFailure >= thresholds.askAtOrAbove) return 'ask';
  return 'allow';
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface EvaluateOptions {
  severityTable?: SeverityTable;
  predictionThresholds?: PredictionThresholds;
  prediction?: Prediction;
  ruleVersions?: string[];
  /**
   * When true, decode-then-rescan preprocessing is applied to Bash commands.
   * Encoded payloads (base64, hex escapes) are decoded and rules are run against
   * both the original and decoded variants. The strictest match wins.
   * Default: false (for backward compat — the hook enables this explicitly).
   */
  preprocess?: boolean;
}

export function evaluate(
  call: ToolCall,
  compiledRules: CompiledRule[],
  opts: EvaluateOptions = {},
): Evaluation {
  const severityTable = opts.severityTable ?? DEFAULT_SEVERITY_TABLE;
  const thresholds = opts.predictionThresholds ?? DEFAULT_PREDICTION_THRESHOLDS;

  // Build the set of ToolCall variants to test. When preprocessing is on,
  // decoded variants of the command are synthesized and evaluated in addition
  // to the original — the strictest result across all variants wins.
  const callsToTest: ToolCall[] = [call];
  if (opts.preprocess && call.command) {
    const variants = extractDecodedVariants(call.command);
    // Skip index 0 — that's the original, already in callsToTest.
    for (const variant of variants.slice(1)) {
      callsToTest.push({ ...call, command: variant });
    }
  }

  const hits: RuleHit[] = [];
  let maxSeverity: Severity | null = null;
  let topReason = '';

  for (const hit of swarmlabPolicyHits(call)) {
    hits.push(hit);
    if (maxSeverity === null || SEVERITY_RANK[hit.severity] > SEVERITY_RANK[maxSeverity]) {
      maxSeverity = hit.severity;
      topReason = swarmlabReason(hit.id);
    }
  }

  for (const testCall of callsToTest) {
    for (const compiled of compiledRules) {
      if (!matchesRule(compiled, testCall)) continue;
      const { rule } = compiled;
      // Avoid duplicate hit entries when the same rule fires on multiple variants.
      if (!hits.some((h) => h.id === rule.id)) {
        hits.push({
          id: rule.id,
          severity: rule.severity,
          category: rule.category,
          target: rule.match.target,
        });
      }
      if (maxSeverity === null || SEVERITY_RANK[rule.severity] > SEVERITY_RANK[maxSeverity]) {
        maxSeverity = rule.severity;
        topReason = rule.description;
      }
    }
  }

  const severityFloor: GateAction = maxSeverity ? severityTable[maxSeverity] : 'allow';
  const predAction = predictionAction(opts.prediction, thresholds);
  const action = strictest(severityFloor, predAction);

  let decidedBy: Evaluation['decidedBy'];
  if (severityFloor === action && predAction === action) decidedBy = 'both';
  else if (predAction === action && severityFloor !== action) decidedBy = 'prediction';
  else decidedBy = 'severity';

  const reason =
    decidedBy === 'prediction' && opts.prediction
      ? `predicted P(failure)=${opts.prediction.pFailure.toFixed(2)} — ${action}`
      : topReason || 'no rule matched';

  return {
    action,
    decidedBy,
    matches: hits,
    prediction: opts.prediction,
    reason,
    ruleVersions: opts.ruleVersions ?? [],
  };
}
