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

      const retryAgain = decide(evaluation, { call: askCall, approvalDir: dir });
      expect(retryAgain.exitCode).toBe(2);
      expect(retryAgain.stderr).toContain('requires approval');
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
