import { describe, expect, it } from 'vitest';
import { evaluate } from '@heybeaux/lattice-aegis';
import { REGRESSION_CASES } from '../src/corpus/regression.js';

describe('SwarmLab RT-12 runtime policy benchmark lift', () => {
  it('puts fact-lifecycle stale-trust hazards into the Aegis regression floor', () => {
    const ids = REGRESSION_CASES.map((c) => c.id);
    expect(ids).toContain('reg.swarmlab.rt12.superseded-supported-fact');
    expect(ids).toContain('reg.swarmlab.rt12.revalidation-needed-fact');
    expect(ids).toContain('reg.swarmlab.rt12.recovered-fact-stale-revocation');
    expect(ids).toContain('reg.benign.rt12.current-supported-fact');
  });

  it('asks on superseded or revalidation-needed facts without false-flagging current supported facts', () => {
    const badSuperseded = REGRESSION_CASES.find(
      (c) => c.id === 'reg.swarmlab.rt12.superseded-supported-fact',
    )!;
    const badRevalidation = REGRESSION_CASES.find(
      (c) => c.id === 'reg.swarmlab.rt12.revalidation-needed-fact',
    )!;
    const badRecovered = REGRESSION_CASES.find(
      (c) => c.id === 'reg.swarmlab.rt12.recovered-fact-stale-revocation',
    )!;
    const goodStable = REGRESSION_CASES.find(
      (c) => c.id === 'reg.benign.rt12.current-supported-fact',
    )!;

    const badSupersededEval = evaluate(badSuperseded.input, []);
    const badRevalidationEval = evaluate(badRevalidation.input, []);
    const badRecoveredEval = evaluate(badRecovered.input, []);
    const goodStableEval = evaluate(goodStable.input, []);

    expect(badSupersededEval.action).toBe('ask');
    expect(badSupersededEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt12.superseded-facts-require-lifecycle-refresh',
    );
    expect(badRevalidationEval.action).toBe('ask');
    expect(badRevalidationEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt12.superseded-facts-require-lifecycle-refresh',
    );
    expect(badRecoveredEval.action).toBe('ask');
    expect(badRecoveredEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt12.superseded-facts-require-lifecycle-refresh',
    );
    expect(goodStableEval.action).toBe('allow');
    expect(goodStableEval.matches).toHaveLength(0);
  });
});
