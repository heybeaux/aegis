# RT-39 - Durable Strict-Roster Retirement Compaction

## Finding

A full strict-roster retirement tombstone cannot be deleted safely merely because its terminal truth
is old. Baseline Aegis `403727c` had no lifecycle-checkpoint contract, so intentional compaction and
lost retirement truth were observationally identical and late retries had no authenticated compact
proof to consult.

## Aegis contract

Aegis now exposes an additive `DurableStrictRosterPolicyRetirementCheckpoint`, a host-atomic exact
retirement-to-checkpoint replacement contract, and compact late-resolve/begin entry points. The
checkpoint retains operation, terminal outcome, receipt digest, terminal revision, verification and
a self-binding digest over those values plus the omitted permit/approval identity. Exact duplicate
compaction is idempotent. Active, conflicting, malformed, unverified, missing or unavailable proof
never regains retry or begin authority.

## Evidence

- SwarmLab experiment: `48-durable-strict-roster-retirement-compaction`
- Baseline: `dsrc-mujg8jlt` on `403727ca4bab8435cfff47865ad666ce14099cd7`
- Post-fix: `dsrc-mujg9oha` on `87e8dba462d6116619d117f1df845a6701032553`
- Before → after: failure detection `0 → 1`; restored authority `1 → 0`; exact accuracy `0 → 1`;
  API availability `0 → 1`; all secondary metrics `0 → 1`.

## Ownership boundary

Hosts own independent checkpoint authentication, linearizable replacement, cross-host visibility,
retention horizon and physical garbage collection. Aegis validates the exposed adapter truth and
fails closed; it does not manufacture independence or choose a production TTL.
