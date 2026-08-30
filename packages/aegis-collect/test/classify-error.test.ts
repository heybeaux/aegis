import { describe, expect, it } from 'vitest';
import { classifyOutcomeError } from '../src/classify-error.js';

describe('classifyOutcomeError', () => {
  it('returns undefined when the row did not error', () => {
    expect(classifyOutcomeError(false)).toBeUndefined();
    expect(classifyOutcomeError(false, 'ignored')).toBeUndefined();
  });

  it('classifies the embedded prompt-lock session race as infra', () => {
    expect(
      classifyOutcomeError(
        true,
        'session file changed while embedded prompt lock was released: /x/y.jsonl',
      ),
    ).toBe('infra');
    expect(classifyOutcomeError(true, 'file lock stale for /x/y.jsonl')).toBe('infra');
  });

  it('classifies genuine tool errors as tool', () => {
    expect(classifyOutcomeError(true, 'ENOENT: no such file or directory')).toBe('tool');
    expect(classifyOutcomeError(true, 'Could not find edits[1] in file')).toBe('tool');
  });

  it('defaults an errored row with no message to tool (never hide a real failure)', () => {
    expect(classifyOutcomeError(true)).toBe('tool');
    expect(classifyOutcomeError(true, '')).toBe('tool');
  });
});
