import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Prediction, ToolCall, GateAction } from '@heybeaux/lattice-aegis';

export type PredictorFailureMode = 'fail-open' | 'fail-closed' | 'degraded';

export interface PredictorContext {
  now?: Date;
  signal?: AbortSignal;
}

export interface PredictorResult {
  prediction: Prediction;
  latencyMs: number;
  mode: 'live' | 'fallback';
  state: 'ok' | 'timeout' | 'error';
  actionKey: string;
  degraded: boolean;
  fallbackReason?: string;
  evidence: {
    sameActionAttempts: number;
    sameActionBlocks: number;
    sameActionApprovals: number;
    recentSessionBlocks: number;
    recentSessionAttempts: number;
  };
}

export interface ApprovalObservation {
  actionKey: string;
  approvedAt?: string;
}

interface ActionStats {
  attempts: number;
  blocks: number;
  approvals: number;
  lastSeenAt: string;
  lastPFailure: number;
}

interface RecentDecision {
  at: string;
  actionKey: string;
  action: GateAction;
}

interface PredictorState {
  version: 1;
  actions: Record<string, ActionStats>;
  recent: RecentDecision[];
}

const DEFAULT_TIMEOUT_MS = 150;
const ASK_FALLBACK = 0.4;
const DENY_FALLBACK = 1;

