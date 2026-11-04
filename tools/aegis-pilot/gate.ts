// Gate arms for the Aegis pilot.
//
// `aegis_rules` evaluates THIS checkout's packages/aegis/src with the bundled
// rule packs, mirroring the omlx-aegis-ab `aegis_rules` condition
// (evaluate(call, rules, { preprocess: true, ruleVersions }); no predictor).
// The source is loaded in-process (node --experimental-transform-types plus a
// resolve hook mapping relative `.js` specifiers to `.ts`), so no build step,
// package install or child process is needed and the evaluated code is exactly
// the code at the recorded repo SHA.
//
// No approval path exists: `ask` and `deny` are both treated as a block.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { GateDecision, GateMode, GateProvenance, PilotAction, PilotGate } from './types.ts';

export const RULE_PACK_FILES = Object.freeze(['bash.json', 'file.json', 'injection.json', 'pii.json', 'secrets.json']);
const EVALUATE_OPTIONS = Object.freeze({ preprocess: true });

interface AegisToolCall {
  tool: string;
  command?: string;
  content?: string;
  paths?: string[];
  argv?: string[];
}

interface AegisEvaluation {
  action: 'allow' | 'ask' | 'deny';
  decidedBy: string;
  matches: Array<{ id: string; severity: string; category: string; target: string }>;
  reason: string;
  ruleVersions: string[];
}

type EvaluateFn = (call: AegisToolCall, rules: unknown[], opts?: Record<string, unknown>) => AegisEvaluation;
type LoadPackFn = (pack: unknown) => unknown[];

/** Same envelope mapping as tools/omlx-aegis-ab/aegis.ts toToolCall(). */
export function toAegisToolCall(action: PilotAction): AegisToolCall {
  switch (action.name) {
    case 'Bash':
      return { tool: 'Bash', command: action.command, argv: action.command.split(/\s+/).filter(Boolean) };
    case 'Write':
      return { tool: 'Write', paths: [action.path], content: action.content };
    case 'Read':
      return { tool: 'Read', paths: [action.path] };
    case 'Handoff':
      return { tool: 'Handoff', content: action.note };
    case 'Finish':
      return { tool: 'Finish', content: action.summary };
  }
}

export function repoRootFromHere(): string {
  return resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function hashAegisSources(repoRoot: string): string {
  const hash = createHash('sha256');
  const roots = [join(repoRoot, 'packages/aegis/src'), join(repoRoot, 'packages/aegis/rulepacks')];
  for (const root of roots) {
    for (const file of listFiles(root)) {
      hash.update(file.slice(repoRoot.length));
      hash.update('\0');
      hash.update(readFileSync(file));
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

let hookInstalled = false;
function installTsResolveHook(srcRoot: string): void {
  if (hookInstalled) return;
  const srcRootUrl = pathToFileURL(srcRoot + '/').href;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        specifier.endsWith('.js') &&
        specifier.startsWith('.') &&
        context.parentURL?.startsWith(srcRootUrl) &&
        context.parentURL.endsWith('.ts')
      ) {
        const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
      }
      return nextResolve(specifier, context);
    },
  });
  hookInstalled = true;
}

function noGateDecision(): GateDecision {
  return {
    gate: 'no_gate',
    action: 'allow',
    reason: 'no_gate arm never intervenes',
    matches: [],
    decidedBy: 'no_gate',
    ruleVersions: [],
  };
}

export async function createAegisRulesGate(repoRoot = repoRootFromHere()): Promise<PilotGate> {
  const features = process.features as { typescript?: string | false };
  if (features.typescript !== 'transform') {
    throw new Error(
      'The aegis_rules gate loads packages/aegis/src directly; run with `node --experimental-transform-types`.',
    );
  }
  const srcRoot = join(repoRoot, 'packages/aegis/src');
  installTsResolveHook(srcRoot);
  const mod = (await import(pathToFileURL(join(srcRoot, 'index.ts')).href)) as {
    evaluate: EvaluateFn;
    loadPack: LoadPackFn;
  };
  const rules: unknown[] = [];
  const ruleVersions: string[] = [];
  for (const file of RULE_PACK_FILES) {
    const pack = JSON.parse(readFileSync(join(repoRoot, 'packages/aegis/rulepacks', file), 'utf8')) as {
      packId: string;
      version: string;
    };
    rules.push(...mod.loadPack(pack));
    ruleVersions.push(`${pack.packId}@${pack.version}`);
  }
  const provenance: GateProvenance = {
    loader: 'aegis_src_transform_types',
    aegisSourceSha256: hashAegisSources(repoRoot),
    ruleVersions,
    evaluateOptions: { ...EVALUATE_OPTIONS },
  };
  return {
    provenance,
    decide(action: PilotAction, mode: GateMode): GateDecision {
      if (mode === 'no_gate') return noGateDecision();
      const evaluation = mod.evaluate(toAegisToolCall(action), rules, { ...EVALUATE_OPTIONS, ruleVersions });
      return {
        gate: 'aegis_rules',
        action: evaluation.action,
        reason: evaluation.reason,
        matches: evaluation.matches.map((m) => ({ id: m.id, severity: m.severity, category: m.category, target: m.target })),
        decidedBy: evaluation.decidedBy,
        ruleVersions: evaluation.ruleVersions,
      };
    },
  };
}

/** Test-only gate with an injected decision function. */
export function createInjectedGate(decide: (action: PilotAction) => GateDecision['action']): PilotGate {
  return {
    provenance: { loader: 'injected_test_gate', aegisSourceSha256: 'n/a', ruleVersions: [], evaluateOptions: {} },
    decide(action, mode) {
      if (mode === 'no_gate') return noGateDecision();
      const verdict = decide(action);
      return { gate: 'aegis_rules', action: verdict, reason: `injected:${verdict}`, matches: [], decidedBy: 'injected', ruleVersions: [] };
    },
  };
}
