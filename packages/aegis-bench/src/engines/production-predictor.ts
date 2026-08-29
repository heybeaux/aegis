import { DEFAULT_PREDICTION_THRESHOLDS, type Prediction, type Severity } from '@heybeaux/lattice-aegis';
import type { FrozenRowLike } from '../real.js';

const ASK_THRESHOLD = DEFAULT_PREDICTION_THRESHOLDS.askAtOrAbove;

const COLD_START_BASE_RATES: Record<Severity | 'none', number> = {
  critical: 0.9,
  high: 0.45,
  medium: 0.2,
  low: 0.03,
  none: 0.01,
};

const REGIME_PRESSURE: Record<FrozenRowLike['features']['sessionHealthRegime'], number> = {
  clean: 0,
  recovering: 0.14,
  thrashing: 0.32,
};

export const PRODUCTION_PREDICTOR_LABEL = 'predictor: PRODUCTION-PREDICTOR';
export const PRODUCTION_PREDICTOR_ENGINE = 'regex+predictor';

interface PredictorBucket {
  fails: number;
  total: number;
}

export interface ProductionPrediction {
  intervene: boolean;
  prediction: Prediction;
}

/**
 * Deterministic in-package predictor for the real-data benchmark.
 *
 * It is intentionally separate from the synthetic stub in `awm-stub.ts`: this
 * engine blends row-local evidence with sequentially learned posteriors over
 * prior real outcomes seen during the benchmark.
 */
export class ProductionPredictor {
  private readonly profileHistory = new Map<string, PredictorBucket>();
  private readonly toolHistory = new Map<string, PredictorBucket>();

  predict(row: FrozenRowLike): ProductionPrediction {
    const { features } = row;
    const profileRate = this.posteriorMean(this.profileHistory.get(this.profileKey(row)));
    const toolRate = this.posteriorMean(this.toolHistory.get(this.toolKey(row)));
    const rollback = features.rollbackProximity ?? 0;
    const severityPrior = COLD_START_BASE_RATES[features.ruleSeverityMax];
    const sessionPressure = REGIME_PRESSURE[features.sessionHealthRegime];
    const repeatedFailurePressure = Math.min(0.18, features.priorFailuresThisSession * 0.06);
    const breadthPressure = Math.min(0.08, Math.max(0, features.pathsTouched - 1) * 0.02);
    const rollbackPressure = rollback > 0 ? 0.6 : 0;

    const blended = clamp01(
      0.32 * severityPrior +
        0.24 * features.histFailRate_toolPath +
        0.16 * profileRate +
        0.12 * toolRate +
        0.1 * sessionPressure +
        0.04 * repeatedFailurePressure +
        0.02 * breadthPressure,
    );
    const pFailure = Math.max(severityPrior, rollbackPressure, blended);
    const confidence = clamp01(0.45 + 0.2 * profileRate + 0.2 * toolRate + 0.15 * rollback);

    return {
      intervene: pFailure >= ASK_THRESHOLD,
      prediction: {
        pFailure,
        confidence,
        source: 'prior',
      },
    };
  }

  record(row: FrozenRowLike): void {
    const failed = row.action_failed === 1;
    this.bump(this.profileHistory, this.profileKey(row), failed);
    this.bump(this.toolHistory, this.toolKey(row), failed);
  }

  private posteriorMean(bucket: PredictorBucket | undefined): number {
    if (!bucket) return 0.5;
    return (bucket.fails + 1) / (bucket.total + 2);
  }

  private bump(store: Map<string, PredictorBucket>, key: string, failed: boolean): void {
    const bucket = store.get(key) ?? { fails: 0, total: 0 };
    bucket.total += 1;
    if (failed) bucket.fails += 1;
    store.set(key, bucket);
  }

  private profileKey(row: FrozenRowLike): string {
    const { features } = row;
    return [
      features.tool,
      features.ruleSeverityMax,
      features.sessionHealthRegime,
      features.rollbackProximity ?? 0,
    ].join('::');
  }

  private toolKey(row: FrozenRowLike): string {
    const { features } = row;
    return [features.tool, features.ruleSeverityMax].join('::');
  }
}

export function runProductionPredictorSequential(rows: readonly FrozenRowLike[]): boolean[] {
  const predictor = new ProductionPredictor();
  return rows.map((row) => {
    const verdict = predictor.predict(row).intervene;
    predictor.record(row);
    return verdict;
  });
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
