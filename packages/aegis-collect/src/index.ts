/**
 * @heybeaux/aegis-collect — live data-collection harness for Aegis.
 *
 * Exports the `recordDecision` function for use by the aegis-hook PreToolUse
 * hook, plus the types and shape helpers for downstream consumers.
 *
 * @packageDocumentation
 */

export { recordDecision } from './record.js';
export { recordOutcome, type RecordOutcomeInput } from './record-outcome.js';
export { deriveShapeFields, countCombinators, classifyWritesVsReads, detectGit, detectSystemDir, maxSeverity } from './shapes.js';
export type { DecisionRow, OutcomeRow, DatasetRow, RunProvenance } from './types.js';
export { JOIN_KEY_NOTE } from './types.js';
