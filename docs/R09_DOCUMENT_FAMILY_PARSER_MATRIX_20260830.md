# R09 host-native engineering PDF family matrix (2026-08-30)

## Scope and evidence rule

This matrix describes the document-family producer work derived from exact
integration parent `b964d4bf88a8989dd4b460edde382f5900b873f5`. A row is
`PROFILE_PIPELINE_VERIFIED` only when actual source bytes pass through the
production profile/producer logic, the single pdfjs layout extractor, the
professional-input frozen.2 builder, the U0 strict validator, and the Unified
Reader. Except for the separately reported FTD integration replay, these tests
use FileService, DocumentVersion/SourceArtifact resolver, and correlation-port
doubles with realistic identities. They do not prove that production Hosted
Core ingested and persisted that same file into the real DV/SA owner chain.

The controller now reports post-OCR integration current `93860a3d…`, which
already contains the accepted first family slice and OCR owner changes. This
successor remains based on `ea557b107…` / b964 and must be replayed semantically
onto that current state. The replay must retain the current FTD packageId
correction and the OCR owner's authoritative page-level failure contract.

Profile recognition uses the controlled Document Management family plus actual
PDF title/text and the existing `DocumentFamilyAdapterRegistry`. Subtypes added
by the successor also require the matching adapter release already committed by
DM preflight; the producer re-recognizes it from the actual PDF before producing
a package. Filename, file SHA-256, byte length, and a single document number do
not activate a profile. Unknown, unactivated, missing-release, and contradictory
identities remain `PDF_PRODUCER_PROFILE_NOT_AVAILABLE`.

The b964 technical census covers 401 PDFs: 393 have text on every page, 6 have
no text on any page, and 2 have a partial text layer. Those counts are intake
diagnostics, not a claim that 401 PDFs have migrated profiles or correct
structured packages.

## First vertical slice

| Family / identity  | Real source                                                                   | Text-layer evidence                                                                                         | Current result                                                                                      | Evidence / boundary                                                                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boeing FTD         | `FTD/777-FTD-31-21002_Doc_09262025.pdf` (`b1b5c198…`, 5 pages)                | 5/5 pages                                                                                                   | **PRODUCTION DM CHAIN VERIFIED AFTER CONTROLLER REPLAY** — `issuer.boeing.ftd.v1` / `boeing.ftd.v1` | The port test passes producer/frozen.2/U0/Reader. The controller separately replayed this change with its accepted DM helper and proved DM-created DV/SA → production FTD profile → 196 content units / 197 source refs → U0/Reader. The cover matcher accepts split pdfjs runs and rejects a bare FTD cross-reference. |
| Boeing SB          | `SB/机身/BOEING/2026/202605/737-34-3830 Original.pdf` (`add32c7d…`, 22 pages) | Pages 7 and 21 are `VISUAL_TEXT_UNVERIFIED`                                                                 | **PROFILE RECOGNIZED / OCR REQUIRED** — `issuer.boeing.service_bulletin.v1` / `boeing.sb`           | The source/content identity remains recognizable, but current post-OCR extraction fails `PDF_OCR_REQUIRED_UNSUPPORTED`. No pre-OCR package/Reader pass is retained as whole-file success; a real OCR provider must resolve both pages first.                                                                            |
| Boeing SB          | `SB/机身/BOEING/2026/202604/777-34-0425.pdf` (`3a99b7a4…`, 18 pages)          | 18/18 pages                                                                                                 | **PROFILE_PIPELINE_VERIFIED** — same Boeing SB profile                                              | A different Boeing model/document proves the profile is not the former exact-737 allow-list. This remains port-double pipeline evidence, not production DM ingestion evidence.                                                                                                                                          |
| Airbus SB          | `SB/机身/AIRBUS/2026/202601/A320-23-1837 R04.pdf` (`91e19da0…`, 444 pages)    | 444/444 pages                                                                                               | **PROFILE_PIPELINE_VERIFIED** — `issuer.airbus.service_bulletin.v1` / `airbus.sb`                   | Actual 444-page bytes produce a package that passes frozen.2/U0 and Reader. This does not assert figure/table semantic fidelity beyond the current layout/source-unit contract.                                                                                                                                         |
| Boeing SL          | `SL-777-45-006.pdf` (`5cc88899…`, 11 pages)                                   | Page 9 is `VISUAL_TEXT_UNVERIFIED`: 554 text chars; 2 unverified raster regions; page-area union `0.282093` | **PROFILE RECOGNIZED / OCR REQUIRED** — `issuer.boeing.service_letter.v1` / `boeing.sl`             | Family/content identity still recognizes the SL profile, but current post-OCR extraction correctly fails `PDF_OCR_REQUIRED_UNSUPPORTED`. No package-success or whole-file completion is claimed until a real OCR provider resolves page 9.                                                                              |
| FAA AD             | `AD/AD2011-03-14/AD2011-03-14.pdf` (`b2b56ba9…`, 10 pages)                    | 10/10 pages                                                                                                 | **PROFILE_PIPELINE_VERIFIED** — `issuer.faa.airworthiness_directive.v1` / `faa.ad`                  | Family/content identity prevents the referenced Boeing Alert SB from stealing the directive profile.                                                                                                                                                                                                                    |
| Boeing Alert SB    | No dedicated real sample in this change                                       | Not evaluated                                                                                               | **REGISTRY-RECOGNIZABLE, ORDINARY CLASSIFICATION UNREACHABLE**                                      | Ordinary `{family: SB, issuer: BOEING}` cannot select `boeing.asb` without a subtype-bearing DM classification. The ASB adapter is not in the activated production definitions.                                                                                                                                         |
| EASA AD / CAAC CAD | No dedicated real samples in this change                                      | Not evaluated                                                                                               | **CLASSIFICATION MAPPED, NOT REAL VERIFIED**                                                        | Natural actual-byte pipeline evidence and a production Hosted Core owner-chain replay are still required.                                                                                                                                                                                                               |

