import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
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

function delegatedCall(
  effectiveConsumerId: string,
  links: NonNullable<ToolCall['approvalDelegation']>['links'],
  overrides: Partial<NonNullable<ToolCall['approvalDelegation']>> = {},
): ToolCall {
  return {
    ...call,
    approvalProvenance: {
      actorId: 'agent:root',
      sessionId: 'session:root',
      workspaceId: 'workspace:aegis',
      taskIntentId: 'intent:publish',
      authorizationDigest: 'auth:epoch-1',
      grantScope: 'exact_session',
    },
    approvalDelegation: {
      effectiveConsumerId,
      declaredScope: 'bounded',
      maxDepth: 2,
      links,
      revoked: false,
      revocationChecked: true,
      structurallyValid: true,
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

  it('lets verified bounded delegates consume while binding the effective consumer and full chain', () => {
    const dir = tmp();
    const rootCall = delegatedCall('agent:root', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
    ]);
    const directCall = delegatedCall('agent:direct', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
      { actorId: 'agent:direct', authorityLevel: 8, verified: true },
    ]);
    const boundedCall = delegatedCall('agent:leaf', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
      { actorId: 'agent:direct', authorityLevel: 8, verified: true },
      { actorId: 'agent:leaf', authorityLevel: 5, verified: true },
    ]);
    try {
      const directPending = requestApproval(rootCall, evaluation, dir);
      approvePending(directPending.id, dir);
      expect(consumeApproval(directCall, evaluation, dir)).toBe(true);

      const boundedPending = requestApproval(rootCall, evaluation, dir);
      approvePending(boundedPending.id, dir);
      expect(consumeApproval(boundedCall, evaluation, dir)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects laundering, unverified, over-depth, expanded, revoked, and malformed chains', () => {
    const dir = tmp();
    const rootCall = delegatedCall('agent:root', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
    ]);
    try {
      for (const invalid of [
        delegatedCall('agent:launderer', [
          { actorId: 'agent:root', authorityLevel: 10, verified: true },
          { actorId: 'agent:direct', authorityLevel: 8, verified: true },
        ]),
        delegatedCall('agent:direct', [
          { actorId: 'agent:root', authorityLevel: 10, verified: true },
          { actorId: 'agent:direct', authorityLevel: 8, verified: false },
        ]),
        delegatedCall('agent:leaf', [
          { actorId: 'agent:root', authorityLevel: 10, verified: true },
          { actorId: 'agent:direct', authorityLevel: 8, verified: true },
          { actorId: 'agent:middle', authorityLevel: 6, verified: true },
          { actorId: 'agent:leaf', authorityLevel: 5, verified: true },
        ]),
        delegatedCall('agent:direct', [
          { actorId: 'agent:root', authorityLevel: 10, verified: true },
          { actorId: 'agent:direct', authorityLevel: 11, verified: true },
        ]),
        delegatedCall('agent:direct', [
          { actorId: 'agent:root', authorityLevel: 10, verified: true },
          { actorId: 'agent:direct', authorityLevel: 8, verified: true },
        ], { revoked: true }),
        delegatedCall('agent:direct', [
          { actorId: 'agent:root', authorityLevel: 10, verified: true },
          { actorId: 'agent:direct', authorityLevel: 8, verified: true },
        ], { structurallyValid: false }),
      ]) {
        const pending = requestApproval(rootCall, evaluation, dir);
        approvePending(pending.id, dir);
        expect(consumeApproval(invalid, evaluation, dir)).toBe(false);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
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

describe('approval execution permits', () => {
  it('finalizes once against an unchanged current authority snapshot', async () => {
    const { createExecutionPermit, finalizeExecutionPermit } = await import('../src/approval.js');
    const dir = tmp();
    const approvedCall = delegatedCall('agent:direct', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
      { actorId: 'agent:direct', authorityLevel: 8, verified: true },
    ]);
    try {
      const permit = createExecutionPermit(approvedCall, evaluation, approvalId(approvedCall, evaluation), dir);
      const current = {
        approvalId: permit.approvalId,
        authorizationDigest: approvedCall.approvalProvenance?.authorizationDigest,
        effectiveConsumerId: approvedCall.approvalDelegation?.effectiveConsumerId,
        links: approvedCall.approvalDelegation?.links,
        revoked: false,
        revocationChecked: true,
        structurallyValid: true,
      };
      expect(finalizeExecutionPermit(permit, current, dir)).toBe(true);
      expect(finalizeExecutionPermit(permit, current, dir)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each([
    ['authorization epoch rotation', { authorizationDigest: 'auth:epoch-2' }],
    ['full delegation revocation', { revoked: true }],
    ['missing revocation check', { revocationChecked: false }],
    ['consumer drift', { effectiveConsumerId: 'agent:other' }],
    ['malformed current chain', { structurallyValid: false }],
  ])('burns the permit when %s is observed at execution', async (_name, patch) => {
    const { createExecutionPermit, finalizeExecutionPermit } = await import('../src/approval.js');
    const dir = tmp();
    const approvedCall = delegatedCall('agent:direct', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
      { actorId: 'agent:direct', authorityLevel: 8, verified: true },
    ]);
    try {
      const permit = createExecutionPermit(approvedCall, evaluation, approvalId(approvedCall, evaluation), dir);
      const current = {
        approvalId: permit.approvalId,
        authorizationDigest: approvedCall.approvalProvenance?.authorizationDigest,
        effectiveConsumerId: approvedCall.approvalDelegation?.effectiveConsumerId,
        links: approvedCall.approvalDelegation?.links,
        revoked: false,
        revocationChecked: true,
        structurallyValid: true,
        ...patch,
      };
      expect(finalizeExecutionPermit(permit, current, dir)).toBe(false);
      expect(finalizeExecutionPermit(permit, { ...current, ...patch, revoked: false, revocationChecked: true, structurallyValid: true }, dir)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('rejects revoked/expanded intermediate links and mismatched approval ids', async () => {
    const { createExecutionPermit, finalizeExecutionPermit } = await import('../src/approval.js');
    const approvedCall = delegatedCall('agent:direct', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
      { actorId: 'agent:direct', authorityLevel: 8, verified: true },
    ]);
    for (const links of [
      [
        { actorId: 'agent:root', authorityLevel: 10, verified: true },
        { actorId: 'agent:direct', authorityLevel: 8, verified: true, revoked: true },
      ],
      [
        { actorId: 'agent:root', authorityLevel: 10, verified: true },
        { actorId: 'agent:direct', authorityLevel: 11, verified: true },
      ],
    ]) {
      const dir = tmp();
      try {
        const permit = createExecutionPermit(approvedCall, evaluation, approvalId(approvedCall, evaluation), dir);
        expect(finalizeExecutionPermit(permit, {
          approvalId: permit.approvalId,
          authorizationDigest: approvedCall.approvalProvenance?.authorizationDigest,
          effectiveConsumerId: approvedCall.approvalDelegation?.effectiveConsumerId,
          links,
          revoked: false,
          revocationChecked: true,
          structurallyValid: true,
        }, dir)).toBe(false);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    expect(() => createExecutionPermit(approvedCall, evaluation, 'aegis_0000000000000000')).toThrow(/does not match/);
  });

  it('uses a shared transactional store for globally one-shot cross-host finalization', async () => {
    const { createExecutionPermitWithStore, finalizeExecutionPermitWithStore } = await import('../src/approval.js');
    const records = new Map<string, any>();
    const store = {
      async create(record: any) {
        if (records.has(record.id)) return false;
        records.set(record.id, structuredClone(record));
        return true;
      },
      async take(id: string) {
        await delay(1);
        const record = records.get(id);
        records.delete(id);
        return record;
      },
    };
    const approvedCall = delegatedCall('agent:direct', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
      { actorId: 'agent:direct', authorityLevel: 8, verified: true },
    ]);
    const id = approvalId(approvedCall, evaluation);
    const permit = await createExecutionPermitWithStore(approvedCall, evaluation, id, store);
    const current = {
      approvalId: permit.approvalId,
      authorizationDigest: approvedCall.approvalProvenance?.authorizationDigest,
      effectiveConsumerId: approvedCall.approvalDelegation?.effectiveConsumerId,
      links: approvedCall.approvalDelegation?.links,
      revoked: false,
      revocationChecked: true,
      structurallyValid: true,
    };
    const results = await Promise.all([
      finalizeExecutionPermitWithStore(permit, current, store),
      finalizeExecutionPermitWithStore(permit, current, store),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await finalizeExecutionPermitWithStore(permit, current, store)).toBe(false);
  });

  it('burns invalid shared permits, rejects duplicate create, and fails closed on store errors', async () => {
    const { createExecutionPermitWithStore, finalizeExecutionPermitWithStore } = await import('../src/approval.js');
    const records = new Map<string, any>();
    const store = {
      async create(record: any) {
        if (records.has(record.id)) return false;
        records.set(record.id, structuredClone(record));
        return true;
      },
      async take(id: string) {
        const record = records.get(id);
        records.delete(id);
        return record;
      },
    };
    const approvedCall = delegatedCall('agent:direct', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
      { actorId: 'agent:direct', authorityLevel: 8, verified: true },
    ]);
    const id = approvalId(approvedCall, evaluation);
    const permit = await createExecutionPermitWithStore(approvedCall, evaluation, id, store);
    await expect(createExecutionPermitWithStore(approvedCall, evaluation, id, store)).rejects.toThrow(/already exists/);
    const current = {
      approvalId: permit.approvalId,
      authorizationDigest: 'auth:rotated',
      effectiveConsumerId: approvedCall.approvalDelegation?.effectiveConsumerId,
      links: approvedCall.approvalDelegation?.links,
      revoked: false,
      revocationChecked: true,
      structurallyValid: true,
    };
    expect(await finalizeExecutionPermitWithStore(permit, current, store)).toBe(false);
    expect(await finalizeExecutionPermitWithStore(permit, { ...current, authorizationDigest: 'auth:epoch-1' }, store)).toBe(false);
    const unavailable = { async create() { throw new Error('down'); }, async take() { throw new Error('down'); } };
    await expect(createExecutionPermitWithStore(approvedCall, evaluation, id, unavailable)).rejects.toThrow(/unavailable/);
    expect(await finalizeExecutionPermitWithStore(permit, { ...current, authorizationDigest: 'auth:epoch-1' }, unavailable)).toBe(false);
    expect(await finalizeExecutionPermitWithStore({ id: '../bad', approvalId: id }, { ...current, approvalId: id }, store)).toBe(false);
  });
});

describe('reconciled approval execution permit store', () => {
  async function fixture() {
    const { createExecutionPermitWithStore, finalizeExecutionPermitWithReconciliation } = await import('../src/approval.js');
    const records = new Map<string, any>();
    const operations = new Map<string, any>();
    let precommitFailures = 0, postcommitTimeouts = 0, statusFailures = 0;
    const store = {
      async create(record: any) { if (records.has(record.id)) return false; records.set(record.id, structuredClone(record)); return true; },
      async take(id: string) { const record = records.get(id); records.delete(id); return record; },
      async prepareTake(id: string, operationId: string) {
        if (precommitFailures-- > 0) throw new Error('precommit');
        if (operations.has(operationId)) return true;
        const record = records.get(id); if (!record) return false;
        records.delete(id); operations.set(operationId, structuredClone(record));
        if (postcommitTimeouts-- > 0) throw new Error('postcommit timeout');
        return true;
      },
      async claimPreparedTake(operationId: string) {
        if (statusFailures-- > 0) throw new Error('status unavailable');
        const record = operations.get(operationId); operations.delete(operationId); return record;
      },
    };
    const approvedCall = delegatedCall('agent:direct', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
      { actorId: 'agent:direct', authorityLevel: 8, verified: true },
    ]);
    const id = approvalId(approvedCall, evaluation);
    const permit = await createExecutionPermitWithStore(approvedCall, evaluation, id, store);
    const current = { approvalId: permit.approvalId, authorizationDigest: approvedCall.approvalProvenance?.authorizationDigest, effectiveConsumerId: approvedCall.approvalDelegation?.effectiveConsumerId, links: approvedCall.approvalDelegation?.links, revoked: false, revocationChecked: true, structurallyValid: true };
    return { store, permit, current, finalizeExecutionPermitWithReconciliation, failPrecommit: () => { precommitFailures = 1; }, timeoutPostcommit: () => { postcommitTimeouts = 1; }, failStatus: () => { statusFailures = 1; } };
  }

  it('reconciles acknowledgement loss after a committed take and executes once', async () => {
    const f = await fixture(); f.timeoutPostcommit();
    await expect(f.finalizeExecutionPermitWithReconciliation(f.permit, f.current, 'op_timeout', f.store)).resolves.toEqual({ status: 'execute', retryable: false });
    await expect(f.finalizeExecutionPermitWithReconciliation(f.permit, f.current, 'op_timeout', f.store)).resolves.toEqual({ status: 'blocked', retryable: true, reason: 'not_taken' });
  });

  it('marks unavailable status indeterminate without authorizing execution', async () => {
    const f = await fixture(); f.timeoutPostcommit(); f.failStatus();
    await expect(f.finalizeExecutionPermitWithReconciliation(f.permit, f.current, 'op_status_down', f.store)).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'status_unavailable' });
  });

  it('allows a new operation after a definite pre-commit failure and burns invalid snapshots', async () => {
    const retry = await fixture(); retry.failPrecommit();
    await expect(retry.finalizeExecutionPermitWithReconciliation(retry.permit, retry.current, 'op_pre_fail', retry.store)).resolves.toEqual({ status: 'blocked', retryable: true, reason: 'not_taken' });
    await expect(retry.finalizeExecutionPermitWithReconciliation(retry.permit, retry.current, 'op_retry', retry.store)).resolves.toEqual({ status: 'execute', retryable: false });

    const invalid = await fixture(); invalid.timeoutPostcommit();
    await expect(invalid.finalizeExecutionPermitWithReconciliation(invalid.permit, { ...invalid.current, authorizationDigest: 'auth:rotated' }, 'op_invalid', invalid.store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'invalid_snapshot' });
    await expect(invalid.finalizeExecutionPermitWithReconciliation(invalid.permit, invalid.current, 'op_invalid_retry', invalid.store)).resolves.toEqual({ status: 'blocked', retryable: true, reason: 'not_taken' });
  });

  it('rejects malformed operation ids before touching shared storage', async () => {
    const f = await fixture();
    await expect(f.finalizeExecutionPermitWithReconciliation(f.permit, f.current, '../bad', f.store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'invalid_snapshot' });
  });
});

describe('journaled approval execution effects', () => {
  async function fixture() {
    const {
      createExecutionPermitWithStore,
      finalizeExecutionPermitWithEffectJournal,
      resolveExecutionEffect,
    } = await import('../src/approval.js');
    const records = new Map<string, any>();
    const effects = new Map<string, any>();
    let readsUnavailable = 0;
    const store = {
      async create(record: any) { if (records.has(record.id)) return false; records.set(record.id, structuredClone(record)); return true; },
      async take(id: string) { const record = records.get(id); records.delete(id); return record; },
      async prepareEffect(id: string, operationId: string) {
        const existing = effects.get(operationId);
        if (existing) return existing.permit.id === id;
        const record = records.get(id); if (!record) return false;
        records.delete(id); effects.set(operationId, { operationId, permit: structuredClone(record), state: 'authorized', claimed: false }); return true;
      },
      async claimPreparedEffect(operationId: string) {
        const effect = effects.get(operationId);
        if (!effect || effect.claimed || effect.state !== 'authorized') return undefined;
        effect.claimed = true; return structuredClone(effect.permit);
      },
      async beginEffect(operationId: string) { const effect = effects.get(operationId); if (!effect || !effect.claimed || effect.state !== 'authorized') return false; effect.state = 'started'; return true; },
      async commitEffect(operationId: string) { const effect = effects.get(operationId); if (!effect || effect.state !== 'started') return false; effect.state = 'committed'; return true; },
      async readEffect(operationId: string) { if (readsUnavailable-- > 0) throw new Error('down'); const effect = effects.get(operationId); return effect ? structuredClone(effect) : undefined; },
      async burnEffect(operationId: string) { const effect = effects.get(operationId); if (!effect || effect.state === 'committed') return false; effect.state = 'burned'; return true; },
    };
    const approvedCall = delegatedCall('agent:direct', [
      { actorId: 'agent:root', authorityLevel: 10, verified: true },
      { actorId: 'agent:direct', authorityLevel: 8, verified: true },
    ]);
    const id = approvalId(approvedCall, evaluation);
    const permit = await createExecutionPermitWithStore(approvedCall, evaluation, id, store);
    const current = { approvalId: permit.approvalId, authorizationDigest: approvedCall.approvalProvenance?.authorizationDigest, effectiveConsumerId: approvedCall.approvalDelegation?.effectiveConsumerId, links: approvedCall.approvalDelegation?.links, revoked: false, revocationChecked: true, structurallyValid: true };
    return { store, effects, permit, current, finalizeExecutionPermitWithEffectJournal, resolveExecutionEffect, failRead: () => { readsUnavailable = 1; } };
  }

  it('retains committed effect truth and resolves duplicate/cross-host reads idempotently', async () => {
    const f = await fixture();
    await expect(f.finalizeExecutionPermitWithEffectJournal(f.permit, f.current, 'op_commit', f.store)).resolves.toEqual({ status: 'execute', retryable: false });
    await expect(f.store.beginEffect('op_commit')).resolves.toBe(true);
    await expect(f.store.commitEffect('op_commit')).resolves.toBe(true);
    await expect(f.resolveExecutionEffect(f.permit, f.current, 'op_commit', f.store)).resolves.toEqual({ status: 'executed', retryable: false, reason: 'effect_committed' });
    await expect(f.resolveExecutionEffect(f.permit, f.current, 'op_commit', f.store)).resolves.toEqual({ status: 'executed', retryable: false, reason: 'effect_committed' });
    await expect(f.finalizeExecutionPermitWithEffectJournal(f.permit, f.current, 'op_commit', f.store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'not_taken' });
  });

  it('distinguishes untouched authorization from a started ambiguous effect', async () => {
    const untouched = await fixture();
    await untouched.finalizeExecutionPermitWithEffectJournal(untouched.permit, untouched.current, 'op_untouched', untouched.store);
    await expect(untouched.resolveExecutionEffect(untouched.permit, untouched.current, 'op_untouched', untouched.store)).resolves.toEqual({ status: 'not_executed', retryable: true, reason: 'not_started' });

    const started = await fixture();
    await started.finalizeExecutionPermitWithEffectJournal(started.permit, started.current, 'op_started', started.store);
    await started.store.beginEffect('op_started');
    await expect(started.resolveExecutionEffect(started.permit, started.current, 'op_started', started.store)).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'effect_started' });
  });

  it('fails closed on journal loss/unavailability and burns invalid fresh authority', async () => {
    const unavailable = await fixture();
    await unavailable.finalizeExecutionPermitWithEffectJournal(unavailable.permit, unavailable.current, 'op_down', unavailable.store);
    unavailable.failRead();
    await expect(unavailable.resolveExecutionEffect(unavailable.permit, unavailable.current, 'op_down', unavailable.store)).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_unavailable' });

    const invalid = await fixture();
    await invalid.finalizeExecutionPermitWithEffectJournal(invalid.permit, invalid.current, 'op_invalid_resume', invalid.store);
    await expect(invalid.resolveExecutionEffect(invalid.permit, { ...invalid.current, authorizationDigest: 'auth:rotated' }, 'op_invalid_resume', invalid.store)).resolves.toEqual({ status: 'not_executed', retryable: false, reason: 'invalid_snapshot' });
    await expect(invalid.resolveExecutionEffect(invalid.permit, invalid.current, 'op_invalid_resume', invalid.store)).resolves.toEqual({ status: 'not_executed', retryable: false, reason: 'authorization_burned' });
    await expect(invalid.resolveExecutionEffect(invalid.permit, invalid.current, 'op_missing', invalid.store)).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_missing' });
  });

  it('rejects malformed operation identifiers without touching the journal', async () => {
    const f = await fixture();
    await expect(f.finalizeExecutionPermitWithEffectJournal(f.permit, f.current, '../bad', f.store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'invalid_snapshot' });
    await expect(f.resolveExecutionEffect(f.permit, f.current, '../bad', f.store)).resolves.toEqual({ status: 'not_executed', retryable: false, reason: 'invalid_snapshot' });
    expect(f.effects.size).toBe(0);
  });
});

describe('execution effect start fencing', () => {
  async function fixture() {
    const { createExecutionPermitWithStore, finalizeExecutionPermitWithEffectJournal, beginExecutionEffect } = await import('../src/approval.js');
    const records = new Map<string, any>();
    const effects = new Map<string, any>();
    let beginUnavailable = 0;
    const store = {
      async create(record: any) { if (records.has(record.id)) return false; records.set(record.id, structuredClone(record)); return true; },
      async take(id: string) { const value = records.get(id); records.delete(id); return value; },
      async prepareEffect(id: string, operationId: string) { const existing = effects.get(operationId); if (existing) return existing.permit.id === id; const record = records.get(id); if (!record) return false; records.delete(id); effects.set(operationId, { operationId, permit: structuredClone(record), state: 'authorized', claimed: false }); return true; },
      async claimPreparedEffect(operationId: string) { const effect = effects.get(operationId); if (!effect || effect.claimed || effect.state !== 'authorized') return undefined; effect.claimed = true; return structuredClone(effect.permit); },
      async beginEffect(operationId: string) { if (beginUnavailable-- > 0) throw new Error('down'); await delay(1); const effect = effects.get(operationId); if (!effect || !effect.claimed || effect.state !== 'authorized') return false; effect.state = 'started'; return true; },
      async commitEffect(operationId: string) { const effect = effects.get(operationId); if (!effect || effect.state !== 'started') return false; effect.state = 'committed'; return true; },
      async readEffect(operationId: string) { const effect = effects.get(operationId); return effect ? structuredClone(effect) : undefined; },
      async burnEffect(operationId: string) { const effect = effects.get(operationId); if (!effect || effect.state === 'committed') return false; effect.state = 'burned'; return true; },
    };
    const approvedCall = delegatedCall('agent:direct', [{ actorId: 'agent:root', authorityLevel: 10, verified: true }, { actorId: 'agent:direct', authorityLevel: 8, verified: true }]);
    const id = approvalId(approvedCall, evaluation);
    const permit = await createExecutionPermitWithStore(approvedCall, evaluation, id, store);
    const current = { approvalId: permit.approvalId, authorizationDigest: approvedCall.approvalProvenance?.authorizationDigest, effectiveConsumerId: approvedCall.approvalDelegation?.effectiveConsumerId, links: approvedCall.approvalDelegation?.links, revoked: false, revocationChecked: true, structurallyValid: true };
    await finalizeExecutionPermitWithEffectJournal(permit, current, 'op_start_fence', store);
    return { store, permit, current, beginExecutionEffect, failBegin: () => { beginUnavailable = 1; } };
  }

  it('authorizes exactly one of two concurrent starters', async () => {
    const f = await fixture();
    const results = await Promise.all([
      f.beginExecutionEffect(f.permit, f.current, 'op_start_fence', f.store),
      f.beginExecutionEffect(f.permit, f.current, 'op_start_fence', f.store),
    ]);
    expect(results.filter((result) => result.status === 'execute')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'blocked')).toHaveLength(1);
  });

  it('is idempotently blocked after start and commit', async () => {
    const started = await fixture();
    await expect(started.beginExecutionEffect(started.permit, started.current, 'op_start_fence', started.store)).resolves.toEqual({ status: 'execute', retryable: false });
    await expect(started.beginExecutionEffect(started.permit, started.current, 'op_start_fence', started.store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'effect_started' });
    await started.store.commitEffect('op_start_fence');
    await expect(started.beginExecutionEffect(started.permit, started.current, 'op_start_fence', started.store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'effect_committed' });
  });

  it('burns invalid fresh authority and returns indeterminate on unavailable CAS', async () => {
    const invalid = await fixture();
    await expect(invalid.beginExecutionEffect(invalid.permit, { ...invalid.current, authorizationDigest: 'auth:rotated' }, 'op_start_fence', invalid.store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'invalid_snapshot' });
    await expect(invalid.beginExecutionEffect(invalid.permit, invalid.current, 'op_start_fence', invalid.store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'authorization_burned' });

    const unavailable = await fixture(); unavailable.failBegin();
    await expect(unavailable.beginExecutionEffect(unavailable.permit, unavailable.current, 'op_start_fence', unavailable.store)).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'status_unavailable' });
  });

  it('rejects malformed and mismatched operations without starting', async () => {
    const f = await fixture();
    await expect(f.beginExecutionEffect(f.permit, f.current, '../bad', f.store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'invalid_snapshot' });
    await expect(f.beginExecutionEffect(f.permit, f.current, 'op_other', f.store)).resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_missing' });
  });
});
