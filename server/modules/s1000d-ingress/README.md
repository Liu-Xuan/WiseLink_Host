# S1000D V1.1 ingress seam

This module is the narrow S1000D-specific seam for the existing WiseLink
canonical chain:

`DocumentVersion/SourceArtifact -> S1000D producer -> frozen.2 -> U0-validated candidate`

It deliberately does not provide another XML parser, package schema, artifact
store, Reader, HTTP route, database table or client. It also does not persist,
correlate, mutate a WorkItem or create a Reader projection.
`MiaodaS1000dDocumentSourceAdapter` reads the existing Document Management
records and FileService actual bytes; `S1000dIngressService` only proves that a
server-produced candidate passes the existing full U0 frozen.2 validator.

## Activation boundary

The module is not imported by `AppModule`. Production activation remains
blocked until both owner seams exist:

1. Document Management can create a current XML `DocumentVersion` and exact
   `SourceArtifact` without weakening its existing PDF path.
2. A production S1000D producer and a server-owned source-use authorizer are
   explicitly bound. OEM-controlled input additionally requires both
   processing and browser-redistribution evidence.

Authorization covers the complete frozen.2 `source.artifactIds` set, not only
the entry DMC. Every DM/PM/delivery object/schema/ICN needs one exact Host
source-artifact binding and one dependency path to the unique primary
DocumentVersion. Unknown, duplicate, unbound or cyclic dependencies fail before
U0. Every SourceRef must also target an artifact in that exact authorized
source set.

After producer completion the adapter fresh-resolves the current
DocumentVersion again and compares document, version, SourceArtifact, provider
object, byte identity and FileService locator with the initial read. Any drift
fails with `S1000D_DOCUMENT_VERSION_DRIFT` before U0. Because this adapter has
no write-capable dependency, rejection has zero canonical persistence,
correlation, WorkItem state or Reader side effects.

The canonical vertical remains the sole future owner of persistence,
`ScopedProfessionalArtifactCorrelation`, professional-artifact actual-byte
readback, WorkItem CAS/current fresh-read and Reader projection. Until that
owner integrates this candidate seam, successful output is only a minimal
browser-safe validation status and cannot be treated as canonical ingestion.

The unconfigured adapters fail with stable 503 errors. They never substitute a
contract fixture for a production producer.

## Fixture nonclaim

The frozen.2 files under
`server/runtime-assets/technical-publication-parsed-package/v1-frozen-2/fixtures`
are repository-controlled synthetic contract fixtures. Tests use their actual
bytes to prove source binding, strict frozen.2 validation and read-only
SourceUnit/SourceRef Reader inspection only. They are not OEM data, production
DM ingress evidence, CSDB interoperability evidence or authorization evidence.

The candidate status excludes authorization decision ids and direct work item,
request, DocumentVersion, package, artifact, unit and SourceRef identities, as
well as raw bytes, locators, XPath and XML element ids. S1000D applicability
remains source evidence only and is never projected as an aircraft installation
fact.
