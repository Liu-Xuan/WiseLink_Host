# Document Management Phase 2C acceptance

Date: 2026-08-14

App candidate: `app_17bzc551rsg`

Source owner commit: `78f5920ec9f49898d70ea4a4bb7468e7f92bbb3c`

## Result

The one canonical-host candidate now contains the versioned Document Management hosted source
bundle as an internal module. The host uses its own `PlatformModule` providers for
`DRIZZLE_DATABASE` and `FileService`; no second application, Base, Drive directory, WorkItem store,
database connection or user entry point was introduced.

The host registers `DocumentManagementHostedModule` before `ViewModule`. Both hosted routes keep
class-level `@NeedLogin`, and actor/tenant/roles are derived only from `req.userContext`. The host
currently injects `UnconfiguredDocumentManagementIngestAuthorizer`, which rejects read and ingest
before any database or FileService I/O. A positive hosted authorization binding remains a later
activation action.

## DEV infrastructure readback

The exact owner migration `migrations/0001_document_management_hosted_catalog.sql` was applied once
to the empty DEV schema through the official database CLI. It created these seven tables with the
owner transaction, unique constraints, currentness CAS support, immutable row triggers, platform
audit columns and RLS policies:

- `dm_source_artifact`
- `dm_acquisition`
- `dm_publication_family`
- `dm_document`
- `dm_document_version`
- `dm_ingress_preflight`
- `dm_currentness_decision`

An independent table-list readback returned exactly seven tables and `estimated_row_count=0` for
every table. `npm run gen:db-schema` then generated `server/database/schema.ts` from app
`app_17bzc551rsg`, branch `dev`; the hosted catalog imports that generated schema and no longer uses
the module-owned table declaration. A FileService read-only list returned zero files.

## Real local host loop

`npm run test:document-management:real-pdf` executes the business core emitted by the host build,
with only the catalog and FileService test providers coming from the exact owner worktree. Inputs:

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| `777-FTD-31-21002_Doc_07042025.pdf` | 119387 | `d93100d54ea7e5f7eff9f18ac157e31580d31da45a2dcd4b7248969de823f36c` |
| `777-FTD-31-21002_Doc_09262025.pdf` | 122102 | `b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c` |

Observed decisions were `INGEST_NEW_FAMILY`, `RESUME_EXISTING_PROCESS`,
`INGEST_NEW_REVISION`, and `IDEMPOTENT_REPLAY`. Final local counts were two immutable source
artifacts, three acquisitions, one family, one document, two immutable versions, two currentness
decisions and two `upsert:false` FileService writes. Current generation became 2, the old
DocumentVersion remained byte-for-byte unchanged, and all four requests were authorized before
I/O.

## Verification

- Jest: 8 suites / 51 tests passed.
- server and client typecheck: passed.
- lint (ESLint, stylelint, typecheck): passed.
- `test:document-management:composition`: CommonJS load passed, 23 adapter assets parsed, default
  authorization failed closed.
- `test:document-management:real-pdf`: passed on the two real PDFs above.
- Unified composition and canonical activation regression: passed.
- production server and client build: passed.
- `git diff --check`: passed before commit.

## Claims and non-claims

Claim: Document Management Phase 2C is locally integrated into the only canonical-host candidate,
the DEV catalog schema exists empty, and the actual host build can execute the two-revision FTD
loop with the selected owner business core.

Non-claims: this commit is not published; no release was created; no online FileService byte,
catalog business record, WorkItem, package, current selection or engineering decision was written.
The hosted positive authorization provider is not selected, and therefore the deployed API remains
locked even if this source is later released unchanged. The next release must wait for the Unified
owner's `jsonschema` delivery slice and a separate master instruction.

## Goal alignment

- This slice moves the real vertical closer to exact DocumentVersion creation from user-selected
  PDFs, rather than adding a gate-only artifact.
- The seven-table constraints and fail-closed authorizer directly prevent split currentness,
  duplicate revision identities and unauthenticated writes; no new hash, frozen contract or second
  authority was added.
- The work did not expand assessment, AEO, Parser or WorkItem scope.
- The next shortest path remains hosted DM PDF ingress followed by the selected frozen.2 Unified
  producer/Validator/Reader on the same logical WorkItem after the authorized runtime dependencies
  are available.
