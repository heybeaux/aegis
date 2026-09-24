# Aegis

**Purpose:** Governance harness for AI agents with an outcome-learning loop. Aegis combines a deterministic rule gate, live decision/outcome collection, real-data labels, a deterministic failure predictor, and SwarmLab-derived benchmark/release gates.
**Repo:** https://github.com/heybeaux/aegis
**Status:** active
**Phase:** rule floor live and at parity (44/44); SwarmLab evidence gate at 37/37 (RT-01..RT-37); 40 runtime policy ids enforced across RT-07..RT-16; trained/calibrated predictor NOT built yet
**Last verified:** 2026-09-24

## Runtime

- **Local path:** `/Users/beauxwalton/Dev/aegis`
- **Package manager:** pnpm workspaces
- **Root commands:**
  - `pnpm -r build`
  - `pnpm -r test`
  - `pnpm -r typecheck`
- **Key packages:**
  - `@heybeaux/lattice-aegis` — rule engine and evaluator
  - `@heybeaux/aegis-hook` — Claude Code/OpenClaw-style PreToolUse hook
  - `@heybeaux/aegis-collect` — decisions/outcomes JSONL logging and dataset join
  - `@heybeaux/aegis-label` — label pipeline over signed event chains
  - `@heybeaux/aegis-bench` — synthetic, real-data, and SwarmLab evidence benchmark axes
  - `production-predictor.ts` — deterministic hand-weighted failure predictor (not a trained model)

## Dependencies

- **Depends on:** `@heybeaux/lattice-aegis`, `@heybeaux/awm-core`, pnpm workspaces
- **Feeds on:** live hook decisions/outcomes in `~/.aegis/*.jsonl`; future Sonder signed event chain
- **Used by:** agent runtime governance, release safety checks, predictor training/evaluation
- **Related:** SwarmLab, Sonder, AOP, Lattice, Engram, Parliament, AWM

## Key contacts

- **Owner:** @beauxwalton
- **Contributors:** agent team

## Quick gotchas

- **Local checkouts drift badly.** On 2026-09-24 `~/Dev/aegis` was 107 commits behind `origin/main` (local tip RT-08, real tip RT-37). Always `git fetch` and read `origin/main` before judging maturity. Work lands via dated branches (`nori/YYYY-MM-DD-expNN-aegis`) as numbered PRs.
- The shipped predictor is **deterministic and hand-weighted** — fixed feature weights, hardcoded cold-start severity base rates, sequential per-bucket posteriors. No trained classifier, no held-out calibration curve. Do not call it "calibrated" or "proven". The rule floor and evidence gate are what's proven.
- Data is the binding constraint, not modelling: ~4.8k decisions / ~4.1k outcomes / ~2.1k labeled rows, one operator, one machine.
- `ask` in the PreToolUse hook pauses by exiting non-zero, writes a pending one-shot approval record, and resumes only after `aegis-hook approve <approval-id>` plus retrying the exact same tool call.
- Live collection writes to `~/.aegis/decisions.jsonl`, `outcomes.jsonl`, `dataset-live.jsonl` — outside the repo.
- Exact decision/outcome joins need `tool_use_id` on both PreToolUse and PostToolUse. Fuzzy joins are opt-in and must stay truth-conservative.
- The SwarmLab evidence gate is not a predictor — it's a deterministic release gate over completed retests.

## Harness axes

1. **Rule floor / parity:** AutoHarness-style regression corpus; catches known dangerous tool calls. **44/44 applicable cases (3 excluded as framework-API tests).**
2. **Synthetic tool-use lift:** seeded synthetic episodes; proves the benchmark machinery and over-time scoring.
3. **Real-data axis:** frozen `action_failed` rows from live decisions/outcomes; compares the regex floor against the deterministic production predictor. Does not yet report held-out calibration.
4. **SwarmLab evidence gate:** completed retests RT-01..RT-37 turned into deterministic release-gate metrics. **37/37 passed, 0 partial / failed / pending / provisional** (verified 2026-09-24).

## Runtime-enforced SwarmLab policies

40 policy ids enforced in-hook as `ask` escalations, spanning RT-07..RT-16: value-echo deep handoffs (07), high-risk audit grounded support (08), desired-state receipts + retry idempotency (09), grounded citation / fresh evidence / private cross-scope disclosure (10), structured extraction at untrusted boundaries (11), fact lifecycle refresh (12), merge coordination + semantic review (13), independent checks for panel certification (14), intervention state for resumed actions (15), step integrity for partial-success resumes (16).

## Gate class coverage (RT-01..RT-37)

Earlier: typed payload contract, pinned criterion / drift audit, memory fidelity / anti-entropy, fact-checked evidence / ground-store, capability trust transfer, evidence-capped probation trust, value-echo handoff, verification-tier audit.

Later: post-authorization effect commitments, concurrent start fencing, receipt-bound terminal outcomes, delegated approval authority (19), terminal truth through compaction (31), authority-plane rollback (32), checkpoint authority equivocation (33), witness-set omission (34), witness roster epoch (35), roster continuity (36), durable strict roster (37).

**Scope caveat:** the RT corpus encodes failure modes found by this project's own SwarmLab retests, authored by one maintainer. Real replay-verified coverage — not general-purpose agent-safety certification.

## Where to learn more

- `README.md` — project overview
- `docs/aegis-status-2026-06-15.md` — status/roadmap snapshot
- `docs/aegis-action-failed-label-spec-2026-06-14.md` — label semantics
- `docs/aegis-benchmark-spec-2026-06-14.md` — benchmark design
- `packages/aegis-bench/src/swarmlab-evidence.ts` — SwarmLab retest release gate
