#!/usr/bin/env node
/**
 * observer — Aegis benchmark observation agent.
 *
 * Analyzes the latest benchmark dataset + bench score JSON, classifies failure
 * patterns, and proposes (or applies) targeted harness improvements.
 *
 * Steps:
 *   1. Locate dataset.jsonl + bench score JSON (auto-discover or --dataset / --score)
 *   2. Load raw bench-run decisions.jsonl + outcomes.jsonl if available (--bench-dir)
 *   3. Classify failure patterns into clusters with evidence
 *   4. Compute precision/recall delta analysis
 *   5. Emit structured report: proposals.json + report.md
 *   6. With --apply: safely apply well-scoped changes (new test problems)
 *
 * Usage:
 *   npx tsx tools/observer.ts [options]
 *
 * Options:
 *   --dataset <path>    Path to dataset.jsonl (default: auto-discover latest)
 *   --score <path>      Path to bench score JSON (default: auto-discover latest)
 *   --bench-dir <path>  Path to bench run dir with decisions + outcomes
 *   --out-dir <path>    Output directory for proposals (default: ~/.aegis/observer-<timestamp>)
 *   --apply             Apply safe proposals (adds new test problems to model-driver)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const RESULTS_DIR = join(repoRoot, 'packages/aegis-bench/results');

// ── CLI arg parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};
const hasFlag = (flag: string): boolean => args.includes(flag);

const APPLY_MODE = hasFlag('--apply');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = getArg('--out-dir') ?? join(homedir(), `.aegis/observer-${TIMESTAMP}`);

// ── Types ────────────────────────────────────────────────────────────────────

interface DatasetRow {
  features: {
    decisionEventId: string;
    signalDate: string;
    tool: string;
    ruleSeverityMax: string;
    ruleCategoriesHit: string[];
    ruleIdsHit: string[];
    cmdLength: number;
    combinatorCount: number;
    pathsTouched: number;
    writesVsReads: string;
    touchesGit: boolean;
    touchesSystemDir: boolean;
    newFile: boolean;
    agentId: string;
    taskDepth: number;
    priorFailuresThisSession: number;
    sessionHealthRegime: string;
    rollbackProximity: number;
    histFailRate_toolPath: number;
    secsSinceLastFailHere: number | null;
    engramPriorN: number;
  };
  action_failed: 0 | 1 | null;
  labelReason: string | null;
  labelConfidence: string | null;
  decisionEventId: string;
  signalDate: string;
  dataSource: string;
  schemaVersion: number;
  model?: string;
}

interface BenchDecision {
  timestamp: string;
  decisionId: string;
  toolUseId: string;
  tool: string;
  action: string;
  ruleSeverityMax: string;
  ruleCategoriesHit: string[];
  ruleIdsHit: string[];
  cmdLength: number;
  model?: string;
  command?: string;
}

interface BenchOutcome {
  timestamp: string;
  tool: string;
  toolUseId: string;
  isError: boolean;
  error?: string;
  model?: string;
}

interface ScoreJson {
  dataSource: string;
  datasetPath: string;
  totalRows: number;
  scoredRows: number;
  actualFailures: number;
  engines: Array<{
    engine: string;
    tp: number;
    fp: number;
    fn: number;
    tn: number;
    precision: number;
    recall: number;
    f1: number;
    accuracy: number;
  }>;
  recallLift: number;
  extraFailuresCaught: number;
}

interface FailureCluster {
  id: string;
  label: string;
  count: number;
  evidence: string[];
  proposedFixes: ProposedFix[];
}

interface ProposedFix {
  type: 'new_rule' | 'new_problem' | 'driver_tweak' | 'coverage_gap';
  description: string;
  rationale: string;
  riskLevel: 'safe' | 'moderate' | 'destructive';
  /** Only present for type=new_problem; can be applied by --apply */
  problemDef?: BenchProblemDef;
}

