# Aegis gap-closure acceptance criteria

Date: 2026-08-29

## Scope

Close the production gaps identified after RT-09 through RT-11, then measure Aegis with two local OMLX models in a paired baseline-versus-governed tool-use evaluation.

## Product acceptance criteria

1. **No synthetic predictor in production/real paths**
   - Synthetic data and `SYNTHETIC-STUB` remain permitted only in the explicitly synthetic benchmark command.
   - The real-data benchmark reports only deterministic rule-floor and production predictor implementations.
   - Output names and documentation cannot imply that the synthetic blender is production AWM.

2. **No sibling checkout dependency**
   - Installing, building, testing, or running Aegis from a clean checkout must not require `../../awm` or any other sibling repository.
   - The production predictor contract and implementation used by Aegis live inside the Aegis package graph or use a normal resolvable package dependency.

3. **Prediction on every live hook decision**
   - Every valid live tool call obtains a prediction before `evaluate()`.
   - The prediction can only escalate the deterministic rule floor.
   - Prediction source, probability, latency, operating mode, and fallback/degraded state are recorded.

4. **Explicit runtime failure policy with telemetry**
   - Configurable `fail-open`, `fail-closed`, and `degraded` behavior exists for predictor/runtime failures.
   - The default remains `fail-open` to avoid silently bricking existing installations.
   - Every failure/fallback emits structured JSONL telemetry; fail-closed and degraded decisions provide a clear reason.
   - Predictor calls are time-bounded.

5. **Polished one-shot approval**
   - `ask` creates a stable approval ID bound to the exact call and evaluation.
   - Approval can be consumed exactly once; changed calls cannot reuse it.
   - Human-facing output includes one copyable approval command and exact-retry guidance.
   - Approval lifecycle events are recorded in structured telemetry.

6. **Framework-neutral adapters**
   - A documented adapter contract separates host payload parsing, prediction, evaluation, and host decision rendering.
   - Claude Code and generic JSON/stdio adapters both implement that contract.
   - Contract and both adapters have tests.

## Local model evaluation acceptance criteria

- Models: `mlx-community--Qwen3.8-27B-8bit` and `Muse-Glimmer-30B-8bit` as exposed by the local OMLX server.
- Conditions: identical model/task/seed configuration with Aegis disabled versus enabled.
- Frozen manifest includes benign, destructive/high-risk, obfuscated/injection, and retry/recovery scenarios.
- Harmful calls are simulated in an isolated executor and never affect the host filesystem or network.
- Report includes unsafe-call prevention, benign completion, false-positive/approval tax, retries, latency, and token usage by model and condition.
- Raw model envelopes and per-turn gate decisions are retained for audit.
- Results are labeled honestly; no claim of benefit is made unless the measured paired deltas support it.

## Verification gate

- `pnpm install --frozen-lockfile` from a clean Aegis checkout.
- Repository build, typecheck, lint, tests, SwarmLab evidence gate, and `release:check` pass.
- Focused live-hook tests cover predictor success and all three failure modes.
- Focused adapter tests cover Claude Code and generic JSON/stdio behavior.
- Both OMLX model suites complete and produce JSON plus Markdown reports.
