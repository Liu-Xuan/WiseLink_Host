# Document Management hosted source

- source owner repository: `document-management-app-q2d`
- source owner commit: `cb5cadd940d869891e6d969ea04167c2bcbd502e`
- exported with: `npm run export:hosted-module -- --output <empty-directory>`
- host app candidate: `app_17bzc551rsg`
- module role: versioned internal source bundle; not a second user application
- runtime storage: host `DRIZZLE_DATABASE` and host `FileService`
- authorization default: unconfigured and fail-closed before I/O
- current online baseline before Phase 2F: seven catalog tables empty; two authorized FTD input PDFs in FileService

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