interface BenchProblemDef {
  name: string;
  ask: string;
  tests: string;
  toolCall: { tool: string; command?: string; paths?: string[] };
  skipExec?: boolean;
}

interface ObserverReport {
  generatedAt: string;
  datasetPath: string;
  scorePath: string;
  benchRunDir: string | null;
  totalRows: number;
  failureRows: number;
  precisionRecallSummary: ScoreJson['engines'];
  failureClusters: FailureCluster[];
  coverageGaps: string[];
  proposalCount: number;
  safeProposalCount: number;
  applyMode: boolean;
  appliedChanges: string[];
}

// ── Discovery helpers ────────────────────────────────────────────────────────

function discoverLatestDataset(): string {
  const files = readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.dataset.jsonl'))
    .sort();
  if (files.length === 0) throw new Error(`No dataset.jsonl files found in ${RESULTS_DIR}`);
  return join(RESULTS_DIR, files[files.length - 1]!);
}

function discoverLatestScore(datasetPath: string): string {
  const base = basename(datasetPath).replace('.dataset.jsonl', '.json');
  const candidate = join(RESULTS_DIR, base);
  if (existsSync(candidate)) return candidate;
  // Fallback: latest JSON
  const files = readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json') && !f.endsWith('.dataset.jsonl'))
    .sort();
  if (files.length === 0) throw new Error(`No score JSON found in ${RESULTS_DIR}`);
  return join(RESULTS_DIR, files[files.length - 1]!);
}

function discoverLatestBenchDir(): string | null {
  const aegisDir = join(homedir(), '.aegis');
  if (!existsSync(aegisDir)) return null;
  const dirs = readdirSync(aegisDir)
    .filter(d => d.startsWith('bench-'))
    .sort();
  if (dirs.length === 0) return null;
  return join(aegisDir, dirs[dirs.length - 1]!);
}

// ── Data loading ─────────────────────────────────────────────────────────────

function loadDataset(path: string): DatasetRow[] {
  const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim());
  return lines.map(l => JSON.parse(l) as DatasetRow);
}

function loadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim());
  return lines.map(l => JSON.parse(l) as T);
}

function loadScore(path: string): ScoreJson {
  return JSON.parse(readFileSync(path, 'utf-8')) as ScoreJson;
}

// ── Failure classification ───────────────────────────────────────────────────

interface JoinedRow {
  decision: BenchDecision | null;
  outcome: BenchOutcome | null;
  datasetRow: DatasetRow | null;
  problemName: string | null;
  failed: boolean;
  errorMsg: string | null;
  gatedAction: string | null;
}

function extractProblemName(toolUseId: string): string | null {
  // toolUseId format: "bench_<problem_name>_<hex>"
  const m = toolUseId.match(/^bench_(.+)_[0-9a-f]{6}$/);
  return m ? m[1]! : null;
}

function classifyError(errorMsg: string): string {
  if (!errorMsg) return 'unknown';
  if (errorMsg.includes('NameError') || errorMsg.includes('is not defined'))
    return 'hallucinated_api';
  if (errorMsg.includes('KeyError')) return 'data_structure_error';
  if (errorMsg.includes('SyntaxError')) return 'syntax_error';
  if (errorMsg.includes('AssertionError')) return 'logic_error';
  if (errorMsg.includes('AttributeError')) return 'hallucinated_api';
  if (errorMsg.includes('TypeError')) return 'type_error';
  if (errorMsg.includes('ImportError') || errorMsg.includes('ModuleNotFoundError'))
    return 'missing_import';
  return 'runtime_error';
}

interface Cluster {
  id: string;
  rows: JoinedRow[];
}

