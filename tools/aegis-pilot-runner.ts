#!/usr/bin/env node
// CLI for the exploratory 8-task x 4-arm Aegis agent-outcome pilot.
//
//   node --experimental-transform-types tools/aegis-pilot-runner.ts --self-test
//   node --experimental-transform-types tools/aegis-pilot-runner.ts --live \
//     --base-url http://127.0.0.1:8000/v1 --models <model> [--repetitions 1]
//
// Default is the self-test. Live mode never starts without --live AND an
// explicit loopback --base-url (127.0.0.1 or [::1]); env vars are not consulted
// for the endpoint.
import { env } from 'node:process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LoopbackChatClient, validateLoopbackBaseUrl } from './aegis-pilot/client.ts';
import { PILOT_TASKS } from './aegis-pilot/fixtures.ts';
import { createAegisRulesGate } from './aegis-pilot/gate.ts';
import { executePilot, runSelfTest, type PilotConfig } from './aegis-pilot/pilot.ts';
import { DEFAULT_BUDGETS } from './aegis-pilot/runner.ts';

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function intFlag(name: string, fallback: number, min = 0): number {
  const raw = readFlag(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) throw new Error(`Invalid integer for ${name}: ${raw}`);
  return parsed;
}

function usage(): string {
  return [
    'Usage:',
    '  node --experimental-transform-types tools/aegis-pilot-runner.ts --self-test [--output <dir>]',
    '  node --experimental-transform-types tools/aegis-pilot-runner.ts --live --base-url http://127.0.0.1:<port>/v1 --models <csv> [options]',
    '',
    'Options (live):',
    '  --tasks <csv>              Subset of task ids. Default: all 8',
    '  --repetitions <n>          Repetitions (seed = seed-base + repetition). Default: 1',
    '  --seed-base <n>            Default: 1',
    '  --order-seed <n>           Seed for per-block arm order. Default: 20261013',
    `  --max-turns-single <n>     Default: ${DEFAULT_BUDGETS.maxTurnsSingle}`,
    `  --max-turns-team-a <n>     Default: ${DEFAULT_BUDGETS.maxTurnsTeamA}`,
    `  --max-turns-team-b <n>     Default: ${DEFAULT_BUDGETS.maxTurnsTeamB}`,
    `  --max-tokens <n>           Max completion tokens per call. Default: ${DEFAULT_BUDGETS.maxTokensPerCall}`,
    `  --max-run-tokens <n>       Token budget per run (all sessions). Default: ${DEFAULT_BUDGETS.maxTotalTokensPerRun}`,
    `  --timeout-ms <n>           Per-request timeout. Default: ${DEFAULT_BUDGETS.requestTimeoutMs}`,
    '  --api-key-env <name>       Env var with an optional API key (value never recorded).',
    '  --output <dir>             Output directory. Default: a fresh dir under the OS temp dir.',
    '',
    `Tasks: ${PILOT_TASKS.map((t) => t.id).join(', ')}`,
    'Arms: single:no_gate, single:aegis_rules, team:no_gate, team:aegis_rules',
  ].join('\n');
}

function defaultOutput(prefix: string): string {
  return resolve(tmpdir(), `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    process.stdout.write(usage() + '\n');
    return;
  }
  const features = process.features as { typescript?: string | false };
  if (features.typescript !== 'transform') {
    throw new Error('Run with `node --experimental-transform-types` (the aegis_rules gate loads packages/aegis/src directly).');
  }

  if (!hasFlag('--live')) {
    const outputDir = readFlag('--output') ? resolve(readFlag('--output')!) : defaultOutput('aegis-pilot-selftest');
    const result = await runSelfTest({ outputDir });
    process.stdout.write(
      JSON.stringify(
        {
          mode: 'selftest',
          integrity: result.summary.integrity,
          networkAttempts: result.networkAttempts.length,
          configSha256: result.manifest.configSha256,
          repoHead: result.manifest.repo.headSha,
          aegisSourceSha256: result.manifest.gate.aegisSourceSha256,
          plannedRuns: result.manifest.plannedRuns,
          recordedRuns: result.records.length,
          arms: result.summary.arms.map((a) => ({ arm: a.arm, completed: a.completed, harmfulRuns: a.harmfulRuns, blocks: a.blocks, falseBlocks: a.falseBlocks, errorRuns: a.errorRuns })),
          outputs: result.paths,
        },
        null,
        2,
      ) + '\n',
    );
    if (!result.summary.integrity.ok || result.networkAttempts.length > 0) process.exitCode = 1;
    return;
  }

  const baseUrl = readFlag('--base-url');
  if (!baseUrl) throw new Error('--live requires an explicit --base-url http://127.0.0.1:<port>/v1');
  validateLoopbackBaseUrl(baseUrl);
  const models = (readFlag('--models') ?? readFlag('--model') ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  if (models.length === 0) throw new Error('--live requires --models <csv>');
  const taskIds = (readFlag('--tasks') ?? PILOT_TASKS.map((t) => t.id).join(',')).split(',').map((t) => t.trim()).filter(Boolean);
  const budgets = {
    ...DEFAULT_BUDGETS,
    maxTurnsSingle: intFlag('--max-turns-single', DEFAULT_BUDGETS.maxTurnsSingle, 1),
    maxTurnsTeamA: intFlag('--max-turns-team-a', DEFAULT_BUDGETS.maxTurnsTeamA, 1),
    maxTurnsTeamB: intFlag('--max-turns-team-b', DEFAULT_BUDGETS.maxTurnsTeamB, 1),
    maxTokensPerCall: intFlag('--max-tokens', DEFAULT_BUDGETS.maxTokensPerCall, 1),
    maxTotalTokensPerRun: intFlag('--max-run-tokens', DEFAULT_BUDGETS.maxTotalTokensPerRun, 1),
    requestTimeoutMs: intFlag('--timeout-ms', DEFAULT_BUDGETS.requestTimeoutMs, 1),
  };
  const apiKeyEnv = readFlag('--api-key-env');
  const config: PilotConfig = {
    mode: 'live',
    models,
    taskIds,
    repetitions: intFlag('--repetitions', 1, 1),
    seedBase: intFlag('--seed-base', 1),
    orderSeed: intFlag('--order-seed', 20261013),
    budgets,
    baseUrl,
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
  };
  const client = new LoopbackChatClient({ baseUrl, apiKey: apiKeyEnv ? env[apiKeyEnv] : undefined, timeoutMs: budgets.requestTimeoutMs });
  const gate = await createAegisRulesGate();
  const outputDir = readFlag('--output') ? resolve(readFlag('--output')!) : defaultOutput('aegis-pilot-live');
  const result = await executePilot({ config, client, gate, outputDir, log: (line) => process.stderr.write(line + '\n') });
  process.stdout.write(JSON.stringify({ mode: 'live', integrity: result.summary.integrity, configSha256: result.manifest.configSha256, outputs: result.paths }, null, 2) + '\n');
  if (!result.summary.integrity.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (env['AEGIS_PILOT_DEBUG'] ? String(error.stack) : error.message) : String(error)}\n`);
  process.exitCode = 1;
});
