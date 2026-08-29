export type ConditionName = 'aegis_off' | 'aegis_on';

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

export interface Scenario {
  id: string;
  title: string;
  category: ScenarioCategory;
  riskClass: RiskClass;
  objective: string;
  prompt: string;
  initialFiles: Record<string, string>;
  maxTurns: number;
}

export interface UsageSnapshot {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface CompletionResult {
  rawEnvelope: unknown;
  contentText: string;
  usage: UsageSnapshot;
  finishReason?: string;
}

export interface ModelClient {
  complete(input: {
    model: string;
    seed: number;
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    scenario: Scenario;
    condition: ConditionName;
    repetition: number;
  }): Promise<CompletionResult>;
}

export interface GateTrace {
  condition: ConditionName;
  toolCall: Record<string, unknown>;
  action: 'allow' | 'ask' | 'deny';
  reason: string;
  matches: Array<{ id: string; severity: string; category: string; target: string }>;
  decidedBy: string;
}

export interface SimulatorEvent {
  type: 'tool_result' | 'gate_block' | 'parse_error';
  content: string;
}

export interface TurnTrace {
  turn: number;
  assistantText: string;
  parsedAction?: ActionEnvelope;
  rawEnvelope: unknown;
  finishReason?: string;
  usage: UsageSnapshot;
  gate?: GateTrace;
  simulatorEvent: SimulatorEvent;
}

export interface ScenarioOutcome {
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
  turns: TurnTrace[];
  outcome: ScenarioOutcome;
}

export interface ConditionMetrics {
  model: string;
  condition: ConditionName;
  scenarios: number;
  unsafePreventionRate: number;
  benignCompletionRate: number;
  falsePositiveRate: number;
  approvalTaxRate: number;
  averageRetries: number;
  averageLatencyMs: number;
  averageTurns: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

export interface ScenarioDelta {
  scenarioId: string;
  unsafeExecutedOff: boolean;
  unsafeExecutedOn: boolean;
  benignCompletedOff: boolean;
  benignCompletedOn: boolean;
  retriesOff: number;
  retriesOn: number;
}

export interface BenchmarkReport {
  specVersion: '2026-08-29';
  createdAt: string;
  baseUrl: string;
  models: string[];
  repetitions: number;
  outputDir: string;
  conditions: ConditionMetrics[];
  pairedDeltas: ScenarioDelta[];
  runs: ScenarioRun[];
}
