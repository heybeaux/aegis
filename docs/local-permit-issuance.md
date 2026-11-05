# Local execution-permit issuance lifetime (SwarmLab RT-65)

Retrying `createExecutionPermit` after finalization used to recreate the same
ready file, even though the approval had already been consumed. A stale permit
handle could also finalize the ready file from a fresh approval for identical
inputs. SwarmLab experiment75 reproduces both failures against main9841b2c.

A successful local `consumeApproval` now atomically publishes a random issuance
generation bound to the full approval signature. Local permit IDs incorporate
that generation. Creation exclusively writes a persistent `.issued.json` marker
before publishing the ready record. Finalization removes the ready record but
retains the marker. Retrying creation for that generation fails, including after
restart or rejection of an invalid snapshot. If publishing the ready record fails
after issuance was claimed, the generation stays spent; obtain a fresh approval.

Requesting or approving without consumption does not refresh the generation.
A fresh successful consumption of the same call produces a different permit ID,
so the old handle cannot consume the new grant. Existing finalization/snapshot
rules remain in effect. Public shared-store APIs are unchanged and are **not**
covered by this local issuance guarantee.

The host must use a protected persistent approval directory, serialize the local
approval lifecycle, and pass the exact call/evaluation after successful
consumption. The API remains a trusted-host boundary, not an authentication layer
for callers who can modify its files. Legacy direct callers without a recorded
local consumption retain one initial deterministic issuance; another issuance
requires a genuine local consumption. External approval providers should use an
appropriate shared-store contract, not delete local markers to reuse authority.

Retain consumption metadata and issuance markers: deleting them can restore
replay authority. Retention grows with issuances; safe compaction is not supplied
by this change. The rename/exclusive-create protocol handles ordinary process
restart; no fsync/power-loss durability or concurrent consume/reapprove guarantee
is claimed. Before migration, drain old outstanding grants and reapprove work;
pre-upgrade finalized grants left no marker and their history cannot be inferred.
No host deployment or actual process side effect was performed.

The frozen20-case real-package experiment includes Bash and ProcessInput,
execution/burn/restart remint, pending/approved/failed consumption, outstanding
duplicate, fresh approval and stale handle controls. Baseline:12/12 unsafe
reissuances and2/2 stale-handle executions. Patched runtime8162da4:0/12 and0/2,
all6 fresh-approval controls pass. Twelve focused tests and the full hook suite
pass; linked SwarmLab receipts/CI supply executable evidence. The historical
58-case benchmark catalogue does not itself execute RT-65.
