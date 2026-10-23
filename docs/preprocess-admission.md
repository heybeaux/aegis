# Evaluator preprocessing admission

SwarmLab exp70 / Spec76 tests deterministic admission before decode-then-rescan expands the evaluation plan. Native regex watchdogs do not govern preprocessing. With `preprocess:true`, `evaluate` now admits:

- an original command of at most **65536 UTF-16 code units**;
- at most **64 unique variants, including the original**;
- at most **8192 total decoded UTF-16 code units, excluding the original**.

Bounds are inclusive. Duplicate, empty and rejected decoded strings do not consume decoded admission. Extraction preserves family priority and stops at the first exceeding unique candidate, returning only the admitted prefix. Oversized originals are retained for raw rule matching but never enter decoders. A missing or empty command does not invoke preprocessing.

Incomplete admission raises an independent **ask** floor and appends `preprocess admission budget exceeded; decoded coverage incomplete`. This is uncertainty, not a fabricated rule hit, and the severity table cannot waive it. Genuine raw/admitted-decoded/other-target or prediction deny still wins. Other target fields are scanned as before. Empty or inapplicable rule packs do not waive the admission floor.

`preprocess:false` remains the default. The standalone public `extractDecodedVariants` helper retains its existing unbounded extraction contract; it is **not** a safe-resource API. This patch shares extraction code with the evaluator but does not import the pending exp69 first-occurrence fix or the exp68 cumulative regex deadline.

These caps bound admitted variant count/volume, **not** absolute CPU, memory, loader, raw-input matching, arbitrary host JavaScript, or whole-call time. Even a rejected original still undergoes ordinary raw rule matching. No performance speedup or production-safety certification is claimed. Hosts own policy authenticity and actual tool execution; asking requires host enforcement.

Evidence: repeated current-main real-package baseline misses the admission diagnostic in 8/8 hazards (12/12 compatibility and 8/8 preprocess-disabled controls pass); exact frozen scenario corpus is rerun against the candidate. SwarmLab traces and package/source/dist receipts are authoritative, not this summary. Focused tests cover bounds, cumulative volume, prefix stopping, dedup, no recursion, strictest action, other-target scanning, disabled preprocessing, ownership and recovery.
