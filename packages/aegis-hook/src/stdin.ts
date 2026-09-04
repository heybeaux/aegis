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

function panelDiversity(
  value: unknown,
): NonNullable<ToolCall['verification']>['panelDiversity'] | undefined {
  return value === 'single_model' ||
    value === 'same_model_n' ||
    value === 'same_provider' ||
    value === 'cross_provider'
    ? value
    : undefined;
}

function sourceDiversity(
  value: unknown,
): NonNullable<ToolCall['verification']>['sourceDiversity'] | undefined {
  return value === 'none' || value === 'single_source' || value === 'independent'
    ? value
    : undefined;
}

function verificationTaskClass(
  value: unknown,
): NonNullable<ToolCall['verification']>['taskClass'] | undefined {
  return value === 'factual_qa' ||
    value === 'criterion_interpretation' ||
    value === 'fact_check' ||
    value === 'code_review'
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

function boundarySourceType(
  value: unknown,
): NonNullable<ToolCall['contentBoundary']>['sourceType'] | undefined {
  return value === 'github_issue' ||
    value === 'json' ||
    value === 'log' ||
    value === 'web_page' ||
    value === 'trace' ||
    value === 'chat_quote'
    ? value
    : undefined;
}

function boundaryTrust(
  value: unknown,
): NonNullable<ToolCall['contentBoundary']>['trust'] | undefined {
  return value === 'trusted' || value === 'untrusted' ? value : undefined;
}

function boundaryParserMode(
  value: unknown,
): NonNullable<ToolCall['contentBoundary']>['parserMode'] | undefined {
  return value === 'raw' || value === 'structured' ? value : undefined;
}

function instructionSignal(
  value: unknown,
):
  | NonNullable<NonNullable<ToolCall['contentBoundary']>['instructionSignals']>[number]
  | undefined {
  return value === 'authority_spoof' ||
    value === 'action_request' ||
    value === 'secret_request' ||
    value === 'completion_override' ||
    value === 'tool_output_spoof'
    ? value
    : undefined;
}

function proposedAction(
  value: unknown,
): NonNullable<ToolCall['contentBoundary']>['proposedAction'] | undefined {
  return value === 'answer' || value === 'mark_done' || value === 'exfiltrate_secret'
    ? value
    : undefined;
}

function factClass(
  value: unknown,
): NonNullable<ToolCall['factLifecycle']>['factClass'] | undefined {
  return value === 'capability' ||
    value === 'deployment_target' ||
    value === 'user_preference' ||
    value === 'dependency' ||
    value === 'endpoint' ||
    value === 'quota_limit'
    ? value
    : undefined;
}

function usageKind(
  value: unknown,
): NonNullable<ToolCall['factLifecycle']>['usageKind'] | undefined {
  return value === 'route' ||
    value === 'deploy' ||
    value === 'notify' ||
    value === 'approve' ||
    value === 'execute'
    ? value
    : undefined;
}

function factStatus(
  value: unknown,
): NonNullable<ToolCall['factLifecycle']>['basisStatus'] | undefined {
  return value === 'supported' || value === 'revoked' || value === 'needs_revalidation'
    ? value
    : undefined;
}

function coordinationOperation(
  value: unknown,
): NonNullable<ToolCall['coordination']>['operation'] | undefined {
  return value === 'merge' ? value : undefined;
}

function branchFreshness(
  value: unknown,
): NonNullable<ToolCall['coordination']>['branchFreshness'] | undefined {
  return value === 'current' || value === 'stale' ? value : undefined;
}

function overlapClass(
  value: unknown,
): NonNullable<ToolCall['coordination']>['overlapClass'] | undefined {
  return value === 'none' ||
    value === 'text_conflict' ||
    value === 'api_drift' ||
    value === 'duplicate_intent' ||
    value === 'shared_invariant'
    ? value
    : undefined;
}

function verificationCoverage(
  value: unknown,
): NonNullable<ToolCall['coordination']>['verificationCoverage'] | undefined {
  return value === 'none' || value === 'visible' || value === 'semantic' ? value : undefined;
}

function interventionOperation(
  value: unknown,
): NonNullable<ToolCall['intervention']>['operation'] | undefined {
  return value === 'resume_action' ? value : undefined;
}

function interventionStateSource(
  value: unknown,
): NonNullable<ToolCall['intervention']>['stateSource'] | undefined {
  return value === 'context_only' || value === 'durable_log' ? value : undefined;
}

function interventionDirective(
  value: unknown,
): NonNullable<ToolCall['intervention']>['directive'] | undefined {
  return value === 'none' ||
    value === 'correction' ||
    value === 'pause' ||
    value === 'stop' ||
    value === 'approval' ||
    value === 'deny'
    ? value
    : undefined;
}

function approvalScope(
  value: unknown,
): NonNullable<ToolCall['intervention']>['approvalScope'] | undefined {
  return value === 'none' || value === 'broad' || value === 'exact_action' ? value : undefined;
}

function interventionRiskLevel(
  value: unknown,
): NonNullable<ToolCall['intervention']>['riskLevel'] | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function workflowResumeOperation(
  value: unknown,
): NonNullable<ToolCall['workflowResume']>['operation'] | undefined {
  return value === 'resume_workflow_step' ? value : undefined;
}

function workflowState(
  value: unknown,
): NonNullable<ToolCall['workflowResume']>['workflowState'] | undefined {
  return value === 'clean' || value === 'partial_success' ? value : undefined;
}

function workflowStepStatus(
  value: unknown,
): NonNullable<ToolCall['workflowResume']>['stepStatus'] | undefined {
  return value === 'remaining' ||
    value === 'completed' ||
    value === 'revoked' ||
    value === 'unknown'
    ? value
    : undefined;
}

function workflowApprovalBinding(
  value: unknown,
): NonNullable<ToolCall['workflowResume']>['approvalBinding'] | undefined {
  return value === 'task' || value === 'step' || value === 'step_instance' ? value : undefined;
}

function approvalEnvelopeOperation(
  value: unknown,
): NonNullable<ToolCall['approvalEnvelope']>['operation'] | undefined {
  return value === 'approved_retry' ? value : undefined;
}

function instructionSignals(
  value: unknown,
): NonNullable<ToolCall['contentBoundary']>['instructionSignals'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map((item) => instructionSignal(item))
    .filter(
      (
        item,
      ): item is NonNullable<NonNullable<ToolCall['contentBoundary']>['instructionSignals']>[number] =>
        item !== undefined,
    );
  return parsed.length > 0 ? parsed : undefined;
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
  verification.panelDiversity =
    panelDiversity(source.panelDiversity) ??
    panelDiversity(source.panel_diversity);
  verification.criterionPinned =
    bool(source, 'criterionPinned') ??
    bool(source, 'criterion_pinned');
  verification.sharedPremiseRisk =
    bool(source, 'sharedPremiseRisk') ??
    bool(source, 'shared_premise_risk');
  verification.sourceDiversity =
    sourceDiversity(source.sourceDiversity) ??
    sourceDiversity(source.source_diversity);
  verification.adversarialVerifierPresent =
    bool(source, 'adversarialVerifierPresent') ??
    bool(source, 'adversarial_verifier_present');
  verification.specialistVerifierPresent =
    bool(source, 'specialistVerifierPresent') ??
    bool(source, 'specialist_verifier_present');
  verification.taskClass =
    verificationTaskClass(source.taskClass) ??
    verificationTaskClass(source.task_class);

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

function toContentBoundary(
  root: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolCall['contentBoundary'] | undefined {
  const raw = asRecord(root.contentBoundary ?? root.content_boundary);
  const inputRaw = asRecord(input.contentBoundary ?? input.content_boundary);
  const source = Object.keys(inputRaw).length > 0 ? inputRaw : raw;
  if (Object.keys(source).length === 0) return undefined;

  const contentBoundary: NonNullable<ToolCall['contentBoundary']> = {};
  contentBoundary.sourceType =
    boundarySourceType(source.sourceType) ??
    boundarySourceType(source.source_type) ??
    boundarySourceType(source.kind);
  contentBoundary.trust =
    boundaryTrust(source.trust) ??
    boundaryTrust(source.trustLevel) ??
    boundaryTrust(source.trust_level);
  contentBoundary.parserMode =
    boundaryParserMode(source.parserMode) ??
    boundaryParserMode(source.parser_mode) ??
    boundaryParserMode(source.mode);
  contentBoundary.instructionSignals =
    instructionSignals(source.instructionSignals) ??
    instructionSignals(source.instruction_signals) ??
    instructionSignals(source.signals);
  contentBoundary.proposedAction =
    proposedAction(source.proposedAction) ??
    proposedAction(source.proposed_action) ??
    proposedAction(source.action);

  return Object.values(contentBoundary).some((v) => v !== undefined) ? contentBoundary : undefined;
}

function toFactLifecycle(
  root: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolCall['factLifecycle'] | undefined {
  const raw = asRecord(root.factLifecycle ?? root.fact_lifecycle);
  const inputRaw = asRecord(input.factLifecycle ?? input.fact_lifecycle);
  const source = Object.keys(inputRaw).length > 0 ? inputRaw : raw;
  if (Object.keys(source).length === 0) return undefined;

  const factLifecycle: NonNullable<ToolCall['factLifecycle']> = {};
  factLifecycle.factClass =
    factClass(source.factClass) ?? factClass(source.fact_class) ?? factClass(source.kind);
  factLifecycle.usageKind =
    usageKind(source.usageKind) ?? usageKind(source.usage_kind) ?? usageKind(source.usage);
  factLifecycle.basisStatus =
    factStatus(source.basisStatus) ??
    factStatus(source.basis_status) ??
    factStatus(source.status);
  factLifecycle.latestStatus =
    factStatus(source.latestStatus) ??
    factStatus(source.latest_status) ??
    factStatus(source.currentStatus) ??
    factStatus(source.current_status);
  factLifecycle.superseded =
    bool(source, 'superseded') ?? bool(source, 'isSuperseded') ?? bool(source, 'is_superseded');
  factLifecycle.replacementAvailable =
    bool(source, 'replacementAvailable') ??
    bool(source, 'replacement_available') ??
    bool(source, 'hasReplacement');
  factLifecycle.recoveryObserved =
    bool(source, 'recoveryObserved') ??
    bool(source, 'recovery_observed') ??
    bool(source, 'recovered');

  return Object.values(factLifecycle).some((v) => v !== undefined) ? factLifecycle : undefined;
}

function toCoordination(
  root: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolCall['coordination'] | undefined {
  const raw = asRecord(root.coordination);
  const inputRaw = asRecord(input.coordination);
  const source = Object.keys(inputRaw).length > 0 ? inputRaw : raw;
  if (Object.keys(source).length === 0) return undefined;

  const coordination: NonNullable<ToolCall['coordination']> = {};
  coordination.operation =
    coordinationOperation(source.operation) ??
    coordinationOperation(source.kind);
  coordination.branchFreshness =
    branchFreshness(source.branchFreshness) ??
    branchFreshness(source.branch_freshness) ??
    branchFreshness(source.freshness);
  coordination.overlapClass =
    overlapClass(source.overlapClass) ??
    overlapClass(source.overlap_class) ??
    overlapClass(source.overlap);
  coordination.fileLockPresent =
    bool(source, 'fileLockPresent') ??
    bool(source, 'file_lock_present') ??
    bool(source, 'fileLock');
  coordination.taskLeasePresent =
    bool(source, 'taskLeasePresent') ??
    bool(source, 'task_lease_present') ??
    bool(source, 'taskLease');
  coordination.intentLedgerPresent =
    bool(source, 'intentLedgerPresent') ??
    bool(source, 'intent_ledger_present') ??
    bool(source, 'intentLedger');
  coordination.mergeQueuePresent =
    bool(source, 'mergeQueuePresent') ??
    bool(source, 'merge_queue_present') ??
    bool(source, 'mergeQueue');
  coordination.semanticReviewPresent =
    bool(source, 'semanticReviewPresent') ??
    bool(source, 'semantic_review_present') ??
    bool(source, 'semanticReview');
  coordination.verificationCoverage =
    verificationCoverage(source.verificationCoverage) ??
    verificationCoverage(source.verification_coverage) ??
    verificationCoverage(source.coverage);

  return Object.values(coordination).some((v) => v !== undefined) ? coordination : undefined;
}

function toIntervention(
  root: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolCall['intervention'] | undefined {
  const raw = asRecord(root.intervention);
  const inputRaw = asRecord(input.intervention);
  const source = Object.keys(inputRaw).length > 0 ? inputRaw : raw;
  if (Object.keys(source).length === 0) return undefined;

  const intervention: NonNullable<ToolCall['intervention']> = {};
  intervention.operation =
    interventionOperation(source.operation) ??
    interventionOperation(source.kind);
  intervention.stateSource =
    interventionStateSource(source.stateSource) ??
    interventionStateSource(source.state_source) ??
    interventionStateSource(source.source);
  intervention.directive =
    interventionDirective(source.directive) ??
    interventionDirective(source.directive_state) ??
    interventionDirective(source.directiveState);
  intervention.planFreshness =
    branchFreshness(source.planFreshness) ??
    branchFreshness(source.plan_freshness) ??
    branchFreshness(source.freshness);
  intervention.resumeAuthorized =
    bool(source, 'resumeAuthorized') ??
    bool(source, 'resume_authorized') ??
    bool(source, 'authorized');
  intervention.approvalScope =
    approvalScope(source.approvalScope) ??
    approvalScope(source.approval_scope) ??
    approvalScope(source.scope);
  intervention.approvedActionMatch =
    bool(source, 'approvedActionMatch') ??
    bool(source, 'approved_action_match') ??
    bool(source, 'actionMatch');
  intervention.duplicateRisk =
    bool(source, 'duplicateRisk') ??
    bool(source, 'duplicate_risk') ??
    bool(source, 'alreadyCompleted');
  intervention.idempotentResume =
    bool(source, 'idempotentResume') ??
    bool(source, 'idempotent_resume') ??
    bool(source, 'resumeVerified');
  intervention.riskLevel =
    interventionRiskLevel(source.riskLevel) ??
    interventionRiskLevel(source.risk_level) ??
    interventionRiskLevel(source.risk);

  return Object.values(intervention).some((v) => v !== undefined) ? intervention : undefined;
}

function toWorkflowResume(
  root: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolCall['workflowResume'] | undefined {
  const raw = asRecord(root.workflow_resume);
  const camelRaw = asRecord(root.workflowResume);
  const inputRaw = asRecord(input.workflow_resume);
  const inputCamelRaw = asRecord(input.workflowResume);
  const source =
    Object.keys(inputRaw).length > 0
      ? inputRaw
      : Object.keys(inputCamelRaw).length > 0
        ? inputCamelRaw
        : Object.keys(raw).length > 0
          ? raw
          : camelRaw;
  if (Object.keys(source).length === 0) return undefined;

  const workflowResume: NonNullable<ToolCall['workflowResume']> = {};
  workflowResume.operation =
    workflowResumeOperation(source.operation) ??
    workflowResumeOperation(source.kind);
  workflowResume.workflowState =
    workflowState(source.workflowState) ??
    workflowState(source.workflow_state) ??
    workflowState(source.state);
  workflowResume.stepStatus =
    workflowStepStatus(source.stepStatus) ??
    workflowStepStatus(source.step_status) ??
    workflowStepStatus(source.status);
  workflowResume.approvalBinding =
    workflowApprovalBinding(source.approvalBinding) ??
    workflowApprovalBinding(source.approval_binding) ??
    workflowApprovalBinding(source.binding);
  workflowResume.bindingMatch =
    bool(source, 'bindingMatch') ??
    bool(source, 'binding_match') ??
    bool(source, 'approvedBindingMatch');
  workflowResume.remainingStepVerified =
    bool(source, 'remainingStepVerified') ??
    bool(source, 'remaining_step_verified') ??
    bool(source, 'verified');
  workflowResume.riskLevel =
    interventionRiskLevel(source.riskLevel) ??
    interventionRiskLevel(source.risk_level) ??
    interventionRiskLevel(source.risk);

  return Object.values(workflowResume).some((v) => v !== undefined) ? workflowResume : undefined;
}

function toApprovalEnvelope(
  root: Record<string, unknown>,
  input: Record<string, unknown>,
): ToolCall['approvalEnvelope'] | undefined {
  const raw = asRecord(root.approval_envelope);
  const camelRaw = asRecord(root.approvalEnvelope);
  const inputRaw = asRecord(input.approval_envelope);
  const inputCamelRaw = asRecord(input.approvalEnvelope);
  const source =
    Object.keys(inputRaw).length > 0
      ? inputRaw
      : Object.keys(inputCamelRaw).length > 0
        ? inputCamelRaw
        : Object.keys(raw).length > 0
          ? raw
          : camelRaw;
  if (Object.keys(source).length === 0) return undefined;

  const approvalEnvelope: NonNullable<ToolCall['approvalEnvelope']> = {};
  approvalEnvelope.operation =
    approvalEnvelopeOperation(source.operation) ??
    approvalEnvelopeOperation(source.kind);
  approvalEnvelope.riskLevel =
    interventionRiskLevel(source.riskLevel) ??
    interventionRiskLevel(source.risk_level) ??
    interventionRiskLevel(source.risk);
  approvalEnvelope.freshnessWindowMs =
    num(source, 'freshnessWindowMs') ??
    num(source, 'freshness_window_ms') ??
    num(source, 'ttlMs') ??
    num(source, 'ttl_ms');
  approvalEnvelope.observedAt =
    str(source, 'observedAt') ??
    str(source, 'observed_at') ??
    str(source, 'timestamp');
  approvalEnvelope.artifactDigest =
    str(source, 'artifactDigest') ??
    str(source, 'artifact_digest') ??
    str(source, 'artifact');
  approvalEnvelope.verificationDigest =
    str(source, 'verificationDigest') ??
    str(source, 'verification_digest') ??
    str(source, 'verification');
  approvalEnvelope.targetDigest =
    str(source, 'targetDigest') ??
    str(source, 'target_digest') ??
    str(source, 'target');

  return Object.values(approvalEnvelope).some((v) => v !== undefined) ? approvalEnvelope : undefined;
}

/**
 * Pure mapping from a raw Claude Code hook payload to an Aegis ToolCall.
 *
 * - `tool_name` -> `tool` (empty string when absent).
 * - `tool_input.command` -> `command` (Bash).
 * - `tool_input.content` (Write) or `new_string` (Edit) -> `content`.
 * - `tool_input.file_path` (Write/Edit/Read) -> `paths: [...]`.
 * - `handoff` or `tool_input.handoff` -> structured handoff metadata for SwarmLab-derived gates.
 * - `verification` / `completion` / `recall` / `content_boundary` / `fact_lifecycle` /
 *   `coordination` / `intervention` / `workflow_resume` / `approval_envelope` are parsed into the
 *   matching structured metadata surfaces when present.
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
  const contentBoundary = toContentBoundary(root, input);
  if (contentBoundary !== undefined) call.contentBoundary = contentBoundary;
  const factLifecycle = toFactLifecycle(root, input);
  if (factLifecycle !== undefined) call.factLifecycle = factLifecycle;
  const coordination = toCoordination(root, input);
  if (coordination !== undefined) call.coordination = coordination;
  const intervention = toIntervention(root, input);
  if (intervention !== undefined) call.intervention = intervention;
  const workflowResume = toWorkflowResume(root, input);
  if (workflowResume !== undefined) call.workflowResume = workflowResume;
  const approvalEnvelope = toApprovalEnvelope(root, input);
  if (approvalEnvelope !== undefined) call.approvalEnvelope = approvalEnvelope;
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
