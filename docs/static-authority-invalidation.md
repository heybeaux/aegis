# Static entry authority across absent journal claims

`finalizeExecutionPermitWithEffectJournal` validates the retained operation's
permit against its captured entry snapshot after a claim throws or returns no
record. A static revocation, unchecked revocation, invalid delegation, changed
authorization digest, consumer, or process generation must not remain recoverable
simply because authority stayed unchanged while claim was pending.

The extra read checks the exact operation, permit, approval and issuance binding
before invalidating. It never grants execution. Owned invalid authority requires
`burnEffect` acknowledgement before reporting `blocked/invalid_snapshot`. Failed
reads, malformed/foreign bindings, or unconfirmed burns report
`indeterminate/status_unavailable`. An absent record preserves the original
claim-failure/contention result. Valid snapshots preserve fenced recovery and
existing `not_taken` retry semantics. Caller inputs remain privately captured and
are checked again after the new awaited read.

The host still owns authentic authority, durable atomic adapters, immutable
operation-to-permit binding, quarantine on uncertainty, and the begin CAS before
external effects. Aegis cannot cancel an already-started effect or guarantee a burn
during storage failure. This does not establish production durability, protection
against hostile adapters, unseen ABA, post-return mutation or external exactly-once.

SwarmLab Spec101 / exp95 pre-registers 57 deterministic Bash/ProcessInput cases,
with static authority held unchanged across throw-before, throw-after and actual
competing claim outcomes. Baseline Aegis beffd514ea144bfdcf13531cbc9d87760bbc55b4
has 33/33 unsafe clean recoveries and 18/57 complete scenarios passing in two
identical runs. All paired controls, rival claims, approval consumption, fixture,
state and ownership checks pass. The experiment checks actual retained state and
clean recovery; store outages remain uncertainty, not false invalidation success.
Candidate and delivery evidence are recorded in SwarmLab and the nightly ledger.

This extends the explicitly excluded static-invalid boundary of RT-69/73/74;
those experiments remain separate regression evidence. Source `.acr` is unchanged.
