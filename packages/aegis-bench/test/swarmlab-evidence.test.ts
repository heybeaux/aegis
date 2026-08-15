import { describe, expect, it } from 'vitest';
import {
  SWARMLAB_EVIDENCE_CASES,
  evaluateSwarmLabEvidence,
  swarmLabEvidenceToMarkdown,
  type SwarmLabEvidenceCase,
} from '../src/swarmlab-evidence.js';

describe('SwarmLab evidence gate', () => {
  it('passes when all stack mappings are landed with verified evidence', () => {
    const result = evaluateSwarmLabEvidence();
    expect(result.status).toBe('passed');
    expect(result.total).toBe(8);
    expect(result.passed).toBe(8);
    expect(result.failed).toBe(0);
    expect(result.partial).toBe(0);
    expect(result.pendingImplementation).toBe(0);
    expect(result.provisionalEvidence).toBe(0);

    const rt06 = result.cases.find((c) => c.id === 'RT-06');
    const rt06Source = SWARMLAB_EVIDENCE_CASES.find((c) => c.id === 'RT-06');
    expect(rt06?.status).toBe('passed');
    expect(rt06?.implementationStatus).toBe('landed');
    expect(rt06?.evidenceTier).toBe('verified');
    expect(rt06Source?.runIds).toEqual([
      'tf-msv0gfsa',
      'tf-msv0frlb',
      'tf-msv0fryh',
      'tf-msv0fsbq',
      'tf-msv0fsp2',
      'tf-msv0ft24',
    ]);
    expect(rt06Source?.implementationRefs).toContain(
      'lattice PR #42 merged at 1f21d06833f7842c02544029636debebaf3a88d7',
    );
    expect(rt06Source?.implementationRefs).toContain(
      'swarmlab PR #3 merged at f731e5388d447c7c1400bd1408a697af15225e15',
    );
    expect(rt06?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'maxCapableExcludedRate',
          after: 0.02,
          threshold: 0.02,
          comparator: 'lte',
          passed: true,
        }),
        expect.objectContaining({
          name: 'maxLateIncapableSelectionRate',
          after: 0.047,
          threshold: 0.05,
          comparator: 'lte',
          passed: true,
        }),
        expect.objectContaining({
          name: 'maxIncapableLeakRate',
          after: 0,
          threshold: 0,
          comparator: 'eq',
          passed: true,
        }),
        expect.objectContaining({
          name: 'minTransferAvoidRate',
          after: 1,
          threshold: 1,
          comparator: 'eq',
          passed: true,
        }),
      ]),
    );

    const rt08 = result.cases.find((c) => c.id === 'RT-08');
    const rt08Source = SWARMLAB_EVIDENCE_CASES.find((c) => c.id === 'RT-08');
    expect(rt08?.status).toBe('passed');
    expect(rt08?.implementationStatus).toBe('landed');
    expect(rt08?.evidenceTier).toBe('verified');
    expect(rt08Source?.runIds).toEqual(['gsv-mrc3huyf']);
    expect(rt08Source?.implementationRefs).toContain(
      'swarmlab exp-17 Aegis-wrapped retest gsv-mrc3huyf using file:/Users/beauxwalton/Dev/aegis/packages/aegis',
    );
    expect(rt08?.metrics.find((m) => m.name === 'highRiskAuditEscapeRate')?.before).toBe(0.188);
    expect(rt08?.metrics.find((m) => m.name === 'aegisGovernanceCostTax')?.after).toBe(0.106);
  });

  it('covers the currently proven stack failure classes', () => {
    const ids = SWARMLAB_EVIDENCE_CASES.map((c) => c.id);
    expect(ids).toEqual(['RT-01', 'RT-02', 'RT-03', 'RT-04', 'RT-05', 'RT-06', 'RT-07', 'RT-08']);

    const mappings = SWARMLAB_EVIDENCE_CASES.map((c) => c.aegisMapping).join('\n');
    expect(mappings).toContain('payload contract');
    expect(mappings).toContain('pinned criterion');
    expect(mappings).toContain('fidelity');
    expect(mappings).toContain('ground store');
    expect(mappings).toContain('persistent capability facts');
    expect(mappings).toContain('trust policies');
    expect(mappings).toContain('value-echo manifests');
    expect(mappings).toContain('verification-tier policy');
    expect(mappings).toContain('runtime policy');
  });

  it('renders a report banner matching the evaluated evidence range', () => {
    const markdown = swarmLabEvidenceToMarkdown(evaluateSwarmLabEvidence());
    expect(markdown).toContain('REPLAY-VERIFIED SWARMLAB RETESTS (RT-01..RT-08)');
    expect(markdown).not.toContain('RT-01..RT-07');
    expect(markdown).toContain('0 provisional evidence tier');
    expect(markdown).toContain('| RT-06 | passed | landed | verified |');
  });

  it('fails loudly when a proven metric regresses', () => {
    const mutated: SwarmLabEvidenceCase[] = SWARMLAB_EVIDENCE_CASES.map((c) =>
      c.id === 'RT-07'
        ? {
            ...c,
            metrics: c.metrics.map((m) =>
              m.name === 'deepSurvivalWithValueEcho' ? { ...m, after: 0.9 } : m,
            ),
          }
        : c,
    );

    const result = evaluateSwarmLabEvidence(mutated);
    expect(result.status).toBe('partial');
    const rt07 = result.cases.find((c) => c.id === 'RT-07');
    expect(rt07?.status).toBe('partial');
    expect(rt07?.failedMetrics).toEqual(['deepSurvivalWithValueEcho']);
  });

  it('keeps a landed case partial when the evidence tier still needs holdout confirmation', () => {
    const mutated: SwarmLabEvidenceCase[] = SWARMLAB_EVIDENCE_CASES.map((c) =>
      c.id === 'RT-06' ? { ...c, evidenceTier: 'in_sample' } : c,
    );

    const result = evaluateSwarmLabEvidence(mutated);
    const rt06 = result.cases.find((c) => c.id === 'RT-06');
    expect(rt06?.implementationStatus).toBe('landed');
    expect(rt06?.evidenceTier).toBe('in_sample');
    expect(rt06?.status).toBe('partial');
  });

  it('keeps a verified case partial until the stack mapping lands', () => {
    const mutated: SwarmLabEvidenceCase[] = SWARMLAB_EVIDENCE_CASES.map((c) =>
      c.id === 'RT-06'
        ? {
            ...c,
            implementationStatus: 'pending',
          }
        : c,
    );

    const result = evaluateSwarmLabEvidence(mutated);
    const rt06 = result.cases.find((c) => c.id === 'RT-06');
    expect(rt06?.implementationStatus).toBe('pending');
    expect(rt06?.evidenceTier).toBe('verified');
    expect(rt06?.status).toBe('partial');
    expect(result.pendingImplementation).toBe(1);
    expect(result.provisionalEvidence).toBe(0);
  });
});
