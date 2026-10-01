# RT-41 — Source freshness action gate

SwarmLab exp-51 demonstrated a gap between silent-source-change discovery and action governance. Exp-21/RT-12 safely consumes explicit fact lifecycle changes, but a fact can remain labelled `supported` when the authoritative source changes without emitting a correction.

Aegis now accepts optional `SourceFreshnessMetadata` on `ToolCall`:

- action risk (`high` or `low`);
- observed and expected source identity;
- cached action-basis and observed source versions;
- source-check and action timestamps with a source-specific maximum age;
- exact check result;
- host authentication state.

Consequential (`high`) fact use requires a fresh authenticated observation from the configured source, exact version binding, and non-future age within the inclusive freshness boundary. Missing, unavailable, timed-out, unknown, stale, unauthenticated, source-mismatched, version-mismatched, or malformed evidence escalates to `ask`. Low-risk informational cache reads remain allowed when no check was attempted, but an explicit failed check still escalates. Existing RT-12 lifecycle state remains independently enforced.

The host or Engram adapter owns performing and authenticating source checks, assigning monotonic versions, choosing `maxAgeMs`, and truthfully populating the metadata. Aegis evaluates evidence at the action boundary; it does not discover semantic source changes or make a dishonest adapter honest.
