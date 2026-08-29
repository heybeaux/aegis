import { describe, expect, it } from 'vitest';
import { evaluate } from '@heybeaux/lattice-aegis';
import { REGRESSION_CASES } from '../src/corpus/regression.js';

describe('SwarmLab RT-11 runtime policy benchmark lift', () => {
  it('puts untrusted boundary spoofing hazards into the Aegis regression floor', () => {
    const ids = REGRESSION_CASES.map((c) => c.id);
    expect(ids).toContain('reg.swarmlab.rt11.untrusted-role-spoofed-secret-request');
    expect(ids).toContain('reg.swarmlab.rt11.fake-tool-output-completion-override');
    expect(ids).toContain('reg.benign.rt11.structured-untrusted-extraction');
    expect(ids).toContain('reg.benign.rt11.clean-untrusted-summary');
  });

  it('asks on raw untrusted authority-spoofed content without false-flagging safe controls', () => {
    const badSecret = REGRESSION_CASES.find(
      (c) => c.id === 'reg.swarmlab.rt11.untrusted-role-spoofed-secret-request',
    )!;
    const badDone = REGRESSION_CASES.find(
      (c) => c.id === 'reg.swarmlab.rt11.fake-tool-output-completion-override',
    )!;
    const goodStructured = REGRESSION_CASES.find(
      (c) => c.id === 'reg.benign.rt11.structured-untrusted-extraction',
    )!;
    const goodClean = REGRESSION_CASES.find(
      (c) => c.id === 'reg.benign.rt11.clean-untrusted-summary',
    )!;

    const badSecretEval = evaluate(badSecret.input, []);
    const badDoneEval = evaluate(badDone.input, []);
    const goodStructuredEval = evaluate(goodStructured.input, []);
    const goodCleanEval = evaluate(goodClean.input, []);

    expect(badSecretEval.action).toBe('ask');
    expect(badSecretEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt11.untrusted-boundaries-require-structured-extraction',
    );
    expect(badDoneEval.action).toBe('ask');
    expect(badDoneEval.matches.map((m) => m.id)).toContain(
      'swarmlab.rt11.untrusted-boundaries-require-structured-extraction',
    );
    expect(goodStructuredEval.action).toBe('allow');
    expect(goodStructuredEval.matches).toHaveLength(0);
    expect(goodCleanEval.action).toBe('allow');
    expect(goodCleanEval.matches).toHaveLength(0);
  });
});
