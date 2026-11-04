# Process-generation approval contract (SwarmLab exp73 / RT-63)

A reusable process session handle is not an immutable execution target. Process input approvals now require host-owned lifetime evidence, and a change in host or process generation creates a different approval signature and predictor action key. Payload/session binding and the independent review floor remain.

The OpenClaw host supplies the following OUTSIDE model-authored params on every call/retry:

```ts
openClawToolCall({
  toolName: 'process',
  params: { action: 'write', sessionId: handle, data: input },
  processTarget: {
    hostId,                 // stable identity of the authoritative process host
    sessionId: handle,      // must equal params.sessionId
    generationId,          // immutable, never reused within that host
    verified: true,         // host authenticated this mapping afresh
  },
});
```

All IDs must be nonempty strings; whitespace-only IDs, non-true verification, missing or mismatched target evidence fail closed. No authority is read from params.processTarget. The adapter copies only validated fields. Direct ToolCall consumers are trusted adapters responsible for binding this evidence to the exact payload/target; the same consumption validity guard applies.

Migration: old generationless ProcessInput grants cannot be consumed. Hosts that do not supply valid evidence remain paused even after human approval and receive an explicit diagnostic. With valid evidence, request fresh approval; an exact retry consumes it once. Changed generations do not burn the original grant. Nonprocess tools ignore this metadata and retain prior approval behavior. No hook/plugin deployment accompanies this change.

Aegis owns validation, identity binding and approval consumption. The host owns authenticating the registry, never reusing generation IDs, refreshing the evidence, and guaranteeing that execution reaches the resolved generation. `verified:true` is a trusted integration assertion, not a signature. This does not change effect-permit finalization or solve process replacement between consumption and execution. Do not treat this as atomic execution fencing or production certification.

Evidence: SwarmLab spec79 pre-registration70bf3dc, frozen design402fe74; baseline72f9692331486e426c41167596b5898fb90fe5b7 consumed12/12 invalid/stale-target approvals on two identical runs; runtime01b4360b912724e313ffbde995987b82fa1c94a8 consumes0/12 with6/6 valid retries,8/8 retained-approval recovery and2/2 lifetime identity isolation. Complete raw traces, artifacts, deterministic oracle and executable pinned CI live in experiments/73-process-generation-binding. New focused15 regressions pass (13 failed on baseline); full local release1243 tests and historical52/52 evidence pass. RT63 is a runtime regression corpus, not a newly populated static benchmark catalogue entry. Remote CI and landing state are recorded by the linked PRs/nightly ledger.

Linked delivery: [Aegis81](https://github.com/heybeaux/aegis/pull/81) / [SwarmLab64](https://github.com/heybeaux/swarmlab/pull/64). Runtime pin01b4360b912724e313ffbde995987b82fa1c94a8; local green is not remote CI. Final exact-head checks and merge status are recorded in the2026-11-03 nightly ledger.

## Execution checkpoint target binding (exp74 / RT-64)

Newly created ProcessInput execution permits now retain `tool: 'ProcessInput'` and a detached authenticated `processTarget`. Both creation APIs reject missing/invalid target evidence. Supply a freshly resolved `processTarget` on `ApprovalExecutionSnapshot` at finalization, authorized-effect resolution and effect start. Missing, invalid or changed host/session/generation blocks authorization; existing invalid-snapshot burn semantics apply. Independent delegation/revocation checks still apply. Nonprocess permits retain their existing representation and behavior. This extends the consumption-only scope described above.

The trusted store must preserve these fields. Pre-upgrade permit records contain neither tool nor target; their hashes cannot identify whether they represented process input. Drain outstanding pre-upgrade process permits/effect authorizations and obtain fresh approval before enabling this guarantee. No automatic store migration or host deployment is included. Existing nonprocess records remain compatible.

Aegis compares authenticated host assertions, not a live process registry. A stale but well-formed snapshot still authorizes the old target. The host must resolve evidence afresh and atomically fence the actual write against replacement after finalization. Historical terminal outcomes remain historical truth even if the target is later replaced; this change governs new execution authority only.

Evidence is the frozen exp74 local/shared-store 24-row corpus in SwarmLab, spec80. Focused regressions exercise local/shared/reconciled/journal finalization, effect start and resolution, invalid creation, producer mutation and independent revocation. The static SwarmLab benchmark catalogue is historical regression evidence, not an execution of RT64.
