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
  });
});
