import { describe, expect, it } from 'vitest';
import { evaluate } from '@heybeaux/lattice-aegis';
import { REGRESSION_CASES } from '../src/corpus/regression.js';

describe('SwarmLab RT-16 runtime policy benchmark lift', () => {
  it('puts partial-success workflow-resume hazards and safe controls in the Aegis regression floor', () => {
    const ids = REGRESSION_CASES.map((c) => c.id);
    expect(ids).toContain('reg.swarmlab.rt16.completed-step-replay');
    expect(ids).toContain('reg.swarmlab.rt16.revoked-rollout-step');
    expect(ids).toContain('reg.swarmlab.rt16.wrong-artifact-instance');
    expect(ids).toContain('reg.swarmlab.rt16.unverified-remaining-step');
    expect(ids).toContain('reg.benign.rt16.clean-safe-remaining-step');
    expect(ids).toContain('reg.benign.rt16.verified-step-instance');
  });

  it('asks on unsafe partial-success resumes without false-flagging the safe controls', () => {
    const badIds = [
      'reg.swarmlab.rt16.completed-step-replay',
      'reg.swarmlab.rt16.revoked-rollout-step',
      'reg.swarmlab.rt16.wrong-artifact-instance',
      'reg.swarmlab.rt16.unverified-remaining-step',
    ] as const;
    const goodIds = [
      'reg.benign.rt16.clean-safe-remaining-step',
      'reg.benign.rt16.verified-step-instance',
    ] as const;

    for (const id of badIds) {
      const row = REGRESSION_CASES.find((c) => c.id === id)!;
      const result = evaluate(row.input, []);
      expect(result.action).toBe('ask');
      expect(result.matches.map((m) => m.id)).toContain(
        'swarmlab.rt16.partial-success-resumes-require-step-integrity',
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
