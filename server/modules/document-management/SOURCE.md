# Document Management hosted source

- source owner repository: `document-management-app-q2d`
- source owner commit: `78f5920ec9f49898d70ea4a4bb7468e7f92bbb3c`
- exported with: `npm run export:hosted-module -- --output <host>/server/modules/document-management`
- host app candidate: `app_17bzc551rsg`
- module role: versioned internal source bundle; not a second user application
- runtime storage: host `DRIZZLE_DATABASE` and host `FileService`
- authorization default: unconfigured and fail-closed before I/O
- online business records / FileService writes performed by this integration: none

The seven table definitions are generated into `server/database/schema.ts` from the
host DEV schema. The module-owned table declaration file is deliberately not used.

The exporter-generated CommonJS registry path is adjusted from five to six parent
segments because the host stores adapters at `dist/config/document-family-adapters`,
not `dist/server/config/document-family-adapters`. Adapter bytes and business logic
remain unchanged.
