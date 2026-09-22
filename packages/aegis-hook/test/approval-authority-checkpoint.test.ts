import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  beginExecutionEffect,
  beginStrictRosterContinuityExecutionEffect,
  createStrictRosterContinuityContext,
  resolveAnchoredExecutionEffect,
  resolveExecutionEffect,
  resolveMultiAuthorityAnchoredExecutionEffect,
  resolveStrictRosterContinuityExecutionEffect,
  resolveWitnessRosterAnchoredExecutionEffect,
  resolveWitnessSetAnchoredExecutionEffect,
  type ApprovalExecutionPermit,
  type ApprovalExecutionRevisionCheckpoint,
  type ApprovalExecutionRevisionAuthorityCheckpoint,
  type ApprovalExecutionRevisionWitnessSet,
  type ApprovalExecutionRevisionWitnessRoster,
} from '../src/approval.js';

const signature = 'authority-checkpoint-signature';
const approvalId = `aegis_${'b'.repeat(16)}`;
const permit: ApprovalExecutionPermit = { id: `permit_${createHash('sha256').update(`${approvalId}:${signature}`).digest('hex').slice(0, 24)}`, approvalId };
const operationId = 'op_authority_checkpoint_test';
const links = [{ actorId: 'user:beaux', authorityLevel: 10, verified: true }, { actorId: 'agent:root', authorityLevel: 8, verified: true }];
const permitRecord = { ...permit, signature, authorizationDigest: 'auth:checkpoint', effectiveConsumerId: 'agent:root', links, declaredScope: 'direct' as const, maxDepth: 1 };
const current = { approvalId: permit.approvalId, authorizationDigest: permitRecord.authorizationDigest, effectiveConsumerId: permitRecord.effectiveConsumerId, links, revoked: false, revocationChecked: true, structurallyValid: true };
const rosterDigest = (authorityIds: string[], minimumRequiredAuthorities: number, rosterEpoch: number) => `sha256:${createHash('sha256').update(JSON.stringify({
  minimumRequiredAuthorities,
  operationId,
  requiredAuthorityIds: [...authorityIds].sort(),
  rosterEpoch,
})).digest('hex')}`;
const currentRoster = (): ApprovalExecutionRevisionWitnessRoster => ({
  operationId,
  requiredAuthorityIds: ['witness-a', 'witness-b', 'witness-c'],
  minimumRequiredAuthorities: 3,
  rosterEpoch: 2,
  rosterDigest: rosterDigest(['witness-a', 'witness-b', 'witness-c'], 3, 2),
  verified: true,
});

