# Canonical PDF corpus acceptance runner

This runner records actual, read-only use of the current Canonical Host PDF
path. It fresh-scans an external corpus on every invocation and does not copy
the corpus into Git.

The production path observed for an accepted file is:

```text
actual FileService selection bytes
  -> DocumentManagementHostedCore.ingestFileServiceSelection
  -> committed SourceArtifact / DocumentVersion fresh readback
  -> production family/profile classification
  -> Host-native PDF producer
  -> selected PdfLayoutExtractorPort
  -> SourceUnit / SourceRef
  -> Host-scoped professional artifact readback
  -> frozen.2 full U0
  -> UnifiedReaderService actual-byte readback
```

The runner does not parse PDF internals, construct a package, select a profile,
validate U0, or read a package itself. Those operations remain with the
production owners. Local test/script support carries real selection bytes into
the production hosted DM core and fresh-resolves the identities that core
created. Process-local Catalog/FileService/WorkItem ports make no production
durability, database, cloud, publication, or currentness claim.

## Authority and current checkpoint

This runner closure starts from clean authoritative integration commit
`c717bed2aa52a68675c8b8193fa003663e21ad85` and the R09 cloud contract at
revision 1566. It is runner/test/documentation work only. It is not a replay of
the historical b964 census or an older corpus result.

The family request is built from the family, issuer, and adapter release that
the production Hosted Core actually committed to the resolved DM source. The
adapter release is decoded by `hostNativePdfAdapterIdFromDmPreflight` and the
request is selected by `hostNativePdfClassificationFor`; the runner does not
invent a family, profile, fingerprint, or parser hash. Content registry and
direct layout observations are retained only as diagnostic axes and cannot
turn a failed Host path into success.

The c717 base already contains the accepted composite OCR owner and the pinned,
self-contained Linux/x64 runtime. The full 401-PDF run must be executed from
one committed combined runner/provider revision; any small representative run
is selected-scope evidence only, not corpus acceptance.

## Prerequisite

The selected production `PdfLayoutExtractorPort` exposes its authoritative
page diagnostics. After the OCR successor is replayed, the runner calls the
same `PdfjsOcrCompositeLayoutExtractor` used by the Host producer and consumes
both text-layer, OCR, and visual/raster
coverage; it does not infer completeness from nonzero text. In particular:

- every page has an owner diagnostic, including pages with no text layer;
- empty or partial text-layer coverage fails with
  `PDF_OCR_REQUIRED_UNSUPPORTED` and exact page diagnostics;
- large-raster/operator coverage is an independent owner observation. A page
  with a few text-layer characters can remain visually unproven and must fail
  closed until an OCR/layout provider proves its content.

The runner only consumes and aggregates the owner shape. It does not recalculate
a second text-layer/raster/OCR coverage decision from text runs or image
thresholds. Missing or `UNPROVEN` owner coverage is never success. The concrete
regression is `AD/AD2020-24-02/AD2020-24-02.pdf` page 48: a two-character text
layer does not prove the rasterized engineering procedure is covered.

## Run

Build once, then run a representative real batch:

```bash
npm run build:server
node scripts/run-canonical-pdf-corpus.mjs \
  --match '737-34-3830 Original.pdf' \
  --output-dir /private/tmp/wiselink-corpus-small
```

Run every current PDF with two bounded worker processes:

```bash
node scripts/run-canonical-pdf-corpus.mjs \
  --concurrency 2 \
  --worker-memory-mb 1536 \
  --output-dir /private/tmp/wiselink-corpus-full
```

Resume the same output directory. A prior record is reused only when relative
path, byte length, and fresh SHA-256 all match:

```bash
node scripts/run-canonical-pdf-corpus.mjs \
  --concurrency 2 \
  --output-dir /private/tmp/wiselink-corpus-full \
  --resume
```

Stable zero-based shards are also available:

```bash
node scripts/run-canonical-pdf-corpus.mjs \
  --shard-count 4 \
  --shard-index 0 \
  --output-dir /private/tmp/wiselink-corpus-shard-0
```

Use `--help` for all limits. Concurrency is restricted to 1–4; each file runs
in a separate process with an old-space cap and timeout so a large or damaged
PDF cannot retain memory for later files.

## Outputs

Each output directory contains:

- `scan-manifest.json`: the fresh runtime scan, relative paths, byte lengths,
  SHA-256 values, selection, and shard information;
- `records.ndjson`: one terminal observation per selected exact input;
- `summary.json`: machine-readable totals, routing slices, failure taxonomy,
  and accounting invariants;
- `summary.md`: short engineering summary.

Runtime hashes are coverage evidence for that invocation. They are not a
committed baseline, frozen contract, allowlist, or gate.

