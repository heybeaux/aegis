/**
 * Aegis core types.
 *
 * Rule packs are DATA (JSON), the engine is the only code. These types are the
 * contract for both. See docs/aegis-rulepack-spec-2026-06-14.md.
 *
 * Note on severity vs RiskLevel: Aegis rule `Severity` is a superset of Lattice's
 * contract-level `RiskLevel` ('low'|'medium'|'high') — it adds 'critical'. Severity is
 * internal to rule classification and maps into a gate action; it is NOT the contract type.
 */

/** Rule severity — internal to Aegis rule packs (superset of Lattice RiskLevel). */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** What the gate ultimately returns to the Sonder hook. */
export type GateAction = 'allow' | 'ask' | 'deny';

/** Rule classification buckets. */
export type RuleCategory =
  | 'bash'
  | 'file_write'
  | 'file_read'
  | 'secrets'
  | 'injection'
  | 'pii'
  | 'swarmlab';

/** Which assembled string a rule tests. */
export type MatchTarget = 'command' | 'content' | 'path' | 'argv';

/** How a rule matches. `ast` is reserved for Phase 5 (code-tool parsing). */
export type MatchKind = 'regex' | 'substring' | 'ast';

/** Subset of JS RegExp flags Aegis allows. No `g` (stateful lastIndex is a footgun). */
export type AllowedFlag = 'i' | 'm' | 's' | 'u';

export interface RuleMatch {
  kind: MatchKind;
  /** Raw pattern source. For `regex`, a JS-dialect RegExp source string. */
  pattern: string;
  /** Allowed flags only; validated at load. */
  flags?: string;
  target: MatchTarget;
}

export interface Rule {
  /** Stable, namespaced, kebab id — THE merge/override key (e.g. "bash.rm-rf-root"). */
  id: string;
  category: RuleCategory;
  severity: Severity;
  description: string;
  match: RuleMatch;
  /** Tool-name allowlist (Claude Code / OpenClaw names). ["*"] = any tool. */
  appliesTo: string[];
  remediation?: string;
  references?: string[];
  /** Packs may ship disabled rules; overlays can flip. Defaults true. */
  enabled?: boolean;
  /** Required on an overlay rule that LOWERS a builtin's strictness. Default false. */
  allowDowngrade?: boolean;
}

export interface RulePack {
  packId: string;
  version: string;
  source?: string;
  engineMin?: string;
  rules: Rule[];
}

/** A rule compiled and ready for matching. */
export interface CompiledRule {
  rule: Rule;
  /** Present when match.kind === 'regex'. */
  regex?: RegExp;
}

/** Inputs the evaluator tests rules against. Assembled by the host/hook. */
export interface HandoffMetadata {
  /** Delegation depth of the handoff tree. RT-07 requires value echo at depth >= 2. */
  delegationDepth?: number;
  /** Requirement manifest tier carried at the handoff boundary. */
  manifestTier?: 'none' | 'presence' | 'value-echo';
  /** Number of requirements/items represented by the handoff manifest. */
  requirementCount?: number;
}

export interface VerificationMetadata {
  /** Verification tier attached to a fact/claim before a high-risk audit consumes it. */
  tier?:
    | 'human_attestation'
    | 'provenance_chain'
    | 'retrieval_grounded'
    | 'cross_model_adversarial'
    | 'unsupported_claim_only';
  /** Verification status attached to the fact/claim. */
  status?: 'supported' | 'unsupported' | 'contradicted' | 'needs_human';
  /** Whether this claim is being consumed by a high-risk audit/release decision. */
  highRiskAudit?: boolean;
  /** Whether the verifier panel had correlated-error risk. */
  correlatedVerifierRisk?: boolean;
  /** What diversity shape produced the model-panel certification. */
  panelDiversity?: 'single_model' | 'same_model_n' | 'same_provider' | 'cross_provider';
  /** Whether the panel was pinned to the user's exact decision criterion. */
  criterionPinned?: boolean;
  /** Whether the panel shares a known false-premise or blind-spot risk. */
  sharedPremiseRisk?: boolean;
  /** Whether the cited sources are independent or all echo one source. */
  sourceDiversity?: 'none' | 'single_source' | 'independent';
  /** Whether an adversarial verifier explicitly challenged the panel. */
  adversarialVerifierPresent?: boolean;
  /** Whether a task-specific specialist verifier checked the panel. */
  specialistVerifierPresent?: boolean;
  /** What task class the panel is certifying. */
  taskClass?: 'factual_qa' | 'criterion_interpretation' | 'fact_check' | 'code_review';
}

