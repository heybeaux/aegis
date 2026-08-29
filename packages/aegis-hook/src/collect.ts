import type { Evaluation, ToolCall } from '@heybeaux/lattice-aegis';

type RecordDecisionFn = (
  call: ToolCall,
  evaluation: Evaluation,
  toolUseId?: string,
  model?: string,
  shadow?: {
    enabled: true;
    action: 'allow' | 'ask' | 'deny';
    reason: string;
    decidedBy: string;
    approvalId?: string;
    predictorActionKey?: string;
    predictorMode?: 'live' | 'fallback';
    predictorState?: 'ok' | 'timeout' | 'error';
  },
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
  shadow?: Parameters<RecordDecisionFn>[4],
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
    cached(call, evaluation, toolUseId, undefined, shadow);
  } catch {
    // Collection is strictly fail-open.
  }
}
