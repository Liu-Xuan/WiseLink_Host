# Assessment Registrar hosted source

- source owner repository: `sb-job-aid-reuse-supersede`
- source owner commit: `bb73aacfc4d883ce13fb6cc2fec6704057b98f24`
- host app candidate: `app_17bzc551rsg`
- hosted store candidate: `VorbbDXAkaHbLMsUTV2cBCW5nRd`
- mapped tables: WorkItems `65` fields, Decisions `28`, ExecutionLogs `17`
- module role: optional internal Registrar provider; not a second workbench or user application

The provider and activation implementation are consumed from the exact owner commit. The host does
not synthesize Master trust, permission or write receipts. With ordinary providers only and those
inputs absent, readiness is intentionally `BLOCKED` and `writeAuthorized=false` before Base I/O.
This local refresh performs no online read, record write, workflow call, push or release.

The host now supplies one ordinary read-only FileService adapter for
`RegistrarActivationArtifactStorePort`. It resolves only the configured artifact-ref namespace,
reads actual bytes from the configured bucket, and returns the configured store ID, bucket ID and
adapter revision. It exposes no upload, delete, signature, permission or authorization operation.
This adapter is deliberately distinct from Unified's package-descriptor adapter because Registrar
activation consumes exact Master artifact refs rather than package descriptors. The remaining
three Registrar ports—Master signature/trust, sole-writer permission fresh-read and validation-write
authorization—are still absent, so the hosted Registrar remains `BLOCKED` and the read adapter is
not enough to activate it.

## Dedicated Open Platform Base transport

`dedicated-registrar-base.adapter.ts` adds a server-only, deliberately unbound transport for the
three selected Registrar tables. It obtains a `tenant_access_token` from a dedicated Open Platform
application and exposes only record search, single-record create and single-record update.

The adapter uses ordinary runtime configuration for the app ID, server secret, official token/API
endpoints, Base token and three table IDs. The secret is sent only to the token endpoint; stable
errors do not include upstream messages. Tokens are cached by their returned expiry and refreshed
once after a `401`; `403`, `429`, upstream `5xx` and network failures remain explicit.

This transport never receives `userContext`: authenticated business actors remain unchanged fields
supplied by the existing `@NeedLogin`/Decision layer. It does not create Decisions, choose a CAS
version or grant append-only authority. It is not registered in `AppModule`, so the host remains
zero-write while the dedicated app identity, permissions and exact business mapper are pending. No
generic `feishu-bitable` client capability is used as the Registrar writer.
