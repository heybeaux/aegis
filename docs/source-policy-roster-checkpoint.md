# RT-45 — Durable source-policy roster checkpoint

Exp-55 pre-registered at SwarmLab 730e3b3f8fdc98fc11a85889f47cdc47e70bd65f; baseline sprc-muwb2jz7 and repeat sprc-muwb2k1q, real Aegis c8fe1b0, allowed 12/13 checkpoint faults. Candidate runtime 86d68cd30c08a26e7ad8e18918770aa069d3f8c7 / sprc-muwb77jk passes all frozen thresholds.

Use `evaluateWithSourcePolicyRosterCheckpoint(call, compiledRules, store, options?)` from `@heybeaux/lattice-aegis`. It is a strict async boundary, not automatically installed in the CLI hook. Do not perform the action before it returns allow. Existing evaluate remains pure and backwards compatible; it does not claim durable rollback safety.

Host implements `SourcePolicyRosterCheckpointStore.read(rosterId)` and `observe(proposal)`. Read is linearizable and returns null only for genuinely absent truth, otherwise independently authenticated exact rosterId, positive safe epoch, sha256 digest. Observe atomically initializes or advances to a greater epoch, never regress or overwrite same-epoch conflicting digests. Host authenticates persisted readback, never blindly copies the Aegis proposal's authenticated flag (always false). Retain/share state across restart and host handoff, outside roster backup/rollback domain.

Aegis checks prior high-water, rejects invalid/unverified/foreign/older/same-epoch conflict evidence, then reconciles any observe acknowledgement (including an exception) through exact authenticated readback. Missing, unavailable, or raced newer truth asks; earlier rule/predictor decisions stay restrictive. The proposed binding is frozen and isolated from host adapter mutation.

Limitations: a dishonest/rolled-back independent store can lie; complete membership, epoch allocation, authority independence, monotonic persistence and retention are host-owned. There is a final-read-to-action gap; this API does not claim atomic execution under concurrent future roster changes. Experiment is deterministic adapter evidence, not distributed consensus certification or a trained predictor.

## RT-46 — In-flight input integrity

The async gate snapshots plain `ToolCall` data privately before invoking host I/O. After each awaited
read/observe (including failed operations), it checks that the live caller data still matches that
snapshot. Observable changes fail closed with
`swarmlab.rt46.async-source-policy-gate-requires-stable-input`; newly observed critical rule matches
retain `deny`, not merely `ask`. Changes seen after the first read cause no checkpoint observe.
Equivalent deep-cloned data is allowed. Unsnapshotable input fails closed. Caller objects are not
mutated or frozen. Original deny/ask floors and ordinary synchronous evaluate remain compatible.

This is not action atomicity. Hosts must pass plain-data calls and execute exactly the authorized
call after return, without reusing a concurrently mutable reference. Proxies/getters, transient
mutate-and-restore (ABA) between observations, mutable rules/options, and mutations after the final
comparison remain outside this guarantee. The checkpoint host still owns authentication, atomic
monotonic persistence and independently retained truth. Exp-56 tests mutable input DURING one
invocation; it does not replace RT-45 history validation or production host integration tests.

## RT-48 — Bind evaluator configuration through awaited I/O

The strict async gate privately captures effective entry options (including exported defaults) and
compiled rules with stateless RegExp source/flags. After every read/observe (including rejected I/O),
it compares the live policy. Drift fails closed with
`swarmlab.rt48.async-source-policy-gate-requires-stable-configuration`; original and current
configuration deny classifications are retained even when caller ToolCall changes simultaneously.
Early drift prevents observe; post-observe drift prevents another read. This refusal cannot be
overridden by permissive severity. Equivalent copied config is allowed; caller data is not frozen
or modified. Unsnapshotable options fail closed. RegExp lastIndex is incidental, not policy identity.

This is observed configuration integrity, not hot-reload coordination or action atomicity. Hosts
still own valid plain-data config, authentic checkpoint, trusted stateless regex and immediate
exact execution. Getters/proxies, function overrides, transient ABA and post-return races remain
unproven. Pure evaluate and elapsed-clock semantics are unchanged. Exp58 has21 frozen scenarios
with repeated real baseline red and unchanged candidate green; RT48 intentionally reserves RT47
for prior unlanded exp57.

RT48 local verification:1087 tests, release evidence47/47 (RT47 reserved/unlanded), focused29/29. The previous RT47 branch must reconcile clock-function capture with RT48 plain-policy snapshots when rebased; combined behavior is not proven by these receipts.

Linked experiment PR: https://github.com/heybeaux/swarmlab/pull/46; runtime PR: https://github.com/heybeaux/aegis/pull/63. CI/merge state is recorded in nightly pipeline ledger, not presumed by local receipts.
