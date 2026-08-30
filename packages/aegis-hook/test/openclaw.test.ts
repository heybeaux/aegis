import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenClawAdapter, openClawToolCall } from '../src/openclaw.js';
import { runHook } from '../src/runtime.js';

afterEach(() => {
  delete process.env['AEGIS_HOME'];
  delete process.env['AEGIS_COLLECT_DIR'];
  delete process.env['AEGIS_SHADOW_MODE'];
});

describe('OpenClaw adapter', () => {
  it('maps native OpenClaw tool envelopes to Aegis calls', () => {
    expect(
      openClawToolCall({
        toolName: 'exec',
        toolCallId: 'call-1',
        params: { command: 'git push --force origin main', workdir: '/tmp/repo' },
      }),
    ).toEqual({
      tool: 'Bash',
      command: 'git push --force origin main',
      paths: ['/tmp/repo'],
    });

    expect(
      openClawToolCall({
        toolName: 'edit',
        params: { path: '/tmp/a.txt', newText: 'hello' },
        derivedPaths: ['/tmp/a.txt'],
      }),
    ).toEqual({ tool: 'Edit', content: 'hello', paths: ['/tmp/a.txt'] });
  });

  it('evaluates in fail-open shadow mode and records an exact decision join key', async () => {
    const home = mkdtempSync(join(tmpdir(), 'aegis-openclaw-'));
    process.env['AEGIS_HOME'] = home;
    process.env['AEGIS_COLLECT_DIR'] = home;
    try {
      const response = await runHook(
        createOpenClawAdapter({
          toolName: 'exec',
          toolCallId: 'oc-call-1',
          params: { command: 'git push --force origin main' },
        }),
        '',
        { shadow: true },
      );
      expect(response.exitCode).toBe(0);
      const observation = JSON.parse(response.stdout) as Record<string, unknown>;
      expect(observation).toMatchObject({ action: 'ask', decidedBy: 'severity' });

      const decision = JSON.parse(readFileSync(join(home, 'decisions.jsonl'), 'utf8')) as {
        toolUseId?: string;
        shadow?: { enabled?: boolean; action?: string };
      };
      expect(decision.toolUseId).toBe('oc-call-1');
      expect(decision.shadow).toMatchObject({ enabled: true, action: 'ask' });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
