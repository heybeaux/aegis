#!/usr/bin/env node
/**
 * The Aegis PreToolUse hook entry point.
 *
 * Claude Code runs this command and pipes the tool-call JSON to stdin. We read
 * stdin, map it to an Aegis ToolCall, evaluate the compiled rule packs, and signal
 * the verdict via exit code + stderr (see decide.ts).
 *
 * FAIL OPEN: any unexpected fault — empty/unparseable stdin, a rulepack load
 * failure, a bug here — logs to stderr and exits 0. A broken governance hook must
 * never brick the user's Claude Code session; only clean Aegis `deny` and `ask`
 * decisions block/pause.
 */

import { resolve } from 'node:path';
import { evaluate } from '@heybeaux/lattice-aegis';
import { readStdin, toToolCall, toolUseIdFromHookInput } from './stdin.js';
import { loadAllPacks } from './rules.js';
import { decide } from './decide.js';
import { installHook } from './install.js';
import { approvePending } from './approval.js';
import { recordDecision } from '@heybeaux/aegis-collect';

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

function main(): void {
  const argv = process.argv.slice(2);
  if (argv[0] === 'install') {
    runInstall(argv.slice(1));
    return;
  }
  if (argv[0] === 'approve') {
    runApprove(argv.slice(1));
    return;
  }

  const input = readStdin().trim();
  if (input === '') {
    process.stderr.write('[Aegis] empty stdin; allowing (fail-open)\n');
    process.exit(0);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    process.stderr.write('[Aegis] unparseable stdin JSON; allowing (fail-open)\n');
    process.exit(0);
  }

  const call = toToolCall(raw);
  // Enable decode-then-rescan so obfuscated payloads (base64, hex) are caught.
  const evaluation = evaluate(call, loadAllPacks(), { preprocess: true });

  // Extract tool_use_id for join key (best-effort; undefined when absent).
  const toolUseId = toolUseIdFromHookInput(raw);

  // Record the decision for training data collection. Wrapped in its own
  // try/catch so a collector bug can never reach the hook's exit logic.
  try {
    recordDecision(call, evaluation, toolUseId);
  } catch {
    // Intentionally swallowed — fail-open.
  }

  const { exitCode, stderr } = decide(evaluation, { call });
  if (stderr) process.stderr.write(stderr + '\n');
  process.exit(exitCode);
}

try {
  main();
} catch (err) {
  // Fail OPEN on any unexpected fault — never block the session on a hook bug.
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[Aegis] hook error (fail-open): ${msg}\n`);
  process.exit(0);
}
