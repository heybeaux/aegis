import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordOutcome } from '../src/record-outcome.js';

afterEach(() => {
  delete process.env['AEGIS_COLLECT_DIR'];
  delete process.env['AEGIS_HOME'];
});

describe('recordOutcome', () => {
  it('records OpenClaw outcome metadata with an exact join key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aegis-outcome-'));
    process.env['AEGIS_COLLECT_DIR'] = dir;
    try {
      recordOutcome({
        tool: 'exec',
        toolUseId: 'call-1',
        isError: false,
        source: 'openclaw',
        agentId: 'nori',
        sessionKey: 'agent:nori:main',
        runId: 'run-1',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        resolvedRef: 'openai-codex/gpt-5.4',
        harnessId: 'codex',
        durationMs: 42,
      });
      expect(JSON.parse(readFileSync(join(dir, 'outcomes.jsonl'), 'utf8'))).toMatchObject({
        tool: 'exec',
        toolUseId: 'call-1',
        isError: false,
        exactJoinEligible: true,
        source: 'openclaw',
        agentId: 'nori',
        sessionKey: 'agent:nori:main',
        runId: 'run-1',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        resolvedRef: 'openai-codex/gpt-5.4',
        harnessId: 'codex',
        durationMs: 42,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
