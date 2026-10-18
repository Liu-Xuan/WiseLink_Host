# WiseLink Host source status

Current canonical source: **45c0a56e153094748743b6cfc7e233746a8df42b** (parent 6082709006d886f06852dbd5fa15adff4b355291).

The Native transport now supports an explicitly configured existing Chrome browser WebSocket alongside the previous loopback HTTP discovery path. It selects an existing exact Host page, attaches with a pinned session, invokes the unchanged bridge, then detaches and closes. It does not discover endpoints, launch or navigate Chrome, read credentials, or resubmit an unknown POST. Receiver identity, Source authority, preflight and immutable original-byte checks remain unchanged.

Local validation includes 36 transport checks and 10 independent counterexamples. The exact canonical commit passes the complete build with all 4039 tracked inputs restored and four physical deployment-package checks. These checks use synthetic peers; they do not establish a real Chrome connection or Source reception. The previous reviewed Source0.2.83/@13 pure consumers remain in this snapshot; later unintegrated handoffs are not included.

[Receiver wiring, deployment identity, Source consumers and Native transport](TDMS_RECEIVER_RUNTIME_20261018.md) describes actual consumers and prerequisites. Database/profile activation, formal Source registration, an authorized usable endpoint and real business reception remain separate steps. Private operational records and private development history are excluded from this public source snapshot.
