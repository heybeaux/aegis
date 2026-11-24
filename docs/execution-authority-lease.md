# Shared finalization authority lease (SwarmLab exp94 / RT-84)

A fresh host authority snapshot can become too old while a shared store call is
pending, even if none of its fields changes. The simple and reconciled destructive
finalizers accept an optional last argument:

```ts
const options = { validUntilMs: authenticatedAuthorityDeadline };
const allowed = await finalizeExecutionPermitWithStore(permit, snapshot, store, options);
// Or: finalizeExecutionPermitWithReconciliation(permit, snapshot, operationId, store, options)
```

The deadline is an inclusive, nonnegative safe-integer epoch millisecond. A trusted
`nowMs` callback can replace `Date.now`; it must use the same units/epoch and return
nondecreasing safe-integer times. Aegis captures both at entry, validates the clock
at entry and after awaited storage, and retains any observed expiry or clock failure
through prepare acknowledgement recovery. Taken or claimed records are still burned
on rejection. The reconciled failure is `blocked/invalid_snapshot`, nonretryable;
store uncertainty retains its existing indeterminate classification. Clock errors,
malformed options and attempts to relax the options during I/O never authorize.
No-option calls preserve their previous behavior without sampling a clock.

This is an opt-in lease on one finalization invocation, **not a persisted permit TTL**.
The host must supply its authenticated deadline on every attempt, including retries,
and execute immediately after allow. This API does not derive the deadline from the
original approval envelope. Local finalization and retained effect-journal/start APIs
do not accept this option and are outside this contract. Hosts must not treat an
ignored extra argument on those APIs or older package versions as enforcement.
Host clock trust, durable atomic adapter behavior, cross-host clock skew, mandatory
host adoption and post-return races remain outside the guarantee.

Experiment94 freezes 34 deterministic cases and paired no-lease controls against
the real built public package. Baseline 9c06ee8 authorized 24/26 unsafe lease cases
in both runs. This demonstrates a missing policy capability, not a violation of
an existing documented permit-expiry promise. Raw red and candidate evidence lives
in SwarmLab; focused unit regressions are included in Aegis release:check.
