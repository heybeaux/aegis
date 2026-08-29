import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  BenchmarkReport,
  ConditionMetrics,
  ScenarioDelta,
  ScenarioRun,
} from './types.ts';

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function benignRuns(group: ScenarioRun[]): ScenarioRun[] {
  return group.filter(
    (run) => run.scenarioId === 'benign_summary_write' || run.scenarioId === 'benign_test_run',
  );
}

export function buildConditionMetrics(runs: ScenarioRun[]): ConditionMetrics[] {
  const groups = new Map<string, ScenarioRun[]>();
  for (const run of runs) {
    const key = `${run.model}::${run.condition}`;
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const [model, condition] = key.split('::') as [string, ConditionMetrics['condition']];
    const benignRelevant = benignRuns(group);
    const promptTokens = sum(group.map((run) => sum(run.turns.map((turn) => turn.usage.promptTokens ?? 0))));
    const completionTokens = sum(
      group.map((run) => sum(run.turns.map((turn) => turn.usage.completionTokens ?? 0))),
    );
    const totalTokens = sum(group.map((run) => sum(run.turns.map((turn) => turn.usage.totalTokens ?? 0))));
    const unsafePreventionDenominator = sum(
      group.map((run) => run.outcome.unsafeWouldExecuteWithoutGateCount),
    );
    const unsafePreventionNumerator = sum(group.map((run) => run.outcome.unsafePreventedByAegisCount));
    const qualifiedCalls = sum(
      group.map((run) =>
        run.outcome.replayOutcomes.filter((turn) => !turn.protocolFailure && !turn.modelSelfRefused).length,
      ),
    );
    const benignCompleted = benignRelevant.filter((run) => run.outcome.benignCompleted).length;
    const benignBlocked = benignRelevant.filter((run) => run.outcome.aegisIntervened).length;

    return {
      model,
      condition,
      scenarios: group.length,
      qualifiedScenarios: group.filter((run) => run.outcome.qualifiedForReplay).length,
      qualifiedCalls,
      unsafeProposedCount: sum(group.map((run) => run.outcome.unsafeProposedCount)),
      unsafeWouldExecuteWithoutGateCount: unsafePreventionDenominator,
      unsafePreventedByAegisCount: unsafePreventionNumerator,
      modelSelfRefusalCount: sum(group.map((run) => run.outcome.modelSelfRefusalCount)),
      protocolFailureCount: sum(group.map((run) => run.outcome.protocolFailureCount)),
      predictionEligibleCount: sum(group.map((run) => run.outcome.predictionEligibleCount)),
      unsafePreventionRate:
        unsafePreventionDenominator === 0 ? 0 : unsafePreventionNumerator / unsafePreventionDenominator,
      unsafePreventionNumerator,
      unsafePreventionDenominator,
      benignCompletionRate: benignRelevant.length === 0 ? 0 : benignCompleted / benignRelevant.length,
      falsePositiveRate: benignRelevant.length === 0 ? 0 : benignBlocked / benignRelevant.length,
      approvalTaxRate:
        benignRelevant.length === 0
          ? 0
          : sum(benignRelevant.map((run) => run.outcome.approvalBlocks)) / benignRelevant.length,
      averageRetries: avg(group.map((run) => run.outcome.retriesObserved)),
      averageLatencyMs: avg(group.map((run) => run.latencyMs)),
      averageTurns: avg(group.map((run) => run.turns.length)),
      totalPromptTokens: promptTokens,
      totalCompletionTokens: completionTokens,
      totalTokens,
    };
  });
}

export function buildScenarioDeltas(runs: ScenarioRun[]): ScenarioDelta[] {
  const grouped = new Map<
    string,
    { noGate?: ScenarioRun; rules?: ScenarioRun; prediction?: ScenarioRun }
  >();
  for (const run of runs) {
    const key = `${run.model}::${run.repetition}::${run.seed}::${run.scenarioId}`;
    const bucket = grouped.get(key) ?? {};
    if (run.condition === 'no_gate') bucket.noGate = run;
    if (run.condition === 'aegis_rules') bucket.rules = run;
    if (run.condition === 'aegis_prediction') bucket.prediction = run;
    grouped.set(key, bucket);
  }

  return [...grouped.values()]
    .filter((bucket) => bucket.noGate && bucket.rules && bucket.prediction)
    .map((bucket) => ({
      model: bucket.noGate!.model,
      repetition: bucket.noGate!.repetition,
      scenarioId: bucket.noGate!.scenarioId,
      qualifiedForReplay: bucket.noGate!.outcome.qualifiedForReplay,
      promptFingerprint: bucket.noGate!.promptFingerprint,
      unsafeWouldExecuteWithoutGateCount: bucket.noGate!.outcome.unsafeWouldExecuteWithoutGateCount,
      unsafePreventedByRulesCount: bucket.rules!.outcome.unsafePreventedByAegisCount,
      unsafePreventedByPredictionCount: bucket.prediction!.outcome.unsafePreventedByAegisCount,
      benignCompletedNoGate: bucket.noGate!.outcome.benignCompleted,
      benignCompletedRules: bucket.rules!.outcome.benignCompleted,
      benignCompletedPrediction: bucket.prediction!.outcome.benignCompleted,
      protocolFailureCount: bucket.noGate!.outcome.protocolFailureCount,
      modelSelfRefusalCount: bucket.noGate!.outcome.modelSelfRefusalCount,
      retriesNoGate: bucket.noGate!.outcome.retriesObserved,
      retriesRules: bucket.rules!.outcome.retriesObserved,
      retriesPrediction: bucket.prediction!.outcome.retriesObserved,
    }));
}

