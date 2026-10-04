# RT-43 — Source freshness policy authority consensus

When a host configures plural freshness-policy truth, `SourceFreshnessMetadata` accepts an exact `expectedPolicyAuthorityIds` roster plus independently authenticated `policyAuthorities`. A consequential action fails closed unless every expected authority is present exactly once and every supplied view agrees with the scalar canonical policy identity, positive safe revision, source-version namespace, and maximum age.

The comparison is order-independent. Empty, missing, malformed, unauthenticated, duplicate, omitted, unexpected, or disagreeing authority evidence emits `swarmlab.rt43.source-freshness-requires-authority-consensus` and asks. Legacy RT-41 observation checks and RT-42 scalar policy bindings remain compatible when no authority roster is configured.

Hosts still own authority independence/authentication, complete enumeration, retention, and linearizable reads. This adapter validates supplied evidence; it is not a consensus service and cannot detect hidden or colluding authorities.
