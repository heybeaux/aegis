# Shared permit issuance lifetime (SwarmLab RT-66)

Atomic create-if-absent and destructive take prevent duplicate outstanding permits,
but do not remember issuance after take. A second host could recreate a spent
permit, and a stale handle could consume the permit for a fresh approval with the
same call bytes. The local filesystem issuance fix does not protect shared stores.

Hosts can now opt into strict shared issuance:

```ts
const permit = await createExecutionPermitWithStore(
  call, evaluation, consumedApprovalId, store,
  { issuanceId: consumedGrantIdentity },
);
```

`issuanceId` is a trusted host's stable identity for ONE successful approval
consumption, scoped to the exact approved call. Reuse it for all retries and all
hosts; assign a new identity only after a new successful approval consumption.
It must be a nonblank string of at most 256 UTF-16 code units. Aegis binds it to
the approval/signature in a separate shared-issuance namespace. Do not generate a
new ID on every creation attempt: doing so grants fresh authority outside this
contract. The API does not authenticate a dishonest host's identity assertion.

The store must expose `createOnce(record)`. In ONE durable transaction shared by
all hosts, it must check the permanent issuance marker and any existing ready
record, reject duplicates, and insert BOTH marker and ready record. Return literal
`true` only when newly issued. `take(id)` removes ready state but MUST retain the
issuance marker. A unique primary key/tombstone in a database is one possible
implementation; a process-local Set is insufficient for production durability.
Aegis supplies the contract and refusal behavior, not a database adapter.

Strict requests reject malformed identity, absent capability, false/nonboolean
success and storage exceptions. There is no fallback to legacy `create`. If the
store committed but lost its creation acknowledgement, retry remains blocked;
lost-handle recovery is not implemented. This sacrifices availability to avoid
reissuing authority. If the store failed before commit, retry may succeed.
Snapshot checks and one-shot finalization remain in force.

Four-argument callers keep legacy behavior. They have NO protection against
recreation after destructive take. Migrate all issuing hosts and retain markers;
drain outstanding grants and reapprove before adopting the new contract. Strict
and legacy handles have distinct namespaces and are not mutually exclusive: do
not use both issuance modes for the same consumed grant. Historical finalized
grants have no reconstructable issuance history. Marker compaction, hostile
storage and host identity compromise remain outside the guarantee.

Experiment76's fixed 28-case corpus calls the real built package with two adapter
objects sharing a deterministic transactional storage fixture. Baseline2c3a68d:
8/8 remint hazards execute, 2/2 stale handles execute, 0/6 full fresh-grant controls,
0/6 capability refusals. Runtime dad0766: 0/8 and 0/2 unsafe execution, 6/6 fresh
controls and 6/6 refusals; all28 cases pass. Twenty-one new unit tests cover the
contract, malformed options, acknowledgement loss and nonboolean store results.
No real database durability, external side effects or deployment was tested.
