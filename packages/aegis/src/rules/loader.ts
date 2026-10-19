/**
 * Rule-pack loader: validate -> flag-restrict -> compile -> ReDoS budget.
 * Fail-closed: a pack that violates any guard is rejected wholesale, loudly.
 * See docs/aegis-rulepack-spec-2026-06-14.md §2.
 */

import { createContext, Script } from 'node:vm';

import type {
  AllowedFlag,
  CompiledRule,
  Rule,
  RulePack,
} from '../types.js';

const ALLOWED_FLAGS: ReadonlySet<string> = new Set<AllowedFlag>([
  'i',
  'm',
  's',
  'u',
]);

/** Adversarial filler strings used to detect catastrophic backtracking at load time. */
const REDOS_PROBES: readonly string[] = [
  'a'.repeat(64),
  ('a' + ' ').repeat(48),
  '/'.repeat(64),
  ('rm -rf ' + 'x'.repeat(8) + ' ').repeat(16),
  'aaaaaaaaaaaaaaaaaaaaaaaa!'.repeat(8),
];

/**
 * Per-probe match budget. A pattern slower than this on any probe is rejected.
 *
 * Keep this as a guard, not a micro-benchmark. GitHub runners and cold local
 * machines routinely vary by a few ms, so the default needs enough headroom to
 * avoid rejecting known-good rulepacks because one probe took 5.1ms. Override
 * with AEGIS_REDOS_BUDGET_MS for tighter local experiments.
 */
const configuredBudget = Number(process.env['AEGIS_REDOS_BUDGET_MS'] ?? '25');
// vm requires a positive integer timeout. Invalid operator input must not turn
// the guard off (NaN/Infinity), reject all packs (zero/negative), or leak a
// RangeError. Round fractional milliseconds up, keeping the default headroom.
const REDOS_BUDGET_MS = Number.isFinite(configuredBudget) &&
  configuredBudget > 0 && configuredBudget <= 2_147_483_647
  ? Math.ceil(configuredBudget)
  : 25;

// Fixed source, primitive data only: patterns are never interpolated as code.
// Construct the RegExp in the timed V8 context so a native backtracking call is
// interruptible. An elapsed check after a host RegExp.test cannot preempt it.
const REDOS_PROBE_SCRIPT = new Script('new RegExp(pattern, flags).test(probe)');

export class RulePackError extends Error {
  constructor(
    message: string,
    readonly packId: string,
    readonly ruleId?: string,
  ) {
    super(
      ruleId
        ? `[aegis:${packId}/${ruleId}] ${message}`
        : `[aegis:${packId}] ${message}`,
    );
    this.name = 'RulePackError';
  }
}

function validateFlags(flags: string | undefined, pack: RulePack, rule: Rule): void {
  if (!flags) return;
  for (const f of flags) {
    if (!ALLOWED_FLAGS.has(f)) {
      throw new RulePackError(
        `disallowed regex flag '${f}' (allowed: i,m,s,u; never g)`,
        pack.packId,
        rule.id,
      );
    }
  }
}

function compileRegex(pack: RulePack, rule: Rule): RegExp {
  const { pattern, flags } = rule.match;
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw new RulePackError(
      `regex failed to compile: ${(err as Error).message}`,
      pack.packId,
      rule.id,
    );
  }
}

function assertNoReDoS(regex: RegExp, pack: RulePack, rule: Rule): void {
  const context = createContext({ pattern: regex.source, flags: regex.flags, probe: '' });
  for (const probe of REDOS_PROBES) {
    context['probe'] = probe;
    try {
      // Fresh context-owned regex each probe: no lastIndex/cache state escapes.
      REDOS_PROBE_SCRIPT.runInContext(context, { timeout: REDOS_BUDGET_MS });
    } catch (err) {
      const timedOut = typeof err === 'object' && err !== null &&
        'code' in err && err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
      throw new RulePackError(
        timedOut
          ? `pattern exceeded ReDoS budget (${REDOS_BUDGET_MS}ms) on a probe — likely catastrophic backtracking`
          : 'ReDoS budget probe could not complete safely',
        pack.packId,
        rule.id,
      );
    }
  }
}

function validateRuleShape(pack: RulePack, rule: Rule): void {
  if (!rule.id) throw new RulePackError('rule missing id', pack.packId);
  if (!rule.match?.pattern) {
    throw new RulePackError('rule missing match.pattern', pack.packId, rule.id);
  }
  if (!rule.appliesTo || rule.appliesTo.length === 0) {
    throw new RulePackError(
      'rule must declare appliesTo (use ["*"] for any tool)',
      pack.packId,
      rule.id,
    );
  }
}

/**
 * Compile a single pack into independently owned, editable Rule values.
 * Producer recipe edits require an explicit reload; inputs are never frozen or
 * mutated. Throws RulePackError on any guard violation.
 */
export function loadPack(pack: RulePack): CompiledRule[] {
  if (!pack.packId) throw new RulePackError('pack missing packId', '<unknown>');
  const seen = new Set<string>();
  const compiled: CompiledRule[] = [];

  for (const recipe of pack.rules) {
    // Validate and compile the same owned plain-data snapshot. Retaining the
    // caller's Rule would let later draft edits bypass this validation boundary
    // (and leave regex declarations inconsistent with their compiled cache).
    // Clone per rule, not per pack, to detach shared nested recipe containers.
    const rule = structuredClone(recipe);
    validateRuleShape(pack, rule);
    if (seen.has(rule.id)) {
      throw new RulePackError(`duplicate rule id within pack`, pack.packId, rule.id);
    }
    seen.add(rule.id);

    if (rule.match.kind === 'regex') {
      validateFlags(rule.match.flags, pack, rule);
      const regex = compileRegex(pack, rule);
      assertNoReDoS(regex, pack, rule);
      compiled.push({ rule, regex });
    } else if (rule.match.kind === 'substring') {
      compiled.push({ rule });
    } else {
      // ast — reserved for Phase 5.
      throw new RulePackError(
        `match.kind 'ast' not yet supported (Phase 5)`,
        pack.packId,
        rule.id,
      );
    }
  }

  return compiled;
}
