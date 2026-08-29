import { describe, expect, it } from 'vitest';
import {
  claudeCodeAdapter,
  genericJsonStdioAdapter,
  type HookRenderInput,
} from '../src/adapters.js';
import type { Decision } from '../src/decide.js';
import type { Evaluation } from '@heybeaux/lattice-aegis';

const evaluation: Evaluation = {
  action: 'ask',
  decidedBy: 'prediction',
  matches: [],
  prediction: { pFailure: 0.44, confidence: 0.7, source: 'prior' },
  reason: 'predicted P(failure)=0.44 - ask',
  ruleVersions: [],
};

const decision: Decision = {
  exitCode: 2,
  stderr: '[Aegis ASK requires approval] predicted P(failure)=0.44 - ask',
  approval: { event: 'requested', id: 'aegis_deadbeefdeadbeef' },
};

const renderInput: HookRenderInput = {
  decision,
  evaluation,
  request: {
    adapter: 'generic-json-stdio',
    rawPayload: {},
    call: { tool: 'Bash', command: 'ls -la' },
    toolUseId: 'toolu_123',
    valid: true,
  },
  predictor: {
    prediction: { pFailure: 0.44, confidence: 0.7, source: 'prior' },
    latencyMs: 4,
    mode: 'live',
    state: 'ok',
    actionKey: 'abc123',
    degraded: false,
    evidence: {
      sameActionAttempts: 1,
      sameActionBlocks: 0,
      sameActionApprovals: 0,
      recentSessionBlocks: 0,
      recentSessionAttempts: 1,
    },
  },
};

describe('claudeCodeAdapter', () => {
  it('parses Claude Code hook payloads into ToolCall form', () => {
    const parsed = claudeCodeAdapter.parse(
      JSON.stringify({
        tool_name: 'Bash',
        tool_use_id: 'toolu_123',
        tool_input: { command: 'ls -la' },
      }),
    );
    expect(parsed.valid).toBe(true);
    expect(parsed.toolUseId).toBe('toolu_123');
    expect(parsed.call).toEqual({ tool: 'Bash', command: 'ls -la' });
  });

  it('renders invalid payloads as fail-open stderr breadcrumbs', () => {
    expect(claudeCodeAdapter.renderInvalid('empty stdin')).toEqual({
      exitCode: 0,
      stdout: '',
      stderr: '[Aegis] empty stdin; allowing (fail-open)',
    });
  });
});

describe('genericJsonStdioAdapter', () => {
  it('accepts wrapped Aegis-native JSON over stdin', () => {
    const parsed = genericJsonStdioAdapter.parse(
      JSON.stringify({
        toolUseId: 'run_1',
        toolCall: { tool: 'Write', paths: ['/tmp/x'], content: 'hello' },
      }),
    );
    expect(parsed.valid).toBe(true);
    expect(parsed.toolUseId).toBe('run_1');
    expect(parsed.call).toEqual({ tool: 'Write', paths: ['/tmp/x'], content: 'hello' });
  });

  it('renders structured JSON responses over stdout', () => {
    const rendered = genericJsonStdioAdapter.render(renderInput);
    expect(rendered.exitCode).toBe(2);
    expect(rendered.stderr).toBe('');
    const body = JSON.parse(rendered.stdout);
    expect(body.action).toBe('ask');
    expect(body.decision).toBe('block');
    expect(body.predictor.actionKey).toBe('abc123');
    expect(body.approval.command).toBe('aegis-hook approve aegis_deadbeefdeadbeef');
  });
});
