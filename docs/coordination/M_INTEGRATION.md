# WiseLink Host source status

Current canonical source: **ba4f257b72f42c27158b891983362ed004dcce2d** (parent 02304b53e610e2ac1b07a7052387ec92137a2985).

This source snapshot adds a bounded deployment identity check to the existing TDMS receiver. It reuses the current OAuth configuration, compares the verified actor tenant/app and actual SQL actor/workspace/role, then calls the same invoker identity-mapping predicate used by the reviewed SQL candidate. Missing configuration does not prevent application startup. Source authority, opaque sessions, member permissions and transactions remain independent.

Local validation includes 28 unit checks, the 30-case legacy PostgreSQL consumer regression, targeted full identity-RLS/SDK checks, and independent counterexamples. The legacy fixture remains a reduced draft test; it is not production RLS evidence. The exact commit passed the full build with all 4034 tracked inputs restored, four physical deployment-package checks, and complete AppModule startup/listen/close with nine minimal HTTP checks under explicit external SDK/database fixtures. None of these results is real Source reception or a Hosted activation.

[Receiver wiring, deployment identity and Native factory](TDMS_RECEIVER_RUNTIME_20261018.md) describes the configuration and database prerequisites. Source consumers remain at the reviewed 0.2.76 baseline; later code-only handoffs have not been adopted. Production schema/configuration/Source permission changes and real Native binding or reception have separate acceptance records. Private operational records and private development history are excluded.
