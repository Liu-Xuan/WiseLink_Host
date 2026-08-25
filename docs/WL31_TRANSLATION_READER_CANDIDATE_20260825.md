# WL31 translation-reader mature source candidate (2026-08-25)

CANDIDATE_ONLY. This lane-local candidate does not claim Gate completion,
release readiness, cross-lane integration, EvidenceRef, ClosureDecision,
ActionReadiness, compliance signoff, or airworthiness approval.

## R08 contract source of truth

- Fresh-read command: `lark-cli docs +fetch --doc https://hv5zjf4j8yb.feishu.cn/docx/MA3fdjEycoISjHxptAqcsyxvn9b --revision-id -1 --scope outline --max-depth 1 --doc-format markdown --as user --jq '.data.document | {document_id, revision_id}'`
- Read back `document_id: MA3fdjEycoISjHxptAqcsyxvn9b`, actual latest
  `revision_id: 379` (latest known rev356/370 were only hints; the
  authorized revision command was re-run fresh at the start of this
  evidence-only follow-up and returned 379, superseding the earlier 370
  read-back). The 370→379 change is a G0-only material update: the
  professional migration contract semantics for this lane's
  translation/Reader work (the two independent consumption axes and the
  read-only status of old 0.10/0.11 material) are unchanged.
- Key applicable scope: 3.1 translation/Reader migration must keep
  `ownerSourceReaderConsumptionAllowed` and
  `bilingualTranslationConsumptionAllowed` as two independent consumption
  axes; old 0.10/0.11 material is read-only migration reference only.

## What this candidate implements

1. `server/modules/canonical-host/canonical-reader-consumption.ts` —
   pure two-axis derivation module.
   - Owner observation schema
     `wiselink.3_1.translation_owner_observation.v0.candidate` carries the
     owner's `currentConsumptionAllowed`, `currentnessGuardReason`,
     `productState`, unit counts, and SBD/TCP lineage.
   - Host-side binding is built from the current WorkItem projection only:
     SBD identity is the current parsed package; TCP lineage is null until
     Host projects one. Nothing is fabricated.
   - Fail-closed guards: unrecognized schema, document/revision mismatch,
     unexpected `sourceTruth`, owner consumption denied, currentness guard
     set, lineage identity mismatch (including unexpected TCP lineage),
     inconsistent unit counts, missing observation/binding. Every guard
     failure closes both axes and reports `failureReasons`.
   - Two axes are derived independently:
     `ownerSourceReaderConsumptionAllowed` (source reading projection) and
     `bilingualTranslationConsumptionAllowed` (requires
     `reading_aid_available` AND `pendingTranslationUnitCount === 0` AND the
     source axis). `translation_pending` keeps the source axis open with the
     bilingual axis closed; existing translation counts are displayed
     without promoting the bilingual axis.
2. `shared/api.interface.ts` — `CanonicalReaderProjection['translation']`
   is now a discriminated union: `UNAVAILABLE` / `BILINGUAL_READING_AID_AVAILABLE` /
   `SOURCE_CURRENT_TRANSLATION_PENDING` / `TRANSLATION_GAP`, carrying the
   two axes plus owner counts and product state.
3. `server/modules/canonical-host/canonical-translation-owner-observation.port.ts`
   — optional owner-observation port with an unconfigured fail-closed
   adapter. CANDIDATE_ONLY wiring note: the provider is deliberately NOT
   registered in `canonical-host.module.ts`; `CanonicalHostVerticalService`
   receives it via an `@Optional()` `@Inject` constructor slot (null in
   production DI today), so no shared module wiring is introduced by this
   candidate. A future lane that owns Host composition can register a real
   adapter against `CANONICAL_TRANSLATION_OWNER_OBSERVATION`.
4. `server/modules/canonical-host/canonical-host-vertical.service.ts` —
   `page()` derives the translation projection Host-side via
   `readTranslationConsumptionAxes`; unconfigured/failing owner reads fail
   closed to `TRANSLATION_PROJECTION_NOT_AVAILABLE`.
5. `client/src/pages/DocumentParsingPage/workbench-projection.ts` +
   `DocumentReaderWorkspace.tsx` — browser view-model consumes the
   Host-derived axes; it never re-derives an axis, matches translation rows,
   or treats `translation_pending` as bilingual readiness. Displays the
   `translation_pending` presentation (`原文阅读投影当前；译文待生成`) and
   shows both axis states verbatim.

## Tests

- New `test/unit/canonical-reader-consumption.spec.ts` (16 cases): both axes
  open; source-open/bilingual-closed for `translation_pending`; no bilingual
  promotion with pending units under `reading_aid_available`; fail-closed
  for schema/identity/sourceTruth/consumption/currentness/lineage/count
  mismatches; unexpected TCP lineage; missing observation/binding;
  `needs_inputs` gap.
- `test/unit/canonical-host-vertical.service.spec.ts` covers the Host wiring
  path: a configured owner-observation port fails closed on null observation
  and derives both axes open when the observation binds to the exact current
  package lineage; the unconfigured path fails closed to
  `TRANSLATION_PROJECTION_NOT_AVAILABLE`.
- `test/unit/canonical-host-workbench-projection.spec.ts` covers the client
  view model across all four translation union states.
- Targeted suite: `npx jest test/unit/canonical-reader-consumption.spec.ts
test/unit/canonical-host-vertical.service.spec.ts
test/unit/canonical-host-workbench-projection.spec.ts` all passing.
- Type checks: `npm run type:check:server` and `npm run type:check:client`
  both exit 0.

## Integration conflict domain (for Sol)

`shared/api.interface.ts` is the one shared file this candidate touches
(`CanonicalReaderProjection['translation']` union +
`CanonicalReaderTranslationProjection` types). It MUST be treated as a
serial integration conflict domain owned by Sol: other lanes editing the
same shared interface will conflict and must be merged serially under
Sol's coordination. No shared integration is complete or claimed here.

## Non-claims

- No owner translation transport is wired: the observation port's only
  adapter is the unconfigured fail-closed one, so every projection today
  reports `TRANSLATION_PROJECTION_NOT_AVAILABLE` until a real owner
  observation adapter is provided in a future lane.
- No TCP/SBD cross-package lineage proof beyond the binding built from the
  current WorkItem projection; `tcpPackageId`/`tcpContentHash` stay null
  until Host projects a TCP lineage.
- No old-runtime, second translation chain, shared wiring, protected/excluded
  scope, database, queue, provider call, push, deployment, or release.
- No claim that browser rendering matches owner translation rows; the
  browser only renders Host-returned axis states and counts.

## Blockers

None for the local candidate. The real owner observation adapter (R08 owner
transport) is future work outside this lane's scope.
