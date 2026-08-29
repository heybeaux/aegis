# `@heybeaux/aegis-bench`

Benchmark package for Aegis tool-governance evaluation.

## Commands

- `pnpm --filter @heybeaux/aegis-bench run build`
- `pnpm --filter @heybeaux/aegis-bench run test`
- `pnpm --filter @heybeaux/aegis-bench run typecheck`
- `pnpm --filter @heybeaux/aegis-bench run lint`
- `pnpm --filter @heybeaux/aegis-bench exec aegis-bench run --seed 42 --episodes 50`
- `pnpm --filter @heybeaux/aegis-bench exec aegis-bench real --dataset ./results/real-2026-06-15.dataset.jsonl`

## Predictor boundary

- `aegis-bench run` is explicitly synthetic. Its reports must continue to identify `predictor: SYNTHETIC-STUB`.
- `aegis-bench real` is the real-data path. It compares the deterministic rule floor (`regex`) against the in-package production predictor (`regex+predictor`).
- The real benchmark does not depend on any sibling checkout such as `../../awm`.
