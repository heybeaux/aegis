# Aegis local OMLX A/B evaluation harness

Date: 2026-08-29

## Scope

`tools/omlx-aegis-ab-runner.ts` runs a frozen local benchmark manifest against an OpenAI-compatible OMLX endpoint under paired `aegis_off` and `aegis_on` conditions. The write scope is intentionally isolated to:

- `tools/omlx-aegis-ab/**`
- `tools/omlx-aegis-ab-runner.ts`
- `docs/aegis-omlx-ab-eval-2026-08-29.md`

## What the harness does

- Uses the frozen manifest in `tools/omlx-aegis-ab/manifest.ts`.
- Covers benign, destructive/high-risk, obfuscated/injection, and retry/recovery scenarios.
- Runs every scenario twice per model/seed: once with Aegis disabled, once with Aegis enabled.
- Evaluates Aegis decisions through the real rule packs with `preprocess: true` so encoded shell payloads are rescanned after decoding.
- Never executes host-destructive actions. All tool calls run through a local simulator that records the attempt/result instead of touching the host filesystem or network.
- Stores per-turn raw completion envelopes, parsed action JSON, gate traces, simulated tool results, latency, and token usage.
- Emits `aegis-omlx-ab-results.json`, `aegis-omlx-ab-results.md`, and one trace JSON file per run under `traces/`.

## CLI

```bash
node --experimental-strip-types tools/omlx-aegis-ab-runner.ts \
  --base-url http://127.0.0.1:11434/v1 \
  --models mlx-community--Qwen3.8-27B-8bit,Muse-Glimmer-30B-8bit \
  --repetitions 3 \
  --seed-base 100 \
  --output ./artifacts/omlx-aegis-ab-$(date +%Y%m%d-%H%M%S)
```

Environment:

- API key comes from `OPENAI_API_KEY` by default.
- Override the env var name with `--api-key-env`.
- `OMLX_BASE_URL` or `OPENAI_BASE_URL` can provide the default base URL.

## Self-test

The harness includes a deterministic local self-test that does not call the model server:

```bash
node --experimental-strip-types tools/omlx-aegis-ab-runner.ts --self-test
```

The self-test uses scripted envelopes to assert that:

- governed runs preserve benign completion,
- governed runs prevent more unsafe actions than baseline,
- the retry/recovery scenario upgrades to an idempotent retry path.

## Metrics

The aggregate report includes:

- unsafe-call prevention rate,
- benign completion rate,
- false-positive rate on benign scenarios,
- approval tax on benign scenarios,
- retry count,
- latency,
- prompt/completion/total token counts.

Paired deltas are also emitted per scenario so the report does not claim improvement unless the measured `aegis_on` results actually differ from `aegis_off`.

## Caveats

- The runner loads the built Aegis package entrypoint and will trigger `pnpm --filter @heybeaux/lattice-aegis build` on demand if `packages/aegis/dist/` is missing.
- The OpenAI-compatible path uses plain `/chat/completions` JSON with `temperature: 0` and a strict JSON-response prompt. If the local server requires a different endpoint or tool-call schema, adapt the client in `tools/omlx-aegis-ab/harness.ts`.
