/**
 * REAL-data benchmark axis (the first non-synthetic number).
 *
 * The synthetic axes (`src/run.ts`) model injected failures over a generated
 * corpus. THIS module instead consumes a real, leak-free `action_failed` dataset
 * produced by `@heybeaux/aegis-label`'s `runLabeling` over a genuine, ed25519-
 * signed Sonder audit chain (rows stamped `dataSource:'real'`). It asks the
 * question the build plan actually cares about:
 *
 *   Given REAL gated actions and their REAL outcomes, how well does each engine
 *   anticipate failure — and does the production predictor lift over the
 *   reactive rule floor?
 *
 * We score two engines on the real labels:
 *   - `regex`            — the reactive rule floor: predict-failure iff the
 *                          rule-eval's `ruleSeverityMax` is high/critical.
 *   - `regex+predictor`  — the in-package production predictor: a deterministic,
 *                          sequential model that blends severity, row-level REAL
 *                          session features, and learned profile/tool posteriors.
 *
 * Metrics are standard binary-classification on `action_failed`: precision,
 * recall, F1, plus the headline LIFT (recall gain of the predictor over the rule
 * floor at comparable-or-better precision). Rows with `action_failed === null`
 * (unknowable outcome) are excluded — Truth-above-all.
 *
 * Honesty: this path is ONLY valid on `dataSource:'real'` rows; it asserts the
 * stamp and reports the row provenance in the result.
 */

import { readFileSync } from 'node:fs';
import {
  PRODUCTION_PREDICTOR_ENGINE,
  runProductionPredictorSequential,
} from './engines/production-predictor.js';
import type { Severity } from '@heybeaux/lattice-aegis';

/** The engines this axis compares. */
export type RealEngine = 'regex' | typeof PRODUCTION_PREDICTOR_ENGINE;

/** Minimal shape of a frozen `aegis-label` row we read from the dataset JSONL. */
export interface FrozenRowLike {
  features: {
    tool: string;
    ruleSeverityMax: Severity | 'none';
    sessionHealthRegime: 'clean' | 'recovering' | 'thrashing';
    priorFailuresThisSession: number;
    histFailRate_toolPath: number;
    pathsTouched: number;
    /**
     * Walk-backward rollback churn signal (aegis-label feature). 1 when a
     * rollback hit an overlapping path within the lookback window before this
     * decision. Optional so older datasets (pre-feature) still parse as 0.
     */
    rollbackProximity?: number;
  };
  action_failed: 0 | 1 | null;
  labelReason: string | null;
  dataSource: 'real' | 'synthetic';
  decisionEventId: string;
}

/** Binary-classification confusion + derived rates for one engine. */
export interface RealEngineMetrics {
  engine: RealEngine;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

/** The full real-data benchmark result. */
export interface RealBenchmarkResult {
  dataSource: 'real';
  datasetPath: string;
  totalRows: number;
  scoredRows: number;
  excludedRows: number;
  actualFailures: number;
  /** Per-engine metrics, ordered [regex, regex+predictor]. */
  engines: RealEngineMetrics[];
  recallLift: number;
  extraFailuresCaught: number;
}

/** Predict-failure verdict for the reactive rule floor. */
function regexPredictsFailure(row: FrozenRowLike): boolean {
  const sev = row.features.ruleSeverityMax;
  return sev === 'high' || sev === 'critical';
}

function metricsFor(
  engine: RealEngine,
  rows: FrozenRowLike[],
  predicts: (r: FrozenRowLike) => boolean,
): RealEngineMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const row of rows) {
    const predicted = predicts(row);
    const actual = row.action_failed === 1;
    if (predicted && actual) tp += 1;
    else if (predicted && !actual) fp += 1;
    else if (!predicted && actual) fn += 1;
    else tn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const accuracy = rows.length === 0 ? 0 : (tp + tn) / rows.length;
  return { engine, tp, fp, fn, tn, precision, recall, f1, accuracy };
}

export function parseDataset(jsonl: string): FrozenRowLike[] {
  return jsonl
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as FrozenRowLike);
}

function validateAndScore(all: FrozenRowLike[], datasetPath: string): {
  scored: FrozenRowLike[];
  excluded: number;
  actualFailures: number;
} {
  for (const r of all) {
    if (r.dataSource !== 'real') {
      throw new Error(
        `runRealBenchmark: dataset ${datasetPath} contains a non-real row ` +
          `(decisionEventId=${r.decisionEventId}, dataSource=${r.dataSource}). ` +
          `This axis only scores real Sonder-chain data.`,
      );
    }
  }
  const scored = all.filter((r) => r.action_failed !== null);
  return {
    scored,
    excluded: all.length - scored.length,
    actualFailures: scored.filter((r) => r.action_failed === 1).length,
  };
}

export function runRealBenchmark(datasetPath: string): RealBenchmarkResult {
  const all = parseDataset(readFileSync(datasetPath, 'utf8'));
  const { scored, excluded, actualFailures } = validateAndScore(all, datasetPath);

  const regex = metricsFor('regex', scored, regexPredictsFailure);
  const predictorVerdicts = runProductionPredictorSequential(scored);
  let predictorIdx = 0;
  const predictor = metricsFor(PRODUCTION_PREDICTOR_ENGINE, scored, () => predictorVerdicts[predictorIdx++]);

  const extraFailuresCaught = predictor.tp - regex.tp;
  const recallLift = regex.fn === 0 ? 0 : extraFailuresCaught / regex.fn;

  return {
    dataSource: 'real',
    datasetPath,
    totalRows: all.length,
    scoredRows: scored.length,
    excludedRows: excluded,
    actualFailures,
    engines: [regex, predictor],
    recallLift,
    extraFailuresCaught,
  };
}
