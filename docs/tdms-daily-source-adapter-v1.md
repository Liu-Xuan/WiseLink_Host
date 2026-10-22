# TDMS daily source receiver adapter v1

The existing three authenticated routes accept the collector's unchanged
`wiselink.tdms-daily-package.v1` envelope. AEO/EXECUTION_STATUS packages with empty
content and no artifacts retain their original metadata-only capture behavior.
Other supported source records use `wiselink.tdms-daily-native-adapter.v1` and the
existing `TdmsSourceService.importPrepared` transaction, repository, scoped
request uniqueness and native head CAS. There is no second repository or table.

Each wider capture retains the complete detached original envelope, its canonical
package digest, the adapter version, the deterministic native output and digest,
source identity mappings, and the actual native revision/assertion/candidate
acquisition refs from that same transaction. Snapshot IDs are native package item
IDs, never DM document-version IDs. Original source/business versions, authors,
locators, order, nulls, coverage and unknown query scope remain in the envelope.
The adapter explicitly rejects unsupported fields or limits; it does not trim a
package to its authorized subset. Existing limits (512 KiB and the native list
limits) remain enforced outside the explicit Complete1 modes below.

The source form mode `wiselink.tdms-owned-visible-business-content.v1` with
`tdms-independent-content-profiles@1` is an independently collected owner probe.
Its exact field order, owner/type/panel binding and two stable source reads are
validated. The bounded fields are stored as `ownedVisibleBusinessContent`, with
blank, absent, truncated and unread observations intact. They are not promoted
into approved opinions. The existing Estimated opinion mapper checks stay in
place. Separate form requests and same-version opinions remain separate retained
observations. Observed OR/VR edges become unresolved candidate assertions with
`nativeRelationId:null`; no number-based join or relation type is inferred.

The executed frozen 0.2.43 sender rejects `ownedBusinessContent` at its record
boundary. Its supported SB/AD packages and ten-key receipts remain compatible;
receipt compatibility does not make that sender able to submit owner probes.
The owner mode above is accepted only with its explicit schema/profile revision
from the source-only 0.2.44 contract. Local synthetic compatibility checks do not
prove that 0.2.44 is installed, has current source authority, or has imported data.

`POST /api/tdms-source-imports` returns the frozen client's exact ten-key receipt
only after persistence and exact capture readback. The same request returns the
same original receipt after current authorization; a changed body/digest or
conflicting capture is rejected. `GET /api/tdms-source-imports/:requestId` returns
that receipt and the complete original package. `GET /api/tdms-source-refs` accepts
one exact SourceRef; snapshot, field, relation and artifact reads return only the
matching immutable source literals and their exact dependencies. Multiple
captures for the same SourceRef are an explicit ambiguity, not a latest-head
selection. All returned dependencies are freshly authorized independently of the
old import grant.

## Remaining production bindings

The default `TdmsSourceModule` still uses `UnconfiguredTdmsSourceAuthorization`:
all three routes return `TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED` (503), before
storage or artifact resolution. A server integration must bind
`TDMS_SOURCE_AUTHORIZATION` through `TdmsSourceModule.register`, using actual
current TDMS source/scope/object audience decisions for the verified final user,
tenant and application. `HostDecisionTdmsSourceAuthorization` requires independent
current scope, import-member and read-member decisions and permission revisions;
it does not supply those decisions itself. Directory readability, a source
package, roles, environment flags, BridgeToken and Cookie are not substitutes.
No supported native TDMS decision provider is configured by this change.

Artifact declarations are not upload selections. The separately server-bound
`TdmsArtifactStore.resolveDailySelection` must supply the exact source-authorized
FileService selection. The existing `acquireSelection` then verifies the current
object and immutable candidate bytes. Missing transport is an explicit
`TDMS_DAILY_ARTIFACT_TRANSPORT_UNCONFIGURED` (503); a null source attachment identity
is preserved by preparation but rejected for materialization with
`TDMS_DAILY_ARTIFACT_IDENTITY_UNCONFIRMED` (503). The owner's source version is never
reused as an attachment version. An acquired candidate still returns a
`REVIEW_REQUIRED` document mapping, with null DM IDs and false formal-document
readback. This adapter does not register a formal DM document, parse, model,
adopt an opinion, verify execution, or dispatch an engineering task.

Production activation still requires the actual identity/session transport,
current native source-authority provider, source-authorized artifact transport,
and any later separately approved DM/source-intake bindings. Those missing seams
are not made successful by local fixtures or this source-only implementation.

## Complete1 own-part observations

The same daily v1 routes also retain the explicit `COMPLETE_OWN_SOURCE@1`
mode: `rawFields.completeOwnedSource` uses
`wiselink.tdms-owned-complete-source-observation.v1` and
`tdms-complete-owned-profiles@1`; `content.completeOwnedFields` retains the
ordered, typed source fields. The Host checks exact owner/type/version/context,
two stable reads, tab/section/field rosters, all eight presence states, relation
windows/counts/terminal evidence and their original target occurrences. The
comparison-only snapshot projection omits observed timing, relation traversal
windows, capture document identity, input discovery/expected-owner claims and
principal context beyond source origin. It normalizes only the reviewed generated
engineering detail-panel identifiers; unknown identifiers remain content. The
complete original envelope, all context and locators, and its request/output
digests still retain every original value.

