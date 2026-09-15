import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Evaluation, ToolCall } from '@heybeaux/lattice-aegis';

const ID_PREFIX = 'aegis_';

export interface ApprovalRecord {
  id: string;
  createdAt: string;
  status: 'pending' | 'approved';
  signature: string;
  reason: string;
  action: 'ask';
  tool: string;
  actionKey?: string;
  approvalEnvelope?: NonNullable<ToolCall['approvalEnvelope']>;
  approvalProvenance?: NonNullable<ToolCall['approvalProvenance']>;
  approvalDelegation?: NonNullable<ToolCall['approvalDelegation']>;
}

export interface ApprovalExecutionPermit {
  id: string;
  approvalId: string;
}

export interface ApprovalExecutionSnapshot {
  approvalId: string;
  authorizationDigest?: string;
  effectiveConsumerId?: string;
  links?: NonNullable<ToolCall['approvalDelegation']>['links'];
  revoked?: boolean;
  revocationChecked?: boolean;
  structurallyValid?: boolean;
}

export interface ApprovalExecutionPermitRecord {
  id: string;
  approvalId: string;
  signature: string;
  authorizationDigest?: string;
  effectiveConsumerId?: string;
  links?: NonNullable<ToolCall['approvalDelegation']>['links'];
  declaredScope?: NonNullable<ToolCall['approvalDelegation']>['declaredScope'];
  maxDepth?: number;
}

/**
 * Host-provided shared transactional storage for execution permits.
 * `create` must atomically insert only when absent. `take` must atomically
 * return and delete at most one record across every participating host.
 */
export interface ApprovalExecutionPermitStore {
  create(record: ApprovalExecutionPermitRecord): Promise<boolean>;
  take(id: string): Promise<ApprovalExecutionPermitRecord | undefined>;
}

export interface ApprovalPaths {
  dir: string;
  pendingPath: string;
  approvedPath: string;
}

