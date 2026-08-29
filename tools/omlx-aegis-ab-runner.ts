#!/usr/bin/env node

import { env } from 'node:process';
import { resolve } from 'node:path';
import { DEFAULT_MODELS } from './omlx-aegis-ab/manifest.ts';
import { runHarness, runSelfTest } from './omlx-aegis-ab/harness.ts';

interface CliOptions {
  models: string[];
  repetitions: number;
  seedBase: number;
  outputDir: string;
  baseUrl: string;
  maxTokens: number;
  apiKeyEnv: string;
  selfTest: boolean;
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function parseNumberFlag(name: string, fallback: number): number {
  const raw = readFlag(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value for ${name}: ${raw}`);
  return parsed;
}

function parseCli(): CliOptions {
  const models = (readFlag('--models') ?? readFlag('--model') ?? DEFAULT_MODELS.join(','))
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const baseUrl =
    readFlag('--base-url') ??
    env['OMLX_BASE_URL'] ??
    env['OPENAI_BASE_URL'] ??
    'http://127.0.0.1:11434/v1';
  const outputDir =
    readFlag('--output') ??
    resolve(process.cwd(), `artifacts/omlx-aegis-ab-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  return {
    models,
    repetitions: parseNumberFlag('--repetitions', 1),
    seedBase: parseNumberFlag('--seed-base', 1),
    outputDir,
    baseUrl,
    maxTokens: parseNumberFlag('--max-tokens', 512),
    apiKeyEnv: readFlag('--api-key-env') ?? 'OPENAI_API_KEY',
    selfTest: hasFlag('--self-test'),
  };
}

function usage(): string {
  return [
    'Usage:',
    '  node --experimental-strip-types tools/omlx-aegis-ab-runner.ts [options]',
    '',
    'Options:',
    `  --models <csv>        Models to evaluate. Default: ${DEFAULT_MODELS.join(',')}`,
    '  --repetitions <n>     Repetitions per scenario/model pair. Default: 1',
    '  --seed-base <n>       Base seed. Repetition index is added to this value. Default: 1',
    '  --base-url <url>      OpenAI-compatible server base URL. Default: http://127.0.0.1:11434/v1',
    '  --output <dir>        Output directory for JSON/Markdown/traces.',
    '  --api-key-env <name>  Env var containing the API key. Default: OPENAI_API_KEY',
    '  --max-tokens <n>      Max completion tokens per turn. Default: 512',
    '  --self-test           Run the deterministic local self-test without network calls.',
  ].join('\n');
}

async function main(): Promise<void> {
  if (hasFlag('--help') || hasFlag('-h')) {
    process.stdout.write(usage() + '\n');
    return;
  }

  const options = parseCli();
  if (options.selfTest) {
    const result = await runSelfTest();
    process.stdout.write(JSON.stringify({ selfTest: 'passed', ...result }, null, 2) + '\n');
    return;
  }

  const apiKey = env[options.apiKeyEnv] ?? env['OMLX_API_KEY'];
  if (!apiKey) {
    throw new Error(
      `Missing API key. Set ${options.apiKeyEnv} or OMLX_API_KEY before running the harness.`,
    );
  }

  const result = await runHarness({
    baseUrl: options.baseUrl,
    apiKey,
    models: options.models,
    repetitions: options.repetitions,
    seedBase: options.seedBase,
    outputDir: options.outputDir,
    maxTokens: options.maxTokens,
  });
  process.stdout.write(
    JSON.stringify(
      {
        status: 'ok',
        outputDir: options.outputDir,
        jsonPath: result.jsonPath,
        markdownPath: result.markdownPath,
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
