# Safe-command newline boundary


## RT-81 / exp91 — Embedded LF is a shell separator

Spec97 was pre-registered at `7e53485`, harness frozen at `3e648cc`.
The real public `isSafeCommand` helper rejected semicolons but accepted all eight
embedded-newline scripts with allowlisted leading commands. Independent Bash
execution of each harmless fixture observed the second command's print marker.
Both implicit and explicit allowlists had the same omission. This is a public
helper classification bug: **no current evaluator/hook bypass is demonstrated**,
since neither calls the helper. It is distinct from exp61 allowlist ownership and
exp90 compact-proof observation ownership (prior work remains separate).

Baseline `f0f1f685538165a0affbce69b4d4725631fe7153`: `scn-mwq3dh6p-83466` and `scn-mwq3dhbl-83548`
have identical raw observations. False-safe rate8/8; hazard rejection0/8;
controls10/12 (quoted/escaped LF also accepted), shell truth/semicolon controls/
ownership/recovery all perfect; infrastructure0. Candidate `902dd23fab904322241426ecb59eeb49fe9ae835`
run `scn-mwq3exj6-84199`: false-safe0/8, hazard rejection8/8, controls12/12,
all20 scenarios green. Exact same harness, seed and thresholds; no holdout tuning.

Aegis now rejects embedded LF using its existing combinator check after trimming
outer whitespace. Quoted/escaped internal LF is conservatively refused; the helper
is not a shell parser. This does not certify all arguments to allowed commands,
all shell syntax, actual effect execution, deployed integration or predictor quality.
Ten focused regression tests (8 fail on baseline) and79 combined focused tests pass.
Full release check and58/58 historical evidence gates pass locally. Historical
gates and SwarmLab's existing evidence corpus are regression checks, not new evidence.
Raw red/red/green traces and full source/dist hashes are committed; executable
receipt verification rescored them, with25 tamper rejections. CI and merge outcomes
are recorded separately in the nightly ledger. No source .acr change.

Next new hypothesis: can unbounded path/argv/content-fragment lists exhaust regex
planning before native-match deadlines? Deduplicate and bound before selection.
