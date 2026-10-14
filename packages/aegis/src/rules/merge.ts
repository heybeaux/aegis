/**
 * Three-layer rule cascade: builtin -> user -> project (project wins).
 * Merge by (packId is provenance; rule.id is identity). Higher layers override
 * matching fields or add new ids. No delete — disable via enabled:false.
 *
 * Strictness invariant: a higher layer may tighten freely. LOWERING a builtin's
 * strictness (disabling, reducing severity, or losing matcher coverage) requires
 * allowDowngrade:true on the current overlay, else
 * the loader keeps the stricter builtin and warns.
 * See docs/aegis-rulepack-spec-2026-06-14.md §3.
 */

import type { Rule, Severity } from '../types.js';

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function isEnabled(r: Rule): boolean {
  return r.enabled !== false;
}

/** Compare flags as a set/order-independent dialect; loadPack owns validity. */
function sameFlags(a: string | undefined, b: string | undefined): boolean {
  return [...(a ?? '')].sort().join('') === [...(b ?? '')].sort().join('');
}

/** Opaque classifier replacement needs review, not an unsound inclusion guess. */
function sameMatcher(base: Rule, overlay: Rule): boolean {
  return base.match.kind === overlay.match.kind &&
    base.match.pattern === overlay.match.pattern &&
    base.match.target === overlay.match.target &&
    sameFlags(base.match.flags, overlay.match.flags);
}

/** True when every tool accepted by base remains accepted by overlay. */
function retainsTools(base: Rule, overlay: Rule): boolean {
  if (overlay.appliesTo.includes('*')) return true;
  if (base.appliesTo.includes('*')) return false;
  const tools = new Set(overlay.appliesTo);
  return base.appliesTo.every(tool => tools.has(tool));
}

/** An enabled base's coverage is protected independently of severity rank. */
function isDowngrade(base: Rule, overlay: Rule): boolean {
  if (isEnabled(base) && !isEnabled(overlay)) return true;
  if (SEVERITY_RANK[overlay.severity] < SEVERITY_RANK[base.severity]) return true;
  if (isEnabled(base) && (!sameMatcher(base, overlay) || !retainsTools(base, overlay))) return true;
  return false;
}

export interface MergeWarning {
  ruleId: string;
  message: string;
}

export interface MergeResult {
  rules: Rule[];
  warnings: MergeWarning[];
}

/**
 * Merge layers in increasing precedence. Pass [builtin, user, project].
 * Returns the effective rule set plus any strictness warnings.
 */
export function mergeLayers(layers: Rule[][]): MergeResult {
  const effective = new Map<string, Rule>();
  const warnings: MergeWarning[] = [];

  for (const layer of layers) {
    for (const overlay of layer) {
      const base = effective.get(overlay.id);
      if (!base) {
        effective.set(overlay.id, overlay);
        continue;
      }
      if (isDowngrade(base, overlay) && overlay.allowDowngrade !== true) {
        warnings.push({
          ruleId: overlay.id,
          message: `overlay tried to weaken rule without allowDowngrade:true — keeping stricter effective rule`,
        });
        // Keep the stricter base; ignore the weakening overlay.
        continue;
      }
      // Overlay fields win over base; nested match is a complete RuleMatch.
      effective.set(overlay.id, { ...base, ...overlay });
    }
  }

  return { rules: [...effective.values()], warnings };
}
