# Canonical host candidate assembly

Date: 2026-08-13

## Decision

`app_17bzc551rsg` (`WiseLink 3.1｜工程资料与综合评估`) is suitable as the single
`CANONICAL_HOST_CANDIDATE`.

Read-only platform inspection established:

- app type is `full_stack`;
- the app was created on 2026-08-12;
- releases are empty;
- application database tables are empty;
- FileService contains 0 files and 0 bytes.

The official `lark-cli apps +init` path created this app's own repository and
`sprint/default`. Development continues on local branch
`codex/v3-1-canonical-host-candidate`. This candidate was not initialized by changing the remote or
`.spark/meta.json` of another app.

## Source migration audit

Source baseline:

- worktree: `private/runtime/worktrees/v3-1-canonical-host-main-loop`;
- exact source commit: `23dbc9d72840478d9c7157025bdc6ed5722ac782`;
- source and target both use the current NestJS/React `full_stack` scaffold;
- dependencies are compatible; the target keeps its newer platform-generated scaffold and lockfile.

Migrated:

- canonical-host module and its tests;
- Unified Reader/Validator composition source and tests;
- Document & Parsing page and API client;
- existing machine composition contracts needed to exercise the migrated module.

Not migrated:

- `.git`, remote, branch history, `.spark/meta.json`, `.env`, `.env.local`;
- the prior app's runtime-probe implementation and UI;
- any old app/Base/Aily/TDMS/AAmis/demo identity;
- generated `dist`, `node_modules`, logs or temporary receipts;
- real provider configuration or online business data.

## File-level provider plan

The existing composition seams are sufficient; no new receipt, authority, schema, contract or gate
is introduced.

1. **Document Management producer**
   - add one internal DM adapter module under `server/modules/document-management/`;
   - translate an authorized exact DocumentVersion request to the existing
     `CANONICAL_PDF_PRODUCER` port;
   - bind it in `server/app.module.ts` only after its exact hosted integration is selected.
2. **Registrar**
   - add one adapter under `server/modules/work-item/` implementing
     `CanonicalWorkItemRegistrarPort` against the selected store;
   - keep WorkItem identity/current state in that one store; do not mirror it in Unified or AEO.
3. **Unified**
   - reuse `server/modules/unified-reader/unified-reader.module.ts`;
   - inject the selected ArtifactStore, full Validator and exact Unified failure adapter providers;
   - do not copy another Reader/Validator implementation.
4. **AEO**
   - export one `AEO_SPECIALIST_READER_PORT` provider from its internal module;
   - use `createAeoSpecialistReaderBridgeProvider()` and `aeoSpecialistReaderProvider`; AEO does
     not create a second app or WorkItem store.
5. **Miaoda and Aily**
   - Miaoda reads only the fresh WorkItem projection at
     `client/src/pages/DocumentParsingPage/`;
   - Aily later calls the existing status/query/deep-link façade and owns no parsing state.

## Claims and non-claims

Claim: one new, empty full-stack app now has a local candidate branch containing the source-level
host composition with every hosted provider unconfigured.

Non-claims: no candidate code has been pushed, no release exists, no hosted provider has been
selected, no FileService/Base/database/WorkItem was written, and no current or engineering decision
was changed.

## Only blocker

The 3.1 master has not yet selected the exact hosted provider set for the first authorized vertical:
Document Management source adapter, WorkItem Registrar, ArtifactStore, full U0 Validator,
authorization/permission readers and canonical deep-link origin. Until that one provider assembly is
selected, this app remains a candidate and correctly stays locked.
