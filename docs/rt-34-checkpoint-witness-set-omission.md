# RT-34 - Checkpoint Witness-Set Omission

**Evidence:** SwarmLab `exp-43 checkpoint-witness-set-omission`  
**Runtime commit:** `a62c52ea4bcdbb9f5e7c29dc06ade20196f6ecc7`

Exp-43 showed that visible checkpoint authorities can agree with each other while the host omits
another required witness that would reveal a later or conflicting same-operation history. Aegis now
supports an optional witness-set contract:

- `readEffectRevisionWitnessSet(operationId)` returns the authenticated required authority ids,
  minimum required authority count, operation binding, and verified bit.
- Stores that expose the contract fail closed when the witness set is absent, unavailable,
  malformed, unverified, internally duplicated, below quorum, or missing a required visible
  authority.
- `resolveWitnessSetAnchoredExecutionEffect()` exposes the explicit public boundary, while the
  ordinary resolver also detects the optional store capability.

Host responsibility remains outside Aegis: the host must authenticate, retain, and completely expose
the witness-set policy and checkpoint-authority records outside the rollback domain.

