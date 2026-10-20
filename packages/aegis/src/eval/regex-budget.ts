/** Native matching must be interruptible on actual host strings, not just loader probes. */
import { createContext, Script } from 'node:vm';

// Never interpolate policy or input into executable code. The VM owns the native
// RegExp invocation so its watchdog can interrupt catastrophic backtracking.
const MATCH = new Script('new RegExp(source, flags).test(input)');
const DEFAULT_MATCH_BUDGET_MS = 100;
const MAX_MATCH_BUDGET_MS = 1000;

// Context creation per match dominates large rule corpora. This private realm
// evaluates only fixed synchronous code (no callbacks/reentrancy); fresh native
// regex per match and cleared data slots preserve call isolation after timeout.
const slots: { source?: string; flags?: string; input?: string } = {};
let context: ReturnType<typeof createContext> | undefined;
try { context = createContext(slots); } catch { /* matching will return unknown */ }

export function regexMatchBudgetMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_MATCH_BUDGET_MS
    ? Math.ceil(value)
    : DEFAULT_MATCH_BUDGET_MS;
}

/** null means unknown, never a proven nonmatch. No caller RegExp state is touched. */
export function boundedRegexMatch(regex: RegExp, input: string, budgetMs: number): boolean | null {
  try {
    if (!context) return null;
    slots.source = regex.source;
    slots.flags = regex.flags;
    slots.input = input;
    const result: unknown = MATCH.runInContext(context, { timeout: budgetMs });
    return typeof result === 'boolean' ? result : null;
  } catch {
    // Timeouts, unavailable VM execution and invalid native state all fail closed.
    return null;
  } finally {
    // Do not retain a caller command/content/path in module-owned state.
    slots.source = slots.flags = slots.input = undefined;
  }
}
