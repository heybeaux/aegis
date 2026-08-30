/**
 * classify-error — separate genuine tool failures from host/harness artifacts.
 *
 * Shadow collection records `isError` straight from the host tool result, but a
 * large share of those errors are infrastructure races (e.g. the embedded
 * runner aborting a tool because the session JSONL changed under a released
 * prompt lock). Those are NOT signals about whether the tool call itself was
 * dangerous or wrong, so counting them as `action_failed = 1` poisons any
 * predictor trained on the data.
 *
 * We classify errors into:
 *   - 'tool'  : a genuine failure attributable to the tool call.
 *   - 'infra' : a host/harness/concurrency artifact unrelated to tool danger.
 *
 * Truth-above-all: we never silently drop rows. Infra errors are tagged, and
 * downstream (build-dataset) excludes them from the trained label rather than
 * relabelling them as successes.
 */

export type OutcomeErrorClass = 'tool' | 'infra';

/** Substrings that mark a host/harness artifact rather than a real tool failure. */
const INFRA_ERROR_PATTERNS: readonly string[] = [
  'session file changed while embedded prompt lock was released',
  'embedded prompt lock',
  'file lock stale for',
  'session file changed',
];

/**
 * Classify an outcome error string.
 *
 * Returns undefined when there is no error to classify (isError === false or
 * no error text). A missing error string on an errored row defaults to 'tool'
 * so we never hide a real failure behind a missing message.
 */
export function classifyOutcomeError(
  isError: boolean,
  error?: string,
): OutcomeErrorClass | undefined {
  if (!isError) return undefined;
  const text = (error ?? '').toLowerCase();
  for (const pattern of INFRA_ERROR_PATTERNS) {
    if (text.includes(pattern.toLowerCase())) return 'infra';
  }
  return 'tool';
}
