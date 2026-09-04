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
  if (approvalExpired(approved, call)) {
    rmSync(consumingPath, { force: true });
    rmSync(paths.pendingPath, { force: true });
    return false;
  }
  rmSync(consumingPath, { force: true });
  rmSync(paths.pendingPath, { force: true });
  return true;
}