Every file record keeps routing and coverage separate. It includes:

- relative path, actual bytes, SHA-256, and page count;
- DM family/source type/category/adapter release and recognized issuer;
- DM-created acquisition/SourceArtifact/Document/DocumentVersion IDs, immutable
  source readback, and fresh current catalog resolution;
- normalized-descriptor evidence status. Legacy defaulted `documentCode` or
  `pageCount` mismatches are visible but never identity authority; actual
  filename/SHA/byte mismatches are terminal identity failures;
- content-recognized document category, source type, adapter, document type,
  and parse profile;
- exact Canonical Host request classification and selected profile status;
- production parser route and per-page `NATIVE_TEXT` / `OCR_COVERED` /
  `OCR_REQUIRED` / `MISSING` coverage, plus the separately reported native
  text-layer and owner-observed material-raster page counts;
- SourceUnit and SourceRef counts;
- frozen.2 artifact/readback identity and full U0 proof;
- Unified Reader query and all-source-unit readback counts;
- actual Host producer/failure code and one terminal code.

The summary groups DM family, DM issuer, committed DM adapter release, and
descriptor-evidence status separately from content-recognized
issuer/category/source type/adapter/parse profile, routing slice,
authoritative page-coverage failure code, and actual Host failure code.
This keeps Boeing maintenance tips and Airbus RIL/AOT/OIT/FOT/ALS/ETOPS
CMP/SBIT/TFU/Concession observations visible even when their top-level path is
`SB/`. An `AEO-` filename that the production DM/content owners still classify
as generic is reported as `UNRESOLVED:AEO_FILENAME_PREFIX`; it is not guessed
into a governed family.

A matched, limited, or sharded run is always labeled
`SELECTED_SCOPE_ACCEPTED` / `SELECTED_SCOPE_NOT_ACCEPTED`. Only a run whose
selected identities equal every PDF in the same fresh scan can report
`FULL_CORPUS_ACCEPTED` / `FULL_CORPUS_NOT_ACCEPTED`; the explicit
`acceptance.scope` and `allFreshCorpusInputsSelected` fields make that boundary
machine-readable.

## Terminal outcomes

`CANONICAL_READER_VERIFIED` is the only success. It requires all of:

- authoritative page coverage accounts for every page and requires no OCR;
- Canonical Host returns `CANDIDATE_VERTICAL_VERIFIED`;
- non-empty SourceUnit and SourceRef counts;
- all enumerated SourceUnits have SourceRefs;
- full strict frozen.2 U0 passes on persisted actual bytes;
- Unified Reader returns a non-empty, source-bound query result.

Failures are explicit, including:

- `UNSUPPORTED_PROFILE`;
- `UNKNOWN_FAMILY`;
- `OCR_NEEDED` for owner-reported fully scanned PDFs;
- `PARTIAL_OCR_NEEDED` for owner-reported mixed PDFs;
- `VISUAL_TEXT_OCR_NEEDED` and `PARTIAL_VISUAL_OCR_NEEDED` for owner-reported
  raster/operator visual text that the text layer does not prove;
- `DAMAGED_OR_UNREADABLE_PDF` and `ENCRYPTED_PDF`;
- `DM_IDENTITY_NOT_COMMITTABLE`, `DM_REVIEW_REQUIRED`, and
  `SOURCE_BYTES_TOO_LARGE` from production Document Management/FileService;
- `IDENTITY_OR_READBACK_FAILED`;
- `U0_REJECTED_OR_UNAVAILABLE`;
- `READER_FAILED`;
- `PAGE_COVERAGE_DIAGNOSTIC_UNAVAILABLE`;
- `INPUT_CHANGED_DURING_RUN` and `WORKER_FAILED`.

An OCR or partial-OCR result remains a failure even if another document-level
stage appears non-empty. Unsupported, damaged, encrypted, identity/readback,
U0, and Reader failures never contribute to corpus acceptance. Completing all
records is reported as observation completion; full-corpus acceptance is a
separate field and is false when any file fails.

## Nonclaims

- This runner does not activate a parser profile, OCR provider, canonical
  product role, or publication authority.
- It does not make model, TDMS, AAmis, Aily, deployment, or cloud calls.
- Before every fresh-scanned input reaches a terminal record from one committed
  combined runner/provider revision, it makes no full-corpus result claim.
- Direct layout/page diagnostics are not product parsing success.
- A nonzero text layer is not a visual-content-completeness claim; the external
  raster audit is cross-check evidence only, not a runner-owned OCR threshold.
- An unsupported family/profile is not inferred from its directory name.
- A process-local port carrier is not a production durability or concurrency
  claim.
