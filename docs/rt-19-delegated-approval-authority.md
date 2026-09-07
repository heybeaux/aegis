# RT-19 — Delegated Approval Authority

**Date:** 2026-09-07  
**Evidence:** SwarmLab `exp-28 delegated-approval-authority`  
**Baseline:** `daa-mtqw5r7i`  
**Post-fix:** `daa-mtqwgbcv`

## Finding

An approval bound only to the apparent principal can be laundered by a delegated agent that presents the principal's provenance. Binding only the effective consumer prevents that misuse, but blocks legitimate direct and bounded delegates. The safe contract needs both identities plus independently verified delegation truth.

## Aegis contract

`ToolCall.approvalDelegation` carries:

- `effectiveConsumerId`
- explicit `declaredScope`: `none`, `direct`, or `bounded`
- `maxDepth`
- an ordered root-to-consumer chain with verified nodes and non-increasing `authorityLevel`
- revocation-check and structural-validity results supplied by the trusted host

The approval signature binds the original provenance plus the stable grant constraints. The approved record preserves the full original delegation metadata. At consumption, Aegis rejects missing, malformed, unverified, over-depth, expanding, revoked, or mismatched chains. The effective actor may differ from the approving principal only when valid delegation metadata is present. Legacy approvals without delegation metadata retain RT-18 exact-principal behavior.

## Measured result

The same pre-registered ten-scenario experiment changed from:

- laundering execution: `1.000 → 0.000`
- legitimate delegation block rate: `0.667 → 0.000`
- refresh coverage: `0.857 → 1.000`
- delegation accuracy: `0.700 → 1.000`

All specific unsafe classes were zero after the change, root control did not spuriously re-ask, and initial ask coverage remained 1.000.

## Ownership boundary

Aegis owns the metadata contract, adapter normalization, approval-store validation, regression tests, and RT-19 release gate. The host owns truthful consumer identity, independent chain verification, revocation state, and structural validity. Aegis fails closed when that required delegation evidence is absent or false.