function statePath(): string {
  const root = process.env['AEGIS_HOME'] ?? join(homedir(), '.aegis');
  return process.env['AEGIS_PREDICTOR_STATE_PATH'] ?? join(root, 'predictor-state.json');
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function loadState(): PredictorState {
  const path = statePath();
  if (!existsSync(path)) return { version: 1, actions: {}, recent: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PredictorState;
    return parsed.version === 1 && parsed.actions && Array.isArray(parsed.recent)
      ? parsed
      : { version: 1, actions: {}, recent: [] };
  } catch {
    return { version: 1, actions: {}, recent: [] };
  }
}

function saveState(state: PredictorState): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pathRisk(paths: string[] | undefined): number {
  if (!paths || paths.length === 0) return 0;
  if (paths.some((path) => /^\/(etc|usr|bin|sbin|lib)\b/.test(path))) return 0.3;
  if (paths.some((path) => /(^|\/)\./.test(path))) return 0.06;
  return Math.min(0.12, paths.length * 0.03);
}

function toolBaseRisk(call: ToolCall): number {
  switch (call.tool) {
    case 'Bash':
      return 0.12;
    case 'Write':
    case 'Edit':
      return 0.18;
    case 'Delegate':
    case 'Task':
      return 0.2;
    case 'Read':
      return 0.05;
    default:
      return 0.08;
  }
}

function combinatorRisk(command: string | undefined): number {
  if (!command) return 0;
  const matches = command.match(/(;|&&|\|\||\||`|\$\(|>|<)/g) ?? [];
  return Math.min(0.18, matches.length * 0.04);
}

function contentRisk(content: string | undefined): number {
  if (!content) return 0;
  if (/OPENAI_API_KEY|aws\/credentials|BEGIN [A-Z ]*PRIVATE KEY/.test(content)) return 0.25;
  return content.length > 5000 ? 0.04 : 0;
}

export function actionKeyFor(call: ToolCall): string {
  const payload = {
    tool: call.tool,
    command: call.command,
    contentHash: call.content
      ? createHash('sha256').update(call.content).digest('hex').slice(0, 16)
      : undefined,
    paths: call.paths,
    argv: call.argv,
    handoff: call.handoff,
    verification: call.verification,
    completion: call.completion,
    recall: call.recall,
    contentBoundary: call.contentBoundary,
    factLifecycle: call.factLifecycle,
    coordination: call.coordination,
    intervention: call.intervention,
  };
  return createHash('sha256').update(stable(payload)).digest('hex').slice(0, 24);
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new Error('predictor aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`predictor timed out after ${timeoutMs}ms`)), timeoutMs);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('predictor aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

async function scorePrediction(call: ToolCall, now: Date): Promise<PredictorResult> {
  const artificialDelayMs = Number(process.env['AEGIS_PREDICTOR_DELAY_MS'] ?? '0');
  if (Number.isFinite(artificialDelayMs) && artificialDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, artificialDelayMs));
  }
  const state = loadState();
  const actionKey = actionKeyFor(call);
  const entry = state.actions[actionKey] ?? {
    attempts: 0,
    blocks: 0,
    approvals: 0,
    lastSeenAt: now.toISOString(),
    lastPFailure: 0,
  };
  const recentCutoff = now.getTime() - 10 * 60 * 1000;
  const recent = state.recent.filter((item) => Date.parse(item.at) >= recentCutoff);
  const sameActionRecent = recent.filter((item) => item.actionKey === actionKey);
  const recentBlocks = recent.filter((item) => item.action !== 'allow').length;

  const sameActionAttempts = entry.attempts;
  const sameActionBlocks = entry.blocks;
  const sameActionApprovals = entry.approvals;
  const recentSessionAttempts = recent.length;
  const recentSessionBlocks = recentBlocks;

  const blockedRate = sameActionAttempts === 0 ? 0 : sameActionBlocks / sameActionAttempts;
  const sessionBlockRate = recentSessionAttempts === 0 ? 0 : recentSessionBlocks / recentSessionAttempts;
  const sameActionRetryLift = Math.max(0, sameActionRecent.length - 1) * 0.1;

  const pFailure = clamp(
    toolBaseRisk(call) +
      pathRisk(call.paths) +
      combinatorRisk(call.command) +
      contentRisk(call.content) +
      blockedRate * 0.38 +
      sessionBlockRate * 0.18 +
      sameActionRetryLift +
      sameActionApprovals * 0.03,
    0.01,
    0.98,
  );
  const confidence = clamp(
    0.2 + Math.min(0.55, sameActionAttempts * 0.06) + Math.min(0.2, recentSessionAttempts * 0.01),
    0.2,
    0.95,
  );

  return {
    prediction: {
      pFailure,
      confidence,
      source: 'prior',
    },
    latencyMs: 0,
    mode: 'live',
    state: 'ok',
    actionKey,
    degraded: false,
    evidence: {
      sameActionAttempts,
      sameActionBlocks,
      sameActionApprovals,
      recentSessionBlocks,
      recentSessionAttempts,
    },
  };
}

export async function predictWithPolicy(
  call: ToolCall,
  failureMode: PredictorFailureMode,
  context: PredictorContext = {},
): Promise<PredictorResult> {
  const now = context.now ?? new Date();
  const rawTimeoutMs = Number(process.env['AEGIS_PREDICTOR_TIMEOUT_MS'] ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0 ? rawTimeoutMs : DEFAULT_TIMEOUT_MS;
  const started = Date.now();

  try {
    const result = await withTimeout(scorePrediction(call, now), timeoutMs, context.signal);
    return {
      ...result,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const actionKey = actionKeyFor(call);
    const state = error instanceof Error && /timed out/i.test(error.message) ? 'timeout' : 'error';
    const fallbackReason = error instanceof Error ? error.message : String(error);
    const fallbackPrediction =
      failureMode === 'fail-closed'
        ? { pFailure: DENY_FALLBACK, confidence: 0, source: 'prior' as const }
        : failureMode === 'degraded'
          ? { pFailure: ASK_FALLBACK, confidence: 0, source: 'prior' as const }
          : { pFailure: 0, confidence: 0, source: 'prior' as const };

    return {
      prediction: fallbackPrediction,
      latencyMs,
      mode: 'fallback',
      state,
      actionKey,
      degraded: failureMode !== 'fail-open',
      fallbackReason,
      evidence: {
        sameActionAttempts: 0,
        sameActionBlocks: 0,
        sameActionApprovals: 0,
        recentSessionBlocks: 0,
        recentSessionAttempts: 0,
      },
    };
  }
}

export function observeDecision(
  actionKey: string,
  action: GateAction,
  prediction: Prediction,
  now = new Date(),
): void {
  try {
    const state = loadState();
    const entry = state.actions[actionKey] ?? {
      attempts: 0,
      blocks: 0,
      approvals: 0,
      lastSeenAt: now.toISOString(),
      lastPFailure: prediction.pFailure,
    };
    entry.attempts += 1;
    if (action !== 'allow') entry.blocks += 1;
    entry.lastSeenAt = now.toISOString();
    entry.lastPFailure = prediction.pFailure;
    state.actions[actionKey] = entry;
    state.recent.push({ at: now.toISOString(), actionKey, action });
    state.recent = state.recent.slice(-200);
    saveState(state);
  } catch {
    // Predictor learning must never override an already-computed gate decision.
  }
}

export function observeApproval(observation: ApprovalObservation): void {
  try {
    const state = loadState();
    const entry = state.actions[observation.actionKey];
    if (!entry) return;
    entry.approvals += 1;
    entry.lastSeenAt = observation.approvedAt ?? new Date().toISOString();
    state.actions[observation.actionKey] = entry;
    saveState(state);
  } catch {
    // Approval remains valid even if predictor learning cannot be persisted.
  }
}

export function predictorFailureModeFromEnv(): PredictorFailureMode {
  const raw = process.env['AEGIS_PREDICTOR_FAILURE_MODE'];
  return raw === 'fail-closed' || raw === 'degraded' || raw === 'fail-open'
    ? raw
    : 'fail-open';
}