Different original requests may share that content snapshot identity. Each
request still reads back its exact original envelope. The existing SourceRef
lookup rejects multiple matching captures with `TDMS_DAILY_REFERENCE_AMBIGUOUS`
instead of choosing one; this candidate does not change that v1 readback boundary.

The current own DTO also requires `technicalVersionFieldEvidence` separately
from a supported engineering header's `technicalVersionEvidence`. Engineering
own input retains its `classificationOperationId` for directory or required
relation targets. This proof is retained independently from a classification
observation and grants no source admission. Single-aircraft status accepts the
concrete native class evidence, and feedback keeps its exact native header/type
binding. Related-status column tokens and optional native status enumeration
proof are validated against their exact owner/version, counts and target links.
Execution dates and feedback references in that proof remain raw source
evidence, including TBD execution dates; they do not make execution verified.

The ordinary own-part stays one record, `PARTIAL` / `NON_ATOMIC`, with an unknown query
scope, no artifact bindings, and `COMPLETION_CERTIFICATE_NOT_ISSUED`. It neither
issues a composite source-completion certificate nor approves opinions or
execution. `Estimating` opinion fields must remain `NOT_APPLICABLE` with null
text. Independently captured assessments sharing a business revision remain
separate source identities and observations. Approved/Estimated source literals
are retained without becoming the existing approved-opinion mapper's output.

The related-only AD item retains its exact `WTChangeActivity2` identity as a
native `OBSERVATION`; complete-mode single-aircraft status and feedback also
use `OBSERVATION`, preserving their original daily kind and proof. The legacy
single-aircraft status fields and legacy opinion/body contracts are unchanged.
Observed edges still become `CANDIDATE_ONLY` / unresolved assertions with no
native semantic promotion.

Complete1 permits 850 KiB for its two-read observation and 2 MiB for the whole
request envelope or native package, with edge kinds up to 500 characters and
locators up to 700. Those limits require the strict complete-mode record and
package validation. Legacy modes retain their 512 KiB and original edge and
identifier limits. An over-limit object is rejected explicitly; no field,
window or original relationship is cropped into a successful import. Source authorization and nonempty artifact
transport still require the independent server bindings described above. An
attachment listed in the own read is source metadata, not collected original
bytes or a formal DM document version.

## Frozen 0.2.54 wire alignment

The current pure Complete1 DTO retains required `nativeReloadProvenance`, the
PRIMARY metadata observation, parent `linkIndex`, optional required-document
classification operation, native document header version and reviewed own-field
roles. A reload must replace the native document, bypass cache, settle twice and
finish before the source observation. Reload evidence remains in the saved
envelope and digest; only its comparison projection omits it. Reviewed user and
context references retain their raw own-field occurrences without emitting
business edges. Unknown field roles stay unknown. The native `已批准` state can
retain an own assessment literal, without mapping it to an adopted opinion.

`documentTargetClassification` and `engineeringClassification` validate their
own two native reads, exact owner/proof/version/context, disposition and snapshot
projection. Their native kinds are `OBSERVATION` and `ENGINEERING_FILE`,
respectively. Each is one `PARTIAL` / `NON_ATOMIC` observation with empty content,
edges and artifacts and `OWN_COMPLETE_CONTENT_NOT_READ`. An in-scope or
out-of-scope classifier result is not foreign complete content, source authority
or an inventory/completion certificate. Other unimplemented raw-field modes are
still rejected.

Only the typed `query.originalAcquisition` Complete1 branch permits one exact
PRIMARY binding for a declared owner/version. Its operation and receipt hash
remain source claims, not Host verification of those runtime operations. Native
Format Name selects PDF, ZIP, DOCX, XLSX or PPTX; filename suffixes do not select a
format. The marker, owner snapshot, ApplicationData identity, format, SHA,
length and binding version must agree. Ordinary own observations still forbid
artifacts. The adapter retains the marker through the normal FileService
selection path; the independent `resolveDailySelection` and current object/byte
verification are required. No formal document, parsing, model or adoption is
invoked.

Complete1 native relations permit 1000 edges to match the unchanged daily outer
limit; other native lists remain at 200. The validated derived-original
FileService core keeps its 2 MiB bound with at most 8 KiB of measured wrapper
overhead. The existing 100 MiB artifact-read budget remains unchanged. Other
modes retain their 512 KiB envelope and native relation limit of 200. Payloads
are rejected at their limits without trimming evidence.

This local alignment does not install 0.2.54, bind the default closed authority,
provide an authenticated collector receiver/session, select a FileService
object or prove `HostReceived`. The frozen v1 routes, ten-key receipt, SourceRef
readback, five-key sourceContext, current ACL/member checks, native head CAS and
GLM profile remain unchanged. Activation and real source acceptance still
require those independent bindings and actual source samples.
