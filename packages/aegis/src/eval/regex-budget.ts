/** Native matching must be interruptible on actual host strings, not just loader probes. */
import { createContext, Script } from 'node:vm';

const DEFAULT_MATCH_BUDGET_MS = 100;
const MAX_MATCH_BUDGET_MS = 1000;
const MAX_CACHED_PATTERNS = 2048;
const DEFAULT_TOTAL_BUDGET_MS = 250;
const MAX_TOTAL_BUDGET_MS = 1000;

/**
 * One regex test to run inside the private realm. `rule` identifies the rule (a timeout
 * makes every later job of the same rule unresolved and skipped); `group` identifies one
 * (variant, rule) pair whose strings are tested in order until the first match.
 */
export interface RegexJob {
  rule: number;
  group: number;
  source: string;
  flags: string;
  input: string;
}

/** Per-job outcome: true/false = proven, null = unknown (timeout/unavailable), undefined = not run. */
export type RegexJobResult = boolean | null | undefined;

// Fixed code only: policy sources and inputs are plain data slots, never interpolated
// into executable text. One VM entry runs a whole batch (entering the VM per match was
// ~480x slower on the builtin corpus). The VM watchdog interrupts native backtracking;
// a timeout is uncatchable inside the script, so per-job try/catch only sees genuine
// compilation/runtime errors.
const BATCH = new Script(`(() => {
  for (let i = start; i < jobs.length; i++) {
    const j = jobs[i];
    if (matched[j.group] === true || bad[j.rule] === true) { out[i] = 2; continue; }
    out[i] = 4; // running marker: a timeout leaves the culprit identifiable
    try {
      let byFlags = cache.get(j.flags);
      if (byFlags === undefined) { byFlags = new Map(); cache.set(j.flags, byFlags); }
      let re = byFlags.get(j.source);
      if (re === undefined) {
        if (size >= limit) { cache.clear(); byFlags = new Map(); cache.set(j.flags, byFlags); size = 0; }
        re = new RegExp(j.source, j.flags);
        byFlags.set(j.source, re);
        size++;
      }
      re.lastIndex = 0;
      const m = re.test(j.input);
      re.lastIndex = 0;
      out[i] = m ? 1 : 0;
      if (m) matched[j.group] = true;
    } catch (e) {
      out[i] = 3;
      bad[j.rule] = true;
    }
  }
})()`);

// Reset legacy RegExp statics (RegExp.input/$1..) so the realm keeps no caller input.
const CLEAR = new Script("/(?:)/.test('')");

interface Slots {
  jobs?: RegexJob[];
  start?: number;
  out?: number[];
  matched?: Record<number, boolean>;
  bad?: Record<number, boolean>;
  cache?: unknown;
  size?: number;
  limit?: number;
}

const slots: Slots = {};
let context: ReturnType<typeof createContext> | undefined;
try {
  context = createContext(slots);
  new Script('cache = new Map(); size = 0;').runInContext(context);
  slots.limit = MAX_CACHED_PATTERNS;
} catch {
  context = undefined; // matching will return unknown
}

export function regexMatchBudgetMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_MATCH_BUDGET_MS
    ? Math.ceil(value)
    : DEFAULT_MATCH_BUDGET_MS;
}

/** Total native work allowance for one evaluate invocation; never an unbounded opt-out. */
export function regexTotalBudgetMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_TOTAL_BUDGET_MS
    ? Math.ceil(value)
    : DEFAULT_TOTAL_BUDGET_MS;
}

export type RegexBatchResults = RegexJobResult[] & { cumulativeBudgetExceeded?: boolean };

/**
 * Run jobs in order with per-job budget semantics. A batch call that times out is
 * restarted with the culprit as its first job; only a job that alone exceeds the budget
 * is unknown. Results never fabricate a match; unknown is never a nonmatch.
 */
export function boundedRegexMatchMany(jobs: readonly RegexJob[], budgetMs: number, totalBudgetMs?: number): RegexBatchResults {
  const results: RegexBatchResults = new Array(jobs.length).fill(undefined);
  const deadline = totalBudgetMs === undefined ? Infinity : performance.now() + regexTotalBudgetMs(totalBudgetMs);
  if (jobs.length === 0) return results;
  if (!context) {
    // Unavailable: every job's first evaluated string per rule is unknown.
    const badRules = new Set<number>();
    const matchedGroups = new Set<number>();
    jobs.forEach((j, i) => {
      if (badRules.has(j.rule) || matchedGroups.has(j.group)) return;
      results[i] = null;
      badRules.add(j.rule);
    });
    return results;
  }
  const out: number[] = new Array(jobs.length).fill(0).map(() => -1);
  const matched: Record<number, boolean> = Object.create(null);
  const bad: Record<number, boolean> = Object.create(null);
  let start = 0;
  const exhaustTotal = () => {
    // Keep proven results and first-match group short-circuit semantics. An unrun
    // rule is unknown, never a nonmatch; one unknown per rule is sufficient.
    for (let i = start; i < jobs.length; i++) {
      if (out[i] !== -1 && out[i] !== 4) continue;
      const j = jobs[i]!;
      if (matched[j.group] || bad[j.rule]) { out[i] = 2; continue; }
      out[i] = 3;
      bad[j.rule] = true;
      results.cumulativeBudgetExceeded = true;
    }
  };
  try {
    while (start < jobs.length) {
      slots.jobs = jobs as RegexJob[];
      slots.out = out;
      slots.matched = matched;
      slots.bad = bad;
      slots.start = start;
      const remaining = Math.floor(deadline - performance.now());
      if (remaining < 1) { exhaustTotal(); break; }
      const timeout = Math.min(budgetMs, remaining);
      try {
        BATCH.runInContext(context, { timeout });
        break;
      } catch {
        // A retry must not acquire a fresh total budget. Native work, including
        // work lost to a batch interruption, all consumes this one deadline.
        if (performance.now() >= deadline || timeout < budgetMs) { exhaustTotal(); break; }
        const culprit = out.findIndex((v, i) => i >= start && v === 4);
        if (culprit < 0) {
          // Realm failure outside any job: everything not yet decided is unknown.
          for (let i = start; i < jobs.length; i++) if (out[i] === -1) { out[i] = 3; bad[jobs[i]!.rule] = true; }
          break;
        }
        if (culprit === start) {
          // This job alone exhausted its full budget: unknown, not nonmatch.
          out[culprit] = 3;
          bad[jobs[culprit]!.rule] = true;
          start = culprit + 1;
        } else {
          // Earlier jobs shared the budget; retry the culprit with a fresh, full budget.
          out[culprit] = -1;
          start = culprit;
        }
      }
    }
  } finally {
    // Do not retain caller strings/arrays in module-owned slots.
    slots.jobs = slots.out = slots.matched = slots.bad = undefined;
    slots.start = undefined;
    try { CLEAR.runInContext(context, { timeout: 50 }); } catch { /* best effort */ }
  }
  out.forEach((v, i) => {
    results[i] = v === 1 ? true : v === 0 ? false : v === 3 || v === 4 ? null : undefined;
  });
  return results;
}

/** Single match convenience: null means unknown, never a proven nonmatch. Caller RegExp untouched. */
export function boundedRegexMatch(regex: RegExp, input: string, budgetMs: number): boolean | null {
  let source: string;
  let flags: string;
  try {
    source = regex.source;
    flags = regex.flags;
    if (typeof source !== 'string' || typeof flags !== 'string') return null;
  } catch {
    return null;
  }
  const [result] = boundedRegexMatchMany([{ rule: 0, group: 0, source, flags, input }], budgetMs);
  return result === undefined ? null : result;
}
