import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeCodeAdapter, genericJsonStdioAdapter } from '../src/adapters.js';
import { runHook } from '../src/runtime.js';

function withTempAegisHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-hook-runtime-'));
  process.env['AEGIS_HOME'] = dir;
  delete process.env['AEGIS_HOOK_TELEMETRY_PATH'];
  delete process.env['AEGIS_PREDICTOR_STATE_PATH'];
  delete process.env['AEGIS_APPROVAL_DIR'];
  delete process.env['AEGIS_PREDICTOR_DELAY_MS'];
  delete process.env['AEGIS_PREDICTOR_TIMEOUT_MS'];
  delete process.env['AEGIS_PREDICTOR_FAILURE_MODE'];
  delete process.env['AEGIS_SHADOW_MODE'];
  return dir;
}

afterEach(() => {
  delete process.env['AEGIS_HOME'];
  delete process.env['AEGIS_HOOK_TELEMETRY_PATH'];
  delete process.env['AEGIS_PREDICTOR_STATE_PATH'];
  delete process.env['AEGIS_APPROVAL_DIR'];
  delete process.env['AEGIS_PREDICTOR_DELAY_MS'];
  delete process.env['AEGIS_PREDICTOR_TIMEOUT_MS'];
  delete process.env['AEGIS_PREDICTOR_FAILURE_MODE'];
  delete process.env['AEGIS_SHADOW_MODE'];
});

describe('runHook', () => {
  it('records live predictions before evaluation for valid Claude hook calls', async () => {
    const home = withTempAegisHome();
    try {
      const response = await runHook(
        claudeCodeAdapter,
        JSON.stringify({ tool_name: 'Bash', tool_use_id: 'toolu_live', tool_input: { command: 'ls -la' } }),
      );
      expect(response.exitCode).toBe(0);

      const telemetry = readFileSync(join(home, 'hook-runtime.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const decision = telemetry.find((event) => event.event === 'hook.decision');
      expect(decision).toBeDefined();
      expect(decision?.predictor).toMatchObject({
        mode: 'live',
        state: 'ok',
        source: 'prior',
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('fail-open predictor fallback keeps the deterministic rule floor', async () => {
    const home = withTempAegisHome();
    process.env['AEGIS_PREDICTOR_FAILURE_MODE'] = 'fail-open';
    process.env['AEGIS_PREDICTOR_DELAY_MS'] = '25';
    process.env['AEGIS_PREDICTOR_TIMEOUT_MS'] = '1';
    try {
      const response = await runHook(
        claudeCodeAdapter,
        JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }),
      );
      expect(response.exitCode).toBe(0);
      expect(response.stderr).toBe('');

      const telemetry = readFileSync(join(home, 'hook-runtime.jsonl'), 'utf8');
      expect(telemetry).toContain('"event":"predictor.fallback"');
      expect(telemetry).toContain('"mode":"fail-open"');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('degraded predictor fallback asks with a clear runtime reason', async () => {
    const home = withTempAegisHome();
    process.env['AEGIS_PREDICTOR_FAILURE_MODE'] = 'degraded';
    process.env['AEGIS_PREDICTOR_DELAY_MS'] = '25';
    process.env['AEGIS_PREDICTOR_TIMEOUT_MS'] = '1';
    try {
      const response = await runHook(
        claudeCodeAdapter,
        JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }),
      );
      expect(response.exitCode).toBe(2);
      expect(response.stderr).toContain('Predictor unavailable in degraded mode.');
      expect(response.stderr).toContain('Approve once: aegis-hook approve');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('fail-closed predictor fallback denies with a clear runtime reason', async () => {
    const home = withTempAegisHome();
    process.env['AEGIS_PREDICTOR_FAILURE_MODE'] = 'fail-closed';
    process.env['AEGIS_PREDICTOR_DELAY_MS'] = '25';
    process.env['AEGIS_PREDICTOR_TIMEOUT_MS'] = '1';
    try {
      const response = await runHook(
        claudeCodeAdapter,
        JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }),
      );
      expect(response.exitCode).toBe(2);
      expect(response.stderr).toContain('Predictor unavailable in fail-closed mode.');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('supports the generic JSON/stdio adapter', async () => {
    const home = withTempAegisHome();
    try {
      const response = await runHook(
        genericJsonStdioAdapter,
        JSON.stringify({
          toolUseId: 'generic_1',
          toolCall: { tool: 'Write', paths: ['/tmp/file.txt'], content: 'hello world' },
        }),
      );
      expect(response.stdout).toContain('"action":"allow"');
      expect(response.exitCode).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('shadow mode logs the proposed block but allows execution fail-open', async () => {
    const home = withTempAegisHome();
    process.env['AEGIS_SHADOW_MODE'] = '1';
    try {
      const response = await runHook(
        claudeCodeAdapter,
        JSON.stringify({ tool_name: 'Bash', tool_use_id: 'toolu_shadow', tool_input: { command: 'rm -rf /' } }),
      );
      expect(response.exitCode).toBe(0);
      expect(response.stderr).toBe('');

      const telemetry = readFileSync(join(home, 'hook-runtime.jsonl'), 'utf8');
      expect(telemetry).toContain('"event":"hook.shadow_decision"');
      expect(telemetry).toContain('"toolUseId":"toolu_shadow"');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
