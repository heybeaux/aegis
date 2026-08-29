#!/usr/bin/env node
import { resolve } from 'node:path';
import { readStdin } from './stdin.js';
import { installHook } from './install.js';
import { approvePending } from './approval.js';
import { adapterByName } from './adapters.js';
import { observeApproval } from './predictor.js';
import { runHook } from './runtime.js';
import { writeTelemetry } from './telemetry.js';

/**
 * `aegis-hook install [settingsPath] [bin]` — merge the hook into settings.json.
 *
 * Defaults: settingsPath `.claude/settings.json` in cwd, bin the resolved path to
 * THIS cli.js. The merge preserves every existing hook/matcher (see install.ts).
 * This dispatch MUST run before stdin is read — `install` is invoked from a TTY,
 * not piped, and reading stdin would block.
 */
function runInstall(argv: readonly string[]): void {
  const settingsPath = resolve(
    process.cwd(),
    argv[0] ?? '.claude/settings.json',
  );
  const bin = argv[1] ?? process.argv[1] ?? '';
  const command = `node ${resolve(bin)}`;
  const res = installHook({ settingsPath, command });
  process.stdout.write(
    `[aegis-hook] ${res.added ? 'installed' : 'already present'} → ${res.settingsPath}\n` +
      (res.backupPath ? `[aegis-hook] backup: ${res.backupPath}\n` : '') +
      `[aegis-hook] PreToolUse matchers now: ${res.preToolUse
        .map((m) => m.matcher)
        .join(', ')}\n`,
  );
  process.exit(0);
}

function runApprove(argv: readonly string[]): void {
  const id = argv[0];
  if (id === undefined) {
    process.stderr.write('[aegis-hook] usage: aegis-hook approve <approval-id>\n');
    process.exit(1);
  }
  try {
    const record = approvePending(id);
    if (record.actionKey !== undefined) {
      observeApproval({ actionKey: record.actionKey, approvedAt: record.createdAt });
    }
    writeTelemetry({
      event: 'approval.approved',
      adapter: 'cli',
      tool: record.tool,
      approvalId: record.id,
      reason: record.reason,
      predictor: {
        actionKey: record.actionKey,
      },
    });
    process.stdout.write(
      `[aegis-hook] approved once: ${record.id}\n` +
        `[aegis-hook] retry the exact same tool call to consume this approval.\n`,
    );
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[aegis-hook] approval failed: ${msg}\n`);
    process.exit(1);
  }
}

function parseAdapterArg(argv: readonly string[]): string | undefined {
  const explicit = argv.find((arg) => arg.startsWith('--adapter='));
  if (explicit) return explicit.slice('--adapter='.length);
  const idx = argv.findIndex((arg) => arg === '--adapter');
  if (idx !== -1) return argv[idx + 1];
  return process.env['AEGIS_HOST_ADAPTER'];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'install') {
    runInstall(argv.slice(1));
    return;
  }
  if (argv[0] === 'approve') {
    runApprove(argv.slice(1));
    return;
  }

  const adapter = adapterByName(parseAdapterArg(argv));
  const result = await runHook(adapter, readStdin());
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  process.exit(result.exitCode);
}

try {
  await main();
} catch (err) {
  // Fail OPEN on any unexpected fault — never block the session on a hook bug.
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[Aegis] hook error (fail-open): ${msg}\n`);
  process.exit(0);
}
