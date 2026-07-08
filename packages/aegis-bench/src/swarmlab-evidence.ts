/**
 * SwarmLab evidence gate.
 *
 * This is the first Aegis harnessization layer for completed SwarmLab retests: it turns
 * replay-verified lab findings into a deterministic release gate. It is deliberately NOT a
 * predictor and does not claim live learning. Predictors can use these rows later as benchmark
 * axes/features; today they give the harness a concrete "do not regress the proven fixes" check.
 */

export type StackProject = 'sonder' | 'aop' | 'parliament' | 'engram' | 'lattice' | 'aegis';

export type EvidenceStatus = 'passed' | 'failed' | 'partial';
export type ImplementationStatus = 'landed' | 'pending';

export type Comparator = 'lte' | 'gte' | 'eq';

export interface EvidenceMetric {
  /** Stable metric key from the SwarmLab retest/readme table. */
  name: string;
  /** Baseline value before the stack fix, when available. */
  before?: number;
  /** Measured value after the real package was linked into the retest. */
  after: number;
  /** Release gate threshold. */
  threshold: number;
  /** Comparison applied to `after` and `threshold`. */
  comparator: Comparator;
  /** Human unit for reports. */
  unit?: string;
}

export interface SwarmLabEvidenceCase {
  /** Retest ledger id in SwarmLab SYNTHESIS.md. */
  id: string;
  /** Source experiment/spec. */
  source: string;
  /** Short stack-facing finding. */
  finding: string;
  /** Project(s) whose releases should carry this as a regression gate. */
  owners: StackProject[];
  /** Production change proven by the retest. */
  change: string;
  /** SwarmLab run ids / proof handles. */
  runIds: string[];
  /** Commit/PR/source reference for the real stack patch, when known. */
  implementationRefs: string[];
  /** Whether the stack-facing patch is landed yet or still only a recommendation. */
  implementationStatus?: ImplementationStatus;
  /** What this becomes inside Aegis. */
  aegisMapping: string;
  /** Metrics that must remain green for the evidence case to pass. */
  metrics: EvidenceMetric[];
}

export interface EvidenceMetricResult extends EvidenceMetric {
  passed: boolean;
}

export interface EvidenceCaseResult {
  id: string;
  status: EvidenceStatus;
  owners: StackProject[];
  source: string;
  finding: string;
  implementationStatus: ImplementationStatus;
  aegisMapping: string;
  failedMetrics: string[];
  metrics: EvidenceMetricResult[];
}

export interface EvidenceGateResult {
  status: EvidenceStatus;
  total: number;
  passed: number;
  failed: number;
  partial: number;
  pendingImplementation: number;
  cases: EvidenceCaseResult[];
}

function compare(after: number, threshold: number, comparator: Comparator): boolean {
  switch (comparator) {
    case 'lte':
      return after <= threshold;
    case 'gte':
      return after >= threshold;
    case 'eq':
      return Object.is(after, threshold);
  }
}

function caseStatus(metrics: readonly EvidenceMetricResult[]): EvidenceStatus {
  const passed = metrics.filter((m) => m.passed).length;
  if (passed === metrics.length) return 'passed';
  if (passed === 0) return 'failed';
  return 'partial';
}

/**
 * Completed SwarmLab retests that already proved stack changes against real packages.
 *
 * Sources:
 * - /Users/beauxwalton/projects/swarmlab/SYNTHESIS.md RT-01..RT-08
 * - /Users/beauxwalton/projects/swarmlab/docs/STACK-LIFECYCLE.md current priority list
 */
