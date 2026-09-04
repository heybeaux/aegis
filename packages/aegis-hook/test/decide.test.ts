import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../src/decide.js';
import { approvalId, approvePending } from '../src/approval.js';
import type { Evaluation, ToolCall } from '@heybeaux/lattice-aegis';

function ev(action: Evaluation['action'], reason: string): Evaluation {
  return {
    action,
    decidedBy: 'severity',
    matches: [],
    reason,
    ruleVersions: [],
  };
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'aegis-decide-'));
}

const askCall: ToolCall = {
  tool: 'Delegate',
  handoff: { delegationDepth: 3, manifestTier: 'presence', requirementCount: 7 },
};

function approvalRetryCall(observedAt: string, overrides: Partial<NonNullable<ToolCall['approvalEnvelope']>> = {}): ToolCall {
  return {
    ...askCall,
    approvalEnvelope: {
      operation: 'approved_retry',
      riskLevel: 'high',
      freshnessWindowMs: 60_000,
      observedAt,
      artifactDigest: 'artifact:v1',
      verificationDigest: 'verify:v1',
      targetDigest: 'target:v1',
      ...overrides,
    },
  };
}

describe('decide', () => {
  it('deny -> exit 2 with the reason on stderr', () => {
    const d = decide(ev('deny', 'rm -rf /'));
    expect(d.exitCode).toBe(2);
    expect(d.stderr).toContain('rm -rf /');
    expect(d.stderr).toContain('DENY');
  });

  it('ask -> exit 2 and writes approval instructions', () => {
    const dir = tmp();
    try {
      const evaluation = ev('ask', 'deep handoff requires value echo');
      const d = decide(evaluation, { call: askCall, approvalDir: dir });
      expect(d.exitCode).toBe(2);
      expect(d.stderr).toContain('requires approval');
      expect(d.stderr).toContain('deep handoff requires value echo');
      expect(d.stderr).toContain(`aegis-hook approve ${approvalId(askCall, evaluation)}`);
      expect(d.stderr).toContain('without changing arguments, content, or paths');
      expect(d.approval).toEqual({
        event: 'requested',
        id: approvalId(askCall, evaluation),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ask approval is consumed once on exact retry', () => {
    const dir = tmp();
    try {
      const evaluation = ev('ask', 'deep handoff requires value echo');
      const first = decide(evaluation, { call: askCall, approvalDir: dir });
      expect(first.exitCode).toBe(2);

      approvePending(approvalId(askCall, evaluation), dir);
      const approved = decide(evaluation, { call: askCall, approvalDir: dir });
      expect(approved.exitCode).toBe(0);
      expect(approved.stderr).toContain('approved once');
      expect(approved.approval).toEqual({
        event: 'consumed',
        id: approvalId(askCall, evaluation),
      });

      const retryAgain = decide(evaluation, { call: askCall, approvalDir: dir });
      expect(retryAgain.exitCode).toBe(2);
      expect(retryAgain.stderr).toContain('requires approval');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ask approval expires when the retry freshness window is exceeded', () => {
    const dir = tmp();
    try {
      const evaluation = ev('ask', 'release retry requires fresh approval');
      const firstCall = approvalRetryCall('2026-09-04T06:30:00.000Z');
      const first = decide(evaluation, { call: firstCall, approvalDir: dir });
      expect(first.exitCode).toBe(2);

      approvePending(approvalId(firstCall, evaluation), dir);
      const staleRetry = decide(evaluation, {
        call: approvalRetryCall('2026-09-04T06:31:05.000Z'),
        approvalDir: dir,
      });
      expect(staleRetry.exitCode).toBe(2);
      expect(staleRetry.stderr).toContain('requires approval');
      expect(staleRetry.approval).toEqual({
        event: 'requested',
        id: approvalId(firstCall, evaluation),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ask approval is rebound when the approval-envelope artifact digest changes', () => {
    const dir = tmp();
    try {
      const evaluation = ev('ask', 'publish retry requires matching artifact');
      const originalCall = approvalRetryCall('2026-09-04T06:30:00.000Z');
      const driftedCall = approvalRetryCall('2026-09-04T06:30:30.000Z', {
        artifactDigest: 'artifact:v2',
      });
      decide(evaluation, { call: originalCall, approvalDir: dir });
      approvePending(approvalId(originalCall, evaluation), dir);

      const rebound = decide(evaluation, { call: driftedCall, approvalDir: dir });
      expect(rebound.exitCode).toBe(2);
      expect(rebound.stderr).toContain('requires approval');
      expect(rebound.approval).toEqual({
        event: 'requested',
        id: approvalId(driftedCall, evaluation),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('allow -> exit 0 with empty stderr', () => {
    const d = decide(ev('allow', ''));
    expect(d.exitCode).toBe(0);
    expect(d.stderr).toBe('');
  });
});
