# External discovery to DocumentVersion

## Decision

No new Document Management table, queue, worker, contract, hash, baseline or gate is needed for
the first external-information loop.

The existing hosted Document Management path already separates the lifecycle correctly:

1. OpenClaw keeps unconfirmed search results as discovery candidates. A title, snippet or URL is
   not a document and must not create a `SourceArtifact` or `DocumentVersion`.
2. A user selects a candidate and makes the source file available through the existing Miaoda
   FileService selection path.
3. The existing authenticated `POST /api/document-management/ingestions/file-service` path reads
   the actual bytes, persists one immutable `dm_source_artifact`, records provenance in
   `dm_acquisition`, performs the existing ingress preflight and commits the exact
   `dm_document_version` plus currentness.
4. A later monitor result for the same actual bytes creates another Acquisition carrying the new
   search-run provenance but reuses the same DocumentVersion. It does not create a duplicate
   version or overwrite history.

## Existing ownership

| Information | Existing owner |
| --- | --- |
| Unconfirmed search result, snippet, ranking and monitor observation | OpenClaw / Feishu-native candidate list |
| External portal/search-run provenance after user selection | `dm_acquisition.source_channel`, `source_ref`, `source_descriptor_json` |
| Confirmed source bytes and FileService locator | `dm_source_artifact` |
| Engineering document identity and revision | `dm_document`, `dm_document_version` |
| Which revision is current | `dm_publication_family`, `dm_currentness_decision` |
| Assessment or parsing execution | Existing WorkItem path after exact DocumentVersion exists |

This keeps snippets and access-denied results out of the engineering Document Catalog. Only a
reviewed, actually readable file crosses the existing ingestion boundary.

## Local real-byte verification

The first hosted OpenClaw OEM query is retained as discovery-only input:

- hosted app: `app_17c3zn24kv2`;
- query: `777 FTD 31-21002 software`;
- result: `ZERO_RESULTS_FOR_TARGET_IDENTIFIER`, not access-restricted, not truncated and partial;
- two Boeing candidates were both tangential with no direct identifier match;
- Federal Register and China Southern results were excluded because they were not OEM sources;
- no candidate was selected, downloaded or admitted to the Document Catalog.

The local human-selection fixture below is deliberately separate from this hosted zero-result
query. It seeds the already-accepted first FTD DocumentVersion, then proves the transition after a
reviewer selects the same real readable bytes from an external observation. It does not claim that
OpenClaw found or downloaded the fixture.

`WL_LOCAL_U0_PYTHON=<pinned-python> npm run test:document-management:external-candidate` uses the
real `777-FTD-31-21002_Doc_09262025.pdf` bytes, the production hosted DM core, existing WorkItem
service, exact FTD producer, frozen.2 full Validator and Unified Reader with local FileService and
Catalog doubles. It verifies:

- the hosted zero-result discovery leaves the pre-existing Catalog and FileService unchanged;
- one selected local discovery fixture reuses the existing immutable SourceArtifact and exact
  DocumentVersion while adding only its Acquisition provenance;
- external discovery metadata remains in Acquisition provenance;
- the confirmed exact DocumentVersion enters one ordinary WorkItem without another DM ingestion;
- the existing producer emits the frozen.2 package, the full Validator passes and Reader returns
  only source-bound results;
- a repeated parse action reuses the same WorkItem and package;
- a later monitor result for the same bytes records a second Acquisition and reuses the same
  DocumentVersion;
- idempotent replay performs no extra I/O;
- no delete, online write or publication occurs.

The OpenClaw metadata in this test is explicitly a local discovery fixture. The PDF bytes are
real. The hosted zero-result query above is real, but the test does not claim that it found or
downloaded this file, nor that Airbus or COMAC coverage has run.

Observed local result:

- status: `EXTERNAL_CANDIDATE_TO_READER_LOOP_PASS`;
- live discovery Catalog I/O: `0`;
- exact DocumentVersion: `document_version_fd88dcb9cf64cf3ba21033ef`;
- WorkItem: `WI-LOCAL-EXTERNAL-CANDIDATE-FTD`, first create then exact reuse;
- package: `urn:techpub:package:v1:sha256:9e734a0de1c37c368b954662e9bb11036cc24b430468a073b31da127380df622`;
- package content: `311` units and `239` source refs;
- Reader query: `software`, `38/38` results source-bound;
- final DM rows: one SourceArtifact, three Acquisitions, one Document, one DocumentVersion and one
  currentness decision; one source upload, one package upload and zero deletes;
- online writes, releases and WorkItem API calls: `0`.

The first test attempt intentionally failed closed because a fresh empty Catalog plus explicit
fixture revision metadata produced `document_version_69cd0a612c23c7abe3a7e70e`, while the current
verified FTD producer supports only the already-accepted `document_version_fd88...`. The correction
did not relax the producer or alter document identity: the harness now seeds the existing exact FTD
DocumentVersion first, keeps search provenance only in the later Acquisition, and proves that DM
returns `RESUME_EXISTING_PROCESS` for the same actual bytes.

## Next online action

The current hosted query has no direct target match, so its next Catalog/WorkItem action is none.
After a future OEM query produces one direct candidate and a user selects it, upload or copy only
that selected real file into the existing Miaoda FileService selection path and invoke the existing
authenticated ingestion once. Preserve the real search-run reference and source locator in the
Acquisition descriptor. After the exact DocumentVersion fresh-read succeeds, invoke the existing
ordinary parse action with that `documentVersionId`; do not pass the OpenClaw candidate to Parser
or let OpenClaw call the WorkItem API directly.
