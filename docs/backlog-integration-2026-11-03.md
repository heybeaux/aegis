# Backlog integration, 2026-11-03

Combines PRs #66, #67, #68, #69, #72, #74, #75 and #78 with current main,
plus the local simulated agent-outcome pilot. The observer branch's implementation
was already present; its merge retains the newer chat-template handling.

Interactions resolved: cache binding is checked before native regex job creation;
all encoded occurrences still obey preprocessing admission caps; numeric-contract,
compiled-binding, runtime-timeout and process-input refusal floors compose with
independent deny. Public defaults remain editable templates, with private implicit
policy. The flaky clock test now supplies a controlled Date.now sequence.

## Required host migrations

- Predictions must include finite pFailure/confidence in [0,1] and source awm/prior.
  Incomplete predictions and invented source labels now ask instead of contributing
  a risk estimate. Existing malformed exp58/exp72 fixtures remain red, unmodified.
  SwarmLab's separate verify-rt50-migration script demonstrates their original
  behavior with valid producer metadata; frozen receipts are never rewritten.
- Select modified DEFAULT_* recipes explicitly through evaluator/allowlist options.
- Overlay matcher retunes and tool-scope contractions require allowDowngrade:true
  on that overlay, including opaque regex broadening.
- Reload compiled packs after changing pattern/flags.

Loader probes use a 25ms interruptible wall-time budget. Scheduler pauses can cause
conservative rejection of safe patterns; the earlier load-sensitive observation
is retained, not claimed eliminated. Native evaluation also has a cumulative
250ms default allowance; unresolved matching requires review. No production
plugin reload or gateway restart is part of this merge.

## Verification

Local combined release check: build/typecheck and 1425 tests passed before removing
one duplicated historical catalogue test; 58/58 stored mappings passed.
Simulated pilot: 23/23 tests passed, no live model calls. Fresh real-package
SwarmLab exp55–57,59–71 checks passed; original exp58 and exp72 expose the documented
producer migration, and separate migrated copies pass without changing thresholds.
Remote CI and final counts are recorded in the integration PR.

## Local-only work excluded

- feat/awm-revise-mapping adds an unwired engine importing an unavailable
  @heybeaux/awm-core dependency. Its recorded precision/F1/accuracy regress; it is
  not a verified replacement for the current engine.
- Old exp57 and closed exp58 branches were superseded by the exp57/58 integration
  already in main. Restoring their snapshots would regress later behavior.
