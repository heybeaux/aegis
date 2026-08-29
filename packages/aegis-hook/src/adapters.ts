import type { ToolCall, Evaluation } from '@heybeaux/lattice-aegis';
import { toToolCall, toolUseIdFromHookInput } from './stdin.js';
import type { Decision } from './decide.js';
import type { PredictorResult } from './predictor.js';

export interface HookRequest {
  adapter: string;
  rawPayload: unknown;
  call?: ToolCall;
  toolUseId?: string;
  valid: boolean;
  invalidReason?: string;
}

export interface HookResponse {
  exitCode: 0 | 2;
  stdout: string;
  stderr: string;
}

export interface HostAdapter {
  name: string;
  parse(input: string): HookRequest;
  render(result: HookRenderInput): HookResponse;
  renderInvalid(reason: string): HookResponse;
}

export interface HookRenderInput {
  decision: Decision;
  evaluation: Evaluation;
  request: HookRequest;
  predictor: PredictorResult;
}

function parseJson(input: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'empty stdin' };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, reason: 'unparseable stdin JSON' };
  }
}

export const claudeCodeAdapter: HostAdapter = {
  name: 'claude-code',
  parse(input) {
    const parsed = parseJson(input);
    if (!parsed.ok) {
      return {
        adapter: 'claude-code',
        rawPayload: undefined,
        valid: false,
        invalidReason: parsed.reason,
      };
    }
    const call = toToolCall(parsed.value);
    return {
      adapter: 'claude-code',
      rawPayload: parsed.value,
      call,
      toolUseId: toolUseIdFromHookInput(parsed.value),
      valid: call.tool !== '',
      invalidReason: call.tool === '' ? 'missing tool_name' : undefined,
    };
  },
  render(result) {
    return {
      exitCode: result.decision.exitCode,
      stdout: '',
      stderr: result.decision.stderr,
    };
  },
  renderInvalid(reason) {
    return {
      exitCode: 0,
      stdout: '',
      stderr: `[Aegis] ${reason}; allowing (fail-open)`,
    };
  },
};

function asToolCall(value: unknown): ToolCall | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record['tool'] !== 'string') return undefined;
  return record as unknown as ToolCall;
}

export const genericJsonStdioAdapter: HostAdapter = {
  name: 'generic-json-stdio',
  parse(input) {
    const parsed = parseJson(input);
    if (!parsed.ok) {
      return {
        adapter: 'generic-json-stdio',
        rawPayload: undefined,
        valid: false,
        invalidReason: parsed.reason,
      };
    }
    const raw = parsed.value;
    const record =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const call = asToolCall(record['toolCall']) ?? asToolCall(raw);
    const toolUseId = typeof record['toolUseId'] === 'string' ? record['toolUseId'] : undefined;
    return {
      adapter: 'generic-json-stdio',
      rawPayload: raw,
      call,
      toolUseId,
      valid: call !== undefined && call.tool !== '',
      invalidReason: call === undefined ? 'missing toolCall/tool payload' : undefined,
    };
  },
  render(result) {
    return {
      exitCode: result.decision.exitCode,
      stdout:
        JSON.stringify({
          decision: result.decision.exitCode === 0 ? 'allow' : 'block',
          action: result.evaluation.action,
          reason: result.decision.stderr || result.evaluation.reason,
          evaluation: {
            action: result.evaluation.action,
            decidedBy: result.evaluation.decidedBy,
            prediction: result.evaluation.prediction,
            matches: result.evaluation.matches,
            ruleVersions: result.evaluation.ruleVersions,
          },
          predictor: {
            mode: result.predictor.mode,
            state: result.predictor.state,
            latencyMs: result.predictor.latencyMs,
            actionKey: result.predictor.actionKey,
          },
          approval:
            result.decision.approval === undefined
              ? undefined
              : {
                  id: result.decision.approval.id,
                  command: `aegis-hook approve ${result.decision.approval.id}`,
                },
        }) + '\n',
      stderr: '',
    };
  },
  renderInvalid(reason) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({ decision: 'allow', action: 'allow', reason, mode: 'fail-open' }) + '\n',
      stderr: '',
    };
  },
};

export function adapterByName(name: string | undefined): HostAdapter {
  if (name === 'generic-json' || name === 'json-stdio' || name === 'generic-json-stdio') {
    return genericJsonStdioAdapter;
  }
  return claudeCodeAdapter;
}
