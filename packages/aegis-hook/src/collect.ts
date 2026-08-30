import { recordDecision, type DecisionRow, type RunProvenance } from '@heybeaux/aegis-collect';
import type { Evaluation, ToolCall } from '@heybeaux/lattice-aegis';

type RecordDecisionFn = (
  call: ToolCall,
  evaluation: Evaluation,
  toolUseId?: string,
  model?: string,
  shadow?: DecisionRow['shadow'],
  provenance?: RunProvenance,
) => void;

export async function recordDecisionSafely(
  call: ToolCall,
  evaluation: Evaluation,
  toolUseId?: string,
  shadow?: Parameters<RecordDecisionFn>[4],
  provenance?: RunProvenance,
): Promise<void> {
  try {
    recordDecision(
      call,
      evaluation,
      toolUseId,
      provenance?.model,
      shadow,
      provenance,
    );
  } catch {
    // Collection is strictly fail-open.
  }
}
