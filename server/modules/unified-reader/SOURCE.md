# Unified hosted source

- source owner repository: `v3-1-unified-real-http-vertical`
- current consumed owner commit: `b3e7a20245af19349a8bfa9c0da995d5eeac6acf`
- U0 contract commit: `fa69ada08265934951df53c7a61a3ccdb8cb2900`
- runtime role: internal Unified Reader/Validator module of the one canonical host candidate

The host consumes the existing public provider factories, including ordinary
`pythonModulePath` passthrough to the existing Python U0 adapter. The vendored hosted U0 runtime
configuration that already passed the hosted probe is unchanged.

`createImmutableAcceptanceReceiptOwnerProvider()` is a DI wrapper for a platform-selected
`ImmutableAcceptanceReceiptOwnerPort`; it is not an owner implementation and does not grant write
authority. The canonical host has no validation-write-controlled receipt owner in this local
slice, so `UnifiedReaderModule.forRoot()` binds the explicit unconfigured adapter and readiness
reports `IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_NOT_CONFIGURED`. No manifest or receipt is generated.

The existing exact Unified FailureReport authority remains unchanged. Historical HTTP mutation
routes and a second Validator/Reader/failure authority are not imported into this host.

## Host-owned immutable acceptance receipt storage

The host now provides one local `FileService` implementation of
`ImmutableAcceptanceReceiptOwnerPort`. It uses a receipt-only bucket and the fixed
`immutable-acceptance-receipts/sha256/<raw-sha256>.json` namespace. Uploads set
`upsert=false`; an existing digest path is reused only after metadata and actual downloaded bytes
match exactly. The returned descriptor uses the existing raw SHA-256 and
`ImmutableReceiptArtifactDescriptor` type. Provider timestamps are audit-only.

The adapter does not build an owned receipt, sign or verify Master activation, authorize a write,
mutate a WorkItem, perform CAS, select current or publish. The external coordinator must first
fresh-read its independent validation-write Decision/receipt and only then invoke this owner. This
implementation is exported through `public-api.ts` and is compatible with the existing
`createImmutableAcceptanceReceiptOwnerProvider(owner)` wrapper, but it is not registered in
`AppModule`. Missing exact runtime identities/bucket configuration therefore leaves the current
explicit unconfigured owner in place and performs zero FileService I/O.
