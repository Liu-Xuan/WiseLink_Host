# Host-native professional input provenance

This private Host module is the R08 candidate migration path for PDF
professional input. Runtime execution is entirely inside the WiseLink 3.1
canonical Host. It imports no legacy WiseLink runtime and does not create a
second currentness selector or Reader.

## Source-to-target map

| Source                                                                                                                                                                                                                                                                                                                                           | Reused maturity                                                                                                                       | Host target                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `/Volumes/SSD/LLM/WiseLink-v9-v91-legacy`, commit `d74dd72018a40ecdeda2d085f3a5a294833ae046`, `backend/api/services/v8/parseSourceBundleBuilder.js` (blob `7e73f7dbb3c4acc961d37ef79f2a31cd99672262`, SHA-256 `74a60a9c1633fe9bc5d2ace20f54204899847d528eb12d7735998018962678c2`) and its test (blob `b722877c86d27abc7e553c5371906452309ab0ab`) | Page auxiliary-line and repeated page-header filtering semantics; deterministic source-bound unit construction                        | `builders/source-unit-set.builder.ts`                                                                                              |
| Same repository/commit, `backend/api/services/v8/structuredParseService.js` (blob `516824817465f4cc0acb321fa50ad38cf96085a4`, SHA-256 `898dc158ba129e524fba1ee23ff55e8f3141cb9611e415b1f56cf01119d95384`) and its test (blob `ac7a89ef512572961a6a5e468d475955b032be58`)                                                                         | Mature parser output concepts only; legacy provider, queue, repository, and currentness wiring were deliberately not migrated         | Private `pure/`, `builders/`, and `parser/pdf-layout.extractor.port.ts` contracts                                                  |
| Canonical Host commit `57016a3bfcfa42a77974ff54aa640fbaa5627135`                                                                                                                                                                                                                                                                                 | Pure layout-to-source-unit and source-unit-to-SPP implementation seed                                                                 | `pure/*.ts`, `builders/*.ts`, and `parser/pdf-layout.extractor.port.ts`, corrected to the existing frozen.2 U0 identity/hash views |
| Canonical Host commit `2dde98cf4eca1c8754cb071e736ff8327806f1fc`                                                                                                                                                                                                                                                                                 | Mature pdfjs layout adapter/runner seed                                                                                               | `parser/pdfjs-dist-layout-extractor.adapter.ts` and `parser/pdfjs-layout-extractor.runner.mjs`                                     |
| Mozilla `pdfjs-dist@4.10.38`, declared in this Host's `package.json`                                                                                                                                                                                                                                                                             | Official PDF decoding, objects, streams, fonts, and text-content extraction; version is beyond the CVE-2024-4367 fixed boundary       | Resolved by Node 22 through the package's ESM legacy build; no hand-written PDF syntax parser exists here                          |
| Existing canonical Host at base `77f2a56d4eacecd31e4a501630ee5fe3985fb25a`                                                                                                                                                                                                                                                                       | FileService actual-byte readback, DocumentVersion/currentness decision, frozen.2 U0 validator, package artifact store, Unified Reader | `HostNativeDocumentFamilyPdfProducerAdapter` composes those existing owners with this private parser pipeline                      |

The staged actual FTD source is
`777-FTD-31-21002_Doc_09262025.pdf`, canonical Host source commit
`57016a3bfcfa42a77974ff54aa640fbaa5627135`, blob
`722060550e49fdb79b4fc5f600251772d74a96fe`, SHA-256
`b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c`,
122102 bytes. It remains in the ignored migration-source staging area and is
supplied to `test:professional-input:real-ftd` through
`WL31_REAL_FTD_FIXTURE`; the binary is not duplicated in the product tree.

## Authority and non-claims

The page-level OCR decision and exact production-provider blocker are recorded
in [PDF_OCR_PRODUCTION_DECISION.md](./PDF_OCR_PRODUCTION_DECISION.md).

- Output is frozen.2 `CANDIDATE_ONLY`; it is not an engineering conclusion,
  release approval, publication, compliance sign-off, or airworthiness
  approval.
- The pipeline does not select or mutate currentness. The existing Host
  resolver must fresh-read a verified current DocumentVersion before parsing.
- The pipeline does not persist a second package or provide a second Reader.
  Existing Host U0, artifact-store, and Unified Reader services remain the
  only consumers/owners.
- The actual-byte test uses the real parser, frozen.2 validator, and Reader;
  FileService and DB resolution are bounded test doubles. Hosted persistence,
  deployment, and online writes are not claimed.
