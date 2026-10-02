# RT-42 — Source freshness policy binding

SwarmLab exp-52 demonstrates that an individually fresh authenticated observation is not enough when hosts may disagree about the policy interpreting freshness. A stale host can present an old policy revision, a foreign source-version namespace, or a locally widened maximum-age rule and still satisfy observation-only RT-41 checks.

`SourceFreshnessMetadata` therefore supports an optional configured policy envelope:

- presented and expected policy identity;
- presented and expected positive policy version;
- presented and expected source-version namespace;
- canonical expected maximum observation age;
- host authentication of the presented policy envelope.

When any expected policy field is configured, the complete presented envelope must be authenticated, canonical, and exactly equal to the expected identity, version, namespace, and maximum age. Missing, malformed, rolled-back, future-mismatched, foreign, unauthenticated, or max-age-divergent evidence escalates to `ask` with `swarmlab.rt42.source-freshness-requires-current-policy-binding`.

This is additive and backward compatible: RT-41 callers that do not configure an expected policy envelope retain their observation-only behavior, and low-risk no-check informational use remains allowed. RT-41 source identity, version, time, status, and authentication checks still run first and fail independently.

The host owns authenticating canonical policy truth, maintaining monotonic versions, choosing namespace and max age, and making that truth available consistently across hosts. Aegis compares supplied evidence; it does not provide consensus, discover a hidden split brain, or make a dishonest adapter truthful.
