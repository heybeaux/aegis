/** Package-owned implicit policy. Public DEFAULT_* values are editable recipes, not authority. */
import type { SeverityTable, PredictionThresholds } from '../types.js';

export const IMPLICIT_SEVERITY_TABLE: Readonly<SeverityTable> = Object.freeze({
  critical: 'deny', high: 'ask', medium: 'ask', low: 'allow',
});
export const IMPLICIT_PREDICTION_THRESHOLDS: Readonly<PredictionThresholds> = Object.freeze({
  denyAtOrAbove: 0.8, askAtOrAbove: 0.4,
});
