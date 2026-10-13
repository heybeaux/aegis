import type { CompiledRule, ToolCall } from '../types.js';

/** Validate the cache against declared policy; never silently recompile an unadmitted rule. */
export function invalidCompiledMatcher(compiled: CompiledRule, call: ToolCall): boolean {
  const { rule, regex } = compiled;
  if (rule.enabled === false || !(rule.appliesTo.includes('*') || rule.appliesTo.includes(call.tool)) || rule.match.kind !== 'regex') return false;
  if (!(regex instanceof RegExp)) return true;
  try {
    const flags = rule.match.flags ?? '';
    if ([...flags].some(flag => !'imsu'.includes(flag)) || [...regex.flags].some(flag => !'imsu'.includes(flag))) return true;
    // RegExp.source escapes slash/newline/empty source and flags have canonical order.
    const declared = new RegExp(rule.match.pattern, flags);
    return declared.source !== regex.source || declared.flags !== regex.flags;
  } catch { return true; }
}

