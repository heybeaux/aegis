# aegis-bench — REAL-data result

> DATA: REAL (Sonder ed25519-signed audit chain → aegis-label `action_failed`)
> dataset: `/Users/beauxwalton/Dev/aegis/packages/aegis-bench/results/real-2026-06-16-scaled.dataset.jsonl`

Rows: 186 total · 186 scored · 0 excluded (unknowable). Real failures in scored set: **55**.

## Engine comparison (binary classification on real `action_failed`)

| engine | TP | FP | FN | TN | precision | recall | F1 | accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| regex | 45 | 77 | 10 | 54 | 36.9% | 81.8% | 50.8% | 53.2% |
| regex+awm | 50 | 100 | 5 | 31 | 33.3% | 90.9% | 48.8% | 43.5% |
| regex+awm-core | 48 | 86 | 7 | 45 | 35.8% | 87.3% | 50.8% | 50.0% |

## Headline

Predictive layer caught **3** real failure(s) the reactive rule floor missed — a recall lift of **30.0%** over the rule floor's misses.
