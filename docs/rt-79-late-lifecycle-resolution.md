# RT-79 — Late lifecycle resolution entry binding

Late resolvers for full retirement, legacy compact proof and plural compact proof
capture permit/approval identity before storage reads and validate that identity
at every awaited proof/authority boundary. A caller switching to a foreign permit
cannot make retained foreign proof count as terminal truth for the entry call.
Detected drift returns blocked/policy_lifecycle_inconsistent; unchanged read
outages remain indeterminate/policy_unavailable. Begin never regains authority.
No stored record or caller object is frozen, rewritten or deleted.

SwarmLab Spec95 / experiment89 pre-registered the design before observations.
Baseline 4744da93fe969032bd9b586730e4c8fe05986970: eight false classifications
out of56;16/24 drift hazards rejected. Both baseline runs were identical.
Candidate 1b35ded5653ad7b9ae1cba251826f028d60aac35: zero false classifications,
24/24 hazards rejected,56/56 scenarios pass with unchanged design and thresholds.
48new tests include12baseline failures and full-tombstone plural fallback.
82focused tests pass. This is terminal resolution evidence, distinct from RT78
retirement/compaction write attestation and RT40 static authority disagreement.

Host responsibility: authenticated complete proof/authority enumeration, detached
reads and durable storage. Deterministic Bash fixture uses real approvals/permits
and host-seeded proof, without real external effects or production DB validation.
No hidden ABA within a callback, post-return protection, deployment or predictor
claim. Holdout unused; no tuning. Original red traces retained in SwarmLab.
