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
  adapterByName,
  claudeCodeAdapter,
  genericJsonStdioAdapter,
  type HostAdapter,
  type HookRequest,
  type HookResponse,
} from './adapters.js';
export {
  actionKeyFor,
  observeApproval,
  observeDecision,
  predictWithPolicy,
  predictorFailureModeFromEnv,
  type PredictorFailureMode,
  type PredictorResult,
} from './predictor.js';
export { runHook } from './runtime.js';
export {
  createOpenClawAdapter,
  openClawObservation,
  openClawToolCall,
  type OpenClawToolEvent,
  type OpenClawShadowObservation,
} from './openclaw.js';
export { recordDecisionSafely } from './collect.js';
export {
  approvalId,
  approvalPaths,
  approvalSignature,
  approvePending,
  consumeApproval,
  createExecutionPermit,
  createExecutionPermitWithStore,
  finalizeExecutionPermit,
  finalizeExecutionPermitWithStore,
  finalizeExecutionPermitWithReconciliation,
  finalizeExecutionPermitWithEffectJournal,
  resolveExecutionEffect,
  resolveAnchoredExecutionEffect,
  resolveMultiAuthorityAnchoredExecutionEffect,
  resolveWitnessSetAnchoredExecutionEffect,
  resolveWitnessRosterAnchoredExecutionEffect,
  selectDurableStrictRosterPolicy,
  readDurableStrictRosterPolicy,
  readDurableStrictRosterPolicyLifecycle,
  retireDurableStrictRosterPolicy,
  resolveRetiredDurableStrictRosterPolicyExecutionEffect,
  beginRetiredDurableStrictRosterPolicyExecutionEffect,
  resolveDurableStrictRosterPolicyExecutionEffect,
  createStrictRosterContinuityContext,
  resolveStrictRosterContinuityExecutionEffect,
  resolveCompactedExecutionEffect,
  beginExecutionEffect,
  beginStrictRosterContinuityExecutionEffect,
  beginDurableStrictRosterPolicyExecutionEffect,
  completeExecutionEffect,
  failExecutionEffect,
  requestApproval,
  type ApprovalRecord,
  type ApprovalPaths,
  type ApprovalExecutionPermit,
  type ApprovalExecutionPermitRecord,
  type ApprovalExecutionPermitStore,
  type ReconciledApprovalExecutionPermitStore,
  type JournaledApprovalExecutionPermitStore,
  type RevisionedApprovalExecutionPermitStore,
  type CompactedApprovalExecutionPermitStore,
  type AnchoredApprovalExecutionPermitStore,
  type MultiAuthorityAnchoredApprovalExecutionPermitStore,
  type WitnessSetAnchoredApprovalExecutionPermitStore,
  type WitnessRosterAnchoredApprovalExecutionPermitStore,
  type DurableStrictRosterPolicyMarker,
  type DurableStrictRosterPolicyStore,
  type DurableStrictRosterPolicyLifecycleRecord,
  type DurableStrictRosterPolicyRetirement,
  type RetirableDurableStrictRosterPolicyStore,
  type DurableStrictRosterPolicyLifecycleResult,
  type ApprovalExecutionRevisionCheckpoint,
  type ApprovalExecutionRevisionAuthorityCheckpoint,
  type ApprovalExecutionRevisionWitnessSet,
  type ApprovalExecutionRevisionWitnessRoster,
  type ApprovalExecutionTerminalProof,
  type ApprovalExecutionTerminalProofOutcome,
  type ApprovalExecutionEffectRecord,
  type ApprovalExecutionEffectState,
  type ApprovalExecutionEffectResolutionResult,
  type ApprovalExecutionEffectResolutionStatus,
  type StrictRosterContinuityContext,
  type ApprovalExecutionEffectReceipt,
  type ApprovalExecutionEffectFailureReceipt,
  type ApprovalExecutionEffectFailureCommitStatus,
  type ApprovalExecutionEffectFailureResult,
  type ApprovalExecutionEffectFailureStatus,
  type ApprovalExecutionEffectCommitStatus,
  type ApprovalExecutionEffectCompletionResult,
  type ApprovalExecutionEffectCompletionStatus,
  type ReceiptedApprovalExecutionPermitStore,
  type FailureReceiptedApprovalExecutionPermitStore,
  type ApprovalExecutionFinalizationResult,
  type ApprovalExecutionFinalizationStatus,
  type ApprovalExecutionSnapshot,
} from './approval.js';
export { writeTelemetry, type TelemetryEvent } from './telemetry.js';
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
