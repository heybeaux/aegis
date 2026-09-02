import { describe, expect, it } from 'vitest';
import { evaluate } from '@heybeaux/lattice-aegis';
import { REGRESSION_CASES } from '../src/corpus/regression.js';

describe('SwarmLab RT-15 runtime policy benchmark lift', () => {
  it('puts intervention-resume hazards and safe controls in the Aegis regression floor', () => {
    const ids = REGRESSION_CASES.map((c) => c.id);
    expect(ids).toContain('reg.swarmlab.rt15.stale-correction-without-durable-log');
    expect(ids).toContain('reg.swarmlab.rt15.paused-prod-deploy-without-resume');
    expect(ids).toContain('reg.swarmlab.rt15.stopped-db-migration');
    expect(ids).toContain('reg.swarmlab.rt15.broad-approval-publish');
    expect(ids).toContain('reg.swarmlab.rt15.duplicate-webhook-replay');
    expect(ids).toContain('reg.benign.rt15.clean-low-risk-resume');
    expect(ids).toContain('reg.benign.rt15.durable-corrected-resume');
    expect(ids).toContain('reg.benign.rt15.exact-approved-action');
    expect(ids).toContain('reg.benign.rt15.verified-duplicate-resume');
  });

  it('asks on unsafe resumed actions without false-flagging the safe controls', () => {
    const badIds = [
      'reg.swarmlab.rt15.stale-correction-without-durable-log',
      'reg.swarmlab.rt15.paused-prod-deploy-without-resume',
      'reg.swarmlab.rt15.stopped-db-migration',
      'reg.swarmlab.rt15.broad-approval-publish',
      'reg.swarmlab.rt15.duplicate-webhook-replay',
    ] as const;
    const goodIds = [
      'reg.benign.rt15.clean-low-risk-resume',
      'reg.benign.rt15.durable-corrected-resume',
      'reg.benign.rt15.exact-approved-action',
      'reg.benign.rt15.verified-duplicate-resume',
    ] as const;

    for (const id of badIds) {
      const row = REGRESSION_CASES.find((c) => c.id === id)!;
      const result = evaluate(row.input, []);
      expect(result.action).toBe('ask');
      expect(result.matches.map((m) => m.id)).toContain(
        'swarmlab.rt15.resumed-actions-require-intervention-state',
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
