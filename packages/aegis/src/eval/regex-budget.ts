/** Native matching must be interruptible on actual host strings, not just loader probes. */
import { createContext, Script } from 'node:vm';

// Never interpolate policy or input into executable code. The VM owns the native
// RegExp invocation so its watchdog can interrupt catastrophic backtracking.
const MATCH = new Script('new RegExp(source, flags).test(input)');
const DEFAULT_MATCH_BUDGET_MS = 100;
const MAX_MATCH_BUDGET_MS = 1000;

export function regexMatchBudgetMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_MATCH_BUDGET_MS
    ? Math.ceil(value)
    : DEFAULT_MATCH_BUDGET_MS;
}

/** null means unknown, never a proven nonmatch. No caller RegExp state is touched. */
export function boundedRegexMatch(regex: RegExp, input: string, budgetMs: number): boolean | null {
  try {
    const context = createContext({ source: regex.source, flags: regex.flags, input });
    const result: unknown = MATCH.runInContext(context, { timeout: budgetMs });
    return typeof result === 'boolean' ? result : null;
  } catch {
    // Timeouts, unavailable VM execution and invalid native state all fail closed.
    return null;
  }
}