function store(options: {
  highWater?: number;
  checkpoint?: ApprovalExecutionRevisionCheckpoint | Record<string, unknown>;
  checkpoints?: ApprovalExecutionRevisionAuthorityCheckpoint[] | Record<string, unknown>[];
  witnessSet?: ApprovalExecutionRevisionWitnessSet | Record<string, unknown>;
  witnessRoster?: ApprovalExecutionRevisionWitnessRoster | Record<string, unknown>;
  rosterCapable?: boolean;
  checkpointError?: boolean;
  checkpointQuorumError?: boolean;
  witnessSetError?: boolean;
  witnessRosterError?: boolean;
  postCasRollback?: boolean;
} = {}) {
  const value = {
    operationId,
    permit: permitRecord,
    state: 'authorized',
    claimed: true,
    revision: options.highWater ?? 1,
  };
  return {
    async create() { return true; }, async take() { return permitRecord; },
    async prepareEffect() { return true; }, async claimPreparedEffect() { return permitRecord; },
    async beginEffect() { return options.postCasRollback ? false : true; },
    async commitEffect() { return false; }, async burnEffect() { return true; },
    async readEffect() { return structuredClone(value); },
    async readEffectRevision() { return options.postCasRollback ? 1 : (options.highWater ?? 1); },
    async readEffectRevisionCheckpoint() {
      if (options.checkpointError) throw new Error('checkpoint unavailable');
      return options.checkpoint === undefined
        ? { operationId, revision: 1, verified: true }
        : structuredClone(options.checkpoint);
    },
    async readEffectRevisionCheckpoints() {
      if (options.checkpointQuorumError) throw new Error('checkpoint quorum unavailable');
      return options.checkpoints === undefined
        ? [
            { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
            { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
          ]
        : structuredClone(options.checkpoints);
    },
    async readEffectRevisionWitnessSet() {
      if (options.witnessSetError) throw new Error('witness set unavailable');
      return options.witnessSet === undefined
        ? { operationId, requiredAuthorityIds: ['witness-a', 'witness-b'], minimumRequiredAuthorities: 2, verified: true }
        : structuredClone(options.witnessSet);
    },
    ...((options.rosterCapable || options.witnessRoster !== undefined || options.witnessRosterError) ? {
      async readEffectRevisionWitnessRoster() {
        if (options.witnessRosterError) throw new Error('witness roster unavailable');
        return options.witnessRoster === undefined
          ? { operationId, requiredAuthorityIds: ['witness-a', 'witness-b'], minimumRequiredAuthorities: 2, rosterEpoch: 1, rosterDigest: rosterDigest(['witness-a', 'witness-b'], 2, 1), verified: true }
          : structuredClone(options.witnessRoster);
      },
    } : {}),
  };
}

describe('independent authority revision checkpoints', () => {
  it('blocks coherent host authority rollback below a verified checkpoint', async () => {
    await expect(resolveAnchoredExecutionEffect(permit, current, operationId, store({
      highWater: 1,
      checkpoint: { operationId, revision: 3, verified: true },
    }))).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_stale' });
  });

  it('treats a lagging checkpoint as a lower bound rather than an equality lock', async () => {
    const s = store({ highWater: 3, checkpoint: { operationId, revision: 2, verified: true } });
    s.readEffect = async () => ({ operationId, permit: permitRecord, state: 'committed', claimed: true, revision: 3,
      successReceipt: { permitId: permit.id, approvalId: permit.approvalId, operationId, receiptDigest: `sha256:${'c'.repeat(64)}`, verified: true } });
    await expect(resolveExecutionEffect(permit, current, operationId, s)).resolves.toMatchObject({ status: 'executed', reason: 'effect_committed' });
  });

  it.each([
    ['absent', undefined],
    ['unverified', { operationId, revision: 1, verified: false }],
    ['misbound', { operationId: 'op_other', revision: 1, verified: true }],
    ['unsafe revision', { operationId, revision: Number.MAX_SAFE_INTEGER + 1, verified: true }],
    ['extra property', { operationId, revision: 1, verified: true, extra: true }],
  ])('fails closed for %s checkpoint truth', async (_label, checkpoint) => {
    const s = store({ checkpoint: checkpoint as ApprovalExecutionRevisionCheckpoint | Record<string, unknown> });
    if (checkpoint === undefined) s.readEffectRevisionCheckpoint = async () => undefined as never;
    const result = await resolveExecutionEffect(permit, current, operationId, s);
    expect(result.retryable).toBe(false);
    expect(result.status).toBe('indeterminate');
    expect(result.reason).toBe(checkpoint === undefined ? 'journal_unavailable' : 'journal_inconsistent');
  });

  it('fails closed when the checkpoint read is unavailable', async () => {
    await expect(resolveExecutionEffect(permit, current, operationId, store({ checkpointError: true })))
      .resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_unavailable' });
  });

  it('fails closed when independent checkpoint authorities equivocate on the same revision', async () => {
    await expect(resolveMultiAuthorityAnchoredExecutionEffect(permit, current, operationId, store({
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
        { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: `sha256:${'b'.repeat(64)}` },
      ],
    }))).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_inconsistent' });
  });

  it('preserves lagging multi-authority checkpoints when same revisions do not conflict', async () => {
    const s = store({
      highWater: 3,
      checkpoint: { operationId, revision: 2, verified: true },
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 2, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
        { authorityId: 'witness-b', operationId, revision: 3, verified: true, historyDigest: `sha256:${'b'.repeat(64)}` },
      ],
    });
    s.readEffect = async () => ({ operationId, permit: permitRecord, state: 'committed', claimed: true, revision: 3,
      successReceipt: { permitId: permit.id, approvalId: permit.approvalId, operationId, receiptDigest: `sha256:${'c'.repeat(64)}`, verified: true } });
    await expect(resolveExecutionEffect(permit, current, operationId, s)).resolves.toMatchObject({ status: 'executed', reason: 'effect_committed' });
  });

  it.each([
    ['unavailable', undefined, true],
    ['unverified', [{ authorityId: 'witness-a', operationId, revision: 1, verified: false, historyDigest: `sha256:${'a'.repeat(64)}` }], false],
    ['duplicate authority', [
      { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
      { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
    ], false],
    ['misbound operation', [{ authorityId: 'witness-a', operationId: 'op_other', revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` }], false],
    ['malformed digest', [{ authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: 'digest:not-sha256' }], false],
  ])('fails closed for %s multi-authority checkpoint truth', async (_label, checkpoints, unavailable) => {
    const s = store({ checkpoints: checkpoints as ApprovalExecutionRevisionAuthorityCheckpoint[] | undefined });
    if (unavailable) s.readEffectRevisionCheckpoints = async () => undefined as never;
    const result = await resolveExecutionEffect(permit, current, operationId, s);
    expect(result.retryable).toBe(false);
    expect(result.status).toBe('indeterminate');
    expect(result.reason).toBe(unavailable ? 'journal_unavailable' : 'journal_inconsistent');
  });

  it('rechecks the checkpoint after a losing begin CAS', async () => {
    const s = store({ postCasRollback: true, checkpoint: { operationId, revision: 3, verified: true } });
    await expect(beginExecutionEffect(permit, current, operationId, s))
      .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_stale' });
  });

  it('does not execute when checkpoint authorities equivocate after a successful begin CAS', async () => {
    let reads = 0;
    const s = store();
    s.readEffectRevisionCheckpoints = async () => {
      reads += 1;
      return reads === 1
        ? [
            { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
            { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
          ]
        : [
            { authorityId: 'witness-a', operationId, revision: 2, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
            { authorityId: 'witness-b', operationId, revision: 2, verified: true, historyDigest: `sha256:${'b'.repeat(64)}` },
          ];
    };
    await expect(beginExecutionEffect(permit, current, operationId, s))
      .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_inconsistent' });
  });

  it('fails closed when a required checkpoint witness is omitted from the visible authorities', async () => {
    await expect(resolveWitnessSetAnchoredExecutionEffect(permit, current, operationId, store({
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
        { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
      ],
      witnessSet: {
        operationId,
        requiredAuthorityIds: ['witness-a', 'witness-b', 'witness-c'],
        minimumRequiredAuthorities: 3,
        verified: true,
      },
    }))).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_inconsistent' });
  });

  it('preserves complete witness sets through the explicit witness-set resolver', async () => {
    await expect(resolveWitnessSetAnchoredExecutionEffect(permit, current, operationId, store({
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
        { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
        { authorityId: 'witness-c', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
      ],
      witnessSet: {
        operationId,
        requiredAuthorityIds: ['witness-a', 'witness-b', 'witness-c'],
        minimumRequiredAuthorities: 3,
        verified: true,
      },
    }))).resolves.toEqual({ status: 'not_executed', retryable: true, reason: 'not_started' });
  });

  it.each([
    ['unavailable', undefined, true],
    ['unverified', { operationId, requiredAuthorityIds: ['witness-a', 'witness-b'], minimumRequiredAuthorities: 2, verified: false }, false],
    ['duplicate authority id', { operationId, requiredAuthorityIds: ['witness-a', 'witness-a'], minimumRequiredAuthorities: 2, verified: true }, false],
    ['missing minimum quorum', { operationId, requiredAuthorityIds: ['witness-a', 'witness-b'], minimumRequiredAuthorities: 3, verified: true }, false],
    ['misbound operation', { operationId: 'op_other', requiredAuthorityIds: ['witness-a', 'witness-b'], minimumRequiredAuthorities: 2, verified: true }, false],
  ])('fails closed for %s witness-set policy', async (_label, witnessSet, unavailable) => {
    const s = store({ witnessSet: witnessSet as ApprovalExecutionRevisionWitnessSet | undefined });
    if (unavailable) s.readEffectRevisionWitnessSet = async () => undefined as never;
    const result = await resolveExecutionEffect(permit, current, operationId, s);
    expect(result.retryable).toBe(false);
    expect(result.status).toBe('indeterminate');
    expect(result.reason).toBe(unavailable ? 'journal_unavailable' : 'journal_inconsistent');
  });

  it('does not execute when a required witness disappears after a successful begin CAS', async () => {
    let reads = 0;
    const s = store({
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
        { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
        { authorityId: 'witness-c', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
      ],
      witnessSet: {
        operationId,
        requiredAuthorityIds: ['witness-a', 'witness-b', 'witness-c'],
        minimumRequiredAuthorities: 3,
        verified: true,
      },
    });
    s.readEffectRevisionCheckpoints = async () => {
      reads += 1;
      return reads === 1
        ? [
            { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
            { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
            { authorityId: 'witness-c', operationId, revision: 1, verified: true, historyDigest: `sha256:${'a'.repeat(64)}` },
          ]
        : [
            { authorityId: 'witness-a', operationId, revision: 2, verified: true, historyDigest: `sha256:${'b'.repeat(64)}` },
            { authorityId: 'witness-b', operationId, revision: 2, verified: true, historyDigest: `sha256:${'b'.repeat(64)}` },
          ];
    };
    await expect(beginExecutionEffect(permit, current, operationId, s))
      .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_inconsistent' });
  });

  it('fails closed when a complete visible witness set belongs to an obsolete roster epoch', async () => {
    await expect(resolveWitnessRosterAnchoredExecutionEffect(permit, current, operationId, store({
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: rosterDigest(['witness-a', 'witness-b'], 2, 1) },
        { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: rosterDigest(['witness-a', 'witness-b'], 2, 1) },
      ],
      witnessSet: { operationId, requiredAuthorityIds: ['witness-a', 'witness-b'], minimumRequiredAuthorities: 2, verified: true },
      witnessRoster: currentRoster(),
    }))).resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_inconsistent' });
  });

  it('preserves current roster truth through the explicit roster resolver', async () => {
    await expect(resolveWitnessRosterAnchoredExecutionEffect(permit, current, operationId, store({
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
        { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
        { authorityId: 'witness-c', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
      ],
      witnessSet: { operationId, requiredAuthorityIds: ['witness-a', 'witness-b', 'witness-c'], minimumRequiredAuthorities: 3, verified: true },
      witnessRoster: currentRoster(),
    }))).resolves.toEqual({ status: 'not_executed', retryable: true, reason: 'not_started' });
  });

  it.each([
    ['unavailable', undefined, true],
    ['unverified', { ...currentRoster(), verified: false }, false],
    ['duplicate authority id', { ...currentRoster(), requiredAuthorityIds: ['witness-a', 'witness-a', 'witness-c'] }, false],
    ['missing minimum quorum', { ...currentRoster(), minimumRequiredAuthorities: 4 }, false],
    ['misbound digest', { ...currentRoster(), rosterDigest: `sha256:${'d'.repeat(64)}` }, false],
  ])('fails closed for %s witness roster truth', async (_label, witnessRoster, unavailable) => {
    const result = await resolveExecutionEffect(permit, current, operationId, store({
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
        { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
        { authorityId: 'witness-c', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
      ],
      witnessSet: { operationId, requiredAuthorityIds: ['witness-a', 'witness-b', 'witness-c'], minimumRequiredAuthorities: 3, verified: true },
      witnessRoster: witnessRoster as ApprovalExecutionRevisionWitnessRoster | undefined,
      rosterCapable: true,
      witnessRosterError: unavailable,
    }));
    expect(result.retryable).toBe(false);
    expect(result.status).toBe('indeterminate');
    expect(result.reason).toBe(unavailable ? 'journal_unavailable' : 'journal_inconsistent');
  });


  it('strict roster resolver rejects a store whose roster capability was stripped', async () => {
    const capable = store({
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
        { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
        { authorityId: 'witness-c', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
      ],
      witnessSet: { operationId, requiredAuthorityIds: ['witness-a', 'witness-b', 'witness-c'], minimumRequiredAuthorities: 3, verified: true },
      witnessRoster: currentRoster(),
    });
    const stripped = new Proxy(capable, {
      get(target, property) {
        if (property === 'readEffectRevisionWitnessRoster') return undefined;
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const continuity = createStrictRosterContinuityContext();
    await expect(resolveStrictRosterContinuityExecutionEffect(permit, current, operationId, capable, continuity))
      .resolves.toEqual({ status: 'not_executed', retryable: true, reason: 'not_started' });
    await expect(resolveStrictRosterContinuityExecutionEffect(permit, current, operationId, stripped as any, continuity))
      .resolves.toEqual({ status: 'indeterminate', retryable: false, reason: 'journal_inconsistent' });
    // The generic boundary stays backward compatible for explicitly legacy adapter views.
    await expect(resolveExecutionEffect(permit, current, operationId, stripped as any))
      .resolves.toEqual({ status: 'not_executed', retryable: true, reason: 'not_started' });
  });

  it('strict roster begin rejects missing capability before and after a successful CAS', async () => {
    const capable = store({
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
        { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
        { authorityId: 'witness-c', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
      ],
      witnessSet: { operationId, requiredAuthorityIds: ['witness-a', 'witness-b', 'witness-c'], minimumRequiredAuthorities: 3, verified: true },
      witnessRoster: currentRoster(),
    });
    let started = false;
    const disappearing = new Proxy(capable, {
      get(target, property) {
        if (property === 'readEffectRevisionWitnessRoster' && started) return undefined;
        if (property === 'beginEffect') {
          return async (id: string) => {
            const result = await target.beginEffect(id);
            started = true;
            return result;
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(beginStrictRosterContinuityExecutionEffect(permit, current, operationId, disappearing as any))
      .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_inconsistent' });

    const stripped = new Proxy(capable, {
      get(target, property) {
        if (property === 'readEffectRevisionWitnessRoster') return undefined;
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(beginStrictRosterContinuityExecutionEffect(permit, current, operationId, stripped as any))
      .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_inconsistent' });
  });

  it('does not execute when the witness roster splits after a successful begin CAS', async () => {
    let reads = 0;
    const s = store({
      checkpoints: [
        { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
        { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
        { authorityId: 'witness-c', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
      ],
      witnessSet: { operationId, requiredAuthorityIds: ['witness-a', 'witness-b', 'witness-c'], minimumRequiredAuthorities: 3, verified: true },
      witnessRoster: currentRoster(),
    });
    s.readEffectRevisionCheckpoints = async () => {
      reads += 1;
      return reads === 1
        ? [
            { authorityId: 'witness-a', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
            { authorityId: 'witness-b', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
            { authorityId: 'witness-c', operationId, revision: 1, verified: true, historyDigest: currentRoster().rosterDigest },
          ]
        : [
            { authorityId: 'witness-a', operationId, revision: 2, verified: true, historyDigest: rosterDigest(['witness-a', 'witness-b'], 2, 1) },
            { authorityId: 'witness-b', operationId, revision: 2, verified: true, historyDigest: rosterDigest(['witness-a', 'witness-b'], 2, 1) },
          ];
    };
    s.readEffectRevisionWitnessSet = async () => reads <= 1
      ? { operationId, requiredAuthorityIds: ['witness-a', 'witness-b', 'witness-c'], minimumRequiredAuthorities: 3, verified: true }
      : { operationId, requiredAuthorityIds: ['witness-a', 'witness-b'], minimumRequiredAuthorities: 2, verified: true };
    await expect(beginExecutionEffect(permit, current, operationId, s))
      .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_inconsistent' });
  });
});

it('fails closed when terminal-write attestation observes authority rollback', async () => {
  const receipt = {
    permitId: permit.id,
    approvalId: permit.approvalId,
    operationId,
    receiptDigest: `sha256:${'d'.repeat(64)}`,
    verified: true,
  };
  const s = store({ highWater: 1, checkpoint: { operationId, revision: 3, verified: true } });
  Object.assign(s, {
    async completeEffect() { return 'committed' as const; },
    async readEffect() {
      return { operationId, permit: permitRecord, state: 'committed', claimed: true, revision: 1, successReceipt: receipt };
    },
  });
  const { completeExecutionEffect } = await import('../src/approval.js');
  await expect(completeExecutionEffect(permit, operationId, receipt, s))
    .resolves.toEqual({ status: 'indeterminate', reason: 'store_unavailable' });
});

it('does not execute when authority rolls back between the final check and a successful begin CAS', async () => {
  let checkpointReads = 0;
  const s = store({ highWater: 1, checkpoint: { operationId, revision: 1, verified: true } });
  s.readEffectRevisionCheckpoint = async () => {
    checkpointReads += 1;
    return checkpointReads === 1
      ? { operationId, revision: 1, verified: true }
      : { operationId, revision: 3, verified: true };
  };
  await expect(beginExecutionEffect(permit, current, operationId, s))
    .resolves.toEqual({ status: 'blocked', retryable: false, reason: 'journal_stale' });
});
