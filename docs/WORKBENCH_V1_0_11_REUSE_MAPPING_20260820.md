# Workbench V1 / WiseLink 0.11 reuse mapping

This is an implementation inventory, not a new contract, baseline, endpoint,
or completion claim. WiseLink behavior was inspected from
`codex/0-11@77615d745eb999e89caf0a0c4bcd29d8712d33e8` and confirmed with the
Translation owner. Host starts from
`codex/host-p0-object-authz@981a107fcea0292e5dbe95c1cf1f3ca9901b0738`.

There is no independent `0.1.1` or `v0.1.1` ref. `0.11` names the WiseLink
line above; this Host branch does not switch to it.

## Reuse boundary

The Host must reuse these existing owner reads after their bounded transport
and DTO are frozen:

- Workbench summary:
  `GET /api/0.10/documents/:documentId/document-analysis-workbench?delivery=reader-summary`
- translation rows:
  `GET /api/0.10/documents/:documentId/translation-display?delivery=reader`
  or the owner-paged `delivery=translation-page` surface
- structured Reader, ProductBootstrap, Knowledge Workspace, Applicability,
  and Data Pipeline owner projections for the same document/revision

This change does not call those routes, proxy them through Host, add a second
endpoint, bind an unfrozen Host Skills DTO, calculate KDV, or copy the
translation/applicability evaluators.

## Translation state mapping

`currentConsumptionAllowed` is the owner flag for a current, source-bound
reading projection. It is not a synonym for "translated text is ready".
Workbench must preserve the owner's original `productState` and
`currentConsumptionAllowed`, then derive two non-interchangeable display axes:

```text
ownerSourceReaderConsumptionAllowed =
  owner.currentConsumptionAllowed &&
  current SBD/TCP/source/identity/locator guards pass

bilingualTranslationConsumptionAllowed =
  ownerSourceReaderConsumptionAllowed &&
  owner.productState === "reading_aid_available" &&
  owner.pendingTranslationUnitCount === 0
```

| Owner product state | Owner reading projection | Translated text | Workbench presentation |
| --- | --- | --- | --- |
| `reading_aid_available` | may be consumable only when every currentness and identity guard below passes | available for the translation-required units represented as complete by the owner counts | show the owner-provided bilingual reading aid |
| `translation_pending` | may remain consumable when the current SBD/TCP source-only reading projection is valid | not ready for pending units | show `原文阅读投影当前；译文待生成`; if some translations exist, show the owner count without promoting the bilingual axis |
| `needs_inputs` | not consumable | not consumable | visible GAP with zero rendered owner rows |

The exact guards are:

- the delivery and nested owner schemas are recognized owner schemas;
- document ID and revision ID exactly match the selected owner document;
- `sourceTruth` is exactly `StructuredBilingualDocument.units`;
- the owner explicitly sets `currentConsumptionAllowed=true` and does not set
  a source-truth/currentness guard;
- SBD and TCP package identities and source-package hashes match the current
  DTI -> SBD -> TCP lineage; package presence alone is insufficient;
- the SBD/TCP effective states are non-stale and non-blocking;
- every rendered unit retains the exact owner `unitKey`, `sourceUnitId`,
  `sourceRef`, `sourceHash`, `sourceTextHash`, `targetLocale`, locator summary,
  and bounded context identity;
- `translatedUnitCount`, `pendingTranslationUnitCount`,
  `translationRequiredUnitCount`, and each unit's translated-text state remain
  owner-provided and mutually consistent.

Missing, mismatched, stale, blocked, or unrecognized fields fail closed. The
browser must not match translation rows, derive a locale, reconstruct a
locator, or reinterpret `translation_pending` as bilingual readiness. The
owner's `translation-display?delivery=reader` returns the complete slim unit
set without provider progress; `delivery=translation-page` provides bounded
paging plus provider progress. Workbench summary remains
`document-analysis-workbench?delivery=reader-summary` and contains no rows.

## Exact source-locator binding

Scheme validation is insufficient. Before a future adapter can claim a
controlled source locator is current, it must bind it to the exact
ProductBootstrap owner document:

```text
sourceBinding.sourceLocator
  === documentDetail.controlledPdfPreviewUrl

sourceBinding.frozenArtifactLocator
  === "frozen.2://controlled-pdf/" +
      documentDetail.controlledPdfFileAssetId
```

The same owner projection must also match `documentId`, `revisionId`, raw
source SHA-256, byte length, controlled preview availability, and current
DAP/SPP identity. Through the single owner bundle, every unit locator must
resolve exactly as `sourceRefId -> artifactId -> source artifact SHA-256 and
byteLength`, then retain owner `pageStart/pageEnd`, `charStart/charEnd`, and
`anchorTextHash`. Visual locators additionally retain exact `blockId`,
`pageIndex`, `bbox`, `coordinateSpace`, and `locatorPrecision`.

Correct scheme plus wrong document, revision, artifact, package, document
path, asset ID, query, fragment, alias, encoding, page, character range, or
visual locator must be rejected. Host DM and LibraryIndex cannot fill a
missing owner locator.

## Applicability boundary

Applicability remains a GAP until the owner projection proves all of:

- `sourceTruth=ApplicabilityEffectiveProjection`;
- `matrixTruth=ApplicabilityTargetMatrix`;
- `directParserApplicabilityConsumptionAllowed=false`;
- parser fields remain candidate-only;
- downstream boundary is `consumable_candidate` and current consumption is
  explicitly allowed.

Parser trace counts cannot be promoted to an applicability result. This change
does not implement a Translation or Applicability data model.

## Existing Host safety behavior retained

The baseline already owns and tests these behaviors; this mapping does not
replace them:

- actor change immediately projects page `data=null`, then identity epoch
  checks discard any late response from the previous actor;
- direct-ID 403/404 responses normalize to the same not-found boundary before
  a full projection is loaded;
- recent WorkItem metadata is scoped by exact tenant/user identity and is
  removed after direct-ID denial;
- the browser renders only server-returned SourceRef/locator values;
- deep links keep the Host-generated allowlisted base.

`e834463` is not included. No production binding, API, database, queue,
provider call, push, deployment, or release is part of this mapping.
