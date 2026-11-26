# Burn acknowledgement type integrity (SwarmLab RT-86)

Effect-journal finalization, resolution and start accept only literal `true` from
`burnEffect` as confirmed invalidation. A malformed JavaScript/JSON return such as
`"false"`, `1`, `{ok:false}` or `[]` is unconfirmed. These calls return nonretryable
`indeterminate`, with `journal_unavailable` for resolution and `status_unavailable`
for finalization/start. Confirmed true and thrown-acknowledgement behavior is preserved.

TypeScript's adapter signature remains `Promise<boolean>`. Runtime checks protect the
boundary from protocol faults; they cannot prove a dishonest literal true is durable.
Hosts still own atomic storage, authentic authority, quarantine and reconciliation.
A malformed response may leave a grant startable through a clean adapter: Aegis must
report that uncertainty, rather than claim it has revoked storage it cannot control.

SwarmLab Spec102/exp96 preregisters 54 Bash/ProcessInput cases across all three APIs,
with independent valid controls, real approval consumption and strict permit issuance.
Baseline two identical runs: 24/42 uncertain acknowledgements falsely confirmed,
30/54 scenarios correct; fixtures/state/controls all pass and infrastructure failures0.
The same frozen experiment must pass before delivery. See linked evidence PR for
exact run/package hashes, retained red results, post-fix results and CI.
No production deployment, malicious-adapter containment or external-effect claim.