export const SWARMLAB_EVIDENCE_CASES: readonly SwarmLabEvidenceCase[] = [
  {
    id: 'RT-01',
    source: 'exp-12 schema negotiation + exp-11 reverse engineer',
    finding: 'Wire-name agreement is not semantic agreement; concept+unit must travel explicitly.',
    owners: ['sonder', 'aop', 'aegis'],
    change: 'Typed payload contracts; match fields by concept+unit, wire names advisory.',
    runIds: ['exp-12 retest via real @heybeaux/sonder-core'],
    implementationRefs: ['sonder#10', 'aop#1', 'sonder commit 4c7dddf'],
    aegisMapping: 'release gate: semantic payload crossing an agent/project boundary must carry a payload contract',
    metrics: [
      { name: 'falseFriendMissRate', before: 0.908, after: 0, threshold: 0, comparator: 'eq' },
      { name: 'worstCellSilentCorruption', before: 0.845, after: 0, threshold: 0, comparator: 'eq' },
      { name: 'corruptEscapes', before: 960, after: 0, threshold: 0, comparator: 'eq' },
    ],
  },
  {
    id: 'RT-02',
    source: 'exp-04 consensus under lies',
    finding: 'Criterion drift can capture a vote without anyone stating a false fact.',
    owners: ['parliament', 'lattice', 'aegis'],
    change: 'Pinned decision criterion plus evidence audit; drift is named rather than certified.',
    runIds: ['cul-parl-mr7ty33i'],
    implementationRefs: ['parliament#97', 'parliament commits 1562a1f + 4436f89'],
    aegisMapping: 'release gate: certified deliberation must include a pinned criterion id and drift audit',
    metrics: [
      { name: 'k3SilentCaptureRate', before: 1, after: 0, threshold: 0, comparator: 'eq' },
      { name: 'cleanPanelTax', after: 0, threshold: 0, comparator: 'eq' },
      { name: 'driftNamedWhenPresent', after: 1, threshold: 1, comparator: 'eq' },
    ],
  },
  {
    id: 'RT-03',
    source: 'exp-08 rumor mill',
    finding: 'Coverage can outrun truth; memory needs versioned facts and anti-entropy, not first-write-wins.',
    owners: ['engram', 'aegis'],
    change: 'Versioned facts with content digests and anti-entropy reconciliation.',
    runIds: ['exp-08 versioned-facts retest'],
    implementationRefs: ['engram#323', 'engram commits baf3d05+'],
    aegisMapping: 'release gate: memory fixes must score fidelity, not just propagation/coverage',
    metrics: [
      { name: 'coverageOutrunsTruthCells', before: 19, after: 0, threshold: 0, comparator: 'eq' },
      { name: 'worstFidelity', before: 0.574, after: 1, threshold: 1, comparator: 'gte' },
      { name: 'telephoneGradient', before: 0.113, after: 0, threshold: 0, comparator: 'eq' },
    ],
  },
  {
    id: 'RT-04',
    source: 'exp-04 adapted fabrication attack',
    finding: 'Pinned criteria do not stop on-standard fabricated claims unless evidence is fact-checked.',
    owners: ['parliament', 'engram', 'aegis'],
    change: 'Fact-checked evidence audit with a FactStore; fabricated claims are named.',
    runIds: ['exp-04 fact-check adapted retest'],
    implementationRefs: ['parliament#98', 'parliament commit 218faf1'],
    aegisMapping: 'release gate: certified evidence must be checked against a ground store/provenance tier',
    metrics: [
      { name: 'silentLieCaptureRate', before: 1, after: 0, threshold: 0, comparator: 'eq' },
      { name: 'fabricationNamedRate', after: 1, threshold: 1, comparator: 'eq' },
      { name: 'cleanPanelTruthRate', after: 1, threshold: 1, comparator: 'gte' },
    ],
  },
  {
    id: 'RT-05',
    source: 'exp-14 delegation decay / trust routing',
    finding: 'Capability trust belongs in persistent memory; context-only agents re-delegate to incapable workers forever.',
    owners: ['engram', 'lattice', 'aegis'],
    change: 'Engram-backed capability observations transfer across resets and roots.',
    runIds: ['dd-b-mr7zvbuu', 'dd-llm-mr8042v5'],
    implementationRefs: ['engram reconciliation file: dependency from PR #323'],
    aegisMapping: 'release gate: trust routing must use persistent capability facts with reset/transfer checks',
    metrics: [
      { name: 'lateIncapableSelectionRate', after: 0, threshold: 0, comparator: 'eq' },
      { name: 'postResetIncapableSelectionRate', after: 0, threshold: 0, comparator: 'eq' },
      { name: 'transferAvoidRate', after: 1, threshold: 1, comparator: 'eq' },
    ],
  },
  {
    id: 'RT-06',
    source: 'exp-15 trust forgiveness',
    finding: 'Unforgiving trust benches capable workers; naive time decay re-admits incapable ones.',
    owners: ['lattice', 'engram', 'aegis'],
    change: 'Evidence-capped probation: retry only while failures-successes stays inside a bounded evidence cap.',
    runIds: ['exp-15 evidence-capped probation retest'],
    implementationRefs: ['swarmlab exp-15; policy recommendation pending stack owner patch'],
    implementationStatus: 'pending',
    aegisMapping: 'release gate: trust policies must recover capable workers without reopening incapable-worker leakage',
    metrics: [
      { name: 'capableExcludedRate', after: 0, threshold: 0, comparator: 'eq' },
      { name: 'incapableSelectionRate', after: 0, threshold: 0.05, comparator: 'lte' },
      { name: 'transferRegressionRate', after: 0, threshold: 0, comparator: 'eq' },
    ],
  },
  {
    id: 'RT-07',
    source: 'exp-16 handoff requirement guards',
    finding: 'Presence manifests catch absence but not meaning; deep delegation needs value echo.',
    owners: ['sonder', 'aop', 'lattice', 'aegis'],
    change: 'Value-echo requirement manifest for handoffs at delegation depth >= 2.',
    runIds: ['hg-mr853iu8', 'hg-llm-mr85fdgv'],
    implementationRefs: ['swarmlab exp-16', 'aegis runtime policy swarmlab.rt07.deep-handoff-requires-value-echo'],
    aegisMapping: 'runtime policy + release gate: deep delegation handoffs require value-echo manifests, not presence-only ids',
    metrics: [
      { name: 'deepSurvivalWithValueEcho', before: 0.390, after: 1, threshold: 1, comparator: 'eq' },
      { name: 'valueEchoReinterpretRecovery', after: 1, threshold: 1, comparator: 'eq' },
      { name: 'falseFlagRate', after: 0, threshold: 0, comparator: 'eq' },
    ],
  },
  {
    id: 'RT-08',
    source: 'exp-17 ground-store verification tiers',
    finding: 'Evidence is not a boolean; high-risk audits cannot trust cross-model-only support.',
    owners: ['engram', 'parliament', 'aegis'],
    change:
      'Verification envelopes carry support tier/freshness, and high-risk audits refuse cross-model-only facts.',
    runIds: ['gsv-mr9bvkkk'],
    implementationRefs: ['swarmlab exp-17; schema/policy recommendation pending stack owner patch'],
    implementationStatus: 'pending',
    aegisMapping:
      'release gate honesty: verification-tier policy must distinguish provenance/retrieval support from cross-model-only agreement',
    metrics: [
      { name: 'operationalFalseSupportRate', after: 0, threshold: 0, comparator: 'eq' },
      { name: 'staleSupportRate', after: 0, threshold: 0, comparator: 'eq' },
      { name: 'highRiskAuditEscapeRate', after: 0.063, threshold: 0.063, comparator: 'lte' },
    ],
  },
];

