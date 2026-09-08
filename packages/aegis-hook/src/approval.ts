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

interface ApprovalExecutionPermitRecord {
  id: string;
  approvalId: string;
  signature: string;
  authorizationDigest?: string;
  effectiveConsumerId?: string;
  links?: NonNullable<ToolCall['approvalDelegation']>['links'];
  declaredScope?: NonNullable<ToolCall['approvalDelegation']>['declaredScope'];
  maxDepth?: number;
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
  if (approvalIdValue !== approvalId(call, evaluation)) {
    throw new Error('approval id does not match the consumed call');
  }
  const delegation = call.approvalDelegation;
  const signature = approvalSignature(call, evaluation);
  const id = executionPermitId(approvalIdValue, signature);
  const record: ApprovalExecutionPermitRecord = {
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
  mkdirSync(approvalDir(dir), { recursive: true });
  const path = executionPermitPath(id, dir);
  if (existsSync(path)) throw new Error(`execution permit already exists for ${approvalIdValue}`);
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  return { id, approvalId: approvalIdValue };
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
