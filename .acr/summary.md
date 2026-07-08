# Aegis

Aegis is the predictive governance harness for the heybeaux stack. It gates tool calls with a deterministic rule floor, records decisions/outcomes for labels, benchmarks whether governance actually improves tool use, and absorbs SwarmLab retest findings as release gates and future predictor features.

**Provides:** governance-harness, rule-gater, tool-use-benchmark, live-label-pipeline, swarmlab-evidence-gate, swarmlab-runtime-policy
**Repo:** https://github.com/heybeaux/aegis
**Relates to:** SwarmLab supplies replay-verified evidence; AWM supplies prediction machinery; Sonder/AOP supply signed event substrate; Lattice owns policy; Engram/Parliament provide fact/trust grounding.

Current phase: reactive rule floor working; real-data/predictive layer in progress; SwarmLab evidence gate added in `@heybeaux/aegis-bench`; RT-07 value-echo handoff policy and RT-08 high-risk verification-tier audit policy are runtime-enforced as `ask` escalations. RT-08 has a replay-verified Aegis-wrapped SwarmLab retest proving audit escape reduction.
