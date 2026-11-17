# RT-37 - Durable Strict-Roster Policy Continuity

**Evidence:** SwarmLab `exp-46 durable-strict-roster-policy`

RT-36's opaque continuity context protects one surviving process, but cannot be serialized across a
restart or cross-host handoff. A strict current-roster choice is authority policy, so losing process
memory must not silently turn it into legacy capability detection.

Aegis provides an additive host-owned durable policy contract:

- `DurableStrictRosterPolicyStore` atomically binds and reads an exact
  operation/permit/approval marker.
- `selectDurableStrictRosterPolicy()` validates inputs, performs create-if-absent selection, and
  reconciles exact idempotent reselection through readback without overwriting conflicts.
- `readDurableStrictRosterPolicy()` shape-validates host readback without inventing missing truth.
- `resolveDurableStrictRosterPolicyExecutionEffect()` requires both the exact marker and complete
  current-roster evidence before returning terminal certainty or retry authority.
- `beginDurableStrictRosterPolicyExecutionEffect()` checks marker and roster truth before the journal
  CAS and again after a successful CAS before returning `execute`.

Missing, malformed, or misbound markers fail closed as inconsistent; unavailable marker storage is
honestly unavailable. Generic and process-local APIs remain backward compatible. The host owns
linearizable marker persistence, cross-host visibility, roster authenticity, and operation lifecycle.
Aegis validates the exposed contract; it does not provide a production database.

## Selection identity across storage I/O (exp87 / RT-77)

Selection now retains the entry operation/permit/approval binding and checks caller
permit and current approval identifiers after each storage await. Readback is
validated against the captured binding, so a caller changing to a conflicting
marker cannot obtain a receipt for the original marker. Equivalent values remain
accepted. Drift returns `undefined`; this does not undo a successfully persisted
marker. A caller can retry selection using the original inputs. No caller object
is frozen or rewritten, and the returned marker is detached from the store argument.

This validates selection identity, not complete execution authority or current
revocation/expiry. The execution APIs still own those checks. Host atomicity,
authentication, durability and fresh readback remain required; hidden mutation and
restoration inside one callback, post-return changes and hostile storage are outside
this contract.

SwarmLab Spec93 froze 26 scenarios before execution. Baseline d9d50b0 produced eight
receipts inconsistent with retained storage and accepted all16 identity drift cases,
with all10 controls passing. Candidate0459356 rejects all16 hazards and passes all26,
using the same frozen harness and seeds. Two identical red runs and a green run,
raw traces and source/dist hashes are retained in SwarmLab exp87. No deployment or
production storage claim. Sixteen unit regressions (11baseline failures) and the
62existing checkpoint tests pass; the complete release check passes1671tests and
58/58 historical evidence gates.
