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
| Host authn/authz | `canonical-host.controller.ts` and host module | platform `@NeedLogin`, `authorizationProvider`, `permissionSnapshotProvider` | authn enforced; providers `UNCONFIGURED` |
| Canonical Miaoda binding | `canonical-entry-facade.service.ts` | `miaodaAppBindingProvider` | `UNCONFIGURED` |
| Unified Reader / Validator / ArtifactStore | `server/modules/unified-reader/` | `unifiedReader.{artifactStoreProvider, fullU0ValidatorProvider, u0Frozen2FailureAdapterProvider}` | all `UNCONFIGURED` |
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
