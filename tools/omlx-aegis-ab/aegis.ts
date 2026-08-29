import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ActionEnvelope, GateTrace } from './types.ts';

interface CompiledRule {
  rule: {
    id: string;
    severity: string;
    category: string;
  };
}

interface RuleHit {
  id: string;
  severity: string;
  category: string;
  target: string;
}

interface Evaluation {
  action: 'allow' | 'ask' | 'deny';
  decidedBy: string;
  matches: RuleHit[];
  reason: string;
  ruleVersions: string[];
}

interface ToolCall {
  tool: string;
  command?: string;
  content?: string;
  paths?: string[];
  argv?: string[];
  handoff?: ActionEnvelope['handoff'];
  verification?: ActionEnvelope['verification'];
  completion?: ActionEnvelope['completion'];
  recall?: ActionEnvelope['recall'];
  contentBoundary?: ActionEnvelope['contentBoundary'];
}

type LoadPack = (pack: { packId: string; version: string; rules: unknown[] }) => CompiledRule[];
type EvaluateFn = (
  call: ToolCall,
  rules: CompiledRule[],
  options?: { preprocess?: boolean; ruleVersions?: string[] },
) => Evaluation;

function stableRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

async function importFirst<T>(paths: string[]): Promise<T> {
  let lastError: unknown;
  for (const candidate of paths) {
    try {
      return (await import(pathToFileURL(candidate).href)) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function loadFns(repoRoot: string): Promise<{ evaluate: EvaluateFn; loadPack: LoadPack }> {
  const distIndex = resolve(repoRoot, 'packages/aegis/dist/index.js');
  try {
    return await importFirst<{ evaluate: EvaluateFn; loadPack: LoadPack }>([distIndex]);
  } catch {
    execFileSync('pnpm', ['--filter', '@heybeaux/lattice-aegis', 'build'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    return await importFirst<{ evaluate: EvaluateFn; loadPack: LoadPack }>([distIndex]);
  }
}

function loadCompiledRules(repoRoot: string, loadPack: LoadPack): {
  compiledRules: CompiledRule[];
  ruleVersions: string[];
} {
  const packFiles = ['bash.json', 'file.json', 'injection.json', 'pii.json', 'secrets.json'];
  const compiledRules: CompiledRule[] = [];
  const ruleVersions: string[] = [];
  for (const file of packFiles) {
    const packPath = resolve(repoRoot, 'packages/aegis/rulepacks', file);
    const pack = JSON.parse(readFileSync(packPath, 'utf8')) as {
      packId: string;
      version: string;
      rules: unknown[];
    };
    compiledRules.push(...loadPack(pack));
    ruleVersions.push(`${pack.packId}@${pack.version}`);
  }
  return { compiledRules, ruleVersions };
}

function toToolCall(action: ActionEnvelope): ToolCall {
  return {
    tool: action.name,
    command: action.command,
    content: action.content,
    paths: action.path ? [action.path] : undefined,
    argv: action.command ? action.command.split(/\s+/).filter(Boolean) : undefined,
    handoff: action.handoff,
    verification: action.verification,
    completion: action.completion,
    recall: action.recall,
    contentBoundary: action.contentBoundary,
  };
}

function gateTraceFromEvaluation(
  condition: 'aegis_off' | 'aegis_on',
  toolCall: ToolCall,
  evaluation: Evaluation,
): GateTrace {
  return {
    condition,
    toolCall: toolCall as unknown as Record<string, unknown>,
    action: evaluation.action,
    reason: evaluation.reason,
    matches: evaluation.matches,
    decidedBy: evaluation.decidedBy,
  };
}

export async function createGovernor(repoRoot = stableRepoRoot()): Promise<{
  evaluateAction(action: ActionEnvelope, condition: 'aegis_off' | 'aegis_on'): GateTrace;
}> {
  const { evaluate, loadPack } = await loadFns(repoRoot);
  const { compiledRules, ruleVersions } = loadCompiledRules(repoRoot, loadPack);
  return {
    evaluateAction(action, condition) {
      if (condition === 'aegis_off') {
        return {
          condition,
          toolCall: toToolCall(action) as unknown as Record<string, unknown>,
          action: 'allow',
          reason: 'Aegis disabled for paired baseline condition.',
          matches: [],
          decidedBy: 'baseline',
        };
      }
      const toolCall = toToolCall(action);
      const evaluation = evaluate(toolCall, compiledRules, {
        preprocess: true,
        ruleVersions,
      });
      return gateTraceFromEvaluation(condition, toolCall, evaluation);
    },
  };
}