export interface CompletionMetadata {
  /** What category of task is being finalized or retried. */
  actionCategory?:
    | 'file_write'
    | 'artifact_build'
    | 'test_run'
    | 'external_write'
    | 'job_schedule'
    | 'issue_update'
    | 'message_send';
  /** Whether the caller is claiming done, failed, or wants to retry. */
  claim?: 'done' | 'failed' | 'retry';
  /** Which receipt class currently backs that claim. */
  receiptClass?:
    | 'self_report'
    | 'process'
    | 'tool_output'
    | 'desired_state'
    | 'desired_state_with_idempotency';
  /** Whether the desired end state has actually been verified. */
  desiredStateVerified?: boolean;
  /** Whether a failure/timeout may have happened after a side effect landed. */
  ambiguousSideEffect?: boolean;
  /** Whether the external write is protected by an idempotency key. */
  idempotencyKeyPresent?: boolean;
}

export interface RecallMetadata {
  /** What kind of memory claim the caller is about to make. */
  claimKind?:
    | 'exact_path'
    | 'exact_command'
    | 'exact_identifier'
    | 'negative_constraint'
    | 'private_fact'
    | 'exact_date'
    | 'high_level_summary'
    | 'rejected_option';
  /** Which memory source currently backs the claim. */
  source?: 'raw_context' | 'summary_only' | 'retrieved_evidence' | 'fact_ledger';
  /** Whether the caller is making an exact factual claim rather than a high-level summary. */
  exactClaim?: boolean;
  /** Whether the final answer carries a grounding citation/receipt. */
  citationsPresent?: boolean;
  /** Whether the supporting evidence is the latest corrected version. */
  latestEvidence?: boolean;
  /** Scope of the recalled fact. */
  sourceScope?: 'public' | 'shared' | 'private';
  /** Scope of the destination context. */
  targetScope?: 'public' | 'shared' | 'private';
  /** Whether the caller plans to answer or refuse. */
  responseMode?: 'answer' | 'refuse';
}

export interface ContentBoundaryMetadata {
  /** Which untrusted content surface the agent is consuming. */
  sourceType?: 'github_issue' | 'json' | 'log' | 'web_page' | 'trace' | 'chat_quote';
  /** Whether the content should be treated as trusted instructions or untrusted data. */
  trust?: 'trusted' | 'untrusted';
  /** Whether the caller is still ingesting the document raw or has switched to extraction mode. */
  parserMode?: 'raw' | 'structured';
  /** Signals that the content is trying to pose as authority or redirect the task. */
  instructionSignals?: (
    | 'authority_spoof'
    | 'action_request'
    | 'secret_request'
    | 'completion_override'
    | 'tool_output_spoof'
  )[];
  /** What action the caller is about to take because of the content. */
  proposedAction?: 'answer' | 'mark_done' | 'exfiltrate_secret';
}

