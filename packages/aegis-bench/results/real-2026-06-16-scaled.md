# aegis-bench — REAL-data result

> DATA: REAL (Sonder ed25519-signed audit chain → aegis-label `action_failed`)
> predictor: PRODUCTION-PREDICTOR (in-package deterministic engine)
> dataset: `packages/aegis-bench/results/real-2026-06-16-scaled.dataset.jsonl`

Rows: 186 total · 186 scored · 0 excluded (unknowable). Real failures in scored set: **55**.

## Engine comparison (binary classification on real `action_failed`)

| engine | TP | FP | FN | TN | precision | recall | F1 | accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| regex | 45 | 77 | 10 | 54 | 36.9% | 81.8% | 50.8% | 53.2% |
| regex+predictor | 45 | 78 | 10 | 53 | 36.6% | 81.8% | 50.6% | 52.7% |

## Headline

Predictive layer caught **0** real failure(s) the reactive rule floor missed — a recall lift of **0.0%** over the rule floor's misses.
