import { describe, expect, it } from 'vitest';
import { evaluate, loadPack, RulePackError } from '../src/index.js';
import type { Rule, RulePack, MatchTarget } from '../src/index.js';

const rule = (regex = false): Rule => ({
  id: 'policy.guard', category: 'bash', severity: 'critical', description: 'validated guard',
  match: { kind: regex ? 'regex' : 'substring', pattern: 'DANGER', target: 'command', ...(regex ? { flags: 'i' } : {}) },
  appliesTo: ['Bash'], enabled: true, references: ['CWE-77'],
});
const pack = (rules: Rule[]): RulePack => ({ packId: 'validation-snapshot', version: '1', rules });
const verdict = (compiled: ReturnType<typeof loadPack>) => evaluate({ tool: 'Bash', command: 'DANGER' }, compiled).action;
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

describe('loadPack validated value ownership — exp65', () => {
  const edits: Record<string, (r: Rule) => void> = {
    pattern: r => { r.match.pattern = 'NEVER'; },
    kind: r => { r.match.kind = 'substring'; r.match.pattern = 'NEVER'; },
    scope: r => { r.appliesTo.splice(0, 1, 'Other'); },
    target: r => { r.match.target = 'content'; },
    enabled: r => { r.enabled = false; },
    severity: r => { r.severity = 'low'; },
    id: r => { r.id = 'changed'; },
    metadata: r => { r.description = 'draft'; r.remediation = 'draft'; r.references!.push('draft'); },
    regex: r => { r.match.pattern = 'NEVER'; r.match.flags = 'm'; },
  };
  for (const [field, edit] of Object.entries(edits)) {
    it(`isolates producer ${field} edits after validation`, () => {
      const source = rule(field === 'kind' || field === 'regex'), compiled = loadPack(pack([source]));
      const before = structuredClone(compiled[0]!.rule), sourceBefore = structuredClone(source);
      expect(verdict(compiled)).toBe('deny');
      edit(source);
      expect(source).not.toEqual(sourceBefore);
      expect(compiled[0]!.rule).toEqual(before);
      expect(verdict(compiled)).toBe('deny');
      expect(Object.isFrozen(source)).toBe(false);
    });
  }
  it('never edits producer recipes during compilation or consumer mutations', () => {
    const source = rule(), before = structuredClone(source), compiled = loadPack(pack([source]));
    expect(source).toEqual(before);
    const result = compiled[0]!.rule;
    result.id = 'consumer'; result.enabled = false; result.match.pattern = 'NEVER';
    result.appliesTo.push('Other'); result.references!.push('consumer');
    expect(source).toEqual(before);
    expect(verdict(compiled)).toBe('allow');
  });
  it('isolates repeated loads and distinct rules sharing nested source containers', () => {
    const source = rule(), sibling = { ...source, id: 'policy.second' };
    const input = pack([source, sibling]), before = structuredClone(input);
    const first = loadPack(input), second = loadPack(input);
    first[0]!.rule.match.pattern = 'NEVER'; first[0]!.rule.appliesTo.splice(0, 1, 'Other');
    first[0]!.rule.references!.push('consumer');
    expect(first[1]!.rule).toEqual(before.rules[1]);
    expect(second.map(c => c.rule)).toEqual(before.rules);
    expect(input).toEqual(before);
    expect(verdict([first[1]!])).toBe('deny'); expect(verdict(second)).toBe('deny');
  });
  it('accepts frozen recipes without freezing compiled editable output', () => {
    const input = freeze(pack([rule()])), before = structuredClone(input), compiled = loadPack(input);
    compiled[0]!.rule.enabled = false; compiled[0]!.rule.match.pattern = 'NEVER';
    compiled[0]!.rule.appliesTo.push('Other'); compiled[0]!.rule.references!.push('consumer');
    expect(input).toEqual(before); expect(verdict(compiled)).toBe('allow');
  });
  it('requires explicit reload to incorporate recipe edits', () => {
    const source = rule(), input = pack([source]), old = loadPack(input);
    source.match.pattern = 'NEVER'; const next = loadPack(input);
    expect(verdict(old)).toBe('deny'); expect(verdict(next)).toBe('allow');
    old[0]!.rule.enabled = false;
    expect(verdict(old)).toBe('allow'); expect(source.enabled).toBe(true);
  });
  it('preserves regex compilation, stateless flags and positive/negative semantics', () => {
    const source = rule(true), compiled = loadPack(pack([source]));
    expect(compiled[0]!.regex!.flags).toBe('i');
    for (let i = 0; i < 3; i++) expect(evaluate({ tool: 'Bash', command: 'danger' }, compiled).action).toBe('deny');
    expect(evaluate({ tool: 'Bash', command: 'safe' }, compiled).action).toBe('allow');
    expect(source).toEqual(rule(true));
  });
  for (const target of ['command', 'content', 'path', 'argv'] as MatchTarget[]) {
    it(`retains ${target} matching and scope controls`, () => {
      const source = rule(); source.match.target = target;
      const compiled = loadPack(pack([source])), field = target === 'path' ? 'paths' : target;
      const call = { tool: 'Bash', [field]: target === 'path' || target === 'argv' ? ['safe', 'DANGER'] : 'DANGER' };
      expect(evaluate(call, compiled).action).toBe('deny');
      expect(evaluate({ ...call, tool: 'Other' }, compiled).action).toBe('allow');
      expect(evaluate({ tool: 'Bash', [field]: target === 'path' || target === 'argv' ? ['safe'] : 'safe' }, compiled).action).toBe('allow');
    });
  }
  it('preserves empty packs, order and optional-property shape', () => {
    expect(loadPack(pack([]))).toEqual([]);
    const a = rule(); delete a.references; const b = { ...rule(), id: '__proto__', references: undefined } as unknown as Rule;
    const out = loadPack(pack([a, b])); expect(out.map(c => c.rule.id)).toEqual(['policy.guard', '__proto__']);
    expect('references' in out[0]!.rule).toBe(false); expect('references' in out[1]!.rule).toBe(true);
    expect(out[1]!.rule.references).toBeUndefined();
  });
  it('preserves whole-pack rejection and diagnostics at the validation boundary', () => {
    expect(() => loadPack(pack([rule(), rule()]))).toThrow(/duplicate rule id/);
    const invalid = rule(true); invalid.match.flags = 'g'; expect(() => loadPack(pack([invalid]))).toThrow(/disallowed regex flag/);
    invalid.match.flags = 'i'; invalid.match.pattern = '['; expect(() => loadPack(pack([invalid]))).toThrow(/regex failed to compile/);
    const ast = rule(); ast.match.kind = 'ast'; expect(() => loadPack(pack([ast]))).toThrow(RulePackError);
    const missing = rule(); missing.match.pattern = ''; expect(() => loadPack(pack([missing]))).toThrow(/missing match.pattern/);
  });
});
