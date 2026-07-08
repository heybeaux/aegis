/**
 * @heybeaux/aegis-hook — Claude Code PreToolUse hook for the Aegis governance engine.
 *
 * Re-exports the pure, programmatically-useful pieces for testing and embedding.
 * The runnable hook entry is `cli.ts` (bin `aegis-hook`).
 *
 * @packageDocumentation
 */

export { toToolCall, toolUseIdFromHookInput, readStdin } from './stdin.js';
export { loadAllPacks } from './rules.js';
export { decide, type Decision, type DecideOptions } from './decide.js';
export {
  approvalId,
  approvalPaths,
  approvalSignature,
  approvePending,
  consumeApproval,
  requestApproval,
  type ApprovalRecord,
  type ApprovalPaths,
} from './approval.js';
export {
  buildHookConfig,
  mergeIntoSettings,
  installHook,
  type HookConfig,
  type MatcherEntry,
  type CommandHook,
  type Settings,
  type InstallResult,
} from './install.js';
