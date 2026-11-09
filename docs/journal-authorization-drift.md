# Journal finalization authority integrity (SwarmLab RT-69)

`finalizeExecutionPermitWithEffectJournal` captures a private entry-time copy of
the permit handle and host authority snapshot. It checks for changed input after
prepare and claim, including when prepare committed but its acknowledgement was
lost. Drift observed after prepare remains disqualifying if the caller restores
its data before claim returns.

The claimed operation must be durably burned before returning definitive
`blocked/invalid_snapshot`. A different adapter using clean current authority
then sees `authorization_burned` through resolution and cannot start the effect.
A failed or throwing burn returns `indeterminate/status_unavailable`; that does
NOT establish durable invalidation. Hosts must quarantine and reconcile uncertain
operations. Claim failures retain the existing reconciliation behavior.

Pass authentic fresh plain data and do not mutate in-flight requests. Equivalent
nested data is accepted; caller objects are neither frozen nor rewritten.
Unsnapshotable inputs are rejected before storage. Host adapters still own durable
atomic prepare, single claim, burn, and effect-start transitions.

This evidence uses the legacy four-argument issuance API in isolated stores. The
strict shared issuance namespace is currently incompatible with the journal's
legacy permit ID validation. Do not infer journal compatibility from strict
simple-take tests. This independent shortfall was discovered by failed setup
controls and is reserved for a separate experiment, not patched here.

SwarmLab Spec85/exp79 pre-registered 29 fixed Bash/ProcessInput cases. Two identical
baseline runs on104113f left13/13 repaired/drifting authorizations resumable and
startable; durable invalidation4/17. Runtime889660a yields0/13 unsafe resumes,
17/17 invalidation,29/29cases passing.19new tests (15initially failing),104focused
tests, release1554tests and58historical gates pass. Exp78 compatibility46/46passes.
The static58-case catalogue is not a live execution of RT69. Dedicated SwarmLab
CI builds the pinned package and checks fresh raw outputs against retained traces.

The deterministic Map fixture is contract evidence, not production database
validation or an actual external effect. No claim-after-commit-loss recovery,
post-return protection, malicious adapter defense, transient between-observation
ABA detection, or broader resume/start input-integrity guarantee is established.
Holdout remains unused; no statistical generalization or deployment claim.
