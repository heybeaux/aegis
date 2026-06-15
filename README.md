# Aegis

**A predictive governance harness for AI agents.** Aegis gates risky tool calls with a ported rule engine *and* — the differentiator — learns from real outcomes to predict the probability that an action will fail before it runs.

Think of it as the next step past reactive rule-gating: instead of only matching known-bad patterns, Aegis records every decision and its outcome, then trains a calibrated classifier to score `P(failure)` on future calls.

## Status

Aegis is **alive and running live**, not finished.

- **Reactive rule engine** — ✅ done, at **100% parity** with AutoHarness's own `test_risk.py` benchmark (44/44 applicable cases).
- **Live PreToolUse hook** — ✅ installed and actively gating real tool calls.
- **Decision/outcome collection** — ✅ live; decisions join to outcomes on `toolUseId` for labeled training data.
- **Predictive layer (AWM)** — 🟡 in progress; accumulating labeled data before training a calibrated `P(failure)` model.

See [`docs/aegis-status-2026-06-15.md`](docs/aegis-status-2026-06-15.md) for the full phase map and roadmap.

## Packages

| Package | What it does |
|---|---|
| `core` | Shared types and primitives. |
| `aegis` | The governance engine: ReDoS-guarded rule loader, 3-layer rule-pack merge, safe-command allowlist, evaluate pipeline. Ships ported risk corpus (bash / file / injection / pii / secrets). |
| `aegis-hook` | The Claude Code PreToolUse hook. Maps hook stdin into an Aegis `ToolCall`, evaluates the bundled rule packs, emits the correct permission-decision schema. Includes a `settings.json` installer with the correct nested matcher schema. |
| `aegis-collect` | Logs decisions and outcomes to `~/.aegis/*.jsonl` and joins them into a labeled training set on `toolUseId`. |
| `aegis-label` | Builds the labeled dataset (`action_failed`) from collected decision/outcome pairs. |
| `aegis-bench` | Benchmark harness: AutoHarness parity axis (done) plus a real-data axis driven by live labels. |

## Quick start

```bash
pnpm install
pnpm build
pnpm test
```

Install the live hook into Claude Code:

```bash
node packages/aegis-hook/dist/cli.js install
```

This wires the PreToolUse (decision) and PostToolUse (outcome) hooks into `~/.claude/settings.json`.

## Why Aegis vs. reactive-only harnesses

A pure rule-gater can only block what it already knows is dangerous. Aegis keeps the rule engine as a hard floor, but adds a learned layer: by recording the real outcome of every gated call, it builds a labeled dataset and trains a calibrated predictor. Over time the harness gets better at catching failures the rules never anticipated.

## License

MIT — see [LICENSE](LICENSE).
