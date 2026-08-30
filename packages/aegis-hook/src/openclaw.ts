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
