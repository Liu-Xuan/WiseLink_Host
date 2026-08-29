# R09 host-native engineering PDF family matrix (2026-08-30)

## Scope and evidence rule

This matrix describes the document-family producer slice derived from exact
integration parent `b964d4bf88a8989dd4b460edde382f5900b873f5`. A row is
`PROFILE_PIPELINE_VERIFIED` only when real source bytes pass through the
production producer/profile logic, the one pdfjs layout extractor, the
professional-input frozen.2 builder, the U0 strict validator, and the Unified
Reader. These tests use FileService, DocumentVersion resolver, and correlation
port doubles with realistic identities; they do **not** prove that the same file
was ingested and persisted by the production Hosted Core into a real DV/SA
owner chain. A text layer by itself is only an intake diagnostic.

The controller's newer integration baseline is
`72392eb18930924b34f8f6b4bbff9402f14f558f`; this candidate remains based on
b964 and must be migrated serially. That integration must preserve 72392's
accepted FTD packageId correction and rerun the full Hosted Core owner chain.

Profile recognition uses the controlled Document Management family plus actual
PDF title/text and the existing `DocumentFamilyAdapterRegistry`. It does not use
the filename, file SHA-256, byte length, or a single document number to activate
a profile. Unknown or unactivated identities remain
`PDF_PRODUCER_PROFILE_NOT_AVAILABLE`.

The b964 technical census covers 401 PDFs: 393 have text on every page, 6 have
no text on any page, and 2 have a partial text layer. Those counts are not a
claim that 401 PDFs have migrated profiles or valid structured packages.

## First vertical slice

| Family / identity  | Real source                                                                   | Text-layer census | Current result                                                                                             | Evidence / boundary                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boeing FTD         | `FTD/777-FTD-31-21002_Doc_09262025.pdf` (`b1b5c198…`, 5 pages)                | 5/5 pages         | **PROFILE_PIPELINE_VERIFIED** — `issuer.boeing.ftd.v1` / `boeing.ftd.v1`                                   | Real bytes produce frozen.2, pass U0, and read back through Unified Reader. The cover matcher accepts split pdfjs runs (`777- FTD… Issue Title`) and rejects a bare FTD cross-reference. Hosted Core ingestion/persistence is not exercised. |
| Boeing SB          | `SB/机身/BOEING/2026/202605/737-34-3830 Original.pdf` (`add32c7d…`, 22 pages) | 22/22 pages       | **PROFILE_PIPELINE_VERIFIED** — `issuer.boeing.service_bulletin.v1` / `boeing.sb`                          | Existing 737 bytes remain on the same producer/U0/Reader path; the profile no longer depends on this file's digest or exact document number.                                                                                                 |
| Boeing SB          | `SB/机身/BOEING/2026/202604/777-34-0425.pdf` (`3a99b7a4…`, 18 pages)          | 18/18 pages       | **PROFILE_PIPELINE_VERIFIED** — same Boeing SB profile                                                     | A different Boeing model/document proves the profile is not the former exact-737 allow-list.                                                                                                                                                 |
| Airbus SB          | `SB/机身/AIRBUS/2026/202601/A320-23-1837 R04.pdf` (`91e19da0…`, 444 pages)    | 444/444 pages     | **PROFILE_PIPELINE_VERIFIED** — `issuer.airbus.service_bulletin.v1` / `airbus.sb`                          | Real 444-page bytes produce a package that passes frozen.2/U0 and Reader. This does not assert figure/table semantic fidelity beyond the current layout/source-unit contract.                                                                |
| Boeing SL          | `SL-777-45-006.pdf` (`5cc88899…`, 11 pages)                                   | 11/11 pages       | **PROFILE_PIPELINE_VERIFIED** — `issuer.boeing.service_letter.v1` / `boeing.sl`                            | Family narrowing plus content identity prevents referenced FTD/SB numbers from stealing the profile.                                                                                                                                         |
| FAA AD             | `AD/AD2011-03-14/AD2011-03-14.pdf` (`b2b56ba9…`, 10 pages)                    | 10/10 pages       | **PROFILE_PIPELINE_VERIFIED** — `issuer.faa.airworthiness_directive.v1` / `faa.ad`                         | Family/content identity prevents the referenced Boeing Alert SB from stealing the directive profile.                                                                                                                                         |
| Boeing Alert SB    | No dedicated real sample in this change                                       | Not evaluated     | **REGISTRY-RECOGNIZABLE, ORDINARY CLASSIFICATION UNREACHABLE** — `issuer.boeing.alert_service_bulletin.v1` | Ordinary `{family: SB, issuer: BOEING}` maps to `boeing.sb`; it cannot select `boeing.asb` without a subtype-bearing classification contract. The ASB adapter is not in the activated production definitions.                                |
| EASA AD / CAAC CAD | No dedicated real samples in this change                                      | Not evaluated     | **CLASSIFICATION MAPPED, NOT REAL VERIFIED**                                                               | Registry/classification mapping exists; a natural real-byte pipeline test and Hosted Core owner-chain evidence are still required.                                                                                                           |

