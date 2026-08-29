export type ConditionName =
  | 'no_gate'
  | 'static_guardrails'
  | 'aegis_rules'
  | 'aegis_production_history';

export type ScenarioCategory =
  | 'benign'
  | 'destructive_high_risk'
  | 'obfuscated_injection'
  | 'retry_recovery';

export type RiskClass = 'benign' | 'unsafe' | 'retry_sensitive';

export interface StructuredMetadata {
  handoff?: {
    delegationDepth?: number;
    manifestTier?: 'none' | 'presence' | 'value-echo';
    requirementCount?: number;
  };
  verification?: {
    tier?:
      | 'human_attestation'
      | 'provenance_chain'
      | 'retrieval_grounded'
      | 'cross_model_adversarial'
      | 'unsupported_claim_only';
    status?: 'supported' | 'unsupported' | 'contradicted' | 'needs_human';
    highRiskAudit?: boolean;
    correlatedVerifierRisk?: boolean;
  };
  completion?: {
    actionCategory?:
      | 'file_write'
      | 'artifact_build'
      | 'test_run'
      | 'external_write'
      | 'job_schedule'
      | 'issue_update'
      | 'message_send';
    claim?: 'done' | 'failed' | 'retry';
    receiptClass?:
      | 'self_report'
      | 'process'
      | 'tool_output'
      | 'desired_state'
      | 'desired_state_with_idempotency';
    desiredStateVerified?: boolean;
    ambiguousSideEffect?: boolean;
    idempotencyKeyPresent?: boolean;
  };
  recall?: {
    claimKind?:
      | 'exact_path'
      | 'exact_command'
      | 'exact_identifier'
      | 'negative_constraint'
      | 'private_fact'
      | 'exact_date'
      | 'high_level_summary'
      | 'rejected_option';
    source?: 'raw_context' | 'summary_only' | 'retrieved_evidence' | 'fact_ledger';
    exactClaim?: boolean;
    citationsPresent?: boolean;
    latestEvidence?: boolean;
    sourceScope?: 'public' | 'shared' | 'private';
    targetScope?: 'public' | 'shared' | 'private';
    responseMode?: 'answer' | 'refuse';
  };
  contentBoundary?: {
    sourceType?: 'github_issue' | 'json' | 'log' | 'web_page' | 'trace' | 'chat_quote';
    trust?: 'trusted' | 'untrusted';
    parserMode?: 'raw' | 'structured';
    instructionSignals?: (
      | 'authority_spoof'
      | 'action_request'
      | 'secret_request'
      | 'completion_override'
      | 'tool_output_spoof'
    )[];
    proposedAction?: 'answer' | 'mark_done' | 'exfiltrate_secret';
  };
}

export interface ActionEnvelope extends StructuredMetadata {
  name: 'Bash' | 'Write' | 'Read' | 'Finish';
  command?: string;
  path?: string;
  content?: string;
  summary?: string;
}

export interface ReplayPrediction {
  pFailure: number;
  confidence: number;
  source: 'awm' | 'prior';
}

export interface PredictionTrace {
  pFailure: number;
  confidence: number;
  source: 'deterministic_stub' | 'production_prior' | 'production_fallback';
  rationale: string;
}

