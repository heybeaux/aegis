# Resume/start authority integrity

`resolveExecutionEffect` and `beginExecutionEffect` bind the handle and authority
snapshot at entry. Plain-data values must remain equivalent while journal I/O is
pending. Repairing a revoked/different authority during a pending invocation cannot
grant retry or execution; make a new request with authentic fresh authority instead.
Invalid authorized state is burned before returning invalid_snapshot. A successful
start CAS followed by observed authority drift refuses execution while retaining the
started fence. Hosts must reconcile that fence; do not assume the effect ran or
reset it for retry. Equal nested clones remain valid; caller objects are not frozen.

Terminal journal facts and existing revision/checkpoint integrity rules remain in
force. The host owns durable atomic stores and truthful authority. This change does
not promise detection of mutations restored between observations, post-return edits,
malicious proxies, or wrapper preflight windows. No production deployment claim.

## RT-71 / exp81 — Resume/start authority must remain stable across I/O

Spec87 pre-registration `7198e09`, frozen harness `3549bdf`. This experiment tests
caller authority during resumed journal reads and begin CAS/post-CAS read, separate
from exp78/79 initial finalization and exp80 issuance identity. Real Aegis baseline
`6f29b9a72d97948ca85ac7b4862679be25cd350a`, runs `rsi-mwbszq49-50440` and
`rsi-mwbt02lg-50852`, produces identical raw responses: **18/18 unsafe grants**,
rejection4/22, positives8/8, **12/30 scenarios pass**. Every independent control,
approval consumption and storage self-check passes; infrastructure failures0.

Runtime `1ec252873f2a7127a71b6843f6efe6cab28a180b`, exact same frozen30cases,
`rsi-mwbt28pg-56156`: **0/18 unsafe grants**, rejection22/22, positives8/8,
**30/30 pass**. Resume and begin now capture detached entry authority and handle;
record binding uses that snapshot; changed inputs cannot earn retry/execute.
Begin also remembers drift after CAS and checks again after readback. Before CAS,
invalid authority burns the authorization. After CAS, refusal retains started state
as a duplicate-prevention fence; this is NOT proof an external effect executed.

15 focused new tests (13 baseline failures) plus19 prior finalization tests pass.
Full release: 1589 tests,58/58 historical evidence gates. Exp79all29 and
exp80all28 pass as regressions, explicitly not new evidence. Receipts rescore raw
responses, bind complete source/build manifests, reject34 tamper cases, and live CI
requires fresh pinned actual-package outcomes equal to the admitted green trace.
Local verifier invocation mistakes (abbreviated SHA, incorrect manually entered
freshness bound) were rejected; corrected exact recorded values pass. No experiment
inputs or thresholds changed. CI/merge state recorded independently in nightly ledger.

Scope: deterministic storage contract; no database durability, actual external
effect or deployment proof. Host owns authentic fresh plain data and atomic storage.
Post-return mutation, arbitrary proxies/getters, between-observation ABA, elapsed
expiry and strict-wrapper preflight windows are unproven. Holdout reserved unused;
source .acr unchanged. Store burn-failure behavior was not tested or patched here.
Next hypothesis: can a false burn acknowledgement leave a supposedly invalidated
operation startable through clean authority? Deduplicate before preregistration.
