/**
 * Map an Aegis {@link Evaluation} to the Claude Code PreToolUse exit contract.
 *
 * Claude Code reads the hook's exit code:
 *   - exit 0 -> ALLOW; the tool call proceeds.
 *   - exit 2 -> BLOCK/PAUSE; whatever is on stderr is surfaced to the model as the reason.
 *
 * Aegis returns three gate actions:
 *   - 'deny'  -> exit 2, reason on stderr.
 *   - 'ask'   -> exit 2 until a human approves the exact pending request with
 *                `aegis-hook approve <id>`. Approval is consumed once on retry.
 *   - 'allow' -> exit 0, empty stderr.
 */

import type { Evaluation, ToolCall } from '@heybeaux/lattice-aegis';
import { consumeApproval, requestApproval } from './approval.js';

export interface Decision {
  /** Process exit code: 2 blocks/pauses, 0 allows. */
  exitCode: 0 | 2;
  /** Text to write to stderr (model-visible; '' when allowing silently). */
  stderr: string;
}

export interface DecideOptions {
  /** Original tool call. Required for one-shot approvals on ask decisions. */
  call?: ToolCall;
  /** Test/embedding override. Defaults to AEGIS_APPROVAL_DIR or ~/.aegis/approvals. */
  approvalDir?: string;
}

/** Pure-ish mapping from an Aegis evaluation to an exit code + stderr payload.
 *  The `ask` path persists/consumes a small local approval record when `call` is provided. */
export function decide(evaluation: Evaluation, options: DecideOptions = {}): Decision {
  switch (evaluation.action) {
    case 'deny':
      return { exitCode: 2, stderr: `[Aegis DENY] ${evaluation.reason}` };
    case 'ask': {
      if (options.call !== undefined && consumeApproval(options.call, evaluation, options.approvalDir)) {
        return { exitCode: 0, stderr: `[Aegis ASK approved once] ${evaluation.reason}` };
      }

      if (options.call === undefined) {
        return {
          exitCode: 2,
          stderr: `[Aegis ASK requires approval] ${evaluation.reason}\nApproval unavailable: hook did not provide the original ToolCall.`,
        };
      }

      const pending = requestApproval(options.call, evaluation, options.approvalDir);
      return {
        exitCode: 2,
        stderr:
          `[Aegis ASK requires approval] ${evaluation.reason}\n` +
          `Approval id: ${pending.id}\n` +
          `Approve once: aegis-hook approve ${pending.id}\n` +
          `Then retry the exact same tool call.`,
      };
    }
    case 'allow':
    default:
      return { exitCode: 0, stderr: '' };
  }
}
