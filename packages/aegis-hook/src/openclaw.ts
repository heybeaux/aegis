import type { ToolCall } from '@heybeaux/lattice-aegis';
import type { HostAdapter, HookRequest, HookResponse } from './adapters.js';
import type { Decision } from './decide.js';
import type { HookRenderInput } from './adapters.js';

export interface OpenClawToolEvent {
  toolName: string;
  params: Record<string, unknown>;
  toolCallId?: string;
  derivedPaths?: readonly string[];
}

export interface OpenClawShadowObservation {
  action: 'allow' | 'ask' | 'deny';
  reason: string;
  decidedBy: string;
  approvalId?: string;
  predictor: {
    source: string;
    pFailure: number;
    confidence: number;
    latencyMs: number;
    mode: 'live' | 'fallback';
    state: 'ok' | 'timeout' | 'error';
    actionKey: string;
  };
  matches: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function boolValue(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function normalizeToolName(name: string): string {
  switch (name.toLowerCase()) {
    case 'exec':
    case 'shell':
    case 'bash':
      return 'Bash';
    case 'write':
      return 'Write';
    case 'edit':
    case 'apply_patch':
    case 'apply-patch':
      return 'Edit';
    case 'read':
      return 'Read';
    case 'sessions_spawn':
    case 'task':
    case 'delegate':
      return 'Delegate';
    default:
      return name;
  }
}

function pathsFor(event: OpenClawToolEvent): string[] {
  const params = event.params;
  const candidates = [
    ...stringArray(params['paths']),
    ...stringArray(params['files']),
    ...stringArray(event.derivedPaths),
  ];
  for (const key of ['path', 'filePath', 'file_path', 'workdir', 'cwd', 'outPath']) {
    const value = params[key];
    if (typeof value === 'string') candidates.push(value);
  }
  return [...new Set(candidates)];
}

function normalizeFactLifecycle(value: unknown): ToolCall['factLifecycle'] | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return undefined;

  const factClass = stringValue(record, 'factClass', 'fact_class', 'kind');
  const usageKind = stringValue(record, 'usageKind', 'usage_kind', 'usage');
  const basisStatus = stringValue(record, 'basisStatus', 'basis_status', 'status');
  const latestStatus = stringValue(
    record,
    'latestStatus',
    'latest_status',
    'currentStatus',
    'current_status',
  );

  const normalized: NonNullable<ToolCall['factLifecycle']> = {};
  if (
    factClass === 'capability' ||
    factClass === 'deployment_target' ||
    factClass === 'user_preference' ||
    factClass === 'dependency' ||
    factClass === 'endpoint' ||
    factClass === 'quota_limit'
  ) {
    normalized.factClass = factClass;
  }
  if (
    usageKind === 'route' ||
    usageKind === 'deploy' ||
    usageKind === 'notify' ||
    usageKind === 'approve' ||
    usageKind === 'execute'
  ) {
    normalized.usageKind = usageKind;
  }
  if (
    basisStatus === 'supported' ||
    basisStatus === 'revoked' ||
    basisStatus === 'needs_revalidation'
  ) {
    normalized.basisStatus = basisStatus;
  }
  if (
    latestStatus === 'supported' ||
    latestStatus === 'revoked' ||
    latestStatus === 'needs_revalidation'
  ) {
    normalized.latestStatus = latestStatus;
  }
  normalized.superseded =
    boolValue(record, 'superseded', 'isSuperseded', 'is_superseded');
  normalized.replacementAvailable =
    boolValue(record, 'replacementAvailable', 'replacement_available', 'hasReplacement');
  normalized.recoveryObserved =
    boolValue(record, 'recoveryObserved', 'recovery_observed', 'recovered');

  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}

function normalizeCoordination(value: unknown): ToolCall['coordination'] | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return undefined;

  const operation = stringValue(record, 'operation', 'kind');
  const branchFreshness = stringValue(record, 'branchFreshness', 'branch_freshness', 'freshness');
  const overlapClass = stringValue(record, 'overlapClass', 'overlap_class', 'overlap');
  const verificationCoverage = stringValue(
    record,
    'verificationCoverage',
    'verification_coverage',
    'coverage',
  );