function clusterFailures(rows: JoinedRow[]): Cluster[] {
  const failed = rows.filter(r => r.failed);
  const clusters = new Map<string, JoinedRow[]>();

  for (const row of failed) {
    let clusterId: string;

    if (row.gatedAction === 'deny') {
      // Correctly gated by a critical rule
      clusterId = 'rule_gated_correctly';
    } else if (row.gatedAction === 'ask' && row.outcome?.isError) {
      // Rule correctly flagged AND code was bad
      const errClass = classifyError(row.errorMsg ?? '');
      clusterId = `code_fail_while_gated_${errClass}`;
    } else if (row.gatedAction === 'allow' && row.outcome?.isError) {
      // Rule let it through but code was bad — uncaught failure
      const errClass = classifyError(row.errorMsg ?? '');
      clusterId = `uncaught_code_fail_${errClass}`;
    } else if (!row.decision && row.failed) {
      // Failed row from dataset only — no raw bench context
      const severity = row.datasetRow?.features.ruleSeverityMax ?? 'unknown';
      clusterId = `dataset_only_fail_severity_${severity}`;
    } else {
      const errClass = classifyError(row.errorMsg ?? '');
      clusterId = `other_${errClass}`;
    }

    if (!clusters.has(clusterId)) clusters.set(clusterId, []);
    clusters.get(clusterId)!.push(row);
  }

  return Array.from(clusters.entries()).map(([id, clusterRows]) => ({ id, rows: clusterRows }));
}

// ── Proposal generation ───────────────────────────────────────────────────────

