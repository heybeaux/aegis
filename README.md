# Aegis

**A predictive governance harness for AI agents.** Aegis gates risky tool calls with a ported rule engine *and* — the differentiator — learns from real outcomes to predict the probability that an action will fail *before* it runs.

Think of it as the next step past reactive rule-gating: instead of only matching known-bad patterns, Aegis records every decision and its outcome, then trains a calibrated classifier to score `P(failure)` on future calls.

---

## Why Aegis

A pure rule-gater can only block what it already knows is dangerous. It is a static list of regexes; the moment an agent finds a failure mode the authors never anticipated, the gate waves it through.

Aegis keeps that rule engine as a **hard floor** — every known-bad pattern is still blocked deterministically — but adds a **learned layer** on top:

1. Every gated tool call is recorded as a **decision** (allow / deny / ask, plus the matched rules).
2. When the call completes, its real **outcome** (succeeded / failed, error class, side effects) is recorded.
3. Decisions join to outcomes on `toolUseId`, producing a continuously-growing **labeled dataset**.
4. That dataset trains a calibrated predictor that scores `P(failure)` on *future* calls — catching risky actions the rules never anticipated.

The result is a harness that gets measurably better at catching failures the longer it runs, instead of staying frozen at whatever its rule authors thought of on day one.

## Status

Aegis is **alive and running live**, not finished.

| Capability | State |
|---|---|
| Reactive rule engine | ✅ **100% parity** with AutoHarness's own `test_risk.py` benchmark (44/44 applicable cases) |
| Live PreToolUse hook | ✅ installed and actively gating real tool calls |
| Decision/outcome collection | ✅ live; decisions join to outcomes on `toolUseId` for labeled training data |
| Predictive layer (AWM) | 🟡 in progress; accumulating labeled data before training a calibrated `P(failure)` model |

See [`docs/aegis-status-2026-06-15.md`](docs/aegis-status-2026-06-15.md) for the full phase map and roadmap.

## How it works

```
                    ┌─────────────────────────────────────────────┐
   tool call  ─────▶│  aegis-hook (PreToolUse)                     │
                    │  maps hook stdin → ToolCall, evaluates rules │
                    └───────────────┬─────────────────────────────┘
                                    │ permission decision (allow/deny/ask)
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │  aegis  (rule engine)                        │
                    │  ReDoS-guarded loader · 3-layer rule-pack    │
                    │  merge · safe-command allowlist · evaluate   │
                    └───────────────┬─────────────────────────────┘
                                    │
       decision ────────────────────┤
                                    ▼
                    ┌─────────────────────────────────────────────┐
   tool result ────▶│  aegis-collect (PostToolUse)                 │
                    │  logs decision + outcome → ~/.aegis/*.jsonl  │
                    │  joins on toolUseId                          │
                    └───────────────┬─────────────────────────────┘
                                    │ labeled pairs
                                    ▼
                    ┌──────────────────────┐     ┌──────────────────────┐
                    │  aegis-label         │────▶│  aegis-bench         │
                    │  builds action_failed│     │  parity + real-data  │
                    │  labeled dataset     │     │  benchmark axes      │
                    └──────────────────────┘     └──────────────────────┘
```

Runtime telemetry lives in `~/.aegis/` (`decisions.jsonl`, `outcomes.jsonl`) — outside the repo, on the machine running the agent.

## Packages

| Package | What it does |
|---|---|
| `core` | Shared types and primitives (events, contracts, redaction). |
| `aegis` | The governance engine: ReDoS-guarded rule loader, 3-layer rule-pack merge, safe-command allowlist, evaluate pipeline. Ships a ported risk corpus (bash / file / injection / pii / secrets). |
| `aegis-hook` | The Claude Code PreToolUse hook. Maps hook stdin into an Aegis `ToolCall`, evaluates the bundled rule packs, emits the correct permission-decision schema. Includes a `settings.json` installer with the correct nested matcher schema. |
| `aegis-collect` | Logs decisions and outcomes to `~/.aegis/*.jsonl` and joins them into a labeled training set on `toolUseId`. |
| `aegis-label` | Builds the labeled dataset (`action_failed`) from collected decision/outcome pairs. |
| `aegis-bench` | Benchmark harness: AutoHarness parity axis (done) plus a real-data axis driven by live labels. |

## Prerequisites

- **Node.js >= 20**
- **pnpm** (workspace monorepo)

## Quick start

```bash
pnpm install
pnpm build
pnpm test
```

Install the live hooks into Claude Code:

```bash
node packages/aegis-hook/dist/cli.js install
```

This wires the PreToolUse (decision) and PostToolUse (outcome) hooks into `~/.claude/settings.json`, preserving every existing hook and matcher. After installation, real tool calls are gated by the rule engine and logged for training data.

## Repository layout

```
aegis/
├── packages/
│   ├── core/          shared types, events, redaction
│   ├── aegis/         rule engine + risk corpus
│   ├── aegis-hook/    PreToolUse hook + installer
│   ├── aegis-collect/ decision/outcome logging + join
│   ├── aegis-label/   labeled-dataset builder
│   └── aegis-bench/   benchmark harness
├── docs/              specs + status/roadmap
├── LICENSE
└── README.md
```

## Benchmarking

Aegis measures itself on two axes:

- **Parity axis** — replays AutoHarness's own `test_risk.py` cases to prove the reactive rule engine is at least as good as the reactive-only state of the art. Currently **44/44 applicable cases (100%)**.
- **Real-data axis** — driven by the live `action_failed` labels collected from real tool calls. This is where the predictive layer earns its keep over time.

```bash
pnpm --filter aegis-bench test
```

## Development

```bash
pnpm build       # build all packages
pnpm test        # run all test suites
pnpm lint        # lint all packages
pnpm typecheck   # typecheck all packages
```

Test fixtures intentionally contain **fake** token-shaped strings (clearly labeled `EXAMPLE`/`FAKE`) to exercise the secret-redaction rules. None are real credentials.

## License

MIT — see [LICENSE](LICENSE).
