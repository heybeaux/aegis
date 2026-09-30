# RT-40 — Compact retirement checkpoint authority agreement

RT-39 authenticated one self-binding compact strict-roster retirement checkpoint. RT-40 adds an
optional plural authority boundary for hosts that retain independently authenticated lifecycle views.

`MultiAuthorityCompactableDurableStrictRosterPolicyStore` extends the RT-39 lifecycle store with
`readCompactRetirementCheckpointAuthorities(operationId)`. Each visible authority must have a unique
bounded identity, exact operation/outcome/receipt/revision fields, a host-authenticated `verified: true`
flag, and the same permit/approval-bound checkpoint digest as the local compact record. Empty,
malformed, duplicate, unverified, or conflicting evidence blocks terminal certainty. Missing or
unavailable authority evidence is indeterminate. A full un-compacted retirement tombstone remains
terminal and does not require the compact-authority service.

Use `resolveMultiAuthorityCompactedDurableStrictRosterPolicyExecutionEffect()` for late reads and
`beginMultiAuthorityCompactedDurableStrictRosterPolicyExecutionEffect()` at begin/reselection
boundaries. The begin function never restores authority from terminal proof.

Aegis validates evidence the host exposes; it cannot discover hidden or colluding authorities.
Authority independence, authentication, complete enumeration, linearizable reads, retention, and
physical garbage collection remain host responsibilities.
