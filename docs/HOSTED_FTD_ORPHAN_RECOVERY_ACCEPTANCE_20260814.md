# Hosted FTD orphan recovery acceptance

Date: 2026-08-14

Status: `LOCAL_THREE_ROW_RECOVERY_VALIDATED / HOSTED_NOT_RETRIED`

## Hosted evidence and closure

The controlled DEV validation action on release `7673817815686581436`, commit
`e9124fe1fdb7e5f9a731c62fa38d749dcddcbf11`, was invoked once by the main controller. It returned:

`INGESTION_REPLAY_INCOMPLETE: Idempotent replay found an incomplete prior ingestion; no additional I/O was performed.`

Validation was then disabled and its run ID removed. Closure release
`7673819887076445394` finished on the same exact commit with no release error logs. No further
business request or validation release was executed.

The independent database readback initially queried DEV and saw zero records. The deployed runtime
uses the `online` database. The corrected runtime readback is:

- `dm_source_artifact`: `1`
- `dm_acquisition`: `1`
- `dm_ingress_preflight`: `1`
- `dm_document_family`, `dm_document`, `dm_document_version`,
  `dm_currentness_decision`, `work_item`, `action_attempt`: `0`

The three records belong to the first failed request at approximately 17:01 +08:00. The second
request at approximately 17:38 +08:00 created no additional database rows or FileService object.
Its trace is `39b9e4011e21e4e089778f8b9a78ac5e`; client/gateway logs are
`LOG7673819427411332385` and `LOG7673819400705919974`.

FileService remains at five objects. The relevant content-addressed source is
`/document-management/source/sha256/b1/b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c.pdf`,
`122102` bytes, SHA-256
`b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c`.

## Corrective behavior

The hosted DM core now performs the existing FileService metadata and actual-byte checks, then
fresh-reads related Catalog state before reusing an existing content-addressed object:

- no related Catalog rows: `ORPHAN_RECOVERY_ALLOWED`;
- complete committed Catalog lineage: `CATALOGED_SOURCE_REUSE_ALLOWED`;
- partial Catalog lineage: `IMMUTABLE_SOURCE_REUSE_DB_PARTIAL`;
- conflicting identity: `IMMUTABLE_SOURCE_REUSE_DB_CONFLICT`.

The correction neither deletes nor replaces FileService objects or database rows. In addition to
zero-row orphan recovery, it accepts exactly one residual SourceArtifact, Acquisition and READY
ingress preflight when their primary keys, relations, bytes, metadata, actor, route and deterministic
preflight contents match the retry and all related downstream tables are empty. It then reuses those
same rows and enters the existing `commitNewVersion` transaction. Any different partial shape still
fails closed.

The online three-row state was not retried. A local fixture with the same residual shape was run
through the real FTD path and produced the frozen.2 package, full U0 validation and source-bound
Reader result. Its second action reused the same WorkItem; the source object was uploaded once and
never deleted.

## Regression environment finding

The first local command `npm run test:ordinary:first-ftd-loop` failed explicitly with
`FULL_U0_VALIDATOR_UNAVAILABLE`: system `python3` did not contain the U0-pinned `jsonschema`
dependency, so the frozen FailureReport validator was also unavailable and the test WorkItem
correctly ended `RECORDING_FAILED`. This was a local test-runtime dependency issue, not an orphan
recovery failure.

The same production build and ordinary loop were then run with a temporary isolated Python venv
created from the existing U0 `requirements.txt`, without changing or weakening the Validator. It
passed the real FTD package, full U0 validation, Reader query, repeat WorkItem reuse and frozen
FailureReport validation.

Other failed diagnostics were not skipped:

- a direct source-module ESM inspection failed because a migrated CommonJS adapter uses
  `__dirname`; the same inspection used the production `dist` module instead;
- the first residual-loop assertion counted package and FailureReport uploads as source uploads
  (`3 !== 1`); it was corrected to count only the exact source canonical path;
- the Unified composition check hid a Nest dependency error with logger disabled. With
  `abortOnError:false`, it showed that an isolated module context lacked platform `FileService`;
  the check now imports an explicit no-I/O provider using the official provider's DI token. A
  direct ESM import of the platform token also exposed an existing `ObservableService` export
  mismatch, so the check does not load a second platform entry point.

Key local results:

- Jest: `19 suites / 87 tests PASS`;
- typecheck, lint, production server/client build and precommit: `PASS`;
- DM composition, two-real-PDF revision/currentness loop and Unified composition: `PASS`;
- three-row residual real FTD loop: `PASS`, `122102` source bytes, one source upload, zero deletes;
- package: `urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622`;
- package bytes/hash: `662441` / `349ef64d4538f77aeaf20796deea0e2c5ac2e7cb6d0b4df587570b32d09c56d2`;
- full U0 Validator: `PASS`; Reader `software` query: `38`, all source-bound;
- repeat action: same `WI-LOCAL-FTD-FIRST-VERTICAL`, no second source upload.

## Claims

- A verified FileService orphan with zero related Catalog rows can continue with zero upload and
  zero delete.
- Complete committed Catalog lineage remains reusable.
- Byte, metadata, provider identity, actor, route, row cardinality, preflight, downstream state and
  permission drift all fail closed with stable existing error handling.
- The exact three-row residual fixture continues to `commitNewVersion`, frozen.2, full U0 validation
  and Reader; the second invocation is idempotent.
- No online retry, repair, deletion, WorkItem, package, Assessment or engineering conclusion was
  created by this corrective slice.

## Non-claims and next blocker

The current hosted partial database state has not been modified. Although its expected shape is now
covered locally, the code has not been pushed or released and no hosted retry was made. A future
online FTD retry still requires the separately authorized release-and-single-request sequence. This
slice does not authorize that action, another release, or another validation request.
