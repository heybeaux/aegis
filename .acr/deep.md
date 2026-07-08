# Aegis — Deep

Loaded when changing governance behaviour, labels, benchmark axes, or the live hook/collector path.

## Architecture

```text
packages/aegis/         deterministic rule engine and evaluator
packages/aegis-hook/    PreToolUse hook adapter and installer
packages/aegis-collect/ decisions/outcomes JSONL collector and joiner
packages/aegis-label/   signed-event-chain label pipeline
packages/aegis-bench/   benchmark axes and reports
```

Aegis has two layers:

1. **Reactive floor:** deterministic rules. This is the hard safety floor and AutoHarness parity layer.
2. **Predictive layer:** AWM-style `P(action_failed)` from live labels, session regime, history, rollback/churn, and eventually SwarmLab-derived features.

The predictive claim must be earned with real labels. Synthetic axes are useful for deterministic benchmark mechanics, not product claims.

## Data flow

```text
PreToolUse hook
  → toToolCall(raw)
  → evaluate(rulepacks, preprocess=true)
  → recordDecision(call, evaluation, tool_use_id?)
  → decide allow/ask/deny

PostToolUse hook
  → aegis-outcome
  → outcomes.jsonl(tool_use_id?, isError)

build-dataset
  → exact join on tool_use_id
  → optional fuzzy join by tool + timestamp when TRUST_FUZZY_JOIN=1
  → dataset-live.jsonl(action_failed)
```

Truth rule: ambiguous or missing outcomes produce `action_failed=null`, never a guessed label.

## SwarmLab evidence integration

`packages/aegis-bench/src/swarmlab-evidence.ts` is the first concrete bridge from completed SwarmLab experiments into Aegis. It encodes RT-01..RT-07 as deterministic release gates:

- RT-01 typed payload contracts
- RT-02 pinned criterion + drift audit
- RT-03 Engram memory fidelity / anti-entropy
- RT-04 fact-checked evidence audit
- RT-05 persistent capability trust transfer
- RT-06 evidence-capped probation
- RT-07 value-echo handoff guards

These are not runtime enforcement yet. They are benchmark/release criteria and a clean source of future predictor/rule features.

## Development rules

- Check the current branch and WIP before editing. This repo often has active benchmark/data work.
- Keep deterministic release gates separate from learned predictor claims.
- Exact joins are preferred; fuzzy joins are truth-conservative and opt-in only.
- Do not train on `action_failed=null` rows.
- Add tests for every hook/collector seam because silent label starvation blocks the whole predictive layer.
- If a SwarmLab finding motivates a production policy, cite the RT id and run ids in the Aegis artifact.

## Useful commands

```bash
pnpm --filter @heybeaux/aegis-bench test swarmlab-evidence real
pnpm --filter @heybeaux/aegis-bench typecheck
pnpm --filter @heybeaux/aegis-hook test stdin
pnpm --filter @heybeaux/aegis-hook typecheck
pnpm --filter @heybeaux/aegis-collect test build-dataset record
pnpm --filter @heybeaux/aegis-collect typecheck
```

## Known near-term work

- Run a real `dataset-live.jsonl` rebuild and verify exact join coverage rises when both hooks carry `tool_use_id`.
- Promote SwarmLab evidence gate into CLI/report output if desired.
- Decide which SwarmLab gate classes become deterministic runtime rules versus benchmark-only release checks.
- Add Engram verification-tier features once the fact store exists.
- Keep AWM core comparisons honest: prediction before recording each row outcome.
