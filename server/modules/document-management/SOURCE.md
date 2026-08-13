# Document Management hosted source

- source owner repository: `document-management-app-q2d`
- source owner commit: `4d88666a3c494633dc083388ef781ea7aafab998`
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
not `dist/server/config/document-family-adapters`. Adapter bytes and business logic
remain unchanged.

The host keeps ordinary providers only. Without Master trust, permission fresh-read and write
authority, Registrar readiness remains `BLOCKED` and Document Management ingestion remains
fail-closed before I/O. Phase 2 is permanently stopped; this owner refresh does not authorize a
hosted replay, environment change or online write.

The refreshed FileService adapter treats `updatedAt` as audit metadata only. Bucket, canonical
path, provider object ID and actual bytes remain strict. A pre-existing content-addressed source is
reused only after exact byte verification, with zero upload and zero delete.
