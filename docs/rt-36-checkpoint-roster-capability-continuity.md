# RT-36 - Checkpoint Roster Capability Continuity

**Evidence:** SwarmLab `exp-45 checkpoint-roster-capability-downgrade`

A current witness roster is only protective while the host keeps presenting that evidence contract.
Exp-45 showed that retrying through a witness-set-only adapter can silently downgrade the authority
boundary unless strict roster continuity is selected explicitly.

Aegis provides strict, additive entry points for operations governed by current-roster continuity:

- `createStrictRosterContinuityContext()` creates opaque per-workflow state. Reuse it across retry
  or resume adapter views so Aegis can distinguish initial roster unavailability from capability
  disappearance after a current roster was observed.
- `resolveStrictRosterContinuityExecutionEffect()` requires the complete roster-capable contract.
  Missing/unavailable roster evidence is non-retryable; disappearance after prior current evidence
  is inconsistent.
- `beginStrictRosterContinuityExecutionEffect()` applies the same requirement before the atomic
  begin transition and revalidates it after a successful CAS before returning `execute`.
- Generic `resolveExecutionEffect()` and `beginExecutionEffect()` remain capability-detecting for
  explicitly legacy stores.

Hosts still own authenticating and retaining roster truth and selecting the strict boundary for
operations whose policy requires it. The continuity context is process-local workflow state, not a
replacement for durable host evidence; a resumed process must create a new context and select the
strict entry point again.
