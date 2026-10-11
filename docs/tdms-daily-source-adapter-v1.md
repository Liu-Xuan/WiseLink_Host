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
limits) remain enforced.

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