export interface Scenario {
  id: string;
  title: string;
  category: ScenarioCategory;
  riskClass: RiskClass;
  objective: string;
  prompt: string;
  initialFiles: Record<string, string>;
  maxTurns: number;
  replayPrediction?: ReplayPrediction;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: ActionEnvelope['name'];
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: unknown;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface UsageSnapshot {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface CompletionResult {
  rawEnvelope: unknown;
  assistantMessage: ChatMessage;
  usage: UsageSnapshot;
  finishReason?: string;
}

export interface ModelClient {
  complete(input: {
    model: string;
    seed: number;
    messages: ChatMessage[];
    scenario: Scenario;
    repetition: number;
    tools: ToolDefinition[];
  }): Promise<CompletionResult>;
}

export interface GateTrace {
  condition: ConditionName;
  toolCall: Record<string, unknown>;
  action: 'allow' | 'ask' | 'deny';
  reason: string;
  matches: Array<{ id: string; severity: string; category: string; target: string }>;
  decidedBy: string;
  prediction?: PredictionTrace;
}

export interface SimulatorEvent {
  type: 'tool_result' | 'gate_block' | 'parse_error';
  content: string;
}

export interface ProtocolQualification {
  qualified: boolean;
  reason: string;
  validToolCalls: number;
  protocolFailures: number;
  selfRefusals: number;
  finished: boolean;
}

export interface CapturedTurn {
  turn: number;
  assistantText: string;
  assistantMessage: ChatMessage;
  parsedAction?: ActionEnvelope;
  rawEnvelope: unknown;
  finishReason?: string;
  usage: UsageSnapshot;
  simulatorEvent: SimulatorEvent;
  toolCallId?: string;
  protocolFailure: boolean;
  modelSelfRefused: boolean;
}

export interface ReplayTurnOutcome {
  turn: number;
  toolName?: ActionEnvelope['name'];
  unsafeProposed: boolean;
  modelSelfRefused: boolean;
  protocolFailure: boolean;
  aegisIntervened: boolean;
  unsafeWouldExecuteWithoutGate: boolean;
  unsafePreventedByAegis: boolean;
  executedUnderCondition: boolean;
  predictionEligible: boolean;
  gate?: GateTrace;
}

export interface ScenarioOutcome {
  modelProtocolQualified: boolean;
  qualification: ProtocolQualification;
  eligibleForInterceptionScoring: boolean;
  eligibleDangerousProposalCount: number;
  finished: boolean;
  finishSummary?: string;
  success: boolean;
  unsafeAttempted: boolean;
  unsafeExecuted: boolean;
  benignCompleted: boolean;
  approvalBlocks: number;
  denyBlocks: number;
  retriesObserved: number;
  idempotentRetryUsed: boolean;
  files: Record<string, string>;
  executedCommands: string[];
  replayOutcomes: ReplayTurnOutcome[];
  unsafeProposed: boolean;
  modelSelfRefused: boolean;
  protocolFailure: boolean;
  aegisIntervened: boolean;
  unsafeWouldExecuteWithoutGate: boolean;
  unsafePreventedByAegis: boolean;
  unsafeProposedCount: number;
  modelSelfRefusalCount: number;
  protocolFailureCount: number;
  aegisInterventionCount: number;
  unsafeWouldExecuteWithoutGateCount: number;
  unsafePreventedByAegisCount: number;
  predictionEligibleCount: number;
}

export interface TurnTrace {
  turn: number;
  assistantText: string;
  assistantMessage: ChatMessage;
  parsedAction?: ActionEnvelope;
  rawEnvelope: unknown;
  finishReason?: string;
  usage: UsageSnapshot;
  gate?: GateTrace;
  simulatorEvent: SimulatorEvent;
  protocolFailure: boolean;
  modelSelfRefused: boolean;
}

export interface ScenarioRun {
  model: string;
  condition: ConditionName;
  scenarioId: string;
  repetition: number;
  seed: number;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  promptFingerprint: string;
  turns: TurnTrace[];
  outcome: ScenarioOutcome;
}

export interface ConditionMetrics {
  model: string;
  condition: ConditionName;
  scenarios: number;
  modelProtocolQualifiedScenarios: number;
  qualifiedCalls: number;
  pairedDangerousDenominator: number;
  unsafeProposedCount: number;
  unsafeWouldExecuteWithoutGateCount: number;
  unsafePreventedByAegisCount: number;
  modelSelfRefusalCount: number;
  protocolFailureCount: number;
  predictionEligibleCount: number;
  unsafePreventionRate: number;
  unsafePreventionNumerator: number;
  unsafePreventionDenominator: number;
  benignCompletionRate: number;
  falsePositiveRate: number;
  approvalTaxRate: number;
  averageRetries: number;
  averageLatencyMs: number;
  averageTurns: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  validity:
    | 'no_evidence'
    | 'inconclusive_single_pair'
    | 'below_minimum_threshold'
    | 'minimum_evidence_met';
}

export interface ScenarioDelta {
  model: string;
  repetition: number;
  scenarioId: string;
  modelProtocolQualified: boolean;
  promptFingerprint: string;
  baselineEligibleDangerousProposalCount: number;
  unsafePreventedByRulesCount: number;
  unsafePreventedByProductionHistoryCount: number;
  benignCompletedNoGate: boolean;
  benignCompletedRules: boolean;
  benignCompletedProductionHistory: boolean;
  protocolFailureCount: number;
  modelSelfRefusalCount: number;
  retriesNoGate: number;
  retriesRules: number;
  retriesProductionHistory: number;
}

export interface DeterministicCorpusCase {
  id: string;
  title: string;
  action: ActionEnvelope;
}

export interface DeterministicCaseResult {
  condition: ConditionName;
  action: 'allow' | 'ask' | 'deny';
  reason: string;
  prediction?: PredictionTrace;
}

export interface DeterministicSuiteCaseResult {
  id: string;
  title: string;
  results: DeterministicCaseResult[];
}

export interface QualificationCheck {
  scenarioId: string;
  passed: boolean;
  reason: string;
  validToolCalls: number;
  protocolFailures: number;
  selfRefusals: number;
}

export interface QualificationSummary {
  passed: boolean;
  checks: QualificationCheck[];
}

export interface BenchmarkReport {
  specVersion: '2026-08-29';
  createdAt: string;
  baseUrl: string;
  models: string[];
  repetitions: number;
  outputDir: string;
  qualification: Record<string, QualificationSummary>;
  conditions: ConditionMetrics[];
  pairedDeltas: ScenarioDelta[];
  runs: ScenarioRun[];
}
