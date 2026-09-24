# Aegis

Aegis is the governance harness for the heybeaux stack, with an outcome-learning loop. It gates tool calls with a deterministic rule floor, records decisions/outcomes for labels, benchmarks whether governance improves tool use, and absorbs SwarmLab retest findings as release gates.

**Provides:** governance-harness, rule-gater, tool-use-benchmark, live-label-pipeline, swarmlab-evidence-gate, swarmlab-runtime-policy
**Repo:** https://github.com/heybeaux/aegis
**Relates to:** SwarmLab supplies replay-verified evidence; AWM supplies prediction machinery; Sonder/AOP supply signed event substrate; Lattice owns policy; Engram/Parliament provide fact/trust grounding.

Proven today: rule floor at 44/44 AutoHarness parity; SwarmLab evidence gate 37/37 (RT-01..RT-37); 40 runtime `ask` policies across RT-07..RT-16.

Not proven: the predictor is **deterministic and hand-weighted** — no trained classifier, no held-out calibration. Do not call it calibrated. Data is the constraint (~2.1k labeled rows, one operator, one machine).

Verified 2026-09-24 vs `origin/main` (`69a1164`); local checkouts drift badly.
