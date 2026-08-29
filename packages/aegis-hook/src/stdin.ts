/**
 * Read Claude Code's PreToolUse stdin and map it to an Aegis {@link ToolCall}.
 *
 * Claude Code pipes JSON to the hook's stdin shaped like:
 *   Bash:  { "tool_name": "Bash",  "tool_input": { "command": "rm -rf /" } }
 *   Write: { "tool_name": "Write", "tool_input": { "file_path": "/x", "content": "..." } }
 *   Edit:  { "tool_name": "Edit",  "tool_input": { "file_path": "/x", "new_string": "..." } }
 *   Read:  { "tool_name": "Read",  "tool_input": { "file_path": "/x" } }
 *
 * The mapping is intentionally defensive: any unknown tool / shape produces a
 * best-effort ToolCall from whatever fields exist, never a throw. The hook fails
 * OPEN, so a malformed payload becomes a near-empty ToolCall that matches nothing.
 */

import { readFileSync } from 'node:fs';
import type { ToolCall } from '@heybeaux/lattice-aegis';

/** Narrow an unknown value to a plain (non-array, non-null) object. */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Pull a string field if present and actually a string. */
function str(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

/** Pull a finite number field if present. */
function num(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function bool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const v = obj[key];
  return typeof v === 'boolean' ? v : undefined;
}

function manifestTier(value: unknown): NonNullable<ToolCall['handoff']>['manifestTier'] | undefined {
  return value === 'none' || value === 'presence' || value === 'value-echo' ? value : undefined;
}

function verificationTier(value: unknown): NonNullable<ToolCall['verification']>['tier'] | undefined {
  return value === 'human_attestation' ||
    value === 'provenance_chain' ||
    value === 'retrieval_grounded' ||
    value === 'cross_model_adversarial' ||
    value === 'unsupported_claim_only'
    ? value
    : undefined;
}

function verificationStatus(
  value: unknown,
): NonNullable<ToolCall['verification']>['status'] | undefined {
  return value === 'supported' ||
    value === 'unsupported' ||
    value === 'contradicted' ||
    value === 'needs_human'
    ? value
    : undefined;
}

function completionCategory(
  value: unknown,
): NonNullable<ToolCall['completion']>['actionCategory'] | undefined {
  return value === 'file_write' ||
    value === 'artifact_build' ||
    value === 'test_run' ||
    value === 'external_write' ||
    value === 'job_schedule' ||
    value === 'issue_update' ||
    value === 'message_send'
    ? value
    : undefined;
}

function completionClaim(value: unknown): NonNullable<ToolCall['completion']>['claim'] | undefined {
  return value === 'done' || value === 'failed' || value === 'retry' ? value : undefined;
}

function receiptClass(
  value: unknown,
): NonNullable<ToolCall['completion']>['receiptClass'] | undefined {
  return value === 'self_report' ||
    value === 'process' ||
    value === 'tool_output' ||
    value === 'desired_state' ||
    value === 'desired_state_with_idempotency'
    ? value
    : undefined;
}

function recallClaimKind(value: unknown): NonNullable<ToolCall['recall']>['claimKind'] | undefined {
  return value === 'exact_path' ||
    value === 'exact_command' ||
    value === 'exact_identifier' ||
    value === 'negative_constraint' ||
    value === 'private_fact' ||
    value === 'exact_date' ||
    value === 'high_level_summary' ||
    value === 'rejected_option'
    ? value
    : undefined;
}

function recallSource(value: unknown): NonNullable<ToolCall['recall']>['source'] | undefined {
  return value === 'raw_context' ||
    value === 'summary_only' ||
    value === 'retrieved_evidence' ||
    value === 'fact_ledger'
    ? value
    : undefined;
}

function memoryScope(value: unknown): NonNullable<ToolCall['recall']>['sourceScope'] | undefined {
  return value === 'public' || value === 'shared' || value === 'private' ? value : undefined;
}

function responseMode(value: unknown): NonNullable<ToolCall['recall']>['responseMode'] | undefined {
  return value === 'answer' || value === 'refuse' ? value : undefined;
}

function toHandoff(root: Record<string, unknown>, input: Record<string, unknown>): ToolCall['handoff'] | undefined {
  const raw = asRecord(root.handoff);
  const inputRaw = asRecord(input.handoff);
  const source = Object.keys(inputRaw).length > 0 ? inputRaw : raw;
  if (Object.keys(source).length === 0) return undefined;

  const handoff: NonNullable<ToolCall['handoff']> = {};
  handoff.delegationDepth =
    num(source, 'delegationDepth') ?? num(source, 'delegation_depth') ?? num(source, 'depth');
  handoff.manifestTier =
    manifestTier(source.manifestTier) ?? manifestTier(source.manifest_tier) ?? manifestTier(source.manifest);
  handoff.requirementCount =
    num(source, 'requirementCount') ?? num(source, 'requirement_count') ?? num(source, 'requirements');

  return Object.values(handoff).some((v) => v !== undefined) ? handoff : undefined;
}

function toVerification(
  root: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolCall['verification'] | undefined {
  const raw = asRecord(root.verification);
  const inputRaw = asRecord(input.verification);
  const source = Object.keys(inputRaw).length > 0 ? inputRaw : raw;
  if (Object.keys(source).length === 0) return undefined;

  const verification: NonNullable<ToolCall['verification']> = {};
  verification.tier =
    verificationTier(source.tier) ??
    verificationTier(source.verificationTier) ??
    verificationTier(source.verification_tier);
  verification.status =
    verificationStatus(source.status) ??
    verificationStatus(source.verificationStatus) ??
    verificationStatus(source.verification_status);
  verification.highRiskAudit =
    bool(source, 'highRiskAudit') ?? bool(source, 'high_risk_audit') ?? bool(source, 'highRisk');
  verification.correlatedVerifierRisk =
    bool(source, 'correlatedVerifierRisk') ??
    bool(source, 'correlated_verifier_risk') ??
    bool(source, 'correlatedRisk');

  return Object.values(verification).some((v) => v !== undefined) ? verification : undefined;
}

function toCompletion(
  root: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolCall['completion'] | undefined {
  const raw = asRecord(root.completion);
  const inputRaw = asRecord(input.completion);
  const source = Object.keys(inputRaw).length > 0 ? inputRaw : raw;
  if (Object.keys(source).length === 0) return undefined;

  const completion: NonNullable<ToolCall['completion']> = {};
  completion.actionCategory =
    completionCategory(source.actionCategory) ??
    completionCategory(source.action_category) ??
    completionCategory(source.category);
  completion.claim =
    completionClaim(source.claim) ??
    completionClaim(source.statusClaim) ??
    completionClaim(source.status_claim);
  completion.receiptClass =
    receiptClass(source.receiptClass) ??
    receiptClass(source.receipt_class) ??
    receiptClass(source.receipt);
  completion.desiredStateVerified =
    bool(source, 'desiredStateVerified') ??
    bool(source, 'desired_state_verified') ??
    bool(source, 'desiredState');
  completion.ambiguousSideEffect =
    bool(source, 'ambiguousSideEffect') ??
    bool(source, 'ambiguous_side_effect') ??
    bool(source, 'ambiguous');
  completion.idempotencyKeyPresent =
    bool(source, 'idempotencyKeyPresent') ??
    bool(source, 'idempotency_key_present') ??
    bool(source, 'idempotency');

  return Object.values(completion).some((v) => v !== undefined) ? completion : undefined;
}

function toRecall(root: Record<string, unknown>, input: Record<string, unknown>): ToolCall['recall'] | undefined {
  const raw = asRecord(root.recall);
  const inputRaw = asRecord(input.recall);
  const source = Object.keys(inputRaw).length > 0 ? inputRaw : raw;
  if (Object.keys(source).length === 0) return undefined;

  const recall: NonNullable<ToolCall['recall']> = {};
  recall.claimKind =
    recallClaimKind(source.claimKind) ??
    recallClaimKind(source.claim_kind) ??
    recallClaimKind(source.kind);
  recall.source =
    recallSource(source.source) ??
    recallSource(source.evidenceSource) ??
    recallSource(source.evidence_source);
  recall.exactClaim = bool(source, 'exactClaim') ?? bool(source, 'exact_claim');
  recall.citationsPresent =
    bool(source, 'citationsPresent') ?? bool(source, 'citations_present') ?? bool(source, 'cited');
  recall.latestEvidence =
    bool(source, 'latestEvidence') ?? bool(source, 'latest_evidence') ?? bool(source, 'fresh');
  recall.sourceScope =
    memoryScope(source.sourceScope) ?? memoryScope(source.source_scope) ?? memoryScope(source.scope);
  recall.targetScope =
    memoryScope(source.targetScope) ??
    memoryScope(source.target_scope) ??
    memoryScope(source.destinationScope);
  recall.responseMode =
    responseMode(source.responseMode) ??
    responseMode(source.response_mode) ??
    responseMode(source.mode);

  return Object.values(recall).some((v) => v !== undefined) ? recall : undefined;
}

/**
 * Pure mapping from a raw Claude Code hook payload to an Aegis ToolCall.
 *
 * - `tool_name` -> `tool` (empty string when absent).
 * - `tool_input.command` -> `command` (Bash).
 * - `tool_input.content` (Write) or `new_string` (Edit) -> `content`.
 * - `tool_input.file_path` (Write/Edit/Read) -> `paths: [...]`.
 * - `handoff` or `tool_input.handoff` -> structured handoff metadata for SwarmLab-derived gates.
 *
 * No throws — safe to unit test in isolation.
 */
export function toolUseIdFromHookInput(hookInput: unknown): string | undefined {
  const root = asRecord(hookInput);
  return str(root, 'tool_use_id');
}

export function toToolCall(hookInput: unknown): ToolCall {
  const root = asRecord(hookInput);
  const input = asRecord(root.tool_input);

  const tool = str(root, 'tool_name') ?? '';

  const command = str(input, 'command');
  // Write ships `content`; Edit ships `new_string`. Prefer `content`, fall back to
  // the edit payload so file-content rules still see what is being written.
  const content = str(input, 'content') ?? str(input, 'new_string');

  const paths: string[] = [];
  const filePath = str(input, 'file_path');
  if (filePath) paths.push(filePath);

  const call: ToolCall = { tool };
  if (command !== undefined) call.command = command;
  if (content !== undefined) call.content = content;
  if (paths.length > 0) call.paths = paths;
  const handoff = toHandoff(root, input);
  if (handoff !== undefined) call.handoff = handoff;
  const verification = toVerification(root, input);
  if (verification !== undefined) call.verification = verification;
  const completion = toCompletion(root, input);
  if (completion !== undefined) call.completion = completion;
  const recall = toRecall(root, input);
  if (recall !== undefined) call.recall = recall;
  return call;
}

/** Read all of stdin synchronously (fd 0). Returns '' when nothing is piped. */
export function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    // No piped stdin (e.g. invoked interactively) — treat as empty.
    return '';
  }
}
