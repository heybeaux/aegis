import {
  Oracle,
  InMemoryStore,
  type PredictionContext,
  type StepTrace,
} from '@heybeaux/awm-core';
import type { FrozenRowLike } from '../real.js';

/**
 * Sequential adapter from frozen Aegis real-data rows into @heybeaux/awm-core.
 *
 * The benchmark intentionally predicts BEFORE recording each row's ground-truth
 * outcome. That keeps the comparison honest: AWM core may learn from previous
 * rows, never from the row it is currently scoring.
 */
export async function runAwmCoreSequential(rows: readonly FrozenRowLike[]): Promise<boolean[]> {
  const oracle = new Oracle({ store: new InMemoryStore() });
  const verdicts: boolean[] = [];
  const priorSteps: PredictionContext['priorSteps'] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const context = contextForRow(row, priorSteps);
    const prediction = await oracle.predict(context);

    verdicts.push(prediction.outcome === 'fail');

    const passed = row.action_failed !== 1;
    await oracle.record(traceForRow(row, i, passed));
    priorSteps.push({
      stepType: context.stepType,
      passed,
      revised: row.labelReason === 'rollback',
      model: 'aegis-real-data',
      cost: 1,
    });
  }

  return verdicts;
}

function contextForRow(
  row: FrozenRowLike,
  priorSteps: NonNullable<PredictionContext['priorSteps']>,
): PredictionContext {
  const f = row.features;
  return {
    stepType: stepTypeFor(row),
    profileSlug: profileFor(row),
    sector: f.sessionHealthRegime,
    availableModels: ['aegis-real-data'],
    inputFingerprint: `${f.tool}:${f.ruleSeverityMax}:${f.pathsTouched}:${f.rollbackProximity ?? 0}`,
    priorSteps: priorSteps.slice(-10),
    criticality:
      f.ruleSeverityMax === 'critical' || f.ruleSeverityMax === 'high'
        ? 'critical'
        : f.ruleSeverityMax === 'medium'
          ? 'standard'
          : 'exploratory',
  };
}

function traceForRow(row: FrozenRowLike, index: number, passed: boolean): StepTrace {
  const f = row.features;
  return {
    traceId: row.decisionEventId || `aegis-row-${index}`,
    runId: 'aegis-real-benchmark',
    workflowType: 'aegis-tool-governance',
    stepType: stepTypeFor(row),
    stepIndex: index,
    profileSlug: profileFor(row),
    sector: f.sessionHealthRegime,
    model: 'aegis-real-data',
    inputFingerprint: `${f.tool}:${f.ruleSeverityMax}:${f.pathsTouched}:${f.rollbackProximity ?? 0}`,
    passed,
    revised: row.labelReason === 'rollback',
    revisionReason: row.labelReason ?? undefined,
    tokensIn: 0,
    tokensOut: 0,
    cost: 1,
    latencyMs: 0,
    timestamp: '2026-06-16T00:00:00.000Z',
  };
}

function stepTypeFor(row: FrozenRowLike): string {
  return `tool:${row.features.tool}`;
}

function profileFor(row: FrozenRowLike): string {
  const f = row.features;
  return `${f.ruleSeverityMax}:${f.sessionHealthRegime}:rollback-${f.rollbackProximity ?? 0}`;
}
