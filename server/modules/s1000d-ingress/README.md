# S1000D V1.1 ingress seam

This module is the narrow S1000D-specific seam for the existing WiseLink
canonical chain:

`DocumentVersion/SourceArtifact -> S1000D XML producer -> frozen.2 -> U0 -> scoped professional artifact -> WorkItem CAS -> Unified Reader`

It provides the S1000D-specific XML adapter inside the existing
professional-input package model. It does not add another package schema,
artifact store, Reader, database table or client.
`MiaodaS1000dDocumentSourceAdapter` reads the existing Document Management
records and FileService actual bytes. `S1000dIngressService` authorizes and
validates a server-produced candidate but has no Reader, correlation or
WorkItem-write dependency. The existing `CanonicalHostVerticalService` alone
correlates the attempt artifact, re-reads actual bytes, publishes current with
the existing WorkItem CAS and creates the existing Reader projection.

## Activation boundary

The module is composed by `AppModule`, but S1000D execution remains fail-closed
with HTTP 503 until a server-owned source-use authorizer is explicitly bound.
The production composition includes the existing Document Management source
adapter and the real XML producer; composition is not authorization or cloud
activation. A usable deployment also requires:

1. Document Management can create a current XML `DocumentVersion` and exact
   `SourceArtifact` without weakening its existing PDF path.
2. A server-owned source-use authorizer is explicitly bound. OEM-controlled
   input additionally requires both
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

The canonical vertical is the sole owner of persistence,
`ScopedProfessionalArtifactCorrelation`, professional-artifact actual-byte
readback, WorkItem CAS/current fresh-read and Reader projection. It rechecks
the exact running WorkItem after production and again before the final CAS.
Document/source drift stops before correlation; WorkItem drift stops before
publication. A lost final CAS leaves only immutable attempt artifacts under the
existing artifact-owner semantics and never changes current.

The unconfigured adapters fail with stable 503 errors. They never substitute a
contract fixture for the XML producer.

## Fixture nonclaim

The frozen.2 files under
`server/runtime-assets/technical-publication-parsed-package/v1-frozen-2/fixtures`
are repository-controlled synthetic contract fixtures. Tests use the actual
nine member bytes (DM/PM/DML/DDN/ICN/XSD) and mutate XML to prove that the
producer parses bytes rather than returning a prebuilt package. They prove
source binding, strict frozen.2 validation, correlation/CAS behavior and
SourceUnit/SourceRef Reader browse/query only. They are not OEM data,
production DM ingress evidence, general CSDB interoperability evidence or
authorization evidence.

The V1.1 parser is intentionally limited to the authorized Issue 4.2 shapes
exercised by that corpus. Local XSDs are identity/binding evidence, not a claim
of general XSD or BREX conformance. ICN bytes are bound and projected as an
asset reference; this change adds no multimedia renderer or transcoder.

The candidate status excludes authorization decision ids and direct work item,
request, DocumentVersion, package, artifact, unit and SourceRef identities, as
well as raw bytes, locators, XPath and XML element ids. S1000D applicability
remains source evidence only and is never projected as an aircraft installation
fact.
