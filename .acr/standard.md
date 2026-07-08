# Aegis

**Purpose:** Predictive governance harness for AI agents. Aegis combines a deterministic rule gate, live decision/outcome collection, real-data labels, AWM-backed prediction, and SwarmLab-derived benchmark/release gates.
**Repo:** https://github.com/heybeaux/aegis
**Status:** active
**Phase:** rule floor live; RT-07/RT-08 SwarmLab runtime policies landed; AWM/real-data benchmark scaling in progress
**Last verified:** 2026-07-08

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

## Dependencies

- **Depends on:** `@heybeaux/lattice-aegis`, `@heybeaux/awm-core`, pnpm workspaces
- **Feeds on:** live hook decisions/outcomes in `~/.aegis/*.jsonl`; future Sonder signed event chain
- **Used by:** agent runtime governance, release safety checks, predictor training/evaluation
- **Related:** SwarmLab, Sonder, AOP, Lattice, Engram, Parliament, AWM

## Key contacts

- **Owner:** @beauxwalton
- **Contributors:** agent team

## Quick gotchas

- The current active branch may not be `main`; check `git status` before edits. As of 2026-07-07 the working branch was `feat/awm-dataset-scale` with WIP real-data benchmark changes.
- Do not claim the predictive layer is proven unless the real-data axis has calibrated held-out results. The deterministic rule floor is proven; prediction is still being earned.
- `ask` in the PreToolUse hook now pauses by exiting non-zero, writes a pending one-shot approval record, and resumes only after `aegis-hook approve <approval-id>` followed by retrying the exact same tool call.
- Live collection writes to `~/.aegis/decisions.jsonl`, `outcomes.jsonl`, and `dataset-live.jsonl` outside the repo.
- Exact decision/outcome joins depend on `tool_use_id` being recorded on both PreToolUse and PostToolUse payloads. Fuzzy joins are opt-in and must stay truth-conservative.
- The SwarmLab evidence gate is not a predictor. It is a deterministic release gate over completed retests; RT-07 additionally has runtime enforcement for deep handoffs missing value-echo manifests, and RT-08 asks when high-risk audits try to certify cross-model-only/unsupported verification support.

## Harness axes

1. **Rule floor / parity:** AutoHarness-style regression corpus; catches known dangerous tool calls.
2. **Synthetic tool-use lift:** seeded synthetic episodes; proves the benchmark machinery and over-time scoring.
3. **Real-data axis:** frozen `action_failed` rows from live decisions/outcomes; compares regex floor, synthetic AWM stub, and AWM core when enabled.
4. **SwarmLab evidence gate:** completed retests RT-01..RT-08 turned into deterministic release-gate metrics, with RT-08 also measured through an Aegis-wrapped SwarmLab retest.

## Current SwarmLab-derived gate classes

- typed payload contract regression
- pinned criterion / drift audit regression
- memory fidelity / anti-entropy regression
- fact-checked evidence / ground-store regression
- persistent capability trust transfer regression
- evidence-capped probation trust policy regression
- value-echo handoff guard regression — RT-07 now also runtime policy (`swarmlab.rt07.deep-handoff-requires-value-echo`)
- verification-tier high-risk audit regression — RT-08 now also runtime policy (`swarmlab.rt08.high-risk-audit-requires-grounded-support`), proven in SwarmLab `gsv-mrc3huyf`

## Where to learn more

- `README.md` — project overview
- `docs/aegis-status-2026-06-15.md` — status/roadmap snapshot
- `docs/aegis-action-failed-label-spec-2026-06-14.md` — label semantics
- `docs/aegis-benchmark-spec-2026-06-14.md` — benchmark design
- `packages/aegis-bench/src/swarmlab-evidence.ts` — SwarmLab retest release gate
