# First real FTD WorkItem vertical — hosted DEV acceptance

Date: 2026-08-14

Status: `HOSTED_REAL_VERTICAL_COMPLETE_PASS`

## Purpose

Record the completed first real hosted business loop in the single canonical Miaoda host. The loop
uses the ordinary Miaoda DB WorkItem store and the production adapter from the existing real FTD
PDF output to the selected frozen.2 Unified Parsed Package. Historical
Registrar/Base/activation/receipt candidates are not prerequisites for this path.

## Executed path

`authorized FileService PDF → DM exact DocumentVersion/currentness → one WorkItem/ActionAttempt →
PDF producer adapter → immutable package persist/readback → full U0 validation → Unified Reader →
same WorkItem page/deep-link`

The hosted business action was submitted exactly once with no automatic retry. A later independent
read-only page request initially encountered a response-less FileService read failure, then
succeeded on one bounded read-only retry. It is classified
`TRANSIENT_READ_RECOVERED_BY_SINGLE_READ_ONLY_RETRY`; this does not authorize retrying the business
POST.

## Exact real identities

- Source PDF: `777-FTD-31-21002_Doc_09262025.pdf`
- Source bytes: `122102`
- Source SHA-256: `b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c`
- Document: `document_3943d8eb5b7c7ee8fc742092`
- Hosted DocumentVersion: `document_version_fd88dcb9cf64cf3ba21033ef`
- Hosted trigger source: `bucket_aadkprardjghu:/1873430479421449.pdf`; the existing DM module
  resolves this exact authorized FileService object to the immutable DocumentVersion before the
  WorkItem is reserved.
- Hosted WorkItem: `WI-c2943f5a-d023-46ac-9cf5-9480de0aabaf`
- Hosted ActionAttempt: `ATT-135d647e-49ed-4c82-b102-bec0fba01f45`
- Hosted request: `REQ-e4ea4706-ece6-4012-b1d5-603bdc0affe9`
- Package ID:
  `urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622`
- Package artifact SHA-256:
  `349ef64d4538f77aeaf20796deea0e2c5ac2e7cb6d0b4df587570b32d09c56d2`
- Package bytes: `662441`
- Package content units / source refs: `311 / 239`
- Reader query: `software`, `38` results, all source-bound
- Reader receipt: `reader_receipt_dee9feaf9c3d7accfa6de49d77dcd645`
- Hosted success trace: `b5cf9d1c1773deb421a359cd47cf9d86`
- Hosted client log: `LOG7673837991800442130`
- Explicit FailureReport artifact SHA-256:
  `de8053a1566a02a66b86d2a913b42f40450d551256f7d5b2cdefffec3be0a708`
- FailureReport bytes: `2014`
- Failure code: `PRODUCER_UNSUPPORTED`

## Data layer

The DEV schema and post-run records were independently read back:

- existing DM tables: `7`;
- added `work_item` and `action_attempt` tables: `2`;
- total DEV tables: `9`;
- post-run records: every one of the seven DM tables plus `work_item` and `action_attempt` contains
  exactly one record;
- WorkItem uniqueness: `(tenant_id, action_type, document_version_id)`;
- ActionAttempt uniqueness: `(work_item_id, action_type, attempt_no)`.

DM remains the sole owner of DocumentVersion/currentness. WorkItem stores only the exact
DocumentVersion/source identity and thin package/failure refs.

The resulting WorkItem is `CANDIDATE_READBACK_VERIFIED`, revision `3`; its single ActionAttempt is
`SUCCEEDED` with `attempt_no=1` and no failure/error. The DocumentVersion is
`COMMITTED_IMMUTABLE`; the publication family is active at generation `1`.

FileService contains the five pre-existing objects plus one new immutable package object:

- path:
  `/unified-parsed-packages/sha256/349ef64d4538f77aeaf20796deea0e2c5ac2e7cb6d0b4df587570b32d09c56d2.json`;
- actual bytes: `662441`;
- actual SHA-256: `349ef64d4538f77aeaf20796deea0e2c5ac2e7cb6d0b4df587570b32d09c56d2`.

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

Hosted observations:

- validation release: `7673837815686581436`, exact source commit `65467a48b5010a98fe41921bdb0f9279deb8362c`;
- one authenticated/CSRF-protected POST returned HTTP `201`, schema
  `wiselink.3_1.ordinary_work_item_run.v1`, result `CANDIDATE_VERTICAL_VERIFIED`;
- closure release: `7673837917727050950`, exact same source commit;
- validation configuration is disabled and the run ID is absent after closure;
- downloaded package bytes passed the frozen.2 full U0 strict Validator
  (`FULL_STRICT_VALIDATOR_PASSED`) pinned to
  `fa69ada08265934951df53c7a61a3ccdb8cb2900`;
- the same Reader returned `38/38` `software` results with resolvable source references;
- the exact WorkItem deep link fresh-read now renders `CANDIDATE_READBACK_VERIFIED`, the FTD
  parser profile, frozen.2, `311` content units, `239` source references, `PARTIAL` coverage and
  source-bound applicability rows.

The local system Python lacked `jsonschema`; the test used a temporary venv with the existing pinned
U0 requirements. The hosted vendored Python/U0 runtime was subsequently exercised by the accepted
DEV path and the downloaded package passed the same full strict Validator.

## Claims

- The first real FTD hosted DEV business loop is complete and independently read back end to end.
- Duplicate user actions converge on one WorkItem using the ordinary DB unique key.
- Package and failure artifacts are immutable, content-addressed and byte-verified after readback.
- The same frozen.2 full Validator and bounded Reader are used; no second Validator/Reader/failure
  authority exists.
- The WorkItem page/deep-link reads the same server-side WorkItem/package projection, not static
  SAMPLE data.

## Non-claims

- This is a controlled DEV candidate acceptance, not a production/current release.
- Exactly one hosted business POST ran. No replay POST was used to claim hosted idempotency; the
  idempotency behavior remains covered by the real local loop and database uniqueness.
- The first producer adapter is deliberately bounded to the verified real Boeing FTD profile; it is
  not yet a general family classifier or generic PDF parser.
- No Assessment, AEO, applicability result, engineering decision, Aily mutation, production release
  or current switch was created.

## Next slice: Aily same-ledger read-only facade

Add only four read-only tools against the existing canonical host read model:

1. get the exact WorkItem and processing status;
2. read the selected parsed-package summary;
3. query source-bound parsed units/results;
4. return the server-derived canonical Miaoda deep link for that WorkItem.

Aily owns no WorkItem, parser state, package copy, retry, mutation or engineering conclusion. If a
host identity or exact WorkItem is unavailable, the facade fails explicitly instead of inventing a
second ledger.

## Goal alignment

A. Yes: the engineer can inspect the hosted real package, source-bound Reader results and the same
WorkItem page.

B. The only new mechanisms prevent duplicate WorkItems, untraceable package writes or missing
failure artifacts; they are directly tied to wrong user-visible results.

C. No new gate/hash/contract framework was added. The transient read was handled as a bounded
read-only operation, not as a new business retry mechanism.

D. Yes: the next action is the four-tool Aily read-only facade over this completed loop, followed by
classification/general producer expansion rather than more infrastructure.
