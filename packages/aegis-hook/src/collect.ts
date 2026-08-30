import { recordDecision } from '@heybeaux/aegis-collect';
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

export async function recordDecisionSafely(
  call: ToolCall,
  evaluation: Evaluation,
  toolUseId?: string,
  shadow?: Parameters<RecordDecisionFn>[4],
): Promise<void> {
  try {
    recordDecision(call, evaluation, toolUseId, undefined, shadow);
  } catch {
    // Collection is strictly fail-open.
  }
}
