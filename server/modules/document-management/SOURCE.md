# Document Management hosted source

- source owner repository: `document-management-app-q2d`
- source owner commit: `fcab253b17dd1d118232fdbb72f4e0fe2d295f0e`
- exported with: `npm run export:hosted-module -- --output <empty-directory>`
- host app candidate: `app_17bzc551rsg`
- module role: versioned internal source bundle; not a second user application
- runtime storage: host `DRIZZLE_DATABASE` and host `FileService`
- authorization default: unconfigured and fail-closed before I/O
- integration mode: local-only owner refresh; no online read or mutation performed

The owner bundle was exported from the exact detached owner commit into an empty temporary
directory. Owner-owned source bytes were then synchronized mechanically into this host. Host-only
composition remains explicit: the platform-generated table schema, authorization provider and
CommonJS adapter registry root are not overwritten by the owner export.

The seven table definitions are generated into `server/database/schema.ts` from the
host DEV schema. The module-owned table declaration file is deliberately not used.

The exporter-generated CommonJS registry path is adjusted from five to six parent
segments because the host stores adapters at `dist/config/document-family-adapters`,
not `dist/server/config/document-family-adapters`.

The host carries one corrective database-adapter patch after the owner export. Drizzle 0.44.6
requires `insert(...).select(...)` to select every target-table field in the exact generated
schema order. The hosted Catalog now supplies the generated UUID and audit fields for the
existing `dm_document`, `dm_document_version`, and `dm_currentness_decision` statements. This
does not change the seven-table schema, document identity, currentness semantics, or owner
business rules.

The host also carries the failure-specific recovery correction proven by the first hosted FTD run.
A pre-existing content-addressed FileService object may continue only after exact metadata and
actual-byte readback plus a fresh Catalog check. Zero related Catalog rows is an allowed orphan
recovery; complete committed lineage is an allowed ordinary reuse. One narrow residual shape is
also recoverable: exactly one matching SourceArtifact, Acquisition and READY ingress preflight,
with the same actor/route/metadata and no related family, document, version, currentness, WorkItem
or ActionAttempt. It resumes the existing `commitNewVersion` path without rewriting or deleting
those three rows. Any other partial or conflicting lineage remains fail-closed.

The host keeps ordinary providers only. Without Master trust, permission fresh-read and write
authority, Registrar readiness remains `BLOCKED` and Document Management ingestion remains
fail-closed before I/O. Phase 2 is permanently stopped; this owner refresh does not authorize a
hosted replay, environment change or online write.

The refreshed FileService adapter treats `updatedAt` as audit metadata only. Bucket, canonical
path, provider object ID and actual bytes remain strict. A pre-existing content-addressed source is
reused only after exact byte verification, with zero upload and zero delete. The owner now also
passes the provider-canonical path without a leading slash to the official 0.1.2 upload preflight;
the caller-facing Catalog receipt continues to use the leading-slash path.

The `fcab253` owner refresh adds the controlled, catalog-only `OEM_REFERENCE` family and the
`ISSUE <number>` revision ordering used by Airbus FAST. It deliberately returns no Document
Management parser adapter release: parser routing remains a canonical-host concern and cannot be
selected from a filename or an unconfirmed discovery result.
