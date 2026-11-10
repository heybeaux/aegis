# Strict issuance identity through effect journals (SwarmLab RT-70)

Strict shared permit creation now retains `issuanceId` in the stored record.
Journal authorization, start, resolution and terminal receipt attestation recompute
the same domain-separated permit ID used at creation. They continue to bind the
approval ID and exact signature; a matching opaque ID is insufficient. Malformed,
removed or changed strict metadata fails closed. Legacy records continue to use
the legacy derivation. Handle shape and strict permit IDs are unchanged.

Adapters must preserve the complete record, including `issuanceId`, through
prepare, claim, read and receipt transitions. The host still owns durable atomic
storage, permanent issuance markers, truthful per-consumption identities and fresh
authenticated authority. Aegis does not supply a database implementation or prove
that the external effect occurred.

## Upgrade boundary

Strict records issued by older versions lack derivation metadata. They remain
invalid for journal use; exact lost-handle recovery also rejects them because the
new expected record contains `issuanceId`. Do not silently inject or guess metadata,
reissue the same consumed grant, or fall back to legacy creation. Drain outstanding
grants using the old integration or obtain a fresh approval and fresh consumption
identity. Coordinate issuing and journal-reading hosts: old readers will reject
new strict records. Legacy journal records remain compatible. This experiment does
not establish an online mixed-version migration procedure.

## Evidence

SwarmLab Spec86 / exp80 was pre-registered before implementation. The admitted
baseline on a52fc456d07a05527931c6b2c690e1f09c94ad27 repeated identical raw outcomes:
strict lifecycle0/10, negative16/16, legacy/simple controls all passing,18/28cases.
Runtime67b57ac7871347119973aee1da24f155716a979e passes the same frozen28cases:
strict lifecycle10/10, negative16/16, all28green. The lifecycle includes successful
and failed receipts, recovered handles, lost prepare acknowledgement, fresh grant
separation and corrupt retained-record reads for Bash and ProcessInput.

20new focused unit tests pass (four fail against unchanged baseline after fixture
corrections);84focused tests pass. Deterministic storage-contract evidence only:
no production database, external effect, malicious-host defense or deployment
claim. Holdout reserved unused. The SwarmLab PR contains red-red-green traces,
source/dist manifests, an independent replay verifier and live pinned-package CI.
