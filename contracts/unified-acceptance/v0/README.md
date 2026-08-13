# Unified acceptance façade candidate

This contract defines one platform-level candidate façade for exact package dispatch. It accepts
only two registered contract identities:

- `techpub.parsed-package.v1 / frozen.2` → bounded unified reader candidate;
- `aeo_structured_parse_v1 / candidate.1` → injected AEO specialist reader port.

There is no generic fallback. The outer receipt binds WorkItem, request, DocumentVersion,
permission snapshot, classification fingerprint, package/artifact identity and the selected handler.
Changing any bound identity changes the receipt hash and ID.

The receipt remains `CANDIDATE_ACCEPTED` with `canonicalReaderActivated=false`. R1 must select the
full validator/reader identities, activate actual adapters and define the immutable canonical
receipt persistence/Registrar path before this shape can become a canonical `ACCEPTED` receipt.

The selected failure path is not a second failure contract and the canonical host owns no failure
builder or taxonomy. The host consumes only the injected Unified port
`wiselink.3_1.port.u0_frozen2_failure_adapter.v0.candidate.1` from exact source commit
`ebf84f87213227b0a4bdf2f9d4909ca1a58b3518`. That port builds U0
`techpub.parse-failure-report.v1 / frozen.2` bytes and returns the Unified adapter receipt after the
configured frozen U0 Validator accepts the actual persisted bytes.

The host verifies the exact port, source commit, adapter revision/build fingerprint and source
manifest/implementation/input-schema hashes. It then coordinates only these host-owned effects:

1. obtain an independent validation-write authorization receipt before ArtifactStore I/O;
2. persist and read back the exact immutable failure bytes;
3. call the Unified port's actual-byte validation operation;
4. place artifact ref/hash, the Unified adapter receipt and the validation-write receipt in the
   WorkItem CAS projection.

The default Unified port and validation-write authorization ports are unconfigured and fail
closed. Missing port, missing write receipt, or source revision/fingerprint drift performs no
ArtifactStore mutation. If persistence/readback fails after authorization, the existing
`RECORDING_FAILED` terminal semantics remain explicit. The removed host-side selected-failure
schema and builder remain historical conformance evidence only and are not executable authority.

The public status/query request wires never accept a deep-link path. A verified
`CanonicalMiaodaApp` binding derives the exact HTTPS WorkItem path on the server. The default
binding is unconfigured and fails closed.
