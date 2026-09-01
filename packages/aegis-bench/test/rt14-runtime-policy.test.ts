import { describe, expect, it } from 'vitest';
import { evaluate } from '@heybeaux/lattice-aegis';
import { REGRESSION_CASES } from '../src/corpus/regression.js';

describe('SwarmLab RT-14 runtime policy benchmark lift', () => {
  it('puts panel-independence hazards and safe controls in the Aegis regression floor', () => {
    const ids = REGRESSION_CASES.map((c) => c.id);
    expect(ids).toContain('reg.swarmlab.rt14.cross-provider-unpinned-criterion');
    expect(ids).toContain('reg.swarmlab.rt14.shared-premise-without-independent-check');
    expect(ids).toContain('reg.swarmlab.rt14.single-source-without-specialist');
    expect(ids).toContain('reg.benign.rt14.clean-independent-panel');
    expect(ids).toContain('reg.benign.rt14.shared-premise-with-adversarial');
    expect(ids).toContain('reg.benign.rt14.single-source-with-specialist');
  });

  it('asks on correlated high-risk panel certifications without false-flagging independent controls', () => {
    const badIds = [
      'reg.swarmlab.rt14.cross-provider-unpinned-criterion',
      'reg.swarmlab.rt14.shared-premise-without-independent-check',
      'reg.swarmlab.rt14.single-source-without-specialist',
    ] as const;
    const goodIds = [
      'reg.benign.rt14.clean-independent-panel',
      'reg.benign.rt14.shared-premise-with-adversarial',
      'reg.benign.rt14.single-source-with-specialist',
    ] as const;

    for (const id of badIds) {
      const row = REGRESSION_CASES.find((c) => c.id === id)!;
      const result = evaluate(row.input, []);
      expect(result.action).toBe('ask');
      expect(result.matches.map((m) => m.id)).toContain(
        'swarmlab.rt14.panel-certification-requires-independent-checks',
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
