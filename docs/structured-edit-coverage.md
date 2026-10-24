# Structured edit content coverage (RT61)

OpenClaw `edit` with validated `params.edits: [{oldText,newText}, ...]` now projects
all string replacements into optional `ToolCall.contentFragments`. Existing scalar
content is retained and inspected too. Each fragment is a separate rule input:
no delimiter/concatenation can invent a match spanning two edits. Existing rules,
severity/prediction ordering, hit deduplication and scalar calls remain unchanged.
Approval signatures bind ordered fragments; predictor action keys bind their JSON
hash (including empties, order and boundaries). Legacy calls without the field
keep their identity. Content-risk heuristics take maximum per-fragment risk, not a
spread that can exhaust argument limits. No trained-predictor claim.

Hosts still own input/schema validation, unique oldText matching, execution and
receipts. This adapter does NOT parse apply_patch, claim malformed-input safety,
check oldText as written data, or govern arbitrary host mutation. Generic ToolCall
producers may supply independent fragments directly. Resource admission for large
content/argv/path arrays remains a separate unanswered question.

SwarmLab exp71 / Spec77 freezes18 scenarios. Current-main red pair missed8/8
structured hazards and8/8 changed-content identity probes; ten controls and eight
scalar positive controls passed. Same corpus candidate green18/18. Exact runtime
commit259882071774cd2f65da09e8077363995ff11dd2, content-addressed source/dist/trace
receipts in SwarmLab; historical benchmark row is NOT a fresh runtime check.
Linked delivery/check status belongs to GitHub and nightly ledger. Prior RT57
calibration CI issue77 remains open, no unrelated change attempted. Source .acr
unchanged so Territory is not refreshed.

The RT61 candidate evidence constant is deliberately outside the landed release
catalogue. Its focused test requires PARTIAL while implementation is pending;
the unchanged52-case historical catalogue stays independent of merge status.
