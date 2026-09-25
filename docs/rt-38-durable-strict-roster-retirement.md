# RT-38 - Durable Strict-Roster Policy Retirement

**Evidence:** SwarmLab `exp-47 durable-strict-roster-retirement`

Deleting an active strict-roster marker after terminal completion is not enough: absence becomes
indistinguishable from accidental policy loss and permits ABA reselection. Aegis now supports an
additive host-owned retirement lifecycle:

- exact active-to-retired atomic transition;
- terminal outcome, receipt digest, operation/permit/approval, and revision validation;
- retained retirement tombstone readback;
- late resolve classification without retry authority; and
- late begin/reselection blocking.

Missing, malformed, misbound or unavailable lifecycle truth fails closed. The host owns linearizable
storage, terminal authenticity, cross-host visibility, tombstone retention and eventual physical GC.
Aegis deliberately does not prescribe a production TTL.
