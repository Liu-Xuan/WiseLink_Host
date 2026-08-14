# Canonical host candidate assembly

## Superseding current state — 2026-08-14

The earlier activation-first plan below is retained as history, but it no longer defines the main
path. The current owner decision selects an ordinary authenticated WorkItem vertical in the single
Miaoda app. Registrar activation, Base WorkItem storage and detached receipt ownership may remain
as non-blocking historical modules; they are not prerequisites for the first business loop.

Current composition:

- `work_item` and `action_attempt` are ordinary Miaoda DB tables with a business uniqueness key;
- DM exact owner source remains `3ebc61c0532c5ee04122a251464fc644d1238439` and supplies only the
  exact `DocumentVersion` identity to WorkItem processing;
- the first production adapter consumes the verified real FTD producer output and emits the
  selected frozen.2 Unified Parsed Package;
- package and FailureReport bytes use the same ordinary immutable FileService adapter with actual
  byte readback;
- Unified's sole frozen.2 Validator, Reader and FailureReport adapter are configured in the host;
- the Miaoda page and hidden validation action read the same WorkItem; Aily remains later and
  read-only.

Hosted DEV acceptance, exact identities and remaining non-claims are recorded in
`FIRST_REAL_FTD_WORKITEM_VERTICAL_ACCEPTANCE_20260814.md`.

The first real hosted vertical is now `COMPLETE/PASS`: one authenticated request produced the exact
DM DocumentVersion, one WorkItem/ActionAttempt, one immutable frozen.2 package, full U0 validation,
source-bound Reader results and the same Miaoda page/deep-link. Validation is closed. A subsequent
response-less FileService page read succeeded on one bounded read-only retry and is classified
`TRANSIENT_READ_RECOVERED_BY_SINGLE_READ_ONLY_RETRY`; the business POST remains non-retrying.

### Goal alignment

This supersede removes old activation blockers from the product path and advances a directly
inspectable result. It adds no second producer, package contract, hash scheme or gate. The next
step is the three-skill Aily read-only mapping (status plus package summary, source-bound query and
server-derived deep link) over the same WorkItem read model, not more activation proof. A hosted
probe proved that Miaoda API Key scopes match paths literally; the native `/openapi` wrappers now
use fixed paths plus a required `workItemId` query locally. Fixed-scope Key update, hosted
revalidation and Aily configuration remain pending.

---

## Historical assembly record

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
     `b3e7a20245af19349a8bfa9c0da995d5eeac6acf` through
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

Claim: the unique full-stack app candidate has a local host branch containing the source-level
composition with write-authoritative hosted providers unconfigured. The current local production
build and Unified composition pass; Registrar readiness remains `BLOCKED`, with write and
publication authority false. The DM owner refresh is verified only through the built local host and
two real FTD PDFs.

Non-claims for this refresh: no push, release, hosted POST, environment change, Base/FileService/
database/WorkItem/workflow mutation, current switch or engineering decision was performed. Earlier
DEV release history is not repeated or upgraded into a new acceptance claim.

## Only blocker

The remaining activation blockers are Master trust, permission fresh-read and explicit write
authority for the existing hosted providers. This local slice does not invent any of them. Until
the main controller supplies and verifies those ordinary runtime inputs, the app remains a
candidate and its mutation paths correctly stay locked.

## Local platform-adapter coverage

| Port                                        | Local host coverage                                                                                                       | Runtime status                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `RegistrarActivationArtifactStorePort`      | dedicated read-only FileService actual-byte adapter; returns configured store/bucket/adapter identity                     | implemented and unit-tested; not sufficient to activate Registrar                       |
| Registrar Master signature/trust            | none                                                                                                                      | `BLOCKED`; not implemented or simulated                                                 |
| Registrar sole-writer permission fresh-read | none                                                                                                                      | `BLOCKED`; not implemented or simulated                                                 |
| Registrar validation-write authorization    | none                                                                                                                      | `BLOCKED`; not implemented or simulated                                                 |
| Dedicated Registrar Base transport          | server-only tenant-access-token OpenAPI adapter for three-table search/create/update; business actor fields remain opaque | implemented and tested but not registered; dedicated app identity/scopes pending        |
| `ImmutableAcceptanceReceiptOwnerPort`       | receipt-only FileService actual owner plus Unified `b3e7a...` DI wrapper; default module remains unconfigured             | local adapter verified; runtime identity/store and external write authorization pending |
| Unified Python U0 Validator                 | existing hosted-verified adapter and ordinary `pythonModulePath` passthrough                                              | source/config retained; no online probe in this slice                                   |

No activation manifest, immutable acceptance receipt, signature, permission grant or validation-
write authorization is created by these adapters. This is a local composition improvement only;
there was no push, release, environment change or online I/O.

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
`3ebc61c0532c5ee04122a251464fc644d1238439` is now selectively assembled as an internal module.
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

## Post-Phase-2 local owner refresh

The host now consumes the owner-exported leading-slash canonicalization and the metadata/download
object binding from exact DM commit `3ebc61c0532c5ee04122a251464fc644d1238439`.
`updatedAt` is audit metadata only; this does not weaken bucket, canonical path, provider object ID
or actual-byte checks. The local two-PDF loop also preloads the first content-addressed object and
requires its reuse with zero upload and zero delete. Phase 2 is permanently stopped: no hosted
replay, release, environment change or online write is authorized or claimed by this refresh.

## Dedicated Registrar Base adapter local slice

The host now contains one unbound server-only Open Platform transport for WorkItems, Decisions and
ExecutionLogs. It uses `tenant_access_token`, not `ctx.userContext`, for Base calls. The existing
authenticated actor remains an unchanged business field, while the selected Registrar continues
to own authorization, append-only Decisions and CAS. The old generic client capability is not
consumed as a Registrar writer.

The transport is intentionally not in `AppModule`; placeholder configuration is exercised only by
unit tests. Binding still requires an exact dedicated app ID, record search/create/update
permissions, Base access, server-secret injection and the selected Registrar's exact field mapper.
This slice performs no network call, push, release, environment change, Base write or FileService
I/O.

## Immutable acceptance receipt owner local slice

One ordinary FileService-backed `ImmutableAcceptanceReceiptOwnerPort` now persists only bytes
already supplied after an external validation-write authorization decision. Its receipt bucket is
runtime-configured and its path is fixed from the raw SHA-256; it never accepts a client path.
`upsert=false` prevents overwrite, and both new uploads and existing-path reuse require a fresh
metadata read plus exact-byte download verification. Provider timestamps remain audit-only.

The owner has no signing, Master activation, write-authorization, WorkItem, CAS, currentness or
publication operation. Its runtime identity must not alias `CanonicalHubRegistrar`. It is exported
for the existing Unified `createImmutableAcceptanceReceiptOwnerProvider(owner)` composition but is
not wired in `AppModule`; the production-default owner remains explicitly unconfigured and makes
no FileService call. Detailed tests and integration inputs are recorded in
`docs/IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_LOCAL_ACCEPTANCE_20260814.md`.
