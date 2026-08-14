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

`npm run test:document-management:external-candidate` uses the real
`777-FTD-31-21002_Doc_09262025.pdf` bytes and the production hosted DM core with local FileService
and Catalog doubles. It verifies:

- zero Catalog rows before user confirmation;
- one selected OpenClaw discovery candidate creates one immutable SourceArtifact and exact
  DocumentVersion;
- external discovery metadata remains in Acquisition provenance;
- a later monitor result for the same bytes records a second Acquisition and reuses the same
  DocumentVersion;
- idempotent replay performs no extra I/O;
- no delete, online write or publication occurs.

The OpenClaw metadata in this test is explicitly a local discovery fixture. The PDF bytes are
real; the test does not claim a live Boeing/Airbus/COMAC query or download.

## Next online action

After the OpenClaw owner produces one real candidate and the user selects it, upload or copy only
that selected file into the existing Miaoda FileService selection path and invoke the existing
authenticated ingestion once. Preserve the real search-run reference and source locator in the
request descriptor. Do not create a WorkItem until the exact DocumentVersion fresh-read succeeds.
