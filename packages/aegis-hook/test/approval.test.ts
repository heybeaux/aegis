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

describe('approval store', () => {
  it('generates a stable id for the exact call/evaluation pair', () => {
    expect(approvalId(call, evaluation)).toMatch(/^aegis_[a-f0-9]{16}$/);
    expect(approvalId(call, evaluation)).toBe(approvalId({ ...call }, { ...evaluation }));
  });

  it('requests, approves, and consumes a one-shot approval', () => {
    const dir = tmp();
    try {
      const pending = requestApproval(call, evaluation, dir);
      const paths = approvalPaths(pending.id, dir);
      expect(existsSync(paths.pendingPath)).toBe(true);
      expect(existsSync(paths.approvedPath)).toBe(false);

      const approved = approvePending(pending.id, dir);
      expect(approved.status).toBe('approved');
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
      const pending = requestApproval(call, evaluation, dir);
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
});
