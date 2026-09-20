# RT-35 - Checkpoint Witness Roster Epoch

**Evidence:** SwarmLab `exp-44 checkpoint-witness-roster-epoch`  
**Aegis commit:** `be465b0eeae5ed140a7bdaf4f88ca5928c095974`

Exp-44 showed that a complete visible witness set is not sufficient when the witness-set policy
itself can be stale. A host can expose a mutually consistent old roster, such as `witness-a` and
`witness-b`, while independently retained current roster truth requires `witness-c` too.

Aegis now supports an optional current-roster contract:

- `readEffectRevisionWitnessRoster(operationId)` returns authenticated current required authority
  ids, minimum required authority count, positive roster epoch, self-checking roster digest, and a
  verified bit.
- The roster digest is `sha256` over operation id, roster epoch, minimum quorum, and sorted required
  authority ids using the same stable canonical serialization Aegis uses for approvals.
- Stores that expose the contract fail closed when current roster truth is absent, unavailable,
  malformed, digest-mismatched, or inconsistent with the visible witness set/checkpoint authorities.
- `resolveWitnessRosterAnchoredExecutionEffect()` exposes the explicit public boundary, while the
  ordinary resolver also detects the optional roster capability.

This is an adapter and policy contract, not a witness discovery system. Hosts still own authenticating
and retaining current roster truth outside the journal rollback domain.
