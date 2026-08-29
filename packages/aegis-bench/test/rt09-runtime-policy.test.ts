import { describe, expect, it } from 'vitest';
import { evaluate } from '@heybeaux/lattice-aegis';
import { REGRESSION_CASES } from '../src/corpus/regression.js';

describe('SwarmLab RT-09 runtime policy benchmark lift', () => {
  it('puts the receipt-honesty failure and safe controls in the Aegis regression floor', () => {
    const ids = REGRESSION_CASES.map((c) => c.id);
    expect(ids).toContain('reg.swarmlab.rt09.done-without-desired-state-receipt');
    expect(ids).toContain('reg.swarmlab.rt09.retry-without-idempotency');
    expect(ids).toContain('reg.benign.rt09.verified-done');
    expect(ids).toContain('reg.benign.rt09.retry-with-idempotency');
  });

  it('asks on insufficient completion receipts and unsafe retries without false-flagging safe controls', () => {
    const badDone = REGRESSION_CASES.find(
      (c) => c.id === 'reg.swarmlab.rt09.done-without-desired-state-receipt',
    )!;
    const badRetry = REGRESSION_CASES.find(
      (c) => c.id === 'reg.swarmlab.rt09.retry-without-idempotency',
    )!;
    const goodDone = REGRESSION_CASES.find((c) => c.id === 'reg.benign.rt09.verified-done')!;
    const goodRetry = REGRESSION_CASES.find(
      (c) => c.id === 'reg.benign.rt09.retry-with-idempotency',
    )!;

    const badDoneEval = evaluate(badDone.input, []);
    const badRetryEval = evaluate(badRetry.input, []);
    const goodDoneEval = evaluate(goodDone.input, []);
    const goodRetryEval = evaluate(goodRetry.input, []);

    expect(badDoneEval.action).toBe('ask');
    expect(badDoneEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt09.completion-claims-require-desired-state-receipts',
    );
    expect(badRetryEval.action).toBe('ask');
    expect(badRetryEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt09.ambiguous-external-retries-require-idempotency',
    );
    expect(goodDoneEval.action).toBe('allow');
    expect(goodDoneEval.matches).toHaveLength(0);
    expect(goodRetryEval.action).toBe('allow');
    expect(goodRetryEval.matches).toHaveLength(0);
  });
});