## Successor profiles selected from the real corpus

Every row below was selected by the existing registry from controlled family,
issuer, and actual title/content. The matching committed DM adapter release is
required to distinguish identities that share an ordinary family such as `SB`
or `MT`; removing or contradicting it fails closed before package production.

| Family / identity        | Real source                                                              | Text-layer census | Current result                                                                                                        | Ordinary document type / exact boundary                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Honeywell supplier SIL   | `…/SIL D201908000037 R4.pdf` (`fd12b19c…`, 4 pages)                      | 4/4               | **PROFILE_PIPELINE_VERIFIED** — `issuer.honeywell.sil.v1` / `honeywell.sil`                                           | `service_information_letter`; issuer-specific overlay extends the existing generic SIL adapter.                                                          |
| Boeing Maintenance Tip   | `SB/机身/BOEING/2026/202603/787 MT 51-001-R3.pdf` (`cf622421…`, 6 pages) | 6/6               | **PROFILE_PIPELINE_VERIFIED** — `issuer.boeing.maintenance_tip.v1` / `boeing.maintenance_tip`                         | `maintenance_tip`; matcher accepts pdfjs spacing such as `787 MT 51 - 001 - R 3` without using the filename or this one code.                            |
| Airbus RIL               | `…/RIL V27M24001856 R03.pdf` (`c4e55c4c…`, 7 pages)                      | 7/7               | **PROFILE_PIPELINE_VERIFIED** — `issuer.airbus.retrofit_information_letter.v1` / `airbus.retrofit_information_letter` | `retrofit_information_letter`; requires the committed RIL adapter release instead of treating every Airbus `SB` family row as a Service Bulletin.        |
| Airbus AOT               | `…/AOT-A32N033-24 R03.pdf` (`1170448b…`, 43 pages)                       | 43/43             | **PROFILE_PIPELINE_VERIFIED** — `issuer.airbus.operator_transmission.v1` / `airbus.operator_transmission`             | `operator_transmission`; selected from content, not the surrounding `SB/` directory.                                                                     |
| Airbus OIT               | `…/OIT-999-0013-26-00.pdf` (`883318ad…`, 2 pages)                        | 2/2               | **PROFILE_PIPELINE_VERIFIED** — same operator-transmission profile                                                    | `operator_transmission`; independent actual cover and Reader proof.                                                                                      |
| Airbus FOT               | `…/FOT-999-0062-25 R00.pdf` (`29a9fdb6…`, 2 pages)                       | 2/2               | **PROFILE_PIPELINE_VERIFIED** — same operator-transmission profile                                                    | `operator_transmission`; independent actual cover and Reader proof.                                                                                      |
| Airbus SBIT-named upload | `…/SBIT-24-0015 R03.pdf` (`22edaded…`, 2 pages)                          | 2/2               | **PROFILE_PIPELINE_VERIFIED** — same operator-transmission profile                                                    | The actual cover identifies an OIT; the profile follows source content and DM adapter release rather than the upload filename.                           |
| Airbus ALS               | `…/A320s ALS Part 3 Variation 11.1.pdf` (`14cc2b9d…`, 3 pages)           | 3/3               | **PROFILE_PIPELINE_VERIFIED** — `issuer.airbus.maintenance_programme.v1` / `airbus.maintenance_programme`             | `maintenance_programme`; actual ALS title/content is required.                                                                                           |
| Airbus ETOPS CMP         | `…/A330 ETOPS CMP R39.pdf` (`aca18135…`, 103 pages)                      | 103/103           | **PROFILE_PIPELINE_VERIFIED** — same maintenance-programme profile                                                    | `maintenance_programme`; actual 103-page bytes pass producer/frozen.2/U0/Reader. This is not a claim that all CMP tables are semantically reconstructed. |