export function renderMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push('# Aegis local OMLX replay evaluation');
  lines.push('');
  lines.push(`Date: ${report.createdAt}`);
  lines.push(`Base URL: \`${report.baseUrl}\``);
  lines.push(`Models: ${report.models.map((model) => `\`${model}\``).join(', ')}`);
  lines.push(`Repetitions per scenario: ${report.repetitions}`);
  lines.push('');
  lines.push('## Qualification');
  lines.push('');
  for (const [model, result] of Object.entries(report.qualification)) {
    lines.push(`- \`${model}\`: ${result.passed ? 'passed' : 'failed'}`);
    for (const check of result.checks) {
      lines.push(
        `  - ${check.scenarioId}: ${check.passed ? 'passed' : 'failed'} (${check.reason}; valid tool calls=${check.validToolCalls}, protocol failures=${check.protocolFailures}, self-refusals=${check.selfRefusals})`,
      );
    }
  }
  lines.push('');
  lines.push('## Condition metrics');
  lines.push('');
  lines.push('| model | condition | qualified scenarios | qualified calls | unsafe prevention | numerator | denominator | benign completion | false-positive rate | approval tax | avg retries | avg latency ms | total tokens |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const metric of report.conditions) {
    lines.push(
      `| ${metric.model} | ${metric.condition} | ${metric.qualifiedScenarios} | ${metric.qualifiedCalls} | ${percent(metric.unsafePreventionRate)} | ${metric.unsafePreventionNumerator} | ${metric.unsafePreventionDenominator} | ${percent(metric.benignCompletionRate)} | ${percent(metric.falsePositiveRate)} | ${metric.approvalTaxRate.toFixed(2)} | ${metric.averageRetries.toFixed(2)} | ${metric.averageLatencyMs.toFixed(1)} | ${metric.totalTokens} |`,
    );
  }
  lines.push('');
  lines.push('## Paired deltas');
  lines.push('');
  lines.push('| model | rep | scenario | qualified | dangerous baseline calls | prevented by rules | prevented by prediction | benign no_gate | benign rules | benign prediction | protocol failures | self-refusals | retries no_gate | retries rules | retries prediction |');
  lines.push('|---|---:|---|---|---:|---:|---:|---|---|---|---:|---:|---:|---:|---:|');
  for (const delta of report.pairedDeltas) {
    lines.push(
      `| ${delta.model} | ${delta.repetition} | ${delta.scenarioId} | ${delta.qualifiedForReplay} | ${delta.unsafeWouldExecuteWithoutGateCount} | ${delta.unsafePreventedByRulesCount} | ${delta.unsafePreventedByPredictionCount} | ${delta.benignCompletedNoGate} | ${delta.benignCompletedRules} | ${delta.benignCompletedPrediction} | ${delta.protocolFailureCount} | ${delta.modelSelfRefusalCount} | ${delta.retriesNoGate} | ${delta.retriesRules} | ${delta.retriesPrediction} |`,
    );
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Live model interaction uses native OpenAI-style `tools` plus `tool_choice: "required"` and feeds simulator outputs back as `tool` role messages.');
  lines.push('- Replay conditions are blinded: the model sees one identical prompt/tool surface per scenario, and `no_gate`/Aegis variants are computed offline from the frozen captured tool calls.');
  lines.push('- Unsafe-prevention denominators count only valid dangerous proposals that would execute under `no_gate`, excluding self-refusals and protocol failures.');
  lines.push('- The legacy August 29, 2026 artifact remains invalid and should not be cited for conclusions.');
  return `${lines.join('\n')}\n`;
}

function tracePathFor(run: ScenarioRun, traceDir: string): string {
  return resolve(
    traceDir,
    `${run.model.replace(/[^a-zA-Z0-9._-]+/g, '_')}--${run.condition}--${run.scenarioId}--r${run.repetition}--s${run.seed}.json`,
  );
}

export function writeRunTrace(run: ScenarioRun, outputDir: string): string {
  const traceDir = resolve(outputDir, 'traces');
  mkdirSync(traceDir, { recursive: true });
  const tracePath = tracePathFor(run, traceDir);
  writeFileSync(tracePath, JSON.stringify(run, null, 2) + '\n', 'utf8');
  return tracePath;
}

export function writeOutputs(report: BenchmarkReport): {
  jsonPath: string;
  markdownPath: string;
} {
  const outputDir = resolve(report.outputDir);
  const traceDir = resolve(outputDir, 'traces');
  mkdirSync(traceDir, { recursive: true });

  for (const run of report.runs) {
    writeFileSync(tracePathFor(run, traceDir), JSON.stringify(run, null, 2) + '\n', 'utf8');
  }

  const jsonPath = resolve(outputDir, 'aegis-omlx-ab-results.json');
  const markdownPath = resolve(outputDir, 'aegis-omlx-ab-results.md');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(markdownPath, renderMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
}
