# First real FTD WorkItem vertical — local acceptance

Date: 2026-08-14

Status: `LOCAL_REAL_VERTICAL_PASS / HOSTED_VALIDATION_PENDING`

## Purpose

Close the two concrete gaps in the single canonical host: an ordinary Miaoda DB WorkItem store and
a production adapter from the existing real FTD PDF output to the selected frozen.2 Unified Parsed
Package. Historical Registrar/Base/activation/receipt candidates remain non-blocking.

## Executed path

`real FTD PDF bytes → DM exact DocumentVersion → one WorkItem/ActionAttempt → PDF producer adapter
→ immutable package persist/readback → full U0 validation → Unified Reader → page query`

The repeat action uses the same tenant/action/documentVersion business key and returns the same
WorkItem. A separate explicit producer failure runs through the existing Unified frozen.2
FailureReport adapter, ordinary authenticated write receipt, immutable actual-byte readback and the
strict U0 FailureReport validator.

## Exact real identities

- Source PDF: `777-FTD-31-21002_Doc_09262025.pdf`
- Source bytes: `122102`
- Source SHA-256: `b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c`
- Document: `document_3943d8eb5b7c7ee8fc742092`
- Local acceptance DocumentVersion: `document_version_fd88dcb9cf64cf3ba21033ef`
- Hosted trigger source: `bucket_aadkprardjghu:/1873430479421449.pdf`; the existing DM module
  resolves this exact authorized FileService object to the immutable DocumentVersion before the
  WorkItem is reserved.
- Local WorkItem: `WI-LOCAL-FTD-FIRST-VERTICAL`
- Package ID:
  `urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622`
- Package artifact SHA-256:
  `349ef64d4538f77aeaf20796deea0e2c5ac2e7cb6d0b4df587570b32d09c56d2`
- Package bytes: `662441`
- Package content units / source refs: `311 / 239`
- Reader query: `software`, `38` results, all source-bound
- Explicit FailureReport artifact SHA-256:
  `de8053a1566a02a66b86d2a913b42f40450d551256f7d5b2cdefffec3be0a708`
- FailureReport bytes: `2014`
- Failure code: `PRODUCER_UNSUPPORTED`

## Data layer

The DEV schema change was applied once through the official Miaoda DB command and read back:

- existing DM tables: `7`;
- added `work_item` and `action_attempt` tables: `2`;
- total DEV tables: `9`;
- pre-hosted-validation WorkItem/ActionAttempt records: `0 / 0`;
- WorkItem uniqueness: `(tenant_id, action_type, document_version_id)`;
- ActionAttempt uniqueness: `(work_item_id, action_type, attempt_no)`.

DM remains the sole owner of DocumentVersion/currentness. WorkItem stores only the exact
DocumentVersion/source identity and thin package/failure refs.

## Commands and observed results

- `npm test -- --runInBand`: `18 suites / 83 tests PASS`
- `npm run type:check`: server/client `PASS`
- `npm run lint`: ESLint/stylelint/typecheck `PASS`
- `npm run build:prod`: server/client `PASS`
- `npm run test:document-management:composition`: `PASS`, source owner exact
- `npm run test:document-management:real-pdf`: two real FTD revisions and replay `PASS`
- `npm run test:unified:composition`: `PASS`
- `npm run test:canonical:activation`: historical default-unconfigured safety `PASS`
- `WL_LOCAL_U0_PYTHON=/private/tmp/wiselink-u0-local-venv/bin/python npm run
  test:ordinary:first-ftd-loop`: success, repeat reuse and frozen FailureReport `PASS`
- `git diff --check`: `PASS`

The local system Python lacked `jsonschema`; the test used a temporary venv with the existing pinned
U0 requirements. The hosted vendor/runtime assets are unchanged and will be checked again by the
existing read-only runtime probe after release.

## Claims

- The first real FTD local business loop is runnable from the production host build.
- Duplicate user actions converge on one WorkItem using the ordinary DB unique key.
- Package and failure artifacts are immutable, content-addressed and byte-verified after readback.
- The same frozen.2 full Validator and bounded Reader are used; no second Validator/Reader/failure
  authority exists.
- Page reads come from the server WorkItem projection, not static SAMPLE data.

## Non-claims

- No new host commit has yet been pushed or released for this slice.
- No hosted business POST has yet run; WorkItem/ActionAttempt remain empty online before validation.
- The first producer adapter is deliberately bounded to the verified real Boeing FTD profile; it is
  not yet a general family classifier or generic PDF parser.
- No Assessment, AEO, applicability result, engineering decision, Aily mutation, production release
  or current switch was created.

## Next hosted action

After a clean local commit and push, create one controlled DEV release. Fresh-read all nine tables
and FileService, then use the logged-in `/runtime-probe` page to call the fixed FTD WorkItem action
exactly once through `axiosForBackend`. Read back the WorkItem, ActionAttempt, package bytes and
`/work-items/:workItemId/documents` page. Any failure is explicit and stops the hosted slice; there
is no automatic retry.

## Goal alignment

A. Yes: the engineer can now inspect a real package and source-bound Reader results.

B. The only new mechanisms prevent duplicate WorkItems, untraceable package writes or missing
failure artifacts; they are directly tied to wrong user-visible results.

C. No new gate/hash/contract framework was added; one obsolete source-fingerprint gate was removed
in favor of the exact Unified public service plus Git pin.

D. Yes: the next action is the same loop in hosted DEV, followed by classification/general producer
expansion rather than more infrastructure.