function approvalDir(dir?: string): string {
  return dir ?? process.env['AEGIS_APPROVAL_DIR'] ?? join(homedir(), '.aegis', 'approvals');
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function approvalEnvelopeBinding(
  value: ToolCall['approvalEnvelope'],
): Omit<NonNullable<ToolCall['approvalEnvelope']>, 'observedAt'> | undefined {
  if (value === undefined) return undefined;
  const {
    operation,
    riskLevel,
    freshnessWindowMs,
    artifactDigest,
    verificationDigest,
    targetDigest,
  } = value;
  return {
    ...(operation !== undefined ? { operation } : {}),
    ...(riskLevel !== undefined ? { riskLevel } : {}),
    ...(freshnessWindowMs !== undefined ? { freshnessWindowMs } : {}),
    ...(artifactDigest !== undefined ? { artifactDigest } : {}),
    ...(verificationDigest !== undefined ? { verificationDigest } : {}),
    ...(targetDigest !== undefined ? { targetDigest } : {}),
  };
}

function approvalProvenanceBinding(
  value: ToolCall['approvalProvenance'],
): NonNullable<ToolCall['approvalProvenance']> | undefined {
  if (value === undefined) return undefined;
  const { actorId, sessionId, workspaceId, taskIntentId, authorizationDigest, grantScope } = value;
  return {
    ...(actorId !== undefined ? { actorId } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(taskIntentId !== undefined ? { taskIntentId } : {}),
    ...(authorizationDigest !== undefined ? { authorizationDigest } : {}),
    ...(grantScope !== undefined ? { grantScope } : {}),
    ...(grantScope !== 'workspace' && sessionId !== undefined ? { sessionId } : {}),
  };
}

function approvalProvenanceSignatureBinding(
  provenance: ToolCall['approvalProvenance'],
  delegation: ToolCall['approvalDelegation'],
): NonNullable<ToolCall['approvalProvenance']> | undefined {
  const bound = approvalProvenanceBinding(provenance);
  if (bound === undefined || delegation === undefined) return bound;
  const { actorId: _actorId, ...withoutActor } = bound;
  return withoutActor;
}

function approvalDelegationBinding(
  value: ToolCall['approvalDelegation'],
): Pick<
  NonNullable<ToolCall['approvalDelegation']>,
  'declaredScope' | 'maxDepth'
> | undefined {
  if (value === undefined) return undefined;
  const { declaredScope, maxDepth } = value;
  return {
    ...(declaredScope !== undefined ? { declaredScope } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
  };
}

function approvalDelegationForRecord(
  value: ToolCall['approvalDelegation'],
): NonNullable<ToolCall['approvalDelegation']> | undefined {
  if (value === undefined) return undefined;
  const {
    effectiveConsumerId,
    declaredScope,
    maxDepth,
    links,
    revoked,
    revocationChecked,
    structurallyValid,
  } = value;
  return {
    ...(effectiveConsumerId !== undefined ? { effectiveConsumerId } : {}),
    ...(declaredScope !== undefined ? { declaredScope } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(links !== undefined
      ? {
          links: links.map((link) => ({
            ...(link.actorId !== undefined ? { actorId: link.actorId } : {}),
            ...(link.verified !== undefined ? { verified: link.verified } : {}),
            ...(link.authorityLevel !== undefined ? { authorityLevel: link.authorityLevel } : {}),
            ...(link.revoked !== undefined ? { revoked: link.revoked } : {}),
          })),
        }
      : {}),
    ...(revoked !== undefined ? { revoked } : {}),
    ...(revocationChecked !== undefined ? { revocationChecked } : {}),
    ...(structurallyValid !== undefined ? { structurallyValid } : {}),
  };
}

function approvalEnvelopeObservedAt(value: ToolCall['approvalEnvelope']): string | undefined {
  return value?.observedAt;
}

function approvalEnvelopeForRecord(
  value: ToolCall['approvalEnvelope'],
): NonNullable<ToolCall['approvalEnvelope']> | undefined {
  if (value === undefined) return undefined;
  return {
    ...(approvalEnvelopeBinding(value) ?? {}),
    ...(approvalEnvelopeObservedAt(value) !== undefined
      ? { observedAt: approvalEnvelopeObservedAt(value) }
      : {}),
  };
}

function parseIsoMillis(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function approvalDelegationValid(
  approved: ApprovalRecord,
  call: ToolCall,
): boolean {
  const granted = approved.approvalDelegation;
  const retry = call.approvalDelegation;
  if (granted === undefined && retry === undefined) return true;
  if (granted === undefined || retry === undefined) return false;

  const rootActor = approved.approvalProvenance?.actorId;
  const consumer = retry.effectiveConsumerId;
  const declaredScope = granted.declaredScope;
  const links = retry.links;
  const maxDepth = granted.maxDepth;
  if (
    rootActor === undefined ||
    consumer === undefined ||
    declaredScope === undefined ||
    links === undefined ||
    links.length === 0 ||
    maxDepth === undefined ||
    !Number.isSafeInteger(maxDepth) ||
    maxDepth < 0 ||
    retry.revocationChecked !== true ||
    retry.revoked !== false ||
    retry.structurallyValid !== true ||
    links.length - 1 > maxDepth ||
    links[0]?.actorId !== rootActor ||
    links[links.length - 1]?.actorId !== consumer
  ) {
    return false;
  }
  const depth = links.length - 1;
  if (consumer === rootActor && depth === 0) return true;
  if (declaredScope === 'none' || (declaredScope === 'direct' && depth !== 1)) return false;
  if (declaredScope !== 'direct' && declaredScope !== 'bounded') return false;

  let parentAuthority: number | undefined;
  for (let i = 0; i < links.length; i += 1) {
    const link = links[i];
    if (
      link === undefined ||
      link.actorId === undefined ||
      link.verified !== true ||
      link.authorityLevel === undefined ||
      !Number.isFinite(link.authorityLevel) ||
      link.revoked === true ||
      (i > 0 && parentAuthority !== undefined && link.authorityLevel > parentAuthority)
    ) {
      return false;
    }
    parentAuthority = link.authorityLevel;
  }
  return true;
}

function approvalExpired(approved: ApprovalRecord | undefined, call: ToolCall): boolean {
  if (approved === undefined) return false;
  const approvedEnvelope = approved?.approvalEnvelope;
  const retryEnvelope = call.approvalEnvelope;
  if (
    approvedEnvelope?.operation !== 'approved_retry' ||
    retryEnvelope?.operation !== 'approved_retry' ||
    approvedEnvelope.freshnessWindowMs === undefined
  ) {
    return false;
  }
  const approvedAt =
    parseIsoMillis(approvedEnvelope.observedAt) ??
    parseIsoMillis(approved.createdAt);
  const retryAt = parseIsoMillis(retryEnvelope.observedAt);
  if (approvedAt === undefined || retryAt === undefined) return false;
  return retryAt - approvedAt > approvedEnvelope.freshnessWindowMs;
}

function signaturePayload(call: ToolCall, evaluation: Evaluation): unknown {
  return {
    call: {
      tool: call.tool,
      command: call.command,
      content: call.content,
      paths: call.paths,
      argv: call.argv,
      handoff: call.handoff,
      verification: call.verification,
      completion: call.completion,
      recall: call.recall,
      contentBoundary: call.contentBoundary,
      factLifecycle: call.factLifecycle,
      coordination: call.coordination,
      intervention: call.intervention,
      workflowResume: call.workflowResume,
      approvalEnvelope: approvalEnvelopeBinding(call.approvalEnvelope),
      approvalProvenance: approvalProvenanceSignatureBinding(
        call.approvalProvenance,
        call.approvalDelegation,
      ),
      approvalDelegation: approvalDelegationBinding(call.approvalDelegation),
    },
    evaluation: {
      action: evaluation.action,
      reason: evaluation.reason,
      matches: evaluation.matches.map((m) => ({
        id: m.id,
        severity: m.severity,
        category: m.category,
        target: m.target,
      })),
    },
  };
}

export function approvalSignature(call: ToolCall, evaluation: Evaluation): string {
  return createHash('sha256').update(stable(signaturePayload(call, evaluation))).digest('hex');
}

export function approvalId(call: ToolCall, evaluation: Evaluation): string {
  return `${ID_PREFIX}${approvalSignature(call, evaluation).slice(0, 16)}`;
}

export function approvalPaths(id: string, dir?: string): ApprovalPaths {
  if (!/^aegis_[a-f0-9]{16}$/.test(id)) {
    throw new Error(`invalid approval id: ${id}`);
  }
  const root = approvalDir(dir);
  return {
    dir: root,
    pendingPath: join(root, `${id}.pending.json`),
    approvedPath: join(root, `${id}.approved.json`),
  };
}

function recordFor(
  id: string,
  call: ToolCall,
  evaluation: Evaluation,
  status: ApprovalRecord['status'],
  actionKey?: string,
): ApprovalRecord {
  return {
    id,
    createdAt: new Date().toISOString(),
    status,
    signature: approvalSignature(call, evaluation),
    reason: evaluation.reason,
    action: 'ask',
    tool: call.tool,
    ...(actionKey !== undefined ? { actionKey } : {}),
    ...(approvalEnvelopeForRecord(call.approvalEnvelope) !== undefined
      ? { approvalEnvelope: approvalEnvelopeForRecord(call.approvalEnvelope) }
      : {}),
    ...(approvalProvenanceBinding(call.approvalProvenance) !== undefined
      ? { approvalProvenance: approvalProvenanceBinding(call.approvalProvenance) }
      : {}),
    ...(approvalDelegationForRecord(call.approvalDelegation) !== undefined
      ? { approvalDelegation: approvalDelegationForRecord(call.approvalDelegation) }
      : {}),
  };
}

function readRecord(path: string): ApprovalRecord | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ApprovalRecord;
  } catch {
    return undefined;
  }
}

export function requestApproval(
  call: ToolCall,
  evaluation: Evaluation,
  dir?: string,
  actionKey?: string,
): ApprovalRecord {
  const id = approvalId(call, evaluation);
  const paths = approvalPaths(id, dir);
  mkdirSync(paths.dir, { recursive: true });
  const existing = readRecord(paths.pendingPath);
  if (existing?.signature === approvalSignature(call, evaluation)) return existing;
  const record = recordFor(id, call, evaluation, 'pending', actionKey);
  writeFileSync(paths.pendingPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

export function approvePending(id: string, dir?: string): ApprovalRecord {
  const paths = approvalPaths(id, dir);
  const pending = readRecord(paths.pendingPath);
  if (pending === undefined) throw new Error(`no pending Aegis approval found for ${id}`);
  const approved: ApprovalRecord = { ...pending, status: 'approved', createdAt: new Date().toISOString() };
  writeFileSync(paths.approvedPath, JSON.stringify(approved, null, 2) + '\n', 'utf8');
  return approved;
}

export function consumeApproval(call: ToolCall, evaluation: Evaluation, dir?: string): boolean {
  const id = approvalId(call, evaluation);
  const paths = approvalPaths(id, dir);
  if (!existsSync(paths.approvedPath)) return false;
  const consumingPath = join(paths.dir, `${id}.consuming.json`);
  try {
    renameSync(paths.approvedPath, consumingPath);
  } catch {
    return false;
  }
  const approved = readRecord(consumingPath);
  const expected = approvalSignature(call, evaluation);
  if (approved?.signature !== expected) {
    try {
      renameSync(consumingPath, paths.approvedPath);
    } catch {
      rmSync(consumingPath, { force: true });
    }
    return false;
  }
  if (approved !== undefined && !approvalDelegationValid(approved, call)) {
    try {
      renameSync(consumingPath, paths.approvedPath);
    } catch {
      rmSync(consumingPath, { force: true });
    }
    return false;
  }
  if (approvalExpired(approved, call)) {
    rmSync(consumingPath, { force: true });
    rmSync(paths.pendingPath, { force: true });
    return false;
  }
  rmSync(consumingPath, { force: true });
  rmSync(paths.pendingPath, { force: true });
  return true;
}


function executionPermitId(approvalIdValue: string, signature: string): string {
  return `permit_${createHash('sha256').update(`${approvalIdValue}:${signature}`).digest('hex').slice(0, 24)}`;
}

function executionPermitPath(id: string, dir?: string): string {
  if (!/^permit_[a-f0-9]{24}$/.test(id)) throw new Error(`invalid execution permit id: ${id}`);
  return join(approvalDir(dir), `${id}.ready.json`);
}

function executionPermitRecord(
  call: ToolCall,
  evaluation: Evaluation,
  approvalIdValue: string,
): ApprovalExecutionPermitRecord {
  if (approvalIdValue !== approvalId(call, evaluation)) {
    throw new Error('approval id does not match the consumed call');
  }
  const delegation = call.approvalDelegation;
  const signature = approvalSignature(call, evaluation);
  const id = executionPermitId(approvalIdValue, signature);
  return {
    id,
    approvalId: approvalIdValue,
    signature,
    ...(call.approvalProvenance?.authorizationDigest !== undefined
      ? { authorizationDigest: call.approvalProvenance.authorizationDigest }
      : {}),
    ...(delegation?.effectiveConsumerId !== undefined
      ? { effectiveConsumerId: delegation.effectiveConsumerId }
      : {}),
    ...(delegation?.links !== undefined
      ? { links: delegation.links.map((link) => ({ ...link })) }
      : {}),
    ...(delegation?.declaredScope !== undefined ? { declaredScope: delegation.declaredScope } : {}),
    ...(delegation?.maxDepth !== undefined ? { maxDepth: delegation.maxDepth } : {}),
  };
}

/**
 * Create a host-finalized execution permit after a successful approval consumption.
 * The caller must pass the exact call/evaluation that produced the consumed decision.
 */
export function createExecutionPermit(
  call: ToolCall,
  evaluation: Evaluation,
  approvalIdValue: string,
  dir?: string,
): ApprovalExecutionPermit {
  const record = executionPermitRecord(call, evaluation, approvalIdValue);
  mkdirSync(approvalDir(dir), { recursive: true });
  const path = executionPermitPath(record.id, dir);
  if (existsSync(path)) throw new Error(`execution permit already exists for ${approvalIdValue}`);
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  return { id: record.id, approvalId: approvalIdValue };
}

/**
 * Create a globally one-shot permit in a host-provided transactional store.
 * Store failure and duplicate creation fail closed by rejecting the operation.
 */
export async function createExecutionPermitWithStore(
  call: ToolCall,
  evaluation: Evaluation,
  approvalIdValue: string,
  store: ApprovalExecutionPermitStore,
): Promise<ApprovalExecutionPermit> {
  const record = executionPermitRecord(call, evaluation, approvalIdValue);
  let created = false;
  try {
    created = await store.create(record);
  } catch (error) {
    throw new Error('execution permit store unavailable during create', { cause: error });
  }
  if (!created) throw new Error(`execution permit already exists for ${approvalIdValue}`);
  return { id: record.id, approvalId: record.approvalId };
}

function executionSnapshotValid(
  record: ApprovalExecutionPermitRecord,
  current: ApprovalExecutionSnapshot,
): boolean {
  if (
    current.approvalId !== record.approvalId ||
    current.revocationChecked !== true ||
    current.revoked !== false ||
    current.structurallyValid !== true ||
    record.authorizationDigest === undefined ||
    current.authorizationDigest !== record.authorizationDigest ||
    record.effectiveConsumerId === undefined ||
    current.effectiveConsumerId !== record.effectiveConsumerId ||
    record.links === undefined ||
    current.links === undefined ||
    record.declaredScope === undefined ||
    record.maxDepth === undefined ||
    !Number.isSafeInteger(record.maxDepth) ||
    record.maxDepth < 0 ||
    stable(record.links) !== stable(current.links) ||
    current.links.length === 0 ||
    current.links.length - 1 > record.maxDepth ||
    current.links[current.links.length - 1]?.actorId !== current.effectiveConsumerId
  ) return false;
  const depth = current.links.length - 1;
  if (record.declaredScope === 'none' && depth !== 0) return false;
  if (record.declaredScope === 'direct' && depth !== 1) return false;
  if (record.declaredScope !== 'none' && record.declaredScope !== 'direct' && record.declaredScope !== 'bounded') return false;
  let parentAuthority: number | undefined;
  for (const link of current.links) {
    if (
      link.actorId === undefined ||
      link.verified !== true ||
      link.revoked === true ||
      link.authorityLevel === undefined ||
      !Number.isFinite(link.authorityLevel) ||
      (parentAuthority !== undefined && link.authorityLevel > parentAuthority)
    ) return false;
    parentAuthority = link.authorityLevel;
  }
  return true;
}

/**
 * Atomically consume a one-shot permit against the latest host-supplied authority snapshot.
 * Invalid snapshots burn the permit and force a fresh approval; a concurrent/replayed caller loses
 * the atomic rename and cannot execute.
 */
export function finalizeExecutionPermit(
  permit: ApprovalExecutionPermit,
  current: ApprovalExecutionSnapshot,
  dir?: string,
): boolean {
  if (permit.approvalId !== current.approvalId) return false;
  const path = executionPermitPath(permit.id, dir);
  const finalizing = join(approvalDir(dir), `${permit.id}.finalizing.json`);
  try { renameSync(path, finalizing); } catch { return false; }
  try {
    const record = readRecord(finalizing) as ApprovalExecutionPermitRecord | undefined;
    return record?.id === permit.id && executionSnapshotValid(record, current);
  } finally {
    rmSync(finalizing, { force: true });
  }
}

/**
 * Atomically take and burn a permit from shared storage before validating the latest snapshot.
 * Missing, malformed, replayed, or unavailable store results fail closed. Store errors are
 * deliberately converted to `false` at this side-effect boundary.
 */
export async function finalizeExecutionPermitWithStore(
  permit: ApprovalExecutionPermit,
  current: ApprovalExecutionSnapshot,
  store: ApprovalExecutionPermitStore,
): Promise<boolean> {
  if (!/^permit_[a-f0-9]{24}$/.test(permit.id)) return false;
  if (!/^aegis_[a-f0-9]{16}$/.test(permit.approvalId)) return false;
  if (permit.approvalId !== current.approvalId) return false;
  let record: ApprovalExecutionPermitRecord | undefined;
  try {
    record = await store.take(permit.id);
  } catch {
    return false;
  }
  return record?.id === permit.id &&
    record.approvalId === permit.approvalId &&
    executionSnapshotValid(record, current);
}

export type ApprovalExecutionFinalizationStatus = 'execute' | 'blocked' | 'indeterminate';

export interface ApprovalExecutionFinalizationResult {
  status: ApprovalExecutionFinalizationStatus;
  /** True only when a fresh operation id may safely retry the take. */
  retryable: boolean;
  reason?: 'not_taken' | 'invalid_snapshot' | 'store_unavailable' | 'status_unavailable' |
    'effect_started' | 'effect_committed' | 'effect_failed' | 'authorization_burned' | 'journal_missing' | 'journal_inconsistent';
}

/**
 * Reconciliation-capable shared storage. Implementations MUST commit the permit removal and
 * operation-journal entry in one transaction. `claimPreparedTake` MUST atomically return and
 * delete the operation result, so a successful finalization can authorize execution once only.
 */
export interface ReconciledApprovalExecutionPermitStore extends ApprovalExecutionPermitStore {
  prepareTake(id: string, operationId: string): Promise<boolean>;
  claimPreparedTake(operationId: string): Promise<ApprovalExecutionPermitRecord | undefined>;
}

function validExecutionOperationId(value: string): boolean {
  return /^op_[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
}

/**
 * Finalize a shared permit without collapsing acknowledgement loss into a false definitive answer.
 *
 * A thrown `prepareTake` is intentionally followed by operation-status reconciliation: the store
 * may have committed before transport failed. If status cannot be read, the answer is explicitly
 * indeterminate and execution remains blocked. The claimed operation result is destructive, making
 * repeated reconciliation and duplicate operation ids one-shot.
 */
export async function finalizeExecutionPermitWithReconciliation(
  permit: ApprovalExecutionPermit,
  current: ApprovalExecutionSnapshot,
  operationId: string,
  store: ReconciledApprovalExecutionPermitStore,
): Promise<ApprovalExecutionFinalizationResult> {
  const blocked = (
    reason: NonNullable<ApprovalExecutionFinalizationResult['reason']>,
    retryable = false,
  ): ApprovalExecutionFinalizationResult => ({ status: 'blocked', retryable, reason });
  if (!/^permit_[a-f0-9]{24}$/.test(permit.id)) return blocked('invalid_snapshot');
  if (!/^aegis_[a-f0-9]{16}$/.test(permit.approvalId)) return blocked('invalid_snapshot');
  if (permit.approvalId !== current.approvalId) return blocked('invalid_snapshot');
  if (!validExecutionOperationId(operationId)) return blocked('invalid_snapshot');

  try {
    const prepared = await store.prepareTake(permit.id, operationId);
    if (!prepared) return blocked('not_taken', true);
  } catch {
    // Outcome is unknown: reconcile the operation journal below rather than guessing.
  }

  let record: ApprovalExecutionPermitRecord | undefined;
  try {
    record = await store.claimPreparedTake(operationId);
  } catch {
    return { status: 'indeterminate', retryable: false, reason: 'status_unavailable' };
  }
  if (record === undefined) return blocked('not_taken', true);
  if (
    record.id !== permit.id ||
    record.approvalId !== permit.approvalId ||
    !executionSnapshotValid(record, current)
  ) return blocked('invalid_snapshot');
  return { status: 'execute', retryable: false };
}


export type ApprovalExecutionEffectState = 'authorized' | 'started' | 'committed' | 'failed' | 'burned';

export interface ApprovalExecutionEffectRecord {
  operationId: string;
  permit: ApprovalExecutionPermitRecord;
  state: ApprovalExecutionEffectState;
  /** True after one caller has received the initial execute authority. */
  claimed: boolean;
  /** Exact first successful terminal receipt, retained for lost-acknowledgement reconciliation. */
  successReceipt?: ApprovalExecutionEffectReceipt;
  /** Exact first failed terminal receipt, retained for lost-acknowledgement reconciliation. */
  failureReceipt?: ApprovalExecutionEffectFailureReceipt;
}

function effectRecordMatches(
  value: unknown,
  permit: ApprovalExecutionPermit,
  operationId: string,
): value is ApprovalExecutionEffectRecord {
  if (value === null || typeof value !== 'object') return false;
  const effect = value as Partial<ApprovalExecutionEffectRecord>;
  if (
    effect.operationId !== operationId ||
    effect.claimed !== true && effect.claimed !== false ||
    !['authorized', 'started', 'committed', 'failed', 'burned'].includes(String(effect.state)) ||
    effect.permit === null ||
    typeof effect.permit !== 'object'
  ) return false;
  return permitRecordMatches(effect.permit, permit);
}

function permitRecordMatches(
  value: unknown,
  permit: ApprovalExecutionPermit,
): value is ApprovalExecutionPermitRecord {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Partial<ApprovalExecutionPermitRecord>;
  if (
    record.id !== permit.id ||
    record.approvalId !== permit.approvalId ||
    typeof record.signature !== 'string' ||
    record.signature.length === 0
  ) return false;
  return executionPermitId(record.approvalId, record.signature) === record.id;
}

/**
 * Durable post-authorization journal supplied by the host.
 *
 * `prepareEffect` MUST atomically remove the permit and insert an `authorized` effect record.
 * Reusing an operation id for the same permit is idempotent; binding it to another permit fails.
 * `claimPreparedEffect` MUST authorize at most one initial caller while retaining the record.
 * `beginEffect` is written immediately before invoking the external effect, `commitEffect`
 * immediately after successful completion, and `readEffect` MUST be a durable cross-host read.
 * `burnEffect` permanently invalidates an uncommitted authorization.
 */
export interface JournaledApprovalExecutionPermitStore extends ApprovalExecutionPermitStore {
  prepareEffect(id: string, operationId: string): Promise<boolean>;
  claimPreparedEffect(operationId: string): Promise<ApprovalExecutionPermitRecord | undefined>;
  beginEffect(operationId: string): Promise<boolean>;
  commitEffect(operationId: string): Promise<boolean>;
  readEffect(operationId: string): Promise<ApprovalExecutionEffectRecord | undefined>;
  burnEffect(operationId: string): Promise<boolean>;
}

export type ApprovalExecutionEffectResolutionStatus = 'executed' | 'not_executed' | 'indeterminate';

export interface ApprovalExecutionEffectResolutionResult {
  status: ApprovalExecutionEffectResolutionStatus;
  /** True only for an untouched, still-valid authorization whose effect may now run. */
  retryable: boolean;
  reason?: 'not_started' | 'effect_started' | 'effect_committed' | 'effect_failed' | 'authorization_burned' |
    'invalid_snapshot' | 'journal_missing' | 'journal_unavailable' | 'journal_inconsistent';
}

/**
 * Finalize a permit into a retained effect authorization. Unlike RT-22's destructive operation
 * claim, this leaves durable state available after `execute` has been returned.
 */
export async function finalizeExecutionPermitWithEffectJournal(
  permit: ApprovalExecutionPermit,
  current: ApprovalExecutionSnapshot,
  operationId: string,
  store: JournaledApprovalExecutionPermitStore,
): Promise<ApprovalExecutionFinalizationResult> {
  const blocked = (
    reason: NonNullable<ApprovalExecutionFinalizationResult['reason']>,
    retryable = false,
  ): ApprovalExecutionFinalizationResult => ({ status: 'blocked', retryable, reason });
  if (!/^permit_[a-f0-9]{24}$/.test(permit.id)) return blocked('invalid_snapshot');
  if (!/^aegis_[a-f0-9]{16}$/.test(permit.approvalId)) return blocked('invalid_snapshot');
  if (permit.approvalId !== current.approvalId) return blocked('invalid_snapshot');
  if (!validExecutionOperationId(operationId)) return blocked('invalid_snapshot');

  let prepared: boolean | undefined;
  try {
    prepared = await store.prepareEffect(permit.id, operationId);
  } catch {
    // The atomic prepare may have committed before its acknowledgement was lost. Reconcile the
    // retained claim below instead of orphaning it or claiming a definitive store failure.
  }
  if (prepared === false) return blocked('not_taken', true);

  let record: unknown;
  try {
    record = await store.claimPreparedEffect(operationId);
  } catch {
    return { status: 'indeterminate', retryable: false, reason: 'status_unavailable' };
  }
  if (record === undefined) return blocked('not_taken', prepared === undefined);
  if (
    !permitRecordMatches(record, permit) ||
    !executionSnapshotValid(record, current)
  ) {
    try {
      const burned = await store.burnEffect(operationId);
      if (!burned) return { status: 'indeterminate', retryable: false, reason: 'status_unavailable' };
    } catch {
      return { status: 'indeterminate', retryable: false, reason: 'status_unavailable' };
    }
    return blocked('invalid_snapshot');
  }
  return { status: 'execute', retryable: false };
}

/** Resolve a crashed effect without guessing from a missing permit or operation claim. */
export async function resolveExecutionEffect(
  permit: ApprovalExecutionPermit,
  current: ApprovalExecutionSnapshot,
  operationId: string,
  store: JournaledApprovalExecutionPermitStore,
): Promise<ApprovalExecutionEffectResolutionResult> {
  const indeterminate = (
    reason: NonNullable<ApprovalExecutionEffectResolutionResult['reason']>,
  ): ApprovalExecutionEffectResolutionResult => ({ status: 'indeterminate', retryable: false, reason });
  if (!presentObject(permit) || !presentObject(current)) {
    return { status: 'not_executed', retryable: false, reason: 'invalid_snapshot' };
  }
  if (
    !/^permit_[a-f0-9]{24}$/.test(permit.id) ||
    !/^aegis_[a-f0-9]{16}$/.test(permit.approvalId) ||
    permit.approvalId !== current.approvalId ||
    !validExecutionOperationId(operationId)
  ) return { status: 'not_executed', retryable: false, reason: 'invalid_snapshot' };

  let effect: unknown;
  try {
    effect = await store.readEffect(operationId);
  } catch {
    return indeterminate('journal_unavailable');
  }
  if (!effectRecordMatches(effect, permit, operationId)) return indeterminate('journal_missing');
  if (!effectJournalCoherent(effect, permit, operationId, receiptCapableStore(store))) {
    return indeterminate('journal_inconsistent');
  }

  if (effect.state === 'committed') {
    return { status: 'executed', retryable: false, reason: 'effect_committed' };
  }
  if (effect.state === 'failed') {
    return { status: 'not_executed', retryable: false, reason: 'effect_failed' };
  }
  if (effect.state === 'started') return indeterminate('effect_started');
  if (effect.state === 'burned') {
    return { status: 'not_executed', retryable: false, reason: 'authorization_burned' };
  }
  if (effect.state !== 'authorized' || !effect.claimed) return indeterminate('journal_missing');

  if (!executionSnapshotValid(effect.permit, current)) {
    try { await store.burnEffect(operationId); } catch { return indeterminate('journal_unavailable'); }
    return { status: 'not_executed', retryable: false, reason: 'invalid_snapshot' };
  }
  return { status: 'not_executed', retryable: true, reason: 'not_started' };
}

/**
 * Revalidate and atomically fence the transition immediately before the host invokes an effect.
 * A successful compare-and-set authorizes exactly one caller; all losing callers remain blocked.
 */
export async function beginExecutionEffect(
  permit: ApprovalExecutionPermit,
  current: ApprovalExecutionSnapshot,
  operationId: string,
  store: JournaledApprovalExecutionPermitStore,
): Promise<ApprovalExecutionFinalizationResult> {
  const blocked = (
    reason: NonNullable<ApprovalExecutionFinalizationResult['reason']>,
  ): ApprovalExecutionFinalizationResult => ({ status: 'blocked', retryable: false, reason });
  if (!presentObject(permit) || !presentObject(current)) return blocked('invalid_snapshot');
  if (
    !/^permit_[a-f0-9]{24}$/.test(permit.id) ||
    !/^aegis_[a-f0-9]{16}$/.test(permit.approvalId) ||
    permit.approvalId !== current.approvalId ||
    !validExecutionOperationId(operationId)
  ) return blocked('invalid_snapshot');

  let effect: unknown;
  try {
    effect = await store.readEffect(operationId);
  } catch {
    return { status: 'indeterminate', retryable: false, reason: 'status_unavailable' };
  }
  if (!effectRecordMatches(effect, permit, operationId)) return blocked('journal_missing');
  if (!effectJournalCoherent(effect, permit, operationId, receiptCapableStore(store))) return blocked('journal_inconsistent');
  if (effect.state === 'committed') return blocked('effect_committed');
  if (effect.state === 'started') return blocked('effect_started');
  if (effect.state === 'burned') return blocked('authorization_burned');
  if (effect.state !== 'authorized' || !effect.claimed) return blocked('journal_missing');

  if (!executionSnapshotValid(effect.permit, current)) {
    try { await store.burnEffect(operationId); } catch {
      return { status: 'indeterminate', retryable: false, reason: 'status_unavailable' };
    }
    return blocked('invalid_snapshot');
  }

  let started = false;
  try {
    started = await store.beginEffect(operationId);
  } catch {
    return { status: 'indeterminate', retryable: false, reason: 'status_unavailable' };
  }
  if (!started) {
    // A failed CAS can mean another host just started or committed. Read once to report honestly.
    try {
      const latest: unknown = await store.readEffect(operationId);
      if (!effectRecordMatches(latest, permit, operationId)) return blocked('journal_missing');
      if (!effectJournalCoherent(latest, permit, operationId, receiptCapableStore(store))) {
        return blocked('journal_inconsistent');
      }
      if (latest.state === 'committed') return blocked('effect_committed');
      if (latest.state === 'failed') return blocked('effect_failed');
      if (latest.state === 'started') return blocked('effect_started');
      if (latest.state === 'burned') return blocked('authorization_burned');
    } catch {
      return { status: 'indeterminate', retryable: false, reason: 'status_unavailable' };
    }
    return { status: 'indeterminate', retryable: false, reason: 'status_unavailable' };
  }
  return { status: 'execute', retryable: false };
}

export interface ApprovalExecutionEffectReceipt {
  permitId: string;
  approvalId: string;
  operationId: string;
  /** Host-produced digest of independently inspected desired-state evidence. */
  receiptDigest: string;
  /** True only after the host has independently verified the desired state. */
  verified: boolean;
}

export type ApprovalExecutionEffectCommitStatus =
  | 'committed'
  | 'already_committed'
  | 'conflict'
  | 'not_started';

export interface ReceiptedApprovalExecutionPermitStore extends JournaledApprovalExecutionPermitStore {
  /** Atomically persist the first receipt and commit the effect; exact duplicates are idempotent. */
  completeEffect(
    operationId: string,
    receipt: ApprovalExecutionEffectReceipt,
  ): Promise<ApprovalExecutionEffectCommitStatus>;
}

export type ApprovalExecutionEffectCompletionStatus = 'executed' | 'blocked' | 'indeterminate';
export interface ApprovalExecutionEffectCompletionResult {
  status: ApprovalExecutionEffectCompletionStatus;
  reason?: 'invalid_receipt' | 'unverified_receipt' | 'receipt_unverified' | 'receipt_conflict' |
    'effect_not_started' | 'store_unavailable';
}

function validReceiptDigest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value);
}

export interface ApprovalExecutionEffectFailureReceipt extends ApprovalExecutionEffectReceipt {
  /** Stable machine-readable classification of the independently verified non-success. */
  failureCode: string;
}

export type ApprovalExecutionEffectFailureCommitStatus =
  | 'failed'
  | 'already_failed'
  | 'conflict'
  | 'not_started';

export interface FailureReceiptedApprovalExecutionPermitStore extends JournaledApprovalExecutionPermitStore {
  /** Atomically persist the first negative receipt; committed success remains monotonic. */
  failEffect(
    operationId: string,
    receipt: ApprovalExecutionEffectFailureReceipt,
  ): Promise<ApprovalExecutionEffectFailureCommitStatus>;
}

export type ApprovalExecutionEffectFailureStatus = 'failed' | 'blocked' | 'indeterminate';
export interface ApprovalExecutionEffectFailureResult {
  status: ApprovalExecutionEffectFailureStatus;
  reason?: 'invalid_receipt' | 'unverified_receipt' | 'receipt_unverified' | 'receipt_conflict' |
    'effect_not_started' | 'store_unavailable';
}

/**
 * Governance boundaries must fail closed on absent structured input rather than throwing.
 * A caller that passes a null/undefined permit, snapshot, or receipt is an untrusted or buggy
 * host; a thrown TypeError would escape the decision path and could be caught upstream as a
 * transient error, so every effect boundary treats missing input as invalid, not exceptional.
 */
function presentObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validFailureCode(value: string): boolean {
  return /^[a-z0-9_]{1,64}$/.test(value);
}

function validStoredSuccessReceipt(
  value: unknown,
  permit: ApprovalExecutionPermit,
  operationId: string,
): value is ApprovalExecutionEffectReceipt {
  if (!presentObject(value)) return false;
  return value.permitId === permit.id &&
    value.approvalId === permit.approvalId &&
    value.operationId === operationId &&
    typeof value.receiptDigest === 'string' &&
    validReceiptDigest(value.receiptDigest) &&
    value.verified === true &&
    !('failureCode' in value);
}

function validStoredFailureReceipt(
  value: unknown,
  permit: ApprovalExecutionPermit,
  operationId: string,
): value is ApprovalExecutionEffectFailureReceipt {
  if (!presentObject(value)) return false;
  return value.permitId === permit.id &&
    value.approvalId === permit.approvalId &&
    value.operationId === operationId &&
    typeof value.receiptDigest === 'string' &&
    validReceiptDigest(value.receiptDigest) &&
    value.verified === true &&
    typeof value.failureCode === 'string' &&
    validFailureCode(value.failureCode);
}

/**
 * Treat state and receipt as one integrity envelope. Terminal certainty requires exactly one
 * valid receipt of the matching kind; nonterminal records must not carry terminal fragments.
 * This is a defensive read boundary: hosts still own atomic persistence and repair.
 */
function receiptCapableStore(store: JournaledApprovalExecutionPermitStore): boolean {
  const candidate = store as Partial<ReceiptedApprovalExecutionPermitStore & FailureReceiptedApprovalExecutionPermitStore>;
  return typeof candidate.completeEffect === 'function' || typeof candidate.failEffect === 'function';
}

function effectJournalCoherent(
  effect: ApprovalExecutionEffectRecord,
  permit: ApprovalExecutionPermit,
  operationId: string,
  requireTerminalReceipt = true,
): boolean {
  const hasSuccess = effect.successReceipt !== undefined;
  const hasFailure = effect.failureReceipt !== undefined;
  if (effect.state === 'committed') {
    if (!hasSuccess && !hasFailure && !requireTerminalReceipt) return true;
    return validStoredSuccessReceipt(effect.successReceipt, permit, operationId) && !hasFailure;
  }
  if (effect.state === 'failed') {
    if (!hasSuccess && !hasFailure && !requireTerminalReceipt) return true;
    return validStoredFailureReceipt(effect.failureReceipt, permit, operationId) && !hasSuccess;
  }
  return !hasSuccess && !hasFailure;
}

function successReceiptMatches(
  value: unknown,
  expected: ApprovalExecutionEffectReceipt,
): boolean {
  if (!presentObject(value)) return false;
  return value.permitId === expected.permitId &&
    value.approvalId === expected.approvalId &&
    value.operationId === expected.operationId &&
    value.receiptDigest === expected.receiptDigest &&
    value.verified === true;
}

function failureReceiptMatches(
  value: unknown,
  expected: ApprovalExecutionEffectFailureReceipt,
): boolean {
  return successReceiptMatches(value, expected) &&
    (value as Record<string, unknown>).failureCode === expected.failureCode;
}

/**
 * A terminal write may have committed before its transport acknowledgement was lost. Read the
 * retained journal once and accept only the exact receipt supplied by this caller. An opposite or
 * different terminal receipt is a conflict; missing/non-terminal truth is unverified; unavailable
 * readback stays unknown.
 */
type TerminalReceiptAttestation = 'success' | 'failure' | 'conflict' | 'unverified' | 'unavailable';

async function reconcileTerminalReceipt(
  permit: ApprovalExecutionPermit,
  operationId: string,
  receipt: ApprovalExecutionEffectReceipt | ApprovalExecutionEffectFailureReceipt,
  kind: 'success' | 'failure',
  store: JournaledApprovalExecutionPermitStore,
): Promise<TerminalReceiptAttestation> {
  let effect: unknown;
  try {
    effect = await store.readEffect(operationId);
  } catch {
    return 'unavailable';
  }
  if (!effectRecordMatches(effect, permit, operationId)) return 'unverified';
  if (!effectJournalCoherent(effect, permit, operationId)) return 'unverified';
  if (kind === 'success') {
    if (effect.state === 'committed' && successReceiptMatches(effect.successReceipt, receipt)) {
      return 'success';
    }
    if (effect.state === 'committed' || effect.state === 'failed') return 'conflict';
  } else {
    if (
      effect.state === 'failed' &&
      failureReceiptMatches(effect.failureReceipt, receipt as ApprovalExecutionEffectFailureReceipt)
    ) return 'failure';
    if (effect.state === 'committed' || effect.state === 'failed') return 'conflict';
  }
  return 'unverified';
}

/**
 * Persist independently verified non-success for the exact started effect. Unknown timeouts must
 * not call this boundary: without verified negative evidence they remain honestly indeterminate.
 */
export async function failExecutionEffect(
  permit: ApprovalExecutionPermit,
  operationId: string,
  receipt: ApprovalExecutionEffectFailureReceipt,
  store: FailureReceiptedApprovalExecutionPermitStore,
): Promise<ApprovalExecutionEffectFailureResult> {
  if (!presentObject(permit) || !presentObject(receipt)) {
    return { status: 'blocked', reason: 'invalid_receipt' };
  }
  if (
    !/^permit_[a-f0-9]{24}$/.test(permit.id) ||
    !/^aegis_[a-f0-9]{16}$/.test(permit.approvalId) ||
    !validExecutionOperationId(operationId) ||
    receipt.permitId !== permit.id ||
    receipt.approvalId !== permit.approvalId ||
    receipt.operationId !== operationId ||
    !validReceiptDigest(receipt.receiptDigest) ||
    !validFailureCode(receipt.failureCode)
  ) return { status: 'blocked', reason: 'invalid_receipt' };
  if (receipt.verified !== true) return { status: 'blocked', reason: 'unverified_receipt' };

  let result: ApprovalExecutionEffectFailureCommitStatus;
  try {
    result = await store.failEffect(operationId, { ...receipt });
  } catch {
    const reconciled = await reconcileTerminalReceipt(
      permit, operationId, receipt, 'failure', store,
    );
    if (reconciled === 'failure') return { status: 'failed' };
    if (reconciled === 'conflict') return { status: 'blocked', reason: 'receipt_conflict' };
    return { status: 'indeterminate', reason: 'store_unavailable' };
  }
  if (result === 'failed' || result === 'already_failed') {
    const attested = await reconcileTerminalReceipt(permit, operationId, receipt, 'failure', store);
    if (attested === 'failure') return { status: 'failed' };
    if (attested === 'conflict') return { status: 'blocked', reason: 'receipt_conflict' };
    if (attested === 'unavailable') return { status: 'indeterminate', reason: 'store_unavailable' };
    return { status: 'indeterminate', reason: 'receipt_unverified' };
  }
  if (result === 'conflict') return { status: 'blocked', reason: 'receipt_conflict' };
  return { status: 'blocked', reason: 'effect_not_started' };
}

/**
 * Attribute a terminal success to the exact started effect using a verified desired-state receipt.
 * The store owns the atomic first-write-wins terminal transition and exact-duplicate recognition.
 */
export async function completeExecutionEffect(
  permit: ApprovalExecutionPermit,
  operationId: string,
  receipt: ApprovalExecutionEffectReceipt,
  store: ReceiptedApprovalExecutionPermitStore,
): Promise<ApprovalExecutionEffectCompletionResult> {
  if (!presentObject(permit) || !presentObject(receipt)) {
    return { status: 'blocked', reason: 'invalid_receipt' };
  }
  if (
    !/^permit_[a-f0-9]{24}$/.test(permit.id) ||
    !/^aegis_[a-f0-9]{16}$/.test(permit.approvalId) ||
    !validExecutionOperationId(operationId) ||
    receipt.permitId !== permit.id ||
    receipt.approvalId !== permit.approvalId ||
    receipt.operationId !== operationId ||
    !validReceiptDigest(receipt.receiptDigest)
  ) return { status: 'blocked', reason: 'invalid_receipt' };
  if (receipt.verified !== true) return { status: 'blocked', reason: 'unverified_receipt' };

  let result: ApprovalExecutionEffectCommitStatus;
  try {
    result = await store.completeEffect(operationId, { ...receipt });
  } catch {
    const reconciled = await reconcileTerminalReceipt(
      permit, operationId, receipt, 'success', store,
    );
    if (reconciled === 'success') return { status: 'executed' };
    if (reconciled === 'conflict') return { status: 'blocked', reason: 'receipt_conflict' };
    return { status: 'indeterminate', reason: 'store_unavailable' };
  }
  if (result === 'committed' || result === 'already_committed') {
    const attested = await reconcileTerminalReceipt(permit, operationId, receipt, 'success', store);
    if (attested === 'success') return { status: 'executed' };
    if (attested === 'conflict') return { status: 'blocked', reason: 'receipt_conflict' };
    if (attested === 'unavailable') return { status: 'indeterminate', reason: 'store_unavailable' };
    return { status: 'indeterminate', reason: 'receipt_unverified' };
  }
  if (result === 'conflict') return { status: 'blocked', reason: 'receipt_conflict' };
  return { status: 'blocked', reason: 'effect_not_started' };
}
