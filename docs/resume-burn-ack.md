# Resume invalidation acknowledgement (SwarmLab RT-72)

`resolveExecutionEffect` and `beginExecutionEffect` now inspect the boolean returned
by `burnEffect`. A false acknowledgement means durable invalidation is unconfirmed,
just like a rejected promise. Resolution returns `indeterminate/journal_unavailable`;
start returns `indeterminate/status_unavailable`. Neither grants retry or execute.
A confirmed burn retains definitive `invalid_snapshot` behavior.

Hosts must quarantine and reconcile uncertain operations. A failed burn may leave an
authorized record startable through another adapter. A competing valid caller may
already have started the effect. A thrown acknowledgement may follow a durable burn.
Aegis does not invent storage state or guarantee durable revocation during an outage.
No external effect is executed by these APIs.

SwarmLab [Spec88 / exp82](https://github.com/heybeaux/swarmlab/tree/main/experiments/82-resume-burn-ack)
pre-registered 24 Bash/ProcessInput cases across both APIs: valid, confirmed burn,
false burn, throws before/after burn, and concurrent start during burn. Real evaluate,
approval consumption, strict permit issuance and journal finalization precede every
case. Independent unchanged controls and fixture self-checks all pass.

Baseline `63387b582721c5326780b7e936c226ff61c1597f` runs `rba-mwd8f50h-94937`
and `rba-mwd8f54q-94953` have identical raw outputs: false definitive reports8/16,
16/24cases pass. Runtime `6cc58be3fac4276613d570009d0a202d269e8778`, unchanged
harness, run `rba-mwd8h1rw-95860`: false definitive reports0/16,24/24pass.
Four baseline cases remain authorized after rejected burn; four have already started
through a competing valid caller. Throw paths already reported uncertainty correctly.

14 new unit tests (6 failing before patch),48focused tests, release1603tests and
58historical gates pass locally. Exp79all29 and exp81all30 pass as regressions.
Frozen receipts independently rescore responses;34tamper tests reject. Dedicated
SwarmLab CI builds the pinned runtime and verifies fresh outcomes against retained
traces; consult PR checks for CI state. This is deterministic storage-contract evidence,
not production database durability, deployment or external-effect exactly-once proof.
Host authenticity, atomic storage, quarantine and reconciliation remain requirements.
Holdout reserved unused; no parameter tuning or .acr source change.