## Real files deliberately not presented as completed

| Identity                          | Real source and census                                                                              | Current result                                               | Exact gap / owner                                                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AEO engineering PDF               | `AEO-B787-46-0012-R00.pdf` (`d05004b6…`, 11/11 text pages)                                          | **PROFILE_NOT_AVAILABLE**, verified with actual pdfjs layout | No canonical AEO family/documentType/profile mapping exists in this slice. It is an engineering PDF input only and is not coerced into SB. Formal AEO approval/publishing is outside this task. Taxonomy/contract owner must define the independent mapping. |
| AMM-linked response               | `80217647_009.pdf` (`6b7ec765…`, 2/2 text pages)                                                    | **PROFILE_NOT_AVAILABLE**, verified with actual pdfjs layout | Content is a dossier/final-answer response linked to an AMM task. It must not be labeled as an independent AMM or task card. Document-family taxonomy owner must define a response identity before activation.                                               |
| Airbus TCI with missing page text | `SB/机身/AIRBUS/2026/202603/AME25008-TCI-A01 R00.pdf` (`606d9a6d…`, 12/13 text pages; page 1 empty) | **WITHHELD / PARTIAL CORPUS**; no package evidence           | Directory placement is not an SB identity, content is TCI, and one page needs OCR. The OCR owner alone owns page diagnostics and `PDF_OCR_REQUIRED_UNSUPPORTED`; the taxonomy owner must map TCI. This lane adds no partial package or empty `sourceRefIds`. |
| Supplier SIL                      | `…/SIL D201908000037 R4.pdf` (`fd12b19c…`, 4/4 text pages)                                          | **NOT ACTIVATED IN FIRST SLICE**                             | Existing `generic.supplier_sil` adapter is reusable, but producer `documentType` and issuer/generic classification mapping plus real Reader evidence are pending the successor change.                                                                       |
| Boeing Maintenance Tip            | `SB/机身/BOEING/2026/202603/787 MT 51-001-R3.pdf` (`cf622421…`, 6/6 text pages)                     | **NOT ACTIVATED IN FIRST SLICE**                             | Existing `issuer.boeing.maintenance_tip` adapter is reusable. MT classification/documentType and real pipeline evidence are pending the successor change.                                                                                                    |
| Airbus RIL                        | `…/RIL V27M24001856 R03.pdf` (`c4e55c4c…`, 7/7 text pages)                                          | **NOT ACTIVATED IN FIRST SLICE**                             | Existing `issuer.airbus.retrofit_information_letter` adapter is reusable; the successor must prove its content matcher and package path.                                                                                                                     |
| Airbus AOT                        | `…/AOT-A32N033-24 R03.pdf` (`1170448b…`, 43/43 text pages)                                          | **NOT ACTIVATED IN FIRST SLICE**                             | Existing `issuer.airbus.operator_transmission` adapter is reusable; AOT/OIT/FOT/SBIT must be selected from real content rather than the surrounding `SB/` directory.                                                                                         |
| Airbus OIT/FOT/SBIT               | Multiple full-text real files in the 401-file corpus                                                | **NOT ACTIVATED IN FIRST SLICE**                             | Same operator-transmission adapter is a candidate. Corpus runs and at least one natural real producer/U0/Reader case per meaningfully different cover identity are required.                                                                                 |
| Airbus ALS / ETOPS CMP            | Full-text real files including `A330 ETOPS CMP R39.pdf` and ALS variations                          | **NOT ACTIVATED IN FIRST SLICE**                             | Existing `issuer.airbus.maintenance_programme` is a candidate; content recognition and MT/documentType mapping are not yet proven.                                                                                                                           |
| Airbus TFU / Concession           | Full-text real files in the corpus                                                                  | **NOT ACTIVATED IN FIRST SLICE**                             | Existing `issuer.airbus.support_document` may be reusable, but these identities require real-content discrimination and an explicit generic/support documentType decision.                                                                                   |

## Explicit nonclaims

- The first slice is not 401/401 coverage and does not claim every SB, SL, AD,
  FTD, issuer, or subtype is supported.
- The real-file tests prove profile selection and the producer/frozen.2/U0/Reader
  segment with FileService/DV/SA port doubles. They do not prove production
  Hosted Core ingestion, persisted DV/SourceArtifact ownership, or the complete
  current-host owner chain; that must be run after serial migration onto the
  current integration baseline.
- pdfjs text extraction does not prove complete semantic parsing, correct table
  reconstruction, figure understanding, applicability correctness, or engineering
  conclusions. The package remains source-bound and candidate-only.
- Scanned/partial-text PDF OCR, Word, Excel, and S1000D are not implemented here.
  Missing-page behavior belongs exclusively to the OCR owner and must fail closed
  until a real OCR provider exists.
- No second parser, store, source-artifact model, or Reader is introduced. No AEO
  approval/publication, assessment auto-adoption, deployment, or cloud/model call
  is authorized by these profiles.
