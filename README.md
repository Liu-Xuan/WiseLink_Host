# WiseLink 3.1｜工程资料与综合评估

This repository is the local source for the only current
`CANONICAL_HOST_CANDIDATE`:

- Miaoda app: `app_17bzc551rsg`
- App type: `full_stack`
- Branch: `codex/v3-1-canonical-host-candidate`
- Published releases: none
- Online business tables/files: none

It is a candidate assembly, not an activated hosted runtime. Every business provider stays
explicitly unconfigured by default. The application therefore fails closed instead of reading or
writing an old Base, old app, TDMS, AAmis, a demo store or a developer workstation.

## Current composition

The root app installs `CanonicalHostModule.forRoot()` before the fallback `ViewModule`, with every
effectful provider unconfigured. The previous app's runtime-probe module is deliberately not part
of this candidate.

The first page is `WorkItem > 文档与解析`. With no configured Registrar it shows an explicit locked
state and never falls back to sample data.

## Selective internal-module assembly plan

No second user application is created. The following owners attach to this host only through the
existing `CanonicalHostModuleOptions` / `UnifiedReaderModuleOptions` seams:

| Module owner | Files in this host | Provider seam | Phase-1 default |
| --- | --- | --- | --- |
| Document Management | `server/modules/canonical-host/canonical-host.module.ts` | `pdfProducerProvider`, plus an exact DM request adapter inside a future DM module | `UNCONFIGURED` |
| Registrar / WorkItem | same host module | `workItemRegistrarProvider` | `UNCONFIGURED` |
| Assessment Hosted Registrar activation | `server/modules/assessment-registrar/` | exact `bb73aac…` activation provider + three Base capabilities | `BLOCKED` before any Base I/O |
| Host authn/authz | `canonical-host.controller.ts` and host module | platform `@NeedLogin`, `authorizationProvider`, `permissionSnapshotProvider` | authn enforced; providers `UNCONFIGURED` |
| Canonical Miaoda binding | `canonical-entry-facade.service.ts` | `miaodaAppBindingProvider` | `UNCONFIGURED` |
| Unified Reader / Validator / ArtifactStore | `server/modules/unified-reader/` | `public-api.ts` supplies official FileService + exact Python U0 provider factories; existing Unified failure port remains the sole failure authority | all `UNCONFIGURED` |
| AEO specialist reader | Unified module only | `unifiedReader.aeoSpecialistReaderProvider` | `UNCONFIGURED` |
| Failure write authorization | host module | `failureValidationWriteAuthorizationProvider` | `UNCONFIGURED` |

The host does not import module implementation repositories wholesale. Each owner supplies one
Nest provider for the existing seam; the root app remains the only user-facing assembly.

## Next real vertical

After the 3.1 master selects the exact hosted provider bindings, the shortest runnable path is:

`DM exact request → same WorkItem Registrar → PDF producer → frozen.2 package → ArtifactStore → full Validator → bounded Reader → same Miaoda page`

Aily remains a later read-only status/query/deep-link façade over this same WorkItem. No provider,
database schema, FileService object, WorkItem or release is created by this preparation commit.

Implementation lineage: the host source was migrated from local commit
`23dbc9d72840478d9c7157025bdc6ed5722ac782`. Git metadata, `.spark` metadata, environment files,
old runtime probes and old application bindings were not migrated.

Assessment Hosted Registrar lineage is the exact clean source commit
`bb73aacfc4d883ce13fb6cc2fec6704057b98f24`. Only its hosted activation provider, existing
activation loader and the three Registrar Base capabilities are assembled here; the Assessment
workbench UI and unrelated services are not copied.

Unified hosted-consumption lineage is exact clean commit
`2d33803602fd0c92396c381bc4793ebc29bbd7f0`. This host consumes the official FileService provider
factory, the frozen.2 Python U0 Validator factory and their shared types. It does not copy Unified's
historical HTTP mutation surface, receipt owner or another FailureReport builder. Package writes
remain blocked before FileService I/O until a separately authorized validation-write path exists.
The Python adapter is retained for a later DEV runtime capability probe; it is not bound by the
default `AppModule`.