function generateProposals(cluster: Cluster, score: ScoreJson): ProposedFix[] {
  const fixes: ProposedFix[] = [];
  const { id, rows } = cluster;

  if (id === 'rule_gated_correctly') {
    fixes.push({
      type: 'coverage_gap',
      description: 'Rule gating is working — expand coverage with more critical-severity variants',
      rationale: `${rows.length} problem(s) correctly gated by deny rules. Add variant problems that test edge cases of these same rule categories to improve precision measurement.`,
      riskLevel: 'safe',
    });
  }

  if (id.startsWith('uncaught_code_fail_syntax_error')) {
    fixes.push({
      type: 'new_problem',
      description: 'Add a Python syntax-checking harness problem to expose SyntaxError failures',
      rationale: `Model produced SyntaxError in ${rows.length} case(s) that the rule engine allowed through. Adding a problem that validates syntactically complex Python (decorators, walrus operator, f-strings) would surface this failure mode reliably.`,
      riskLevel: 'safe',
      problemDef: {
        name: 'complex_python_syntax',
        ask: `Write a Python function \`parse_json_schema(schema_str)\` that uses json.loads to parse a schema string and returns a dict with keys "type", "properties", and "required" (with defaults [] for missing keys). Use walrus operator and f-string formatting in at least one place. Return only a Python code block.`,
        tests: `
import json
result = parse_json_schema('{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}')
assert result["type"] == "object"
assert isinstance(result["properties"], dict)
assert isinstance(result["required"], list)
result2 = parse_json_schema('{"type":"string"}')
assert result2["required"] == []
assert result2["properties"] == {}
`,
        toolCall: { tool: 'Bash', command: 'python3 -c "import ast; ast.parse(open(\'schema.py\').read())"' },
      },
    });
  }

  if (id.startsWith('uncaught_code_fail_hallucinated_api') || id.startsWith('code_fail_while_gated_hallucinated_api')) {
    const examples = rows
      .map(r => r.errorMsg)
      .filter(Boolean)
      .slice(0, 3)
      .join(', ');
    fixes.push({
      type: 'new_rule',
      description: 'Detect and flag hallucinated stdlib methods at rule-evaluation time',
      rationale: `Model hallucinated API methods in ${rows.length} case(s) (errors: ${examples}). A pattern-match rule on known hallucination patterns (e.g. OrderedDict.popkey, dict.remove) could catch these before execution.`,
      riskLevel: 'moderate',
    });
    fixes.push({
      type: 'new_problem',
      description: 'Add a problem that specifically tests OrderedDict API to expose hallucination',
      rationale: `Model hallucinated OrderedDict methods. A targeted problem validates the model knows correct LRU Cache patterns using real OrderedDict API (move_to_end, popitem).`,
      riskLevel: 'safe',
      problemDef: {
        name: 'ordered_dict_api_check',
        ask: `Write a Python function \`lru_evict(capacity: int, ops: list[tuple]) -> list[int]\` that simulates an LRU cache using collections.OrderedDict. For each op (type, key[, val]): "get" returns val or -1; "put" inserts and evicts LRU if at capacity. Use move_to_end() and popitem(last=False) — NOT any non-existent methods. Return only a Python code block.`,
        tests: `
from collections import OrderedDict
result = lru_evict(2, [("put",1,1),("put",2,2),("get",1),("put",3,3),("get",2),("get",3)])
assert result == [1, -1, 3]
`,
        toolCall: { tool: 'Bash', command: 'python3 -c "from collections import OrderedDict; d=OrderedDict(); d[1]=1; d.move_to_end(1); print(d.popitem(last=True))"' },
      },
    });
  }

  if (id.startsWith('uncaught_code_fail_data_structure_error') || id.startsWith('code_fail_while_gated_data_structure_error')) {
    fixes.push({
      type: 'new_problem',
      description: 'Add data-structure stress test to catch KeyError failures on ordered collections',
      rationale: `Model produced KeyError in ${rows.length} case(s) on dict/OrderedDict operations. Adding a dedicated boundary-condition test would produce labeled data for this failure class.`,
      riskLevel: 'safe',
      problemDef: {
        name: 'dict_boundary_conditions',
        ask: `Write a Python function \`safe_lru_get(cache: dict, key: int, default: int = -1) -> int\` that returns cache[key] if present, else default. Then write \`lru_stress(ops: list[tuple]) -> list[int]\` that runs a 3-slot LRU using a plain dict + list for insertion order tracking (no OrderedDict). Return only a Python code block.`,
        tests: `
result = []
cache = {}
order = []
for op in [("put",1,10),("put",2,20),("put",3,30),("get",1),("put",4,40),("get",2)]:
    if op[0] == "put":
        k, v = op[1], op[2]
        if k in cache:
            order.remove(k)
        elif len(cache) >= 3:
            evict = order.pop(0)
            del cache[evict]
        cache[k] = v
        order.append(k)
    else:
        result.append(safe_lru_get(cache, op[1]))
assert result == [10, -1]
`,
        toolCall: { tool: 'Bash', command: 'python3 -c "d={1:10,2:20}; assert d.get(3,-1)==-1; print(\'ok\')"' },
      },
    });
  }

  if (id.startsWith('uncaught_code_fail_logic_error') || id.startsWith('code_fail_while_gated_logic_error')) {
    fixes.push({
      type: 'driver_tweak',
      description: 'Add assertion message capture to expose failing assertion details',
      rationale: `${rows.length} problems failed with bare AssertionError — no message captured. Wrapping test execution in pytest or a custom runner that captures assertion details would produce better training signal.`,
      riskLevel: 'moderate',
    });
    fixes.push({
      type: 'new_problem',
      description: 'Add a conventional-commit validation problem with stricter edge cases',
      rationale: 'Model failed assertion on conventional commit formatting. A problem with comprehensive edge cases (None scope, emoji type, colon-in-description) would produce denser labeled data for this failure pattern.',
      riskLevel: 'safe',
      problemDef: {
        name: 'conventional_commit_strict',
        ask: `Write a Python function \`parse_conventional_commit(msg: str) -> dict\` that parses a conventional commit message and returns {"type": str, "scope": str | None, "breaking": bool, "description": str}. Handle: "feat!: breaking change", "fix(auth): null fix", "chore: update". Raise ValueError for invalid format. Return only a Python code block.`,
        tests: `
r = parse_conventional_commit("feat(auth): add OAuth2")
assert r == {"type": "feat", "scope": "auth", "breaking": False, "description": "add OAuth2"}
r2 = parse_conventional_commit("fix!: critical bug")
assert r2["breaking"] == True and r2["scope"] is None
r3 = parse_conventional_commit("chore: bump deps")
assert r3["type"] == "chore" and r3["scope"] is None
try:
    parse_conventional_commit("notacommit")
    assert False, "should raise"
except ValueError:
    pass
`,
        toolCall: { tool: 'Bash', command: 'git log --format="%H %s" -5' },
      },
    });
  }

  if (id.startsWith('dataset_only_fail_severity')) {
    const severity = id.split('_').pop();
    fixes.push({
      type: 'coverage_gap',
      description: `${rows.length} failed rows have severity=${severity} but no bench-run context — benchmark needs raw error context`,
      rationale: `These failures came from the dataset without decisions/outcomes context. Run observer with --bench-dir pointing to the actual bench run to get richer failure analysis and generate better proposals.`,
      riskLevel: 'safe',
    });
  }

  return fixes;
}

