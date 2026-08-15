# Immutable acceptance receipt owner — local acceptance

> **ARCHIVED / NON-RUNTIME EVIDENCE** — 本文不定义当前 Aily/WorkItem 主线。当前生产仍使用
> ordinary FileService actual-byte persistence/readback；本文的未装配 owner 试验不得被解释为
> 第二个 store、Registrar 或发布前置条件。

Date: 2026-08-14

## Outcome

The canonical host now contains one minimal FileService-backed implementation of the existing
Unified `ImmutableAcceptanceReceiptOwnerPort`. It consumes Unified source commit
`b3e7a20245af19349a8bfa9c0da995d5eeac6acf` without modifying that repository and is exported for
the existing `createImmutableAcceptanceReceiptOwnerProvider(owner)` DI wrapper.

This is an ordinary storage owner, not an authority. An external coordinator must fresh-read the
independent validation-write Decision/receipt before invoking it. The adapter itself does not
sign/verify Master activation, decide write authorization, create owned-receipt semantics, mutate
WorkItems, execute CAS, switch current or publish.

## Storage behavior

- bucket: dedicated and supplied by server runtime configuration;
- fixed prefix: `immutable-acceptance-receipts/sha256`;
- path: `<prefix>/<raw-sha256>.json`, derived only from actual bytes;
- media type: `application/json`;
- upload: `upsert=false`;
- reuse: allowed only when fresh metadata and downloaded bytes exactly match;
- verification: bucket, canonical path, provider object, length, media type, digest and every byte;
- `updatedAt`: audit-only, never identity.

The returned artifact is the existing `ImmutableReceiptArtifactDescriptor` with raw SHA-256. No
new contract, digest, baseline, gate, receipt type or authority was added.

## Runtime integration inputs

All values remain ordinary server runtime configuration. They are intentionally not frozen here.

| Environment key                                     | Input                                     |
| --------------------------------------------------- | ----------------------------------------- |
| `WL_RECEIPT_OWNER_CANONICAL_MIAODA_HOST_ID`         | exact canonical host ID                   |
| `WL_RECEIPT_OWNER_TENANT_ID`                        | exact tenant ID                           |
| `WL_RECEIPT_OWNER_ENVIRONMENT`                      | exact hosted environment                  |
| `WL_RECEIPT_OWNER_ROLE_RESOLUTION_REVISION`         | fresh role-resolution revision            |
| `WL_RECEIPT_OWNER_ROLE_RESOLUTION_FINGERPRINT`      | existing prefixed SHA-256 fingerprint     |
| `WL_RECEIPT_OWNER_CANONICAL_ARTIFACT_STORE_ID`      | selected package artifact store ID        |
| `WL_RECEIPT_OWNER_SOLE_REGISTRAR_SERVICE_PRINCIPAL` | exact Registrar service principal         |
| `WL_RECEIPT_OWNER_ID`                               | distinct immutable receipt owner identity |
| `WL_RECEIPT_OWNER_ADAPTER_REVISION`                 | selected adapter revision                 |
| `WL_RECEIPT_OWNER_STORE_ID`                         | selected receipt store ID                 |
| `WL_RECEIPT_OWNER_BUCKET_ID`                        | dedicated FileService bucket ID           |

Missing or placeholder identity leaves preparation `BLOCKED`; `CanonicalHubRegistrar` and the sole
Registrar service principal are forbidden as owner aliases. `AppModule` does not consume these
values yet, so the current default is still the existing unconfigured adapter with zero I/O.

## Local verification

Targeted tests cover:

- first upload and actual-byte readback;
- same-byte reuse with zero upload;
- same digest path containing wrong bytes;
- path, length and media-type drift;
- provider timestamp changes remaining non-identifying;
- missing outer/runtime composition yielding zero FileService I/O;
- owner/Registrar identity separation;
- exact use of the existing Unified DI wrapper.

## Claims and non-claims

Claim: the host-owned FileService persistence/readback port works with a pure local official-shape
FileService fake and fails closed on identity or byte drift.

Non-claims: no external validation-write Decision/receipt is selected; no owner/store identity is
frozen; no online FileService/Base/env access or mutation occurred; no AppModule wiring, WorkItem,
CAS, current switch, publication, push or release occurred.
