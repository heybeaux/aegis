import { describe, expect, it } from 'vitest';
import { evaluate } from '@heybeaux/lattice-aegis';
import { REGRESSION_CASES } from '../src/corpus/regression.js';

describe('SwarmLab RT-13 runtime policy benchmark lift', () => {
  it('puts coordination hazards and safe controls in the Aegis regression floor', () => {
    const ids = REGRESSION_CASES.map((c) => c.id);
    expect(ids).toContain('reg.swarmlab.rt13.text-conflict-without-coordination');
    expect(ids).toContain('reg.swarmlab.rt13.stale-api-merge-without-queue');
    expect(ids).toContain('reg.swarmlab.rt13.duplicate-intent-without-ledger');
    expect(ids).toContain('reg.swarmlab.rt13.shared-invariant-without-semantic-review');
    expect(ids).toContain('reg.benign.rt13.clean-parallel-merge');
    expect(ids).toContain('reg.benign.rt13.stale-api-with-queue');
    expect(ids).toContain('reg.benign.rt13.shared-invariant-with-semantic-review');
    expect(ids).toContain('reg.benign.rt13.duplicate-intent-with-ledger');
  });

  it('asks on unsafe merge races without false-flagging the safe coordination controls', () => {
    const badIds = [
      'reg.swarmlab.rt13.text-conflict-without-coordination',
      'reg.swarmlab.rt13.stale-api-merge-without-queue',
      'reg.swarmlab.rt13.duplicate-intent-without-ledger',
      'reg.swarmlab.rt13.shared-invariant-without-semantic-review',
    ] as const;
    const goodIds = [
      'reg.benign.rt13.clean-parallel-merge',
      'reg.benign.rt13.stale-api-with-queue',
      'reg.benign.rt13.shared-invariant-with-semantic-review',
      'reg.benign.rt13.duplicate-intent-with-ledger',
    ] as const;

    for (const id of badIds) {
      const row = REGRESSION_CASES.find((c) => c.id === id)!;
      const result = evaluate(row.input, []);
      expect(result.action).toBe('ask');
      expect(result.matches.map((m) => m.id)).toContain(
        'swarmlab.rt13.risky-merges-require-coordination',
      );
    }

    for (const id of goodIds) {
      const row = REGRESSION_CASES.find((c) => c.id === id)!;
      const result = evaluate(row.input, []);
      expect(result.action).toBe('allow');
      expect(result.matches).toHaveLength(0);
    }
  });
});