export function evaluateSwarmLabEvidence(
  cases: readonly SwarmLabEvidenceCase[] = SWARMLAB_EVIDENCE_CASES,
): EvidenceGateResult {
  const results: EvidenceCaseResult[] = cases.map((c) => {
    const implementationStatus = c.implementationStatus ?? 'landed';
    const metrics = c.metrics.map((m) => ({
      ...m,
      passed: compare(m.after, m.threshold, m.comparator),
    }));
    const metricStatus = caseStatus(metrics);
    const status = implementationStatus === 'pending' && metricStatus === 'passed' ? 'partial' : metricStatus;
    return {
      id: c.id,
      status,
      owners: [...c.owners],
      source: c.source,
      finding: c.finding,
      implementationStatus,
      aegisMapping: c.aegisMapping,
      failedMetrics: metrics.filter((m) => !m.passed).map((m) => m.name),
      metrics,
    };
  });

  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const partial = results.filter((r) => r.status === 'partial').length;
  const pendingImplementation = results.filter((r) => r.implementationStatus === 'pending').length;
  return {
    status: failed === 0 && partial === 0 ? 'passed' : failed > 0 ? 'failed' : 'partial',
    total: results.length,
    passed,
    failed,
    partial,
    pendingImplementation,
    cases: results,
  };
}


function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmt(n: number, unit?: string): string {
  const value = Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return unit ? `${value}${unit}` : value;
}

export function swarmLabEvidenceToMarkdown(result: EvidenceGateResult): string {
  const lines: string[] = [];
  const firstCaseId = result.cases.at(0)?.id ?? 'none';
  const lastCaseId = result.cases.at(-1)?.id ?? 'none';
  const caseRange = firstCaseId === lastCaseId ? firstCaseId : `${firstCaseId}..${lastCaseId}`;

  lines.push('# Aegis SwarmLab Evidence Gate');
  lines.push('');
  lines.push(`> DATA: REPLAY-VERIFIED SWARMLAB RETESTS (${caseRange})`);
  lines.push('> predictor: NONE — deterministic release gate, not a learned model');
  lines.push('');
  lines.push(
    `Status: **${result.status.toUpperCase()}** · ${result.passed}/${result.total} passed · ` +
      `${result.partial} partial · ${result.failed} failed · ` +
      `${result.pendingImplementation} pending implementation`,
  );
  lines.push('');
  lines.push('## Case summary');
  lines.push('');
  lines.push('| id | status | impl | owners | source | release-gate mapping |');
  lines.push('|---|---|---|---|---|---|');
  for (const c of result.cases) {
    lines.push(
      `| ${c.id} | ${c.status} | ${c.implementationStatus} | ${c.owners.join(', ')} | ${c.source} | ${c.aegisMapping} |`,
    );
  }
  lines.push('');
  lines.push('## Metric checks');
  lines.push('');
  for (const c of result.cases) {
    lines.push(`### ${c.id} — ${c.finding}`);
    lines.push('');
    lines.push('| metric | before | after | gate | result |');
    lines.push('|---|---:|---:|---:|---|');
    for (const m of c.metrics) {
      const before = m.before === undefined ? '—' : fmt(m.before, m.unit);
      const cmp = m.comparator === 'eq' ? '=' : m.comparator === 'gte' ? '>=' : '<=';
      lines.push(
        `| ${m.name} | ${before} | ${fmt(m.after, m.unit)} | ${cmp} ${fmt(m.threshold, m.unit)} | ` +
          `${m.passed ? 'PASS' : 'FAIL'} |`,
      );
    }
    if (c.failedMetrics.length > 0) {
      lines.push('');
      lines.push(`Failed metrics: ${c.failedMetrics.join(', ')}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(`_Gate pass rate: ${pct(result.total === 0 ? 0 : result.passed / result.total)}._`);
  lines.push('');
  return lines.join('\n');
}