export interface FactLifecycleMetadata {
  /** What class of fact the caller is using. */
  factClass?:
    | 'capability'
    | 'deployment_target'
    | 'user_preference'
    | 'dependency'
    | 'endpoint'
    | 'quota_limit';
  /** What kind of operation relies on that fact. */
  usageKind?: 'route' | 'deploy' | 'notify' | 'approve' | 'execute';
  /** Lifecycle status of the specific fact basis the caller is leaning on. */
  basisStatus?: 'supported' | 'revoked' | 'needs_revalidation';
  /** Latest lifecycle status for that fact family after all newer corrections. */
  latestStatus?: 'supported' | 'revoked' | 'needs_revalidation';
  /** True when newer lifecycle evidence superseded the fact basis in hand. */
  superseded?: boolean;
  /** True when a corrected replacement value is already available. */
  replacementAvailable?: boolean;
  /** True when a later support row re-established a once-revoked fact. */
  recoveryObserved?: boolean;
}

export interface CoordinationMetadata {
  /** What coordination operation the caller is about to perform. */
  operation?: 'merge';
  /** Whether the branch proposal is current or stale against main. */
  branchFreshness?: 'current' | 'stale';
  /** What class of overlap/race is present. */
  overlapClass?:
    | 'none'
    | 'text_conflict'
    | 'api_drift'
    | 'duplicate_intent'
    | 'shared_invariant';
  /** Whether a file lock already serialized overlapping writes. */
  fileLockPresent?: boolean;
  /** Whether a task lease already guards this intent. */
  taskLeasePresent?: boolean;
  /** Whether an intent ledger exists for dedupe/invariant declaration. */
  intentLedgerPresent?: boolean;
  /** Whether the merge lands through a queue after refresh. */
  mergeQueuePresent?: boolean;
  /** Whether a semantic reviewer checked the overlap before merge. */
  semanticReviewPresent?: boolean;
  /** How strong the post-merge verification is for the risky overlap. */
  verificationCoverage?: 'none' | 'visible' | 'semantic';
}

export interface ToolCall {
  /** Claude Code / OpenClaw tool name, e.g. "Bash", "Write", "Edit", "Read". */
  tool: string;
  /** Assembled shell command, for bash-like tools. */
  command?: string;
  /** File/secret content, for write/secret rules. */
  content?: string;
  /** Paths touched by the call. */
  paths?: string[];
  /** Raw argv, for argv-target rules. */
  argv?: string[];
  /** Optional structured handoff/delegation metadata from Sonder/AOP/Lattice. */
  handoff?: HandoffMetadata;
  /** Optional structured verification metadata from Engram/Parliament/SwarmLab RT-08. */
  verification?: VerificationMetadata;
  /** Optional structured completion metadata from SwarmLab RT-09. */
  completion?: CompletionMetadata;
  /** Optional structured recall metadata from SwarmLab RT-10. */
  recall?: RecallMetadata;
  /** Optional structured untrusted-content boundary metadata from SwarmLab RT-11. */
  contentBoundary?: ContentBoundaryMetadata;
  /** Optional structured fact-lifecycle metadata from SwarmLab RT-12. */
  factLifecycle?: FactLifecycleMetadata;
  /** Optional structured coordination metadata from SwarmLab RT-13. */
  coordination?: CoordinationMetadata;
}

/** One rule that fired during evaluation. */
export interface RuleHit {
  id: string;
  severity: Severity;
  category: RuleCategory;
  target: MatchTarget;
}

/** A predictive contribution (AWM or rule-derived prior). */
export interface Prediction {
  pFailure: number;
  confidence: number;
  source: 'awm' | 'prior';
}

/** The evaluator's output — exactly what the Sonder hook consumes and emits. */
export interface Evaluation {
  action: GateAction;
  decidedBy: 'severity' | 'prediction' | 'both';
  matches: RuleHit[];
  prediction?: Prediction;
  reason: string;
  ruleVersions: string[];
}

/** severity -> deterministic floor action (the constitution table). */
export type SeverityTable = Record<Severity, GateAction>;

export interface PredictionThresholds {
  /** P(failure) >= this -> deny. */
  denyAtOrAbove: number;
  /** P(failure) >= this -> ask. */
  askAtOrAbove: number;
}
