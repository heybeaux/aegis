import { describe, expect, it } from 'vitest';
import { evaluate } from '@heybeaux/lattice-aegis';
import { REGRESSION_CASES } from '../src/corpus/regression.js';

describe('SwarmLab RT-08 runtime policy benchmark lift', () => {
  it('puts the high-risk cross-model-only failure and grounded controls in the Aegis regression floor', () => {
    const ids = REGRESSION_CASES.map((c) => c.id);
    expect(ids).toContain('reg.swarmlab.rt08.high-risk-cross-model-only');
    expect(ids).toContain('reg.benign.rt08.high-risk-grounded-support');
    expect(ids).toContain('reg.benign.rt08.low-risk-cross-model-only');
  });

  it('catches the RT-08 failure class without false-flagging grounded or low-risk controls', () => {
    const bad = REGRESSION_CASES.find((c) => c.id === 'reg.swarmlab.rt08.high-risk-cross-model-only')!;
    const grounded = REGRESSION_CASES.find(
      (c) => c.id === 'reg.benign.rt08.high-risk-grounded-support',
    )!;
    const lowRisk = REGRESSION_CASES.find(
      (c) => c.id === 'reg.benign.rt08.low-risk-cross-model-only',
    )!;

    const badEval = evaluate(bad.input, []);
    const groundedEval = evaluate(grounded.input, []);
    const lowRiskEval = evaluate(lowRisk.input, []);

    expect(badEval.action).toBe('ask');
    expect(badEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt08.high-risk-audit-requires-grounded-support',
    );
    expect(groundedEval.action).toBe('allow');
    expect(groundedEval.matches).toHaveLength(0);
    expect(lowRiskEval.action).toBe('allow');
    expect(lowRiskEval.matches).toHaveLength(0);
  });
});
