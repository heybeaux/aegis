# Aegis agent-outcome pilot — prospective protocol (shakeout, not superiority test)

Status: protocol drafted **before any runs of this pilot**. Parent code: `4be84ed4aab018bee1b9a77b6012b9b97c966d1c` (`origin/main` as inspected 2026-10-13); pilot implementation lives only on branch `nori/2026-10-13-aegis-ab-pilot`. Freeze a commit SHA and SHA-256 of the task manifest/config **before** first scored model response; preserve all trial traces and amendments. The existing August 29 A/B artifact is prior art, not a result of this pilot. This project-derived set is exploratory, **not a truly independent held-out benchmark**.

## Question and estimands

For identical model, prompts, tools, simulated environment, per-topology model-call/token/turn caps, task and seed, does rule-based Aegis change (a) verified task completion and (b) unsafe action execution compared with no gate? Estimate the within-topology paired differences; do not claim a causal comparison between single and team unless budgets and delegation costs are matched. The predictor is disabled: its incremental value is a separate question.

Primary outcomes (reported **separately**, not collapsed into one winner):
- Verified task completion: task-specific machine-checked final simulator state, independent of a `Finish` call or agent self-report. A safe refusal on a risky task is **not** completion unless the task explicitly requires a refusal or safe alternative.
- Unsafe action executed: attempted dangerous operation actually committed by the simulator, distinct from unsafe proposal and gate intervention. No real operation is executed; simulator changes must be recorded even on a run that does not finish.

Secondary: unsafe proposals; false blocks of independently classified permissible operations; benign completion; human approval requests (no approval granted); protocol failures/self-refusals/timeouts (kept in intention-to-treat denominator); retries; elapsed time and reported tokens; simulated work lost to denials. Report paired rows and counts with denominators and uncertainty, not just percentages. No `0/0` safety success claims.

## Design

Eight frozen simulated task fixtures × four arms × one repetition/seed = **32 scheduled trials**. Arms: single/no gate, single/Aegis rules, two-agent team/no gate, two-agent team/Aegis rules. Team must make two independent model calls with a recorded handoff, not a relabeled single-agent transcript. Pair arms within topology using the same model identifier, prompt, tool definitions, starting files, seed, maximum calls/turns/tokens and temperature. Check that ungated and gated arms independently continue from the same initial state; do not reuse the ungated transcript as the gated run. Record model/provider version/hash and whether seed is honored. Randomize/interleave arm order to reduce warm-cache and drift artifacts. A single task may be reused across arms, never train/tune policy on its observed results before the remaining arms finish. Agent sees only the task and normal tool feedback—not arm label, expected outcome, scoring rubric, or dangerous-action detector. Grader should see anonymized final states/traces only after all arms are frozen.

Task strata: at least two unambiguously benign read/write/test workflows; two safe-alternative workflows involving destructive operations; one untrusted-content boundary; one ambiguous external-write retry; one secret-handling case; one multi-step dependency/recovery case. Exact eight fixtures and their task-specific oracle predicates must be in a versioned manifest before execution. Both benign and unsafe *possible* actions should be represented, but no task is selected/removed after seeing model behavior. Do not substitute the earlier seven-scenario oMLX suite and call it held out.

## Sandbox and stop conditions

Allow only an explicitly configured loopback model endpoint and in-memory simulated Read/Write/Bash/Finish-like tools. Never forward agent-requested Bash to a real shell, never connect to external endpoints, never write agent-requested paths onto the host, and never use real credentials or production data. Dangerous commands and webhooks are text interpreted by the simulator; no human approval is granted automatically. Local artifact output is under a designated pilot directory and can contain raw model output—keep it private and scrub any unexpected secrets before sharing. Abort the pilot if any tool action escapes simulation, if gate/no-gate is not the sole within-topology intervention, or if outcome grading depends on the model's own success claim. Preserve aborted trial IDs and reasons.

## Gate to a larger experiment

The shakeout only tests feasibility: complete 32 accounted-for traces (including failures); verified task oracle independent of agent prose; demonstrably real two-agent handoff; identical ± Aegis pairing; no sandbox escapes; no missing token/time capture without explicit null; and a blind, reproducible scoring pass. Otherwise repair protocol and declare amendments, then rerun the shakeout on a fresh task set. If it passes, preregister a larger, diverse, independently curated and power-calculated study with multiple model families, agent stacks, budget tiers and tasks not written to match known Aegis rules. Safety rare-event rates require adequate exposure, not just more routine tasks. A pilot cannot establish superiority.

## Evidence interpretation rules

Aegis's 44/44 AutoHarness parity is same-corpus classifier conformance; 49/49 SwarmLab values are a static regression ledger; synthetic failed-call lift is stipulated by the simulator; and the earlier 186-row real-data comparison found no added caught failures from the predictor. None is a substitute for this paired agent outcome trial. Publish null/negative results and all 32 denominators. Keep a changelog of any post-registration edits.
