# Aegis Release Gates — SwarmLab Evidence Loop

**Date:** 2026-07-07
**Status:** active release-check slice
**Command:** `pnpm run release:check`

## What changed

Aegis now has a deterministic release gate built from completed SwarmLab retests. This is the first executable loop for the stack lifecycle:

```text
SwarmLab experiment/retest evidence
  → Aegis benchmark/release gate
  → JSON/Markdown report
  → release decision input
```

This gate is intentionally not a learned predictor. It is a truth-preserving release check over replay-verified SwarmLab evidence. The predictive layer still has to earn its claim through real labels and calibration.

## Gate command

```bash
pnpm run bench:swarmlab-evidence
```

The command builds `@heybeaux/aegis-bench`, runs the SwarmLab evidence gate, and writes JSON/Markdown reports to `/tmp/aegis-swarmlab-evidence`.

The broader local release check is:

```bash
pnpm run release:check
```

It runs:

1. workspace typecheck
2. workspace tests
3. SwarmLab evidence release gate

## Current measured result

Latest local smoke:

```text
SwarmLab evidence gate: PASSED (7/7 passed, partial=0, failed=0)
```

Covered retests:

- `RT-01` — typed payload contracts
- `RT-02` — pinned criterion / drift audit
- `RT-03` — Engram versioned facts + anti-entropy
- `RT-04` — fact-checked evidence audit
- `RT-05` — persistent capability trust transfer
- `RT-06` — evidence-capped probation
- `RT-07` — value-echo handoff guards

## Release meaning

A change that regresses one of these retest-derived metrics should not ship as a stack improvement until either:

1. the regression is fixed, or
2. the SwarmLab evidence case is updated with a newer replay-verified retest that honestly supersedes the old result.

No pass-rate, consensus score, coverage number, or predictor score overrides these gates by itself. The evidence has to remain tied to measured outcomes.