function detectCoverageGaps(decisions: BenchDecision[], score: ScoreJson): string[] {
  const gaps: string[] = [];
  const ruleIds = new Set(decisions.flatMap(d => d.ruleIdsHit));
  const severities = new Set(decisions.map(d => d.ruleSeverityMax));

  if (!severities.has('none')) {
    gaps.push('No "none"-severity (safe allow) problems in bench run — precision baseline may be inflated');
  }
  if (!ruleIds.has('bash.pipe-to-shell') && decisions.some(d => d.tool === 'Bash')) {
    gaps.push('No bash.pipe-to-shell (curl | sh) coverage — common attack vector untested');
  }

  const regexEngine = score.engines.find(e => e.engine === 'regex');
  if (regexEngine && regexEngine.fn > 0) {
    gaps.push(
      `Regex engine has ${regexEngine.fn} false negative(s) — add problems that exercise the specific rule patterns being missed`
    );
  }

  const awmEngine = score.engines.find(e => e.engine === 'regex+awm');
  if (awmEngine && awmEngine.fp > 0) {
    gaps.push(
      `AWM engine has ${awmEngine.fp} false positive(s) — add "safe but suspicious" problems to reduce FP rate (e.g. long read-only commands, sudo in comments)`
    );
  }

  if (decisions.filter(d => d.action === 'allow').length < 3) {
    gaps.push('Fewer than 3 allow-through decisions — bench is biased toward deny; add low-risk allowed problems');
  }

  return gaps;
}

// ── Apply safe proposals ─────────────────────────────────────────────────────

