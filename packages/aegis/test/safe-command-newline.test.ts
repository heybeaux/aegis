import { describe, expect, it } from 'vitest';
import { isSafeCommand } from '../src/index.js';

describe('safe-command newline boundary', () => {
  it.each(['\n', '\r\n', '\n\n', '\n\t'])('refuses an embedded separator %j', separator => {
    expect(isSafeCommand(`echo ready${separator}unlisted-operation`)).toBe(false);
  });

  it('does not let a host allowlist override the shell separator boundary', () => {
    const allowlist = new Set(['custom-reader']);
    expect(isSafeCommand('custom-reader file\nunlisted-operation', allowlist)).toBe(false);
    expect(isSafeCommand('custom-reader file', allowlist)).toBe(true);
    expect([...allowlist]).toEqual(['custom-reader']);
  });

  it.each(["echo 'quoted\ntext'", 'echo continued\\\ntext', 'echo ready # comment\nunlisted-operation'])('conservatively refuses internal LF without parsing shell quoting: %j', command => {
    expect(isSafeCommand(command)).toBe(false);
  });

  it('preserves outer whitespace, horizontal whitespace and literal backslash-n', () => {
    for (const command of ['\n echo ready \n', 'echo\tready', "echo 'literal\\ntext'"]) {
      expect(isSafeCommand(command)).toBe(true);
    }
  });

  it('keeps independent combinators and leading-token boundaries closed', () => {
    for (const command of ['echo ready; unlisted-operation', 'echo ready && unlisted-operation', 'catastrophe', '']) {
      expect(isSafeCommand(command)).toBe(false);
    }
    expect(isSafeCommand('echo ready')).toBe(true);
  });
});
