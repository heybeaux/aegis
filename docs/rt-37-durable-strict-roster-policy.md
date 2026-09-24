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
