import { describe, expect, it } from 'vitest';
import { evaluate } from '@heybeaux/lattice-aegis';
import { REGRESSION_CASES } from '../src/corpus/regression.js';

describe('SwarmLab RT-10 runtime policy benchmark lift', () => {
  it('puts exact recall and private memory hazards into the Aegis regression floor', () => {
    const ids = REGRESSION_CASES.map((c) => c.id);
    expect(ids).toContain('reg.swarmlab.rt10.exact-summary-only-recall');
    expect(ids).toContain('reg.swarmlab.rt10.private-cross-scope-disclosure');
    expect(ids).toContain('reg.benign.rt10.ledger-cited-exact-recall');
    expect(ids).toContain('reg.benign.rt10.high-level-summary');
  });

  it('asks on unsupported exact recall and private leakage without false-flagging safe controls', () => {
    const badExact = REGRESSION_CASES.find((c) => c.id === 'reg.swarmlab.rt10.exact-summary-only-recall')!;
    const badPrivate = REGRESSION_CASES.find(
      (c) => c.id === 'reg.swarmlab.rt10.private-cross-scope-disclosure',
    )!;
    const goodExact = REGRESSION_CASES.find((c) => c.id === 'reg.benign.rt10.ledger-cited-exact-recall')!;
    const goodSummary = REGRESSION_CASES.find((c) => c.id === 'reg.benign.rt10.high-level-summary')!;

    const badExactEval = evaluate(badExact.input, []);
    const badPrivateEval = evaluate(badPrivate.input, []);
    const goodExactEval = evaluate(goodExact.input, []);
    const goodSummaryEval = evaluate(goodSummary.input, []);

    expect(badExactEval.action).toBe('ask');
    expect(badExactEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt10.exact-recall-requires-grounded-citation',
    );
    expect(badExactEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt10.exact-recall-requires-fresh-evidence',
    );
    expect(badPrivateEval.action).toBe('ask');
    expect(badPrivateEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt10.private-memory-cross-scope-disclosure',
    );
    expect(goodExactEval.action).toBe('allow');
    expect(goodExactEval.matches).toHaveLength(0);
    expect(goodSummaryEval.action).toBe('allow');
    expect(goodSummaryEval.matches).toHaveLength(0);
  });
});
