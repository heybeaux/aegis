# Shared finalization input integrity (SwarmLab RT-68)

`finalizeExecutionPermitWithStore` and `finalizeExecutionPermitWithReconciliation`
now retain a private entry-time copy of the permit handle and authority snapshot.
After awaited storage they require structural equality with caller data and
validate the captured snapshot. Invalid authority repaired during an invocation
cannot turn that invocation into execution permission. Reconciliation remembers
observed drift after prepare, then claims/burns the grant so it cannot be reused.

Pass authenticated fresh plain data. Do not update an in-flight snapshot: obtain
fresh authority for a new request instead. An observed mutation rejects even if
it makes the data valid. Unchanged and equivalent nested replacements work;
caller objects are not mutated or frozen. Null or non-cloneable inputs reject
before store I/O. Unavailable storage keeps existing false/indeterminate behavior.

This covers these two public finalizers. It does not establish transactional world
state, post-return consistency, mutation-and-restore detection between observations,
elapsed expiry, malicious host/store protection, or effect-journal entrypoint safety.
Hosts still own authenticated inputs, durable atomic create/take or prepare/claim,
and immediately executing exactly the authorized action. No database adapter or
external side effect was tested. No predictor improvement is claimed.

Exp78/Spec84: current-main2e7d4dd executed22/22 repaired invalid snapshots across
Bash/ProcessInput and both APIs. Same46fixed cases with runtime63cbf6f execute0/22;
all46pass. Unchanged/equivalent/ABA, valid-to-revoked, outage and replay controls
pass before/after. Two baseline runs have identical raw observations.21new tests
(15red initially),92focused tests, full release1535tests plus58historical gates pass.
Exp77 compatibility28/28passes. SwarmLab keeps raw red-red-green traces and exact
source/dist hashes; its dedicated CI tests the pinned built package. The58-case
historical catalogue is not execution of RT68. Holdout remains unused.

Journal finalization is separately covered by [RT-69](journal-authorization-drift.md),
including retained-state invalidation and clean-snapshot resume checks.
