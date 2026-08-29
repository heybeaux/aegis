import type { Evaluation, ToolCall } from '@heybeaux/lattice-aegis';

type RecordDecisionFn = (
  call: ToolCall,
  evaluation: Evaluation,
  toolUseId?: string,
  model?: string,
) => void;

const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as (specifier: string) => Promise<unknown>;

let cached: RecordDecisionFn | null | undefined;

export async function recordDecisionSafely(
  call: ToolCall,
  evaluation: Evaluation,
  toolUseId?: string,
): Promise<void> {
  if (cached === undefined) {
    try {
      const mod = (await dynamicImport('@heybeaux/aegis-collect')) as {
        recordDecision?: RecordDecisionFn;
      };
      cached = typeof mod.recordDecision === 'function' ? mod.recordDecision : null;
    } catch {
      cached = null;
    }
  }

  if (cached === null) return;
  try {
    cached(call, evaluation, toolUseId);
  } catch {
    // Collection is strictly fail-open.
  }
}
