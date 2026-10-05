# RT-44 — Source freshness policy authority roster binding

When a host configures source-freshness policy authority consensus, it may bind that consensus to an independently authenticated current authority roster. The roster contract carries an exact canonical identity, positive epoch, SHA-256 membership digest, authentication status, and complete member set. Aegis checks the presented roster against the expected identity/epoch/digest, recomputes the digest from the roster identity, epoch, and order-independent member set, and requires the roster members to equal RT-43's expected authority set.

Any partial, missing, malformed, unauthenticated, rolled-back, forked, foreign, digest-inconsistent, duplicate, empty, or member-mismatched configured roster emits `swarmlab.rt44.source-freshness-requires-authority-roster-binding` and asks. RT-41 observation validation and RT-43 authority-view consensus retain precedence. Calls with no roster evidence preserve legacy RT-41/42/43 behavior.

The host remains responsible for authenticating the roster outside the authority members' trust domain, monotonically allocating epochs, supplying current expected fields and complete membership, and linearizable reads. Aegis cannot discover a hidden roster or prove caller-supplied expected truth is current.
