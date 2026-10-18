# WiseLink Host source status

Current canonical source: **71a151d83d4c83a7108baee369a16ca19954e68b** (parent 45c0a56e153094748743b6cfc7e233746a8df42b).

TDMS persisted-object comparisons now ignore object property order while preserving exact key sets, types, recursive values and array order. Ten reviewed comparison helpers are used by existing Host validators. Synthetic regression coverage exercises admission, committed-row readback, replay and SourceRef consistency.

The canonical candidate passed its existing regression checks and complete build. This public source projection reuses those results. Receiver identity checks, immutable source and artifact bindings, and the existing Native transport remain part of the current source snapshot.

[Receiver wiring, deployment identity, Source consumers and Native transport](TDMS_RECEIVER_RUNTIME_20261018.md) describes the runtime interfaces and prerequisites. Deployment and real reception evidence are maintained separately. Private operational records and private development history are excluded from this public source snapshot.
