# Aegis — Status, Roadmap & Open Decisions

**As of:** 2026-06-15 06:48 PDT
**Codename:** Aegis — predictive governance harness ("AutoHarness-killer")
**Home:** `~/Dev/lattice/packages/aegis*` (monorepo)
**One-liner:** Reactive rule-gating (ported from AutoHarness) + a predictive layer (AWM scores P(failure) before an action runs) on top of Sonder/Lattice/Engram.

---

## TL;DR

Aegis is **alive and running live**, not finished. The reactive core (rules + gate pipeline) is done and at **100% parity** with AutoHarness's own benchmark. The live PreToolUse hook is installed and **actively logging decisions** (323 since 04:53 UTC today). The *predictive* layer — the actual differentiator — is **blocked on data and on one wiring bug**: outcomes aren't joining to decisions yet (1/251 labeled). So: core product real and shippable as a rule-gater; the "predictive" headline is not yet earned.

---

## Phase Map

| Phase | What | Status |
|---|---|---|
| **0 — Package scaffold** | `@heybeaux/lattice-aegis`: types, rule loader (ReDoS-guarded), 3-layer merge, safe-command allowlist, evaluate pipeline | ✅ **DONE** — 17/17 tests green, typecheck + build clean |
| **1 — Rule corpus port** | bash / file / injection / pii / **secrets** rulepacks ported from AutoHarness as data | ✅ **DONE** — secret gap closed 2026-06-15, **100% (44/44)** parity on `test_risk.py`, 3 excluded (documented) |
| **2 — Live hook** | `aegis-hook` PreToolUse, decode-then-rescan, install subcommand | ✅ **DONE & LIVE** — wired into `~/.claude/settings.json`, firing on every tool call |
| **3 — Data collection** | `aegis-collect`: log decisions + outcomes to `~/.aegis/*.jsonl`, join into training set | 🟡 **RUNNING, PARTIALLY BROKEN** — 323 decisions / 67 outcomes logged; **join failing (1/251 rows labeled)** |
| **3.5 — Sonder integration** | signed audit-chain feed as label source | 🟡 **SCOPED** — spec written, not yet the live label path |
| **4 — Predictor (AWM)** | retarget AWM `direction_5d` → `action_failed`; calibrated P(failure) → gate | 🔴 **BLOCKED ON DATA** — needs labeled rows; `aegis-label` scaffolded, real-data axis exists but starved |
| **5 — Benchmark** | `aegis-bench`: parity axis (done) + real-data axis | 🟡 parity ✅; real axis present but starved of labels |
| **6 — OSS publish** | public repo, license, docs, CI | 🔴 **NOT STARTED** (open decision below) |

---

## Are we "done"? No — here's the honest read

**What's genuinely finished and verified:**
- Reactive rule engine at full AutoHarness parity (100%, no false positives on clean curl/git).
- Live hook intercepting real tool calls right now.
- Decision logging producing real data (~323 rows in ~9h).

**What is NOT done (and is the whole point of Aegis):**
- The **predictive layer is unproven** — it can't be, because outcomes aren't joining to decisions. We have 250 unlabeled decisions and 1 labeled one. No predictor can train on that.
- No OSS repo, license, or CI yet.

So as a *rule-gater*, Aegis already beats AutoHarness (their installer is broken; ours fires). As a *predictive harness* — the category-defining claim — we are pre-MVP until the join bug is fixed and ~1 week of labeled data accumulates.

---

## Blocked-on-data (the critical path)

1. **Join bug (fix first, today).** `decisions.jsonl` (323) and `outcomes.jsonl` (67) exist but `dataset-live.jsonl` resolves `action_failed` for only 1 row. The decision↔outcome key (`toolUseId`) isn't matching — decisions carry real `toolu_*` ids, outcomes seen so far are mostly test fixtures (`toolu_TESTSUCCESS`). **The live outcome-recording seam is not firing on real tool results.** This is a wiring bug, not a data-volume problem.
2. **Then accumulate.** Once the join works, run the clock ~1 week to get a usable labeled set. Target: enough `action_failed=1` rows to train a calibrated classifier (failures are rare → watch class imbalance).

---

## Open Decisions

1. **`action_failed` label definition** — spec exists (`aegis-action-failed-label-spec-2026-06-14.md`). Current live signal = `isError` from tool result. Decide: is exit-code/error enough, or do we also count human-veto and downstream-error events? This determines what the predictor actually learns.
2. **Label source of truth** — live `outcomes.jsonl` (`isError`) vs Sonder signed audit-chain (Phase 3.5). Pick one as canonical before training.
3. **Inference seam** — warm Python AWM endpoint vs ONNX-in-TS. (Bake-first either way, per AWM's refit-runtime lesson.)
4. **OSS scope** — publish the full predictive harness, or open-source the rule engine + hook and keep the AWM predictive layer proprietary? Affects positioning vs AutoHarness.

---

## Next Steps (immediate → near-term)

**This week:**
1. **Fix the outcome-join bug** so real tool results land in `outcomes.jsonl` with matching `toolUseId`. Verify `dataset-live.jsonl` label rate climbs from <1% toward ~100% of completed calls. *(unblocks Phase 4)*
2. **Let the clock run** — keep the hook live, accumulate ≥1 week of labeled decisions. Daily sanity check on row count + class balance.
3. **Lock the `action_failed` definition** (Decision #1) and the label source (Decision #2).

**Near-term (post-data):**
4. Train first real `aegis-label` predictor; report calibrated P(failure) + real-data benchmark axis vs the parity baseline.
5. Wire prediction into the gate table (`≥0.80 DENY / 0.40–0.80 ASK / <0.40+low-risk ALLOW`) behind a flag — shadow-mode first (log what it *would* do, don't enforce).
6. Session-health regime gate (clean/recovering/thrashing), mirroring AWM's regime ensemble.

---

## Roadmap (the arc)

- **Now → +1wk:** fix join, accumulate labeled data, lock label semantics. *(Aegis = proven rule-gater + data pipeline.)*
- **+1 → +3wk:** first trained predictor, shadow-mode prediction, real-data benchmark number. *(Aegis = predictive — first defensible claim.)*
- **+3 → +6wk:** enforce predictions behind flag, regime gating, decode/AST robustness hardening beyond AutoHarness. *(Aegis = category-killer.)*
- **OSS track (parallel, once predictor shows a real number):** public repo, license, CI, docs, "predictive governance harness" positioning. Credible only *after* we have a non-synthetic predictive result — publishing the rule-gater alone just reships AutoHarness.

---

## Strategy note (unchanged, validated)

Extract + reimplement native in TS. We did not fork the Python (8-commit 2-day single-lab dump, no CI, broken installer). We mined the corpus + test suite as data/spec. That call is holding up: parity hit 100% by porting *rules*, and we own the whole stack in one language.

**Differentiator restated:** AutoHarness is reactive (regex → allow/ask/deny). Aegis adds a predictive backstop that catches *novel-but-doomed* actions regex can't. That claim is **not yet earned** — earning it is the entire near-term roadmap.
