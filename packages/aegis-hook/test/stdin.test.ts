import { describe, it, expect } from 'vitest';
import { toToolCall, toolUseIdFromHookInput } from '../src/stdin.js';

describe('toolUseIdFromHookInput', () => {
  it('extracts Claude Code tool_use_id for exact decision/outcome joins', () => {
    expect(toolUseIdFromHookInput({ tool_use_id: 'toolu_abc123' })).toBe('toolu_abc123');
    expect(toolUseIdFromHookInput({ tool_use_id: 42 })).toBeUndefined();
    expect(toolUseIdFromHookInput(null)).toBeUndefined();
  });
});

describe('toToolCall', () => {
  it('maps a Bash command', () => {
    const call = toToolCall({
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    });
    expect(call).toEqual({ tool: 'Bash', command: 'rm -rf /' });
  });

  it('maps a Write with file_path + content', () => {
    const call = toToolCall({
      tool_name: 'Write',
      tool_input: { file_path: '/etc/passwd', content: 'root:x:0:0' },
    });
    expect(call).toEqual({
      tool: 'Write',
      content: 'root:x:0:0',
      paths: ['/etc/passwd'],
    });
  });

  it('maps an Edit (new_string -> content)', () => {
    const call = toToolCall({
      tool_name: 'Edit',
      tool_input: { file_path: '/src/a.ts', new_string: 'const x = 1;' },
    });
    expect(call).toEqual({
      tool: 'Edit',
      content: 'const x = 1;',
      paths: ['/src/a.ts'],
    });
  });

  it('maps a Read (file_path -> paths)', () => {
    const call = toToolCall({
      tool_name: 'Read',
      tool_input: { file_path: '/home/u/.ssh/id_rsa' },
    });
    expect(call).toEqual({ tool: 'Read', paths: ['/home/u/.ssh/id_rsa'] });
  });

  it('maps structured handoff metadata for SwarmLab RT-07 gates', () => {
    const call = toToolCall({
      tool_name: 'Delegate',
      handoff: {
        delegation_depth: 3,
        manifest_tier: 'presence',
        requirement_count: 7,
      },
    });
    expect(call).toEqual({
      tool: 'Delegate',
      handoff: { delegationDepth: 3, manifestTier: 'presence', requirementCount: 7 },
    });
  });

  it('prefers tool_input.handoff when both root and tool_input handoff metadata exist', () => {
    const call = toToolCall({
      tool_name: 'Delegate',
      handoff: { delegationDepth: 1, manifestTier: 'presence' },
      tool_input: { handoff: { delegationDepth: 2, manifestTier: 'value-echo' } },
    });
    expect(call.handoff).toEqual({ delegationDepth: 2, manifestTier: 'value-echo' });
  });

  it('is defensive against malformed / empty input', () => {
    expect(toToolCall(undefined)).toEqual({ tool: '' });
    expect(toToolCall(null)).toEqual({ tool: '' });
    expect(toToolCall('not an object')).toEqual({ tool: '' });
    expect(toToolCall({})).toEqual({ tool: '' });
    expect(toToolCall({ tool_name: 'Bash' })).toEqual({ tool: 'Bash' });
    // tool_input present but wrong-typed fields are ignored, never thrown.
    expect(toToolCall({ tool_name: 'Bash', tool_input: { command: 42 } })).toEqual({
      tool: 'Bash',
    });
    expect(
      toToolCall({
        tool_name: 'Delegate',
        handoff: { delegationDepth: 'deep', manifestTier: 'semantic-ish' },
      }),
    ).toEqual({ tool: 'Delegate' });
  });
});
