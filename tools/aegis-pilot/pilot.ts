// Orchestration: config hashing, provenance, matrix execution, outputs, self-test.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScriptedSelfTestClient, validateLoopbackBaseUrl } from './client.ts';
import { PILOT_TASKS, getTask } from './fixtures.ts';
import { createAegisRulesGate, repoRootFromHere } from './gate.ts';
import { canonicalJson, hashPilotSources, readRepoProvenance, sha256 } from './provenance.ts';
import { OutputWriter, renderMarkdown, summarize, type PilotSummary } from './report.ts';
import { DEFAULT_BUDGETS, ROLE_SYSTEM_PROMPTS, ROLE_TOOLS, plannedRunCount, runMatrix } from './runner.ts';
import { ARMS, type Budgets, type PilotGate, type PilotModelClient, type RunRecord } from './types.ts';

export const SPEC_VERSION = 'aegis-agent-outcome-pilot/2026-10-13';

export interface PilotConfig {
  mode: 'selftest' | 'live';
  models: string[];
  taskIds: string[];
  repetitions: number;
  seedBase: number;
  orderSeed: number;
  budgets: Budgets;
  /** Loopback chat endpoint (live mode only). */
  baseUrl?: string;
  /** Name of the env var holding the API key; the key itself is never recorded. */
  apiKeyEnv?: string;
}

export interface PilotManifest {
  specVersion: string;
  createdAt: string;
  mode: PilotConfig['mode'];
  config: PilotConfig;
  configSha256: string;
  repo: ReturnType<typeof readRepoProvenance>;
  pilotSources: ReturnType<typeof hashPilotSources>;
  gate: PilotGate['provenance'];
  clientKind: PilotModelClient['kind'];
  runtime: { node: string; platform: string; arch: string };
  arms: readonly string[];
  plannedRuns: number;
  networkPolicy: string;
}

export function configHash(config: PilotConfig, pilotSourcesSha: string): string {
  const tasks = config.taskIds.map((id) => {
    const t = getTask(id);
    return { id: t.id, riskFocus: t.riskFocus, prompt: t.prompt, policy: t.policy, initialState: t.initialState(), npmTest: t.npmTest };
  });
  return sha256(canonicalJson({ specVersion: SPEC_VERSION, config, tasks, rolePrompts: ROLE_SYSTEM_PROMPTS, roleTools: ROLE_TOOLS, arms: ARMS, pilotSourcesSha }));
}

export interface ExecuteResult {
  manifest: PilotManifest;
  summary: PilotSummary;
  records: RunRecord[];
  outputDir: string;
  paths: { manifest: string; summaryJson: string; summaryMd: string; runsJsonl: string };
}

export async function executePilot(input: {
  config: PilotConfig;
  client: PilotModelClient;
  gate: PilotGate;
  outputDir: string;
  repoRoot?: string;
  log?: (line: string) => void;
}): Promise<ExecuteResult> {
  const repoRoot = input.repoRoot ?? repoRootFromHere();
  const { config } = input;
  if (config.mode === 'live') {
    if (!config.baseUrl) throw new Error('live mode requires an explicit loopback baseUrl');
    validateLoopbackBaseUrl(config.baseUrl);
    if (input.client.kind !== 'loopback_openai_compatible') throw new Error('live mode requires the loopback client');
  }
  const tasks = config.taskIds.map(getTask);
  const pilotSources = hashPilotSources(repoRoot);
  const manifest: PilotManifest = {
    specVersion: SPEC_VERSION,
    createdAt: new Date().toISOString(),
    mode: config.mode,
    config,
    configSha256: configHash(config, pilotSources.sha256),
    repo: readRepoProvenance(repoRoot),
    pilotSources,
    gate: input.gate.provenance,
    clientKind: input.client.kind,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    arms: ARMS,
    plannedRuns: plannedRunCount({ models: config.models, tasks, repetitions: config.repetitions }),
    networkPolicy:
      'Tool actions are simulated in memory (no shell, no filesystem, no sockets). The only network egress is POST <loopback baseUrl>/chat/completions in live mode; self-test makes no network calls.',
  };
  const writer = new OutputWriter(input.outputDir);
  const manifestPath = writer.writeJson('manifest.json', manifest);
  const records = await runMatrix({
    models: config.models,
    tasks,
    repetitions: config.repetitions,
    seedBase: config.seedBase,
    orderSeed: config.orderSeed,
    budgets: config.budgets,
    client: input.client,
    gate: input.gate,
    onRun: (record) => {
      writer.appendRun(record);
      input.log?.(`${record.runId} completed=${record.metrics.completed} harmful=${record.metrics.harmfulOutcome} blocks=${record.metrics.blockCount}${record.metrics.runError ? ` runError=${record.metrics.runError}` : ''}`);
    },
  });
  const summary = summarize(records, { models: config.models, taskIds: config.taskIds, repetitions: config.repetitions });
  const summaryJson = writer.writeJson('summary.json', { manifestSha256: sha256(canonicalJson(manifest)), configSha256: manifest.configSha256, ...summary });
  const summaryMd = writer.writeText('summary.md', renderMarkdown(summary, { ...manifest, models: config.models }));
  return {
    manifest,
    summary,
    records,
    outputDir: input.outputDir,
    paths: { manifest: manifestPath, summaryJson, summaryMd, runsJsonl: join(input.outputDir, 'runs.jsonl') },
  };
}

// ---------------------------------------------------------------------------
// Self-test: scripted clients, real Aegis rules, zero network.
// ---------------------------------------------------------------------------

export const SELFTEST_MODELS = Object.freeze(['scripted-safe', 'scripted-reckless']);

export function selfTestConfig(): PilotConfig {
  return {
    mode: 'selftest',
    models: [...SELFTEST_MODELS],
    taskIds: PILOT_TASKS.map((t) => t.id),
    repetitions: 1,
    seedBase: 1,
    orderSeed: 20261013,
    budgets: { ...DEFAULT_BUDGETS },
  };
}

/** Replace global fetch with a tripwire for the duration of `fn`. */
export async function withNetworkTripwire<T>(fn: () => Promise<T>): Promise<{ value: T; attempts: string[] }> {
  const original = globalThis.fetch;
  const attempts: string[] = [];
  globalThis.fetch = (async (target: unknown) => {
    attempts.push(String(target instanceof Request ? target.url : target));
    throw new Error('network access is forbidden in the pilot self-test');
  }) as typeof fetch;
  try {
    return { value: await fn(), attempts };
  } finally {
    globalThis.fetch = original;
  }
}

export async function runSelfTest(options: { outputDir?: string; gate?: PilotGate; client?: PilotModelClient } = {}): Promise<ExecuteResult & { networkAttempts: string[] }> {
  const outputDir = options.outputDir ?? mkdtempSync(join(tmpdir(), 'aegis-pilot-selftest-'));
  const gate = options.gate ?? (await createAegisRulesGate());
  const client = options.client ?? new ScriptedSelfTestClient();
  const { value, attempts } = await withNetworkTripwire(() => executePilot({ config: selfTestConfig(), client, gate, outputDir }));
  return { ...value, networkAttempts: attempts };
}
