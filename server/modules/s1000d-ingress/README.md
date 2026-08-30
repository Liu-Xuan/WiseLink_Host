# S1000D V1.1 ingress seam

This module is the narrow S1000D-specific seam for the existing WiseLink
canonical chain:

`DocumentVersion/SourceArtifact -> S1000D producer -> frozen.2 -> U0 -> UnifiedReader -> browser-safe projection`

It deliberately does not provide another XML parser, package schema, artifact
store, Reader, HTTP route, database table or client. `S1000dIngressService`
uses the existing `UnifiedReaderService`; `MiaodaS1000dDocumentSourceAdapter`
reads the existing Document Management records and FileService actual bytes.

## Activation boundary

The module is not imported by `AppModule`. Production activation remains
blocked until both owner seams exist:

1. Document Management can create a current XML `DocumentVersion` and exact
   `SourceArtifact` without weakening its existing PDF path.
2. A production S1000D producer and a server-owned source-use authorizer are
   explicitly bound. OEM-controlled input additionally requires both
   processing and browser-redistribution evidence.

The unconfigured adapters fail with stable 503 errors. They never substitute a
contract fixture for a production producer.

## Fixture nonclaim

The frozen.2 files under
`server/runtime-assets/technical-publication-parsed-package/v1-frozen-2/fixtures`
are repository-controlled synthetic contract fixtures. Tests use their actual
bytes to prove source binding, strict frozen.2 validation, SourceUnit/SourceRef
readback and browser sanitization only. They are not OEM data, production DM
ingress evidence, CSDB interoperability evidence or authorization evidence.

The browser read model excludes raw source bytes, FileService/package artifact
locators, XPath and XML element ids. S1000D applicability remains source
evidence only and is never projected as an aircraft installation fact.
