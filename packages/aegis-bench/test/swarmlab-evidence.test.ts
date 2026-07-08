import { describe, expect, it } from 'vitest';
import {
  SWARMLAB_EVIDENCE_CASES,
  evaluateSwarmLabEvidence,
  swarmLabEvidenceToMarkdown,
  type SwarmLabEvidenceCase,
} from '../src/swarmlab-evidence.js';

describe('SwarmLab evidence gate', () => {
  it('surfaces pending stack mappings without overstating verified coverage', () => {
    const result = evaluateSwarmLabEvidence();
    expect(result.status).toBe('partial');
    expect(result.total).toBe(8);
    expect(result.passed).toBe(6);
    expect(result.failed).toBe(0);
    expect(result.partial).toBe(2);
    expect(result.pendingImplementation).toBe(2);

    const rt06 = result.cases.find((c) => c.id === 'RT-06');
    expect(rt06?.status).toBe('partial');
    expect(rt06?.implementationStatus).toBe('pending');

    const rt08 = result.cases.find((c) => c.id === 'RT-08');
    expect(rt08?.status).toBe('partial');
    expect(rt08?.implementationStatus).toBe('pending');
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
  });

  it('renders a report banner matching the evaluated evidence range', () => {
    const markdown = swarmLabEvidenceToMarkdown(evaluateSwarmLabEvidence());
    expect(markdown).toContain('REPLAY-VERIFIED SWARMLAB RETESTS (RT-01..RT-08)');
    expect(markdown).not.toContain('RT-01..RT-07');
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
});