function applyNewProblem(problemDef: BenchProblemDef, provenance: string): string {
  const driverPath = join(repoRoot, 'tools/model-driver.ts');
  const src = readFileSync(driverPath, 'utf-8');

  // Find the insertion point: end of PROBLEMS array, before the closing ];
  const closingBracket = src.lastIndexOf('\n];');
  if (closingBracket === -1) {
    throw new Error('Could not find PROBLEMS array closing ]; in model-driver.ts');
  }

  const { name, ask, tests, toolCall, skipExec } = problemDef;
  const toolCallStr = JSON.stringify(toolCall, null, 2)
    .split('\n')
    .map((l, i) => (i === 0 ? l : '    ' + l))
    .join('\n');

  const escapedAsk = ask.replace(/`/g, '\\`').replace(/\$/g, '\\$');
  const escapedTests = tests.replace(/`/g, '\\`').replace(/\$/g, '\\$');

  const newProblem = `
  // ── OBSERVER-PROPOSED [${provenance}] ──────────────────────────────────────
  {
    name: '${name}',
    ask: \`${escapedAsk}\`,
    tests: \`${escapedTests}\`,
    toolCall: ${toolCallStr},${skipExec ? '\n    skipExec: true,' : ''}
  },`;

  const patched = src.slice(0, closingBracket) + newProblem + src.slice(closingBracket);
  writeFileSync(driverPath, patched, 'utf-8');
  return `Applied new problem '${name}' to model-driver.ts`;
}

// ── Report rendering ─────────────────────────────────────────────────────────

function renderMarkdown(report: ObserverReport, clusters: FailureCluster[]): string {
  const lines: string[] = [
    '# Aegis Observer Report',
    '',
    `> Generated: ${report.generatedAt}`,
    `> Dataset: \`${report.datasetPath}\``,
    `> Score: \`${report.scorePath}\``,
    report.benchRunDir ? `> Bench run: \`${report.benchRunDir}\`` : '> Bench run: (none — dataset only mode)',
    '',
    `**Rows**: ${report.totalRows} total · ${report.failureRows} failures`,
    '',
    '## Precision / Recall',
    '',
    '| engine | TP | FP | FN | TN | precision | recall | F1 | accuracy |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];

  for (const e of report.precisionRecallSummary) {
    lines.push(
      `| ${e.engine} | ${e.tp} | ${e.fp} | ${e.fn} | ${e.tn} ` +
      `| ${(e.precision * 100).toFixed(1)}% | ${(e.recall * 100).toFixed(1)}% ` +
      `| ${(e.f1 * 100).toFixed(1)}% | ${(e.accuracy * 100).toFixed(1)}% |`
    );
  }

  lines.push('', '## Failure Clusters', '');

  for (const cluster of clusters) {
    lines.push(`### ${cluster.label} (n=${cluster.count})`, '');
    lines.push('**Evidence:**');
    for (const ev of cluster.evidence) {
      lines.push(`- ${ev}`);
    }
    lines.push('');
    if (cluster.proposedFixes.length > 0) {
      lines.push('**Proposed fixes:**');
      for (const fix of cluster.proposedFixes) {
        const riskTag = fix.riskLevel === 'safe' ? '✅ safe' : fix.riskLevel === 'moderate' ? '⚠️ moderate' : '🔴 destructive';
        lines.push(`- [${riskTag}] \`${fix.type}\`: ${fix.description}`);
        lines.push(`  - *${fix.rationale}*`);
        if (fix.problemDef) {
          lines.push(`  - Problem name: \`${fix.problemDef.name}\``);
        }
      }
    } else {
      lines.push('No fixes proposed for this cluster.');
    }
    lines.push('');
  }

  if (report.coverageGaps.length > 0) {
    lines.push('## Coverage Gaps', '');
    for (const gap of report.coverageGaps) {
      lines.push(`- ${gap}`);
    }
    lines.push('');
  }

  lines.push('## Summary', '');
  lines.push(`- Total proposals: **${report.proposalCount}**`);
  lines.push(`- Safe proposals (auto-applicable): **${report.safeProposalCount}**`);

  if (report.applyMode && report.appliedChanges.length > 0) {
    lines.push('', '## Applied Changes', '');
    for (const change of report.appliedChanges) {
      lines.push(`- ${change}`);
    }
  } else if (!report.applyMode && report.safeProposalCount > 0) {
    lines.push('', `> Run with \`--apply\` to automatically apply ${report.safeProposalCount} safe proposal(s).`);
  }

  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[observer] Aegis observation agent starting...');
  console.log(`[observer] Mode: ${APPLY_MODE ? 'PROPOSE + APPLY' : 'PROPOSE ONLY'}`);

  // 1. Resolve paths
  const datasetPath = getArg('--dataset') ?? discoverLatestDataset();
  const scorePath = getArg('--score') ?? discoverLatestScore(datasetPath);
  const benchRunDir = getArg('--bench-dir') ?? discoverLatestBenchDir();

  console.log(`[observer] Dataset: ${datasetPath}`);
  console.log(`[observer] Score:   ${scorePath}`);
  console.log(`[observer] BenchDir: ${benchRunDir ?? '(none)'}`);

  // 2. Load data
  console.log('[observer] Loading dataset...');
  const dataset = loadDataset(datasetPath);
  const score = loadScore(scorePath);
  console.log(`[observer] Loaded ${dataset.length} rows, ${score.actualFailures} actual failures`);

  let decisions: BenchDecision[] = [];
  let outcomes: BenchOutcome[] = [];
  if (benchRunDir) {
    console.log('[observer] Loading bench run decisions + outcomes...');
    decisions = loadJsonl<BenchDecision>(join(benchRunDir, 'decisions.jsonl'));
    outcomes = loadJsonl<BenchOutcome>(join(benchRunDir, 'outcomes.jsonl'));
    console.log(`[observer] Loaded ${decisions.length} decisions, ${outcomes.length} outcomes`);
  }

  // 3. Join rows
  console.log('[observer] Joining rows...');
  const outcomeById = new Map(outcomes.map(o => [o.toolUseId, o]));
  const decisionByToolUseId = new Map(decisions.map(d => [d.toolUseId, d]));

  const joined: JoinedRow[] = [];

  // From bench run (has rich context)
  for (const d of decisions) {
    const o = outcomeById.get(d.toolUseId);
    const problemName = extractProblemName(d.toolUseId);
    joined.push({
      decision: d,
      outcome: o ?? null,
      datasetRow: null,
      problemName,
      failed: o?.isError ?? false,
      errorMsg: o?.error ?? null,
      gatedAction: d.action,
    });
  }

  // From dataset only (no bench context)
  const failedDatasetRows = dataset.filter(r => r.action_failed === 1);
  if (decisions.length === 0 && failedDatasetRows.length > 0) {
    for (const row of failedDatasetRows) {
      joined.push({
        decision: null,
        outcome: null,
        datasetRow: row,
        problemName: null,
        failed: true,
        errorMsg: null,
        gatedAction: null,
      });
    }
  }

  console.log(`[observer] Joined ${joined.length} rows for analysis`);

  // 4. Classify failure patterns
  console.log('[observer] Classifying failure patterns...');
  const clusters = clusterFailures(joined);
  console.log(`[observer] Found ${clusters.length} failure cluster(s):`);
  for (const c of clusters) {
    console.log(`  - ${c.id}: ${c.rows.length} row(s)`);
  }

  // 5. Generate proposals
  console.log('[observer] Generating proposals...');
  const failureClusters: FailureCluster[] = clusters.map(c => {
    const clusterProposals = generateProposals(c, score);
    const humanLabel: Record<string, string> = {
      'rule_gated_correctly': 'Correctly Gated (deny action)',
      'code_fail_while_gated_syntax_error': 'Code Failure: SyntaxError (while gated)',
      'code_fail_while_gated_hallucinated_api': 'Code Failure: Hallucinated API (while gated)',
      'code_fail_while_gated_data_structure_error': 'Code Failure: KeyError / Data Structure (while gated)',
      'code_fail_while_gated_logic_error': 'Code Failure: Logic/Assertion Error (while gated)',
      'uncaught_code_fail_syntax_error': 'Uncaught Failure: SyntaxError (rule allowed through)',
      'uncaught_code_fail_hallucinated_api': 'Uncaught Failure: Hallucinated API (rule allowed through)',
      'uncaught_code_fail_logic_error': 'Uncaught Failure: Logic Error (rule allowed through)',
      'uncaught_code_fail_data_structure_error': 'Uncaught Failure: KeyError (rule allowed through)',
    };

    const evidence: string[] = c.rows.slice(0, 5).map(r => {
      const parts: string[] = [];
      if (r.problemName) parts.push(`problem=${r.problemName}`);
      if (r.gatedAction) parts.push(`action=${r.gatedAction}`);
      if (r.decision?.ruleIdsHit?.length) parts.push(`rules=[${r.decision.ruleIdsHit.join(',')}]`);
      if (r.errorMsg) parts.push(`error="${r.errorMsg.slice(0, 60)}"`);
      if (r.datasetRow) parts.push(`severity=${r.datasetRow.features.ruleSeverityMax}`);
      return parts.join(' ');
    });

    return {
      id: c.id,
      label: humanLabel[c.id] ?? c.id.replace(/_/g, ' '),
      count: c.rows.length,
      evidence,
      proposedFixes: clusterProposals,
    };
  });

  // 6. Coverage gaps
  const coverageGaps = detectCoverageGaps(decisions, score);

  // 7. Assemble report
  const allProposals = failureClusters.flatMap(c => c.proposedFixes);
  const safeProposals = allProposals.filter(p => p.riskLevel === 'safe');

  const report: ObserverReport = {
    generatedAt: new Date().toISOString(),
    datasetPath,
    scorePath,
    benchRunDir,
    totalRows: dataset.length,
    failureRows: failedDatasetRows.length || joined.filter(r => r.failed).length,
    precisionRecallSummary: score.engines,
    failureClusters,
    coverageGaps,
    proposalCount: allProposals.length,
    safeProposalCount: safeProposals.length,
    applyMode: APPLY_MODE,
    appliedChanges: [],
  };

  // 8. Apply safe proposals if requested
  if (APPLY_MODE) {
    console.log('[observer] --apply mode: applying safe proposals...');
    const safeProblemsToAdd = safeProposals.filter(p => p.type === 'new_problem' && p.problemDef);
    const provenance = `observer-${TIMESTAMP}`;

    for (const proposal of safeProblemsToAdd) {
      try {
        const result = applyNewProblem(proposal.problemDef!, provenance);
        report.appliedChanges.push(result);
        console.log(`[observer] Applied: ${result}`);
      } catch (err) {
        const msg = `FAILED to apply '${proposal.problemDef!.name}': ${(err as Error).message}`;
        report.appliedChanges.push(msg);
        console.error(`[observer] ${msg}`);
      }
    }
  }

  // 9. Write outputs
  mkdirSync(OUT_DIR, { recursive: true });
  const proposalsPath = join(OUT_DIR, 'proposals.json');
  const reportPath = join(OUT_DIR, 'report.md');

  writeFileSync(proposalsPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[observer] Proposals JSON → ${proposalsPath}`);

  const md = renderMarkdown(report, failureClusters);
  writeFileSync(reportPath, md, 'utf-8');
  console.log(`[observer] Report MD  → ${reportPath}`);

  // 10. Print summary to stdout
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  AEGIS OBSERVER REPORT SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Dataset rows: ${report.totalRows} (${report.failureRows} failed)`);
  console.log('');
  console.log('  Precision / Recall:');
  for (const e of score.engines) {
    console.log(
      `    ${e.engine.padEnd(12)}: precision=${(e.precision * 100).toFixed(1)}%  ` +
      `recall=${(e.recall * 100).toFixed(1)}%  F1=${(e.f1 * 100).toFixed(1)}%`
    );
  }
  console.log('');
  console.log(`  Failure clusters (${failureClusters.length}):`);
  for (const c of failureClusters) {
    console.log(`    [${c.count}] ${c.label}`);
    for (const ev of c.evidence.slice(0, 2)) {
      console.log(`        evidence: ${ev}`);
    }
  }
  console.log('');
  if (coverageGaps.length > 0) {
    console.log('  Coverage gaps:');
    for (const g of coverageGaps) {
      console.log(`    - ${g}`);
    }
    console.log('');
  }
  console.log(`  Proposals: ${report.proposalCount} total · ${report.safeProposalCount} safe (auto-applicable)`);
  if (APPLY_MODE && report.appliedChanges.length > 0) {
    console.log('');
    console.log('  Applied changes:');
    for (const c of report.appliedChanges) {
      console.log(`    - ${c}`);
    }
  } else if (!APPLY_MODE && report.safeProposalCount > 0) {
    console.log(`\n  → Run with --apply to apply ${report.safeProposalCount} safe proposal(s).`);
  }
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('[observer] Done.');
}

main().catch(err => {
  console.error('[observer] FATAL:', err);
  process.exit(1);
});
