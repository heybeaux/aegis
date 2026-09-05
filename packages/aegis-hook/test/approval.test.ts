import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Evaluation, ToolCall } from '@heybeaux/lattice-aegis';
import {
  approvalId,
  approvalPaths,
  approvePending,
  consumeApproval,
  requestApproval,
} from '../src/approval.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'aegis-approval-'));
}

const call: ToolCall = {
  tool: 'Delegate',
  handoff: { delegationDepth: 3, manifestTier: 'presence', requirementCount: 7 },
};

const evaluation: Evaluation = {
  action: 'ask',
  decidedBy: 'severity',
  matches: [
    {
      id: 'swarmlab.rt07.deep-handoff-requires-value-echo',
      severity: 'medium',
      category: 'swarmlab',
      target: 'argv',
    },
  ],
  reason: 'SwarmLab RT-07: delegation depth >= 2 requires a value-echo handoff manifest',
  ruleVersions: [],
};

function approvalRetryCall(overrides: Partial<NonNullable<ToolCall['approvalEnvelope']>> = {}): ToolCall {
  return {
    ...call,
    approvalEnvelope: {
      operation: 'approved_retry',
      riskLevel: 'high',
      freshnessWindowMs: 60_000,
      observedAt: '2026-09-04T06:30:00.000Z',
      artifactDigest: 'artifact:v1',
      verificationDigest: 'verify:v1',
      targetDigest: 'target:v1',
      ...overrides,
    },
  };
}

describe('approval store', () => {
  it('generates a stable id for the exact call/evaluation pair', () => {
    expect(approvalId(call, evaluation)).toMatch(/^aegis_[a-f0-9]{16}$/);
    expect(approvalId(call, evaluation)).toBe(approvalId({ ...call }, { ...evaluation }));
  });

  it('keeps approval ids stable across observedAt-only retries but changes when envelope bindings drift', () => {
    const original = approvalRetryCall();
    const laterRetry = approvalRetryCall({ observedAt: '2026-09-04T06:30:45.000Z' });
    const artifactDrifted = approvalRetryCall({ artifactDigest: 'artifact:v2' });

    expect(approvalId(original, evaluation)).toBe(approvalId(laterRetry, evaluation));
    expect(approvalId(original, evaluation)).not.toBe(approvalId(artifactDrifted, evaluation));
  });

  it('binds approval to actor, workspace, intent, authorization, and exact session by default', () => {
    const dir = tmp();
    const provenance = { actorId: 'user:beaux', sessionId: 'session:a', workspaceId: 'workspace:aegis', taskIntentId: 'intent:publish', authorizationDigest: 'auth:epoch-1', grantScope: 'exact_session' as const };
    const approvedCall: ToolCall = { ...call, approvalProvenance: provenance };
    try {
      const pending = requestApproval(approvedCall, evaluation, dir);
      approvePending(pending.id, dir);
      for (const retry of [
        { ...provenance, actorId: 'agent:other' },
        { ...provenance, sessionId: 'session:b' },
        { ...provenance, workspaceId: 'workspace:other' },
        { ...provenance, taskIntentId: 'intent:other' },
        { ...provenance, authorizationDigest: 'auth:revoked' },
      ]) {
        expect(consumeApproval({ ...call, approvalProvenance: retry }, evaluation, dir)).toBe(false);
      }
      expect(consumeApproval(approvedCall, evaluation, dir)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('preserves explicit workspace-scoped portability across sibling sessions', () => {
    const dir = tmp();
    const provenance = { actorId: 'user:beaux', sessionId: 'session:a', workspaceId: 'workspace:aegis', taskIntentId: 'intent:publish', authorizationDigest: 'auth:epoch-1', grantScope: 'workspace' as const };
    const approvedCall: ToolCall = { ...call, approvalProvenance: provenance };
    try {
      const pending = requestApproval(approvedCall, evaluation, dir);
      approvePending(pending.id, dir);
      expect(consumeApproval({ ...approvedCall, approvalProvenance: { ...provenance, sessionId: 'session:b' } }, evaluation, dir)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('requests, approves, and consumes a one-shot approval', () => {
    const dir = tmp();
    try {
      const pending = requestApproval(call, evaluation, dir, 'action-key-1');
      const paths = approvalPaths(pending.id, dir);
      expect(existsSync(paths.pendingPath)).toBe(true);
      expect(existsSync(paths.approvedPath)).toBe(false);
      expect(pending.actionKey).toBe('action-key-1');

      const approved = approvePending(pending.id, dir);
      expect(approved.status).toBe('approved');
      expect(approved.actionKey).toBe('action-key-1');
      expect(existsSync(paths.approvedPath)).toBe(true);

      expect(consumeApproval(call, evaluation, dir)).toBe(true);
      expect(existsSync(paths.pendingPath)).toBe(false);
      expect(existsSync(paths.approvedPath)).toBe(false);
      expect(consumeApproval(call, evaluation, dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not consume an approval for a different handoff signature', () => {
    const dir = tmp();
    try {
      const pending = requestApproval(call, evaluation, dir, 'action-key-2');
      approvePending(pending.id, dir);
      expect(
        consumeApproval(
          { ...call, handoff: { delegationDepth: 3, manifestTier: 'none', requirementCount: 7 } },
          evaluation,
          dir,
        ),
      ).toBe(false);
      expect(consumeApproval(call, evaluation, dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not consume an expired approval-envelope retry and clears stale records', () => {
    const dir = tmp();
    try {
      const approvedCall = approvalRetryCall({ observedAt: '2026-09-04T06:30:00.000Z' });
      const retryCall = approvalRetryCall({ observedAt: '2026-09-04T06:31:01.000Z' });
      const pending = requestApproval(approvedCall, evaluation, dir, 'action-key-expired');
      const paths = approvalPaths(pending.id, dir);
      approvePending(pending.id, dir);

      expect(consumeApproval(retryCall, evaluation, dir)).toBe(false);
      expect(existsSync(paths.pendingPath)).toBe(false);
      expect(existsSync(paths.approvedPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not consume an approval when the approval-envelope artifact binding drifts', () => {
    const dir = tmp();
    try {
      const approvedCall = approvalRetryCall();
      const retryCall = approvalRetryCall({ artifactDigest: 'artifact:v2' });
      const pending = requestApproval(approvedCall, evaluation, dir, 'action-key-artifact');
      const approvedPaths = approvalPaths(pending.id, dir);
      approvePending(pending.id, dir);

      expect(consumeApproval(retryCall, evaluation, dir)).toBe(false);
      expect(existsSync(approvedPaths.pendingPath)).toBe(true);
      expect(existsSync(approvedPaths.approvedPath)).toBe(true);
      expect(consumeApproval(approvedCall, evaluation, dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
