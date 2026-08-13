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
