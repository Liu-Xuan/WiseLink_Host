# TDMS daily metadata receiver

The frozen collector routes are registered in `TdmsSourceModule`:

- `POST /api/tdms-source-imports` accepts exactly `{ requestId, package }`.
- `GET /api/tdms-source-imports/:requestId` returns the stored receipt and exact package.
- `GET /api/tdms-source-refs?sourceRef=...` reads one exact snapshot, field or observed edge.

All routes require the existing hosted native final-user ingress. Login establishes the actor, tenant and application binding; it does not establish TDMS source permissions. The default `UnconfiguredTdmsSourceAuthorization` rejects all three operations with `503 TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED`, without accessing storage. Adding these routes does not configure an actual permission provider or import any collector data.

## Authority binding

The supported server composition entry is `TdmsSourceModule.register({ authorizationProvider })`, with the exact `TDMS_SOURCE_AUTHORIZATION` token. The current `AppModule` still imports the default closed module. There is no HTTP self-grant route, environment switch, package ACL, owner or role fallback.

A real provider must freshly establish the native actor's tenant/application identity, current application admission, exact TDMS source instance/scope and current capabilities from an independent authority. The collector body contains no trusted scope selector. Import requires exactly one current TDMS scope; absence fails closed and multiple scopes return `409 TDMS_DAILY_SOURCE_SCOPE_AMBIGUOUS`.

`authorizeImport` must independently admit retention of every exact record and observed edge. Its existing retention/member/revision checks remain required. A nonempty package claim is not an admission. Missing members reject the whole package; nothing is trimmed. The adapter creates no native record heads, relationship assertions, artifacts or document mappings.

Reads require current `READ_HISTORY` or `READ_RECORD` scope authorization and the independent `authorizeReadMembers` port. `HostDecisionTdmsSourceAuthorization` accepts a third server-bound decision reader for this port; an absent reader returns `503 TDMS_READ_MEMBER_ADMISSION_UNCONFIGURED`. Its admission must include `retainedCaptureReadAllowed`, a current permission revision, authority reference, and all returned records and observed edges. Prior import rights are never substituted for read rights. The inactive shared-foundation first slice does not yet support these daily record kinds or nonempty observation claims; binding it unchanged cannot grant the daily package.

To restore real operation, first identify and verify an actual current source/scope/member decision service, then bind its independent readers through the server module. Supply the collector a supported native authenticated Host transport, preserving the gateway identity rather than exporting or fabricating cookies/headers. Verify the existing capture schema and platform-managed native database policies through the approved development/release process. Validate a current denied principal and an admitted principal before submitting the preserved request once; an unknown outcome is resolved by the same request's readback. A grant/provider or production schema cannot be inferred from this candidate's local tests.

## Persistence and limits

The full detached envelope and exact ten-key receipt are stored in the existing immutable `tdms_capture.data`. The scoped `package_id` storage key is the collector `requestId`; the original package ID remains unchanged inside the envelope. The existing unique insert is the request CAS. A receipt is returned only after actual transaction persistence, exact stored readback and fresh authorization checks. A later authorization failure can leave a retained immutable capture while withholding the response; it must not be treated as proof of rollback.

Same admitted request/envelope/creator/application replays the same receipt. Different binding, conflicting digest or corrupt stored data rejects. Request readback binds the original creator; another currently authorized reader may read an exact SourceRef only through its own fresh member decisions. Exact SourceRef membership uses parameterized `jsonb_exists`, with all four source-scope columns. If a reference occurs in multiple captures or scopes, this bounded receiver returns `409 TDMS_DAILY_REFERENCE_AMBIGUOUS`; it does not choose a head/latest capture or merge histories.

Snapshot/field responses retain their recorded related observations only when their exact snapshot IDs match. OR/VR endpoints are not joined by number or guessed identity. Null native relations, `observed_unresolved`, raw technical/business versions, `PARTIAL`, `PROBE_ONLY`, `NON_ATOMIC`, query gaps and source values remain intact. A successful metadata import does not independently verify native relations, execution, completeness, publication recency or engineering evidence authority. Controlled artifact ingestion and engineering evidence acquisition remain separate operations.

Local synthetic authority and physical PostgreSQL tests prove adapter behavior and request concurrency only. They do not configure production source permissions. Real collector outbox replay is private and retains its unresolved coverage; no private identifiers or metadata are embedded in public tests.
