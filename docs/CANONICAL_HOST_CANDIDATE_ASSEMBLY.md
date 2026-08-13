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
   - `server/modules/assessment-registrar/` now selectively assembles the Hosted Registrar
     activation provider from exact Assessment commit
     `bb73aacfc4d883ce13fb6cc2fec6704057b98f24`;
   - the provider maps the selected 65/28/17 Base tables but remains `BLOCKED` before capability
     loading until the master supplies hosted runtime/bootstrap/ports;
   - add one later adapter implementing `CanonicalWorkItemRegistrarPort` against this same
     Registrar service after activation; do not add another writer;
   - keep WorkItem identity/current state in that one store; do not mirror it in Unified or AEO.
3. **Unified**
   - reuse `server/modules/unified-reader/unified-reader.module.ts`;
   - consume exact Unified hosted source commit
     `2d33803602fd0c92396c381bc4793ebc29bbd7f0` through
     `server/modules/unified-reader/public-api.ts`;
   - the official FileService provider can read and verify immutable package bytes, but package
     persistence is blocked before FileService I/O without a separate validation-write receipt;
   - retain the exact Python frozen.2 U0 adapter for a post-DEV runtime probe of Python,
     `child_process` and contract dependencies; do not pre-build a second Node Validator;
   - inject the selected ArtifactStore, full Validator and exact Unified failure adapter providers
     only after hosted bindings are authorized;
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
host composition with every hosted provider unconfigured. The production build starts locally at
the exact app base path; after following the platform's cookie plus `X-Suda-Csrf-Token` protocol,
Unified readiness returns `VERIFICATION_PENDING` and Registrar readiness returns `BLOCKED`, with
both write and publication authority false.

Non-claims: no candidate code has been pushed, no release exists, no hosted provider has been
selected in `AppModule`, no Python runtime probe has run in hosted DEV, no
FileService/Base/database/WorkItem was written, and no current or engineering decision was changed.

## Only blocker

The remaining runtime blocker is one authorized DEV activation that binds the already-selected
hosted providers and probes whether the Miaoda runtime supports the exact Python U0 adapter
(`child_process`, Python executable and frozen.2 dependencies). Document Management source,
Registrar runtime ports, authorization/permission readers and canonical deep-link origin also
remain unbound. Until that provider assembly is activated, this app remains a candidate and
correctly stays locked.

## Phase 1B read-only DEV probe

The first controlled release adds one bounded, login-protected `GET /api/runtime-probe` endpoint.
It accepts no executable, path, package or persistence input. It checks only:

- a fixed `python3` / `python` / `/usr/bin/python3` executable list;
- `child_process` execution and a temporary-file create/read/delete cycle;
- `jsonschema` availability;
- the exact U0 frozen.2 manifest bytes and required Reader/schema/extension assets copied from U0
  commit `fa69ada08265934951df53c7a61a3ccdb8cb2900`;
- a strict read of the bundled minimal frozen.2 PDF package.

The endpoint hard-codes every business, artifact and Base write authority to `false`. It never
calls FileService, Base, WorkItem, package persistence or receipt persistence. A missing hosted
dependency returns `BLOCKED` with an explicit blocker; it does not fall back to a local service or a
weaker Validator.

## Phase 2C Document Management integration

The exact Document Management source bundle from
`cb5cadd940d869891e6d969ea04167c2bcbd502e` is now selectively assembled as an internal module.
DEV contains the owner migration's seven empty catalog tables, and the host-generated Drizzle
schema is the only table definition consumed at runtime. The source bundle's CommonJS output and
23 document-family adapters load from the production host build. The same built core passed the
real two-PDF FTD revision/idempotency loop with local test providers.

The host authorization provider remains deliberately unconfigured and rejects before DB or
FileService I/O. No online catalog rows or FileService bytes were created, and this Phase 2C source
has not been published. Detailed evidence and current non-claims are in
`docs/DOCUMENT_MANAGEMENT_PHASE_2C_ACCEPTANCE.md`.

## Phase 2D hosted validation status

The hosted Python/vendor/U0 probe and strict Reader now pass in DEV. A bounded validation window
was deployed and closed, but its single DM POST exposed numeric FileService path handling before
any catalog or immutable-source write. The closure release is current; all seven DM tables remain
empty and FileService contains only the two authorized FTD PDFs. The local correction validates
actual bytes instead of path names and preserves the server-owned 403 response, but it has not been
pushed or deployed. Full evidence, release identities and non-claims are in
`docs/PHASE_2D_HOSTED_VALIDATION_ACCEPTANCE_20260814.md`.

## Phase 2F locator correction candidate

The host now consumes the owner-exported leading-slash canonicalization and the metadata/download
object-version binding from exact DM commit `cb5cadd940d869891e6d969ea04167c2bcbd502e`.
This does not weaken bucket, path, object, version or actual-byte checks. It preserves the caller's
numeric FileService path in catalog lineage while comparing the provider's canonical path. At this
commit the correction is a local candidate pending the single validation-release/closure-release
hosted replay; no success claim is made here.
