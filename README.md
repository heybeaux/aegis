# Aegis

**A governance harness for AI agents with an outcome-learning loop.** Aegis gates risky tool calls with a ported rule engine as a hard deterministic floor, records what actually happened after every decision, and scores `P(failure)` on future calls from that accumulated evidence.

The bet: a pure rule-gater can only block what its authors already anticipated. Aegis keeps that floor, but closes the loop — decision in, real outcome out, labeled dataset growing — so the harness can improve on failure modes nobody wrote a regex for.

---

## Why Aegis

A pure rule-gater is a static list of regexes; the moment an agent finds a failure mode the authors never anticipated, the gate waves it through.

Aegis keeps that rule engine as a **hard floor** — every known-bad pattern is still blocked deterministically — and adds an outcome-driven layer on top:

1. Every gated tool call is recorded as a **decision** (allow / deny / ask, plus the matched rules).
2. When the call completes, its real **outcome** (succeeded / failed, error class, side effects) is recorded.
3. Decisions join to outcomes on `toolUseId`, producing a continuously-growing **labeled dataset**.
4. That dataset drives a predictor that scores `P(failure)` on *future* calls — aimed at risky actions the rules never anticipated.

## Status

Aegis is **alive and running live**, not finished. The reactive floor is proven; the predictive layer is earned in stages, and this table is deliberately conservative about which stage it is in.

| Capability | State |
|---|---|
| Reactive rule engine | ✅ **100% parity** with AutoHarness's own `test_risk.py` benchmark (44/44 applicable cases, 3 excluded as framework-API tests) |
| Live PreToolUse hook | ✅ installed and actively gating real tool calls |
| Decision/outcome collection | ✅ live; decisions join to outcomes on `toolUseId` for labeled training data |
| SwarmLab evidence release gate | ✅ **37/37 passed** (`RT-01`..`RT-37`), 0 partial / failed / pending / provisional |
| Runtime SwarmLab policies | ✅ 40 policy ids enforced in-hook across `RT-07`..`RT-16` |
| Predictive layer — deterministic engine | ✅ shipped; hand-weighted blend of severity priors, historical tool/path failure rates, and sequentially-learned per-bucket posteriors |
| Predictive layer — trained calibrated model | 🟡 **not built yet**; no trained classifier, no held-out calibration results |

### What "predictive" means here today — read this before citing Aegis

The shipped predictor (`packages/aegis-bench/src/engines/production-predictor.ts`) is an explicitly **deterministic** engine, not a trained model:

- Its feature weights are **hand-tuned constants**, not fitted parameters.
- Cold-start severity base rates are **hardcoded**.
- It does update from observed outcomes, via sequential per-bucket posteriors over tool/path history within a benchmark run.
- There is **no trained classifier and no held-out calibration curve.** Claims of a "calibrated `P(failure)` model" are not yet supported by evidence in this repo.

The binding constraint is data, not modelling: live collection currently stands at roughly 4.8k decisions and 4.1k outcomes, joining to about 2.1k labeled rows from a single operator on a single machine. That is thin for training a calibrated classifier and will generalize poorly to other tool distributions.

**Do not describe the predictive layer as proven until the real-data axis has calibrated held-out results.** The deterministic rule floor and the SwarmLab evidence gate are the parts that are proven today.

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
| `aegis-bench` | Benchmark harness: AutoHarness parity axis (44/44), a real-data axis driven by live labels, and the SwarmLab evidence release gate (`RT-01`..`RT-37`). |

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

Aegis measures itself on three axes:

- **Parity axis** — replays AutoHarness's own `test_risk.py` cases to prove the reactive rule engine is at least as good as the reactive-only state of the art. Currently **44/44 applicable cases (100%)**.
- **Real-data axis** — driven by the live `action_failed` labels collected from real tool calls. Compares the regex floor against the deterministic production predictor on frozen rows. This axis is where a future trained predictor must earn its keep; today it measures a hand-weighted engine, and it does not yet report held-out calibration.
- **SwarmLab evidence gate** — turns 37 replay-verified SwarmLab retests (`RT-01`..`RT-37`) into deterministic release checks. The current gate is **37/37 passed** (0 partial / failed / pending / provisional), covering post-authorization effect commitments, concurrent start fencing, receipt-bound terminal outcomes, terminal truth through compaction, authority-plane rollback, and checkpoint witness-set / roster-epoch / roster-continuity integrity. This is a deterministic release gate, not a learned predictor.
- **Scope caveat** — the RT corpus encodes failure modes discovered by this project's own SwarmLab retests, authored by a single maintainer. It is real, replay-verified coverage, not a general-purpose agent-safety certification.

```bash
pnpm --filter @heybeaux/aegis-bench test
pnpm run bench:swarmlab-evidence
pnpm run release:check
```

See [`docs/aegis-release-gates-2026-07-07.md`](docs/aegis-release-gates-2026-07-07.md) for the first end-to-end SwarmLab → Aegis release loop.

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
