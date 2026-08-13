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
