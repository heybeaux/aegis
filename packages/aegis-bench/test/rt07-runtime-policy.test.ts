import { describe, expect, it } from 'vitest';
import { evaluate } from '@heybeaux/lattice-aegis';
import { REGRESSION_CASES } from '../src/corpus/regression.js';

describe('SwarmLab RT-07 runtime policy benchmark lift', () => {
  it('puts deep presence-only handoffs and the value-echo control in the Aegis regression floor', () => {
    const ids = REGRESSION_CASES.map((c) => c.id);
    expect(ids).toContain('reg.swarmlab.rt07.deep-handoff-presence-only');
    expect(ids).toContain('reg.benign.rt07.deep-handoff-value-echo');
  });

  it('catches the RT-07 failure class without false-flagging the value-echo control', () => {
    const bad = REGRESSION_CASES.find((c) => c.id === 'reg.swarmlab.rt07.deep-handoff-presence-only')!;
    const good = REGRESSION_CASES.find((c) => c.id === 'reg.benign.rt07.deep-handoff-value-echo')!;

    const badEval = evaluate(bad.input, []);
    const goodEval = evaluate(good.input, []);

    expect(badEval.action).toBe('ask');
    expect(badEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt07.deep-handoff-requires-value-echo',
    );
    expect(goodEval.action).toBe('allow');
    expect(goodEval.matches).toHaveLength(0);
  });
});
