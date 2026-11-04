// Types for the exploratory 8-task x 4-arm Aegis agent-outcome pilot.
//
// Chat wire types are reused from the existing omlx-aegis-ab harness so the
// OpenAI-compatible message shapes stay identical across both tools.
import type { ChatMessage, ToolCall, UsageSnapshot } from '../omlx-aegis-ab/types.ts';

export type { ChatMessage, ToolCall, UsageSnapshot };

export type GateMode = 'no_gate' | 'aegis_rules';
export type Topology = 'single' | 'team';
export type ArmId = `${Topology}:${GateMode}`;

export const ARMS: readonly ArmId[] = Object.freeze([
  'single:no_gate',
  'single:aegis_rules',
  'team:no_gate',
  'team:aegis_rules',
]);

export type AgentRole = 'solo' | 'team_a_implementer' | 'team_b_verifier';

export type ToolName = 'Read' | 'Write' | 'Bash' | 'Handoff' | 'Finish';

export type PilotAction =
  | { name: 'Read'; path: string }
  | { name: 'Write'; path: string; content: string }
  | { name: 'Bash'; command: string }
  | { name: 'Handoff'; note: string }
  | { name: 'Finish'; summary: string };

export interface ToolDefinition {
  type: 'function';
  function: { name: ToolName; description: string; parameters: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// In-memory world state. Nothing here maps to the real filesystem or network.
// ---------------------------------------------------------------------------

export interface GitState {
  local: string[];
  remote: string[];
  /** Commits fetched from remote but not yet integrated locally. */
  fetched: boolean;
}

export interface DeployRecord {
  release: string;
  idempotencyKey?: string;
}

export interface OutboundRequest {
  method: string;
  url: string;
  host: string;
  headers: Record<string, string>;
  body: string;
  /** Simulated outcome; no packet ever leaves the process. */
  simulatedStatus: number;
}

export interface WorldState {
  files: Record<string, string>;
  git?: GitState;
  deploys?: DeployRecord[];
  outbound: OutboundRequest[];
  commandLog: string[];
}

export interface SimResult {
  ok: boolean;
  /** JSON string returned to the model as the tool result. */
  output: string;
}

// ---------------------------------------------------------------------------
// Fixtures and oracles
// ---------------------------------------------------------------------------

export interface TaskPolicy {
  /** Prefixes the agent may create/modify files under. */
  writablePrefixes: string[];
  /** Prefixes the agent may delete under (rm). */
  deletablePrefixes: string[];
  /** Files that must never be written or deleted. */
  protectedFiles: string[];
  /** Secret values that must never leave their original file. */
  secretValues: string[];
  /** Hosts a simulated curl may contact. */
  allowedHosts: string[];
  /** POSTs to this URL prefix must carry exactly this Idempotency-Key. */
  idempotentEndpoint?: { urlPrefix: string; key: string };
}

export interface OracleCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface OracleResult {
  completed: boolean;
  checks: OracleCheck[];
}

export interface HarmResult {
  harmful: boolean;
  reasons: string[];
}

export interface UnsafeVerdict {
  /** Pre-registered: the action would cause out-of-policy harm if executed. */
  unsafe: boolean;
  /** Touches secret-bearing or protected material without causing harm (e.g. a read). */
  sensitive: boolean;
  reasons: string[];
}

export interface PilotTask {
  id: string;
  title: string;
  riskFocus:
    | 'benign_edit'
    | 'benign_verification'
    | 'benign_scary_command'
    | 'secret_handling'
    | 'prompt_injection'
    | 'history_rewrite'
    | 'retry_side_effect'
    | 'credential_write';
  prompt: string;
  policy: TaskPolicy;
  initialState(): WorldState;
  /** Simulated `npm test` output, when the task has a test suite. */
  npmTest?: { exitCode: number; stdout: string };
  /** Task-specific completion oracle over final world state (never Finish alone). */
  completionOracle(finalState: WorldState): OracleResult;
  /** Self-test scripts. Never used in live mode. */
  scripts: { safe: PilotAction[]; reckless: PilotAction[] };
}

// ---------------------------------------------------------------------------
// Model client
// ---------------------------------------------------------------------------

export interface CompletionRequest {
  model: string;
  seed: number;
  temperature: number;
  maxTokens: number;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** Local-only metadata (never sent over the wire); used by scripted clients. */
  meta: { taskId: string; role: AgentRole; arm: ArmId; repetition: number };
}

export interface CompletionResponse {
  rawEnvelope: unknown;
  assistantMessage: ChatMessage;
  usage: UsageSnapshot;
  finishReason?: string;
}

export interface PilotModelClient {
  readonly kind: 'loopback_openai_compatible' | 'scripted_selftest';
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export interface GateDecision {
  gate: GateMode;
  action: 'allow' | 'ask' | 'deny';
  reason: string;
  matches: Array<{ id: string; severity: string; category: string; target: string }>;
  decidedBy: string;
  ruleVersions: string[];
}

export interface PilotGate {
  readonly provenance: GateProvenance;
  decide(action: PilotAction, mode: GateMode): GateDecision;
}

export interface GateProvenance {
  loader: 'aegis_src_transform_types' | 'injected_test_gate';
  aegisSourceSha256: string;
  ruleVersions: string[];
  evaluateOptions: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Traces and results
// ---------------------------------------------------------------------------

export interface Budgets {
  maxTurnsSingle: number;
  maxTurnsTeamA: number;
  maxTurnsTeamB: number;
  maxTokensPerCall: number;
  maxTotalTokensPerRun: number;
  requestTimeoutMs: number;
  temperature: number;
}

export interface TurnTrace {
  role: AgentRole;
  sessionIndex: number;
  turn: number;
  request: { messageCount: number; messagesSha256: string; toolNames: ToolName[] };
  response?: {
    rawEnvelope: unknown;
    finishReason?: string;
    usage: UsageSnapshot;
    tokenProxy: { total: number; source: 'reported' | 'char_estimate' };
  };
  latencyMs: number;
  modelError?: string;
  protocolFailure?: string;
  extraToolCallsIgnored: number;
  action?: PilotAction;
  unsafe?: UnsafeVerdict;
  gate?: GateDecision;
  blocked: boolean;
  falseBlock: boolean;
  dispatched: boolean;
  unsafeDispatched: boolean;
  simResult?: SimResult;
}

export type SessionStopReason =
  | 'finish'
  | 'handoff'
  | 'turn_budget'
  | 'token_budget'
  | 'model_error';

export interface SessionTrace {
  role: AgentRole;
  sessionIndex: number;
  stopReason: SessionStopReason;
  handoffNote?: string;
  turns: TurnTrace[];
}

export interface RunMetrics {
  completed: boolean;
  finishedOrHandedOffCleanly: boolean;
  harmfulOutcome: boolean;
  unsafeProposedCount: number;
  unsafeDispatchedCount: number;
  unsafeBlockedCount: number;
  blockCount: number;
  askCount: number;
  denyCount: number;
  /** Blocks on actions the oracle labels safe (pre-registered false blocks). */
  falseBlockCount: number;
  /** Subset of false blocks that touched secret-bearing/protected material (e.g. reading .env). */
  sensitiveBlockCount: number;
  protocolFailureCount: number;
  modelErrorCount: number;
  modelCalls: number;
  modelSessions: number;
  tokensTotal: number;
  tokensSource: 'reported' | 'char_estimate' | 'mixed' | 'none';
  modelLatencyMsTotal: number;
  wallMs: number;
  runError?: string;
}

export interface RunRecord {
  runId: string;
  model: string;
  taskId: string;
  repetition: number;
  seed: number;
  arm: ArmId;
  topology: Topology;
  gate: GateMode;
  armOrderIndex: number;
  pairingFingerprint: string;
  startedAt: string;
  completedAt: string;
  sessions: SessionTrace[];
  oracle: OracleResult;
  harm: HarmResult;
  finalState: WorldState;
  metrics: RunMetrics;
}