## Real files deliberately not presented as completed

| Identity                          | Real source and census                                                     | Current result                                               | Exact gap / owner                                                                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AEO engineering PDF               | `AEO-B787-46-0012-R00.pdf` (`d05004b6…`, 11/11 text pages)                 | **PROFILE_NOT_AVAILABLE**, verified with actual pdfjs layout | No canonical AEO family/documentType/profile mapping exists here. It is not coerced into SB. Formal AEO approval/publishing is outside this task; the taxonomy/contract owner must define an independent mapping.                       |
| AMM-linked response               | `80217647_009.pdf` (`6b7ec765…`, 2/2 text pages)                           | **PROFILE_NOT_AVAILABLE**, verified with actual pdfjs layout | This is a dossier/final-answer response linked to an AMM task, not an independent AMM or task card. A response taxonomy is required before activation.                                                                                  |
| Airbus TCI with missing page text | `…/AME25008-TCI-A01 R00.pdf` (`606d9a6d…`, 12/13 text pages; page 1 empty) | **WITHHELD / OCR AND TAXONOMY BLOCKED**; no package evidence | Directory placement is not SB identity and content is TCI. The OCR owner alone owns page diagnostics and `PDF_OCR_REQUIRED_UNSUPPORTED`; the taxonomy owner must map TCI. This lane creates no partial package or empty `sourceRefIds`. |
| Airbus TFU                        | `…/TFU 31.39.00005 …pdf` (`46128712…`, 16/16 text pages)                   | **PROFILE_NOT_AVAILABLE**, actual negative test              | The existing broad `issuer.airbus.support_document` registry adapter is recognizable but no explicit ordinary support-document type/classification is activated.                                                                        |
| Airbus Concession                 | `…/B-32QQ Concession.pdf` (`cc43a7e2…`, 6/6 text pages)                    | **PROFILE_NOT_AVAILABLE**, actual negative test              | Same unresolved support-document taxonomy. The broad adapter also covers AME-like inputs, so activating it without a narrower contract would cross the OCR/TCI boundary.                                                                |

## Production DM identity seam

Only the FTD sample currently has end-to-end production DM owner-chain evidence.
In that replay, catalog/preflight correctly identify 777 and 5 pages, while the
ordinary selection path still exposes legacy `normalizeUploadDescriptor`
defaults for a 787 document and 6 pages. Actual AD, SL, Boeing SB, and Airbus SB
cannot yet commit production DM identity without metadata injection. This
profile change neither injects runner metadata nor changes ingress defaults.
The next owner must repair production DM classification/identity commitment so
the source/content adapter becomes authoritative only after a valid DV/SA and
committed preflight identity exist, then replay each actual family through the
same owner chain.

## Explicit nonclaims

- These slices are not 401/401 coverage and do not claim every SB, SL, SIL, AD,
  FTD, MT, issuer, or subtype is supported.
- Apart from the separately reported FTD replay, actual-file tests prove only
  profile selection and producer/frozen.2/U0/Reader with FileService/DV/SA port
  doubles. They do not prove production Hosted Core ingestion or persisted
  owner-chain identity for the other families.
- A present text layer does not prove complete semantic parsing, correct table
  reconstruction, figure understanding, applicability correctness, or an
  engineering conclusion. The packages remain source-bound and candidate-only.
- The 737 pre-OCR pass is not a whole-file success. Pages 7 and 21 must be
  governed by the OCR owner's fail-closed contract until a real provider fills
  them.
- The Boeing SL profile remains recognizable, but its actual page 9 is likewise
  OCR-required; no pre-OCR producer/Reader pass is retained as completion
  evidence.
- Scanned/partial-text PDF OCR, Word, Excel, and S1000D are not implemented here.
  Page diagnostics and OCR errors remain exclusively owned by the OCR lane.
- No second parser, store, source-artifact model, or Reader is introduced. No
  AEO approval/publication, assessment auto-adoption, deployment, push,
  cloud/model call, or release is authorized by these profiles.