  const normalized: NonNullable<ToolCall['coordination']> = {};
  if (operation === 'merge') normalized.operation = operation;
  if (branchFreshness === 'current' || branchFreshness === 'stale') {
    normalized.branchFreshness = branchFreshness;
  }
  if (
    overlapClass === 'none' ||
    overlapClass === 'text_conflict' ||
    overlapClass === 'api_drift' ||
    overlapClass === 'duplicate_intent' ||
    overlapClass === 'shared_invariant'
  ) {
    normalized.overlapClass = overlapClass;
  }
  normalized.fileLockPresent =
    boolValue(record, 'fileLockPresent', 'file_lock_present', 'fileLock');
  normalized.taskLeasePresent =
    boolValue(record, 'taskLeasePresent', 'task_lease_present', 'taskLease');
  normalized.intentLedgerPresent =
    boolValue(record, 'intentLedgerPresent', 'intent_ledger_present', 'intentLedger');
  normalized.mergeQueuePresent =
    boolValue(record, 'mergeQueuePresent', 'merge_queue_present', 'mergeQueue');
  normalized.semanticReviewPresent =
    boolValue(record, 'semanticReviewPresent', 'semantic_review_present', 'semanticReview');
  if (
    verificationCoverage === 'none' ||
    verificationCoverage === 'visible' ||
    verificationCoverage === 'semantic'
  ) {
    normalized.verificationCoverage = verificationCoverage;
  }

  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}

export function openClawToolCall(event: OpenClawToolEvent): ToolCall {
  const params = event.params;
  const tool = normalizeToolName(event.toolName);
  const call: ToolCall = { tool };
  const command = stringValue(params, 'command', 'cmd');
  const content = stringValue(params, 'content', 'newText', 'new_string', 'text', 'message');
  const argv = stringArray(params['argv']);
  const paths = pathsFor(event);
  if (command !== undefined) call.command = command;
  if (content !== undefined) call.content = content;
  if (argv.length > 0) call.argv = argv;
  if (paths.length > 0) call.paths = paths;

  for (const key of ['handoff', 'verification', 'completion', 'recall', 'contentBoundary'] as const) {
    const value = asRecord(params[key]);
    if (Object.keys(value).length > 0) {
      Object.assign(call, { [key]: value });
    }
  }
  const snakeBoundary = asRecord(params['content_boundary']);
  if (call.contentBoundary === undefined && Object.keys(snakeBoundary).length > 0) {
    call.contentBoundary = snakeBoundary;
  }
  const factLifecycle = normalizeFactLifecycle(params['factLifecycle'] ?? params['fact_lifecycle']);
  if (factLifecycle !== undefined) {
    call.factLifecycle = factLifecycle;
  }
  const coordination = normalizeCoordination(params['coordination']);
  if (coordination !== undefined) {
    call.coordination = coordination;
  }
  return call;
}

export function createOpenClawAdapter(event: OpenClawToolEvent): HostAdapter {
  const call = openClawToolCall(event);
  const request: HookRequest = {
    adapter: 'openclaw-plugin',
    rawPayload: event,
    call,
    toolUseId: event.toolCallId,
    valid: call.tool !== '',
    invalidReason: call.tool === '' ? 'missing toolName' : undefined,
  };
  return {
    name: 'openclaw-plugin',
    parse() {
      return request;
    },
    render(result: HookRenderInput): HookResponse {
      return {
        exitCode: result.decision.exitCode,
        stdout: JSON.stringify(openClawObservation(result)) + '\n',
        stderr: result.decision.stderr,
      };
    },
    renderInvalid(reason: string): HookResponse {
      return { exitCode: 0, stdout: '', stderr: `[Aegis] ${reason}; allowing (fail-open)` };
    },
  };
}

function approvalId(decision: Decision): string | undefined {
  return decision.approval?.id;
}

export function openClawObservation(result: HookRenderInput): OpenClawShadowObservation {
  return {
    action: result.evaluation.action,
    reason: result.decision.stderr || result.evaluation.reason,
    decidedBy: result.evaluation.decidedBy,
    ...(approvalId(result.decision) !== undefined ? { approvalId: approvalId(result.decision) } : {}),
    predictor: {
      source: result.predictor.prediction.source,
      pFailure: result.predictor.prediction.pFailure,
      confidence: result.predictor.prediction.confidence,
      latencyMs: result.predictor.latencyMs,
      mode: result.predictor.mode,
      state: result.predictor.state,
      actionKey: result.predictor.actionKey,
    },
    matches: result.evaluation.matches.map((match) => match.id),
  };
}
