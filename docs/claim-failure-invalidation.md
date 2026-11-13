# Claim failures retain observed invalidation (SwarmLab RT-73)

`finalizeExecutionPermitWithEffectJournal` now retains observed input drift when
`claimPreparedEffect` rejects, whether the claim committed or not. Drift after
prepare remains disqualifying even if the caller restores the entry data before
claim rejection. Changed authority or permit handles trigger durable invalidation.
A true burn acknowledgement returns `blocked/invalid_snapshot`; a false or thrown
burn returns `indeterminate/status_unavailable`. Unchanged inputs retain the
existing uncertainty and fenced recovery behavior. No claim exception itself
returns permission to execute.

The host must supply atomic storage and authentic fresh authority, quarantine
uncertain operations, and use `beginExecutionEffect` before invoking the effect.
Aegis cannot durably burn during an outage. This change does not address immutable
invalid inputs without observed drift, claim returning undefined, unseen ABA,
post-return mutation, arbitrary hostile storage, or external-effect exactly-once.

SwarmLab Spec89 / exp83 pre-registered 32 Bash/ProcessInput scenarios: before/after-
commit claim failure, authority repair/revocation, remembered prepare drift, handle
mutation, unchanged/equivalent controls, and false/throwing burns. Each scenario
uses actual approval consumption and strict shared issuance, independent controls,
and storage self-checks. Baseline `23e33e098ad24b04aed8291b654c953af2165073`
runs `cfi-mwenvqdn-58549` and `cfi-mwenvqib-58565` have identical raw responses:
16/16 invalidated authorizations remain startable; 16/32 scenarios pass.
Runtime `43e4a82a71311a320e42555b9e24ef5cb3fc37de`, unchanged frozen design,
run `cfi-mwenxju0-59624`: 0/16 unsafe recoveries; 32/32 scenarios pass.

16 new unit tests (12 failed on baseline), 49 focused tests pass. Exp79 (29 cases)
and exp82 (24 cases) pass as regressions. Source/dist manifests and independent
receipt replay bind red-red-green evidence; 34 tamper checks reject altered inputs.
Dedicated CI builds the pinned real package and verifies fresh raw outcomes.

Local default-concurrency release checks twice hit the unchanged loader's 25ms
regex-probe deadline, in different builtin rules; isolated e2e passed. The nightly
ledger records all attempts and the reduced-concurrency release outcome. The probe
budget and implementation are unchanged. Consult PR checks for CI/merge state.
No production database, deployment or learned-predictor claim. Holdout unused.
