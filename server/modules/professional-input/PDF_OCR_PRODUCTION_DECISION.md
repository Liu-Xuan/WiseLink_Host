# PDF OCR production decision

Decision date: 2026-08-30

Current integration parent: `31a4f42e3e35b6282c4388292bd837ab5c207b96`

## Decision

The Canonical Host now binds one private composite implementation of the
existing `PdfLayoutExtractorPort`. Native pdfjs parsing remains authoritative;
only `EMPTY` pages and regions from a page whose existing raster diagnostic is
`UNVERIFIED` are sent to the deployment-bound OCR provider. Successful TSV
results are mapped back to the same page geometry and merged into one
`ParsedPdfLayout`, after which the unchanged SourceUnitSet, frozen.2 SPP, U0,
artifact-store, and Unified Reader path continues.

If the pinned runtime is unavailable, a required target is empty or malformed,
confidence is below the accepted evidence threshold, or native/OCR text
conflicts, the attempt still fails closed with the established
`PDF_OCR_REQUIRED_UNSUPPORTED` error. It produces no partial package.

This decision applies per page and raster region. A mixed PDF is unsupported
when even one page/region needs OCR; text elsewhere does not make the document
complete. In particular, `status=PRESENT` is never inferred merely from one
non-whitespace character.

The pdfjs provider derives displayed raster bounds from the same page operator
list used by the layout parse. It treats the union of raster regions with no
geometrically overlapping text-layer run as material at one quarter of the
page area. A quarter page is a general engineering-content safety boundary,
not a corpus hash/baseline: such a region can carry an entire procedure and
cannot be dismissed as decoration without a visual/OCR owner. Pages below that
boundary remain observable but are not mechanically rejected solely because
an image exists.

The concrete correctness counterexample is
`AD/AD2020-24-02/AD2020-24-02.pdf` (SHA-256
`4b3462ec9f55232c7a920698d9b688c0bf8ea9faa24967f69f55433b84809ccb`).
Page 48 exposes only the page number (`48`, two non-whitespace characters) in
its text layer while a displayed raster contains the Airspeed Unreliable
procedure. Pages 47-53 contain material raster procedure regions outside the
text-layer geometry and are now `VISUAL_TEXT_UNVERIFIED`, not successful
`PRESENT` pages.

The read-only b964 raster census (`pdf-raster-text-coverage-b964.json`) found
raster objects in 344/401 PDFs and 2,220 pages with a single approximately
quarter-page image; 1,974 of those pages had at most 500 extracted characters.
Those counts are risk evidence, not labels: the runtime policy does not use a
global character-count cutoff or declare every raster page OCR-required. It
uses the actual page operator geometry and text-layer overlap described above.

## Current owner audit

- Host `FileService` owns selected-file actual bytes and readback. It exposes no
  OCR or layout operation.
- The bound layout provider is `PdfjsOcrCompositeLayoutExtractor`, which wraps
  the existing `PdfjsDistLayoutExtractor` and a private
  `TesseractTsvPdfOcrAdapter`. It is not another parser seam.
- The production build always copies pinned `pdfjs-dist`. OCR deployments must
  explicitly supply `WL31_PDF_OCR_RUNTIME_ROOT`; the build copies that complete
  runtime into Host assets after checking the manifest, both executables, and
  `eng`/`chi_sim` files. An omitted runtime is observable and fail-closed when
  OCR is required.
- `CapabilityService` is available as a general plugin invocation surface. The
  current app declares only `@official-plugins/feishu-bitable`; it has no
  `ai-doc-parser` package or capability instance. The official document-parser
  capability contract accepts file URLs on the server and returns plain text,
  not page-indexed text runs/bboxes. That contract cannot preserve the required
  PDF page/source identity and is not an eligible layout-provider adapter.
- WiseLink 0.10's AD materialization script rendered only the first four pages
  at most, then ran `tesseract --psm 6`. It persisted text byte counts/hashes,
  not OCR text or bbox output. Its four source hashes are four of the current
  six full-scan documents. This proves old host tooling could fingerprint
  samples; it is not a current `SourceUnit`/`SourceRef` provider.
- WiseLink 0.10 also used local MinerU/Docker/HTTP runtimes. WiseLink 0.11
  described an official Miaoda document-parser OCR capability but recorded its
  JSON/page/bbox behavior as unverified. These are reuse anchors for
  fail-closed and locator semantics, not current production runtimes.

## Deployment requirement

The remaining external deployment input is the Host-owned runtime directory.
Its pinned manifest requires Poppler `pdftoppm` 25.03.0, Tesseract 5.5.0,
`tessdata_fast` revision 4.1.0, and languages `eng` plus `chi_sim`. Startup
preflight checks exact executable versions, language filenames, and an actual
bilingual Tesseract initialization; `--list-langs` or exit code 0 alone is not
accepted.

For every requested page/region the private provider returns:

1. the same 1-based PDF page identity;
2. real recognized text plus page-relative bbox coordinates;
3. a deterministic success/failure result for every requested page;
4. a deterministic success/failure result for every target; and
5. no external model/provider, Docker service, second package, or second
   Reader.

The developer machine still lacks `chi_sim` in its Homebrew tessdata. That
installation is not a production dependency. The real acceptance run used a
private temporary runtime populated from the exact official 4.1.0 language
blobs; those validation files are not committed or downloaded at runtime.

## Implemented adapter boundary

The implemented boundary is one Host-owned composite adapter behind the
existing `PdfLayoutExtractorPort`:

```text
actual PDF bytes
  -> pdfjs page text-layer + displayed-raster diagnostics
  -> render every EMPTY page and VISUAL_TEXT_UNVERIFIED raster region
     through a deployment-bound renderer
  -> Tesseract TSV/hOCR through deployment-bound engine/language assets
  -> map word bboxes back to the same 1-based PDF page coordinates
  -> merge/dedupe real OCR page/bbox runs with existing pdfjs text runs
     into one ParsedPdfLayout
  -> existing SourceUnitSet / SourceRefs / SPP / frozen.2 U0 / Reader
```

The renderer, Tesseract executable/runtime, and required language assets must
be part of the Miaoda deployment contract rather than discovered from the
developer machine. Any missing asset, page OCR failure, empty OCR result, or
unmapped bbox remains `PDF_OCR_REQUIRED_UNSUPPORTED`/fail-closed.

Actual-byte acceptance at the pinned runtime materialized the two-page CAAC
scan, the rotated Chinese Operation Tip, and AD2020 pages 47-53 (including p48:
38 lines at 94.881352 mean confidence). Operation Tip and AD2020 both passed
the frozen.2 strict U0 validator and Unified Reader; Reader returned p48 RVSM
text with page 48, quote, and granular bbox. Digital FTD and FAA AD produced
zero OCR pages and byte-identical packages versus the native extractor.

TCI p1, 737 p7/p21, Boeing SL p9, Boeing MT p2, Airbus AOT p4/27-28/37-38/42,
and Airbus Concession p5 remained explicitly fail-closed under the same pinned
runtime because required targets were empty or below confidence. These are
observed outcomes, not silent fallback or claims of document completion.

## Non-claims

- This change does not deploy the OCR runtime or its language assets.
- It does not qualify the official document-parser plugin as a layout provider.
- It does not reuse historical Tesseract/MinerU/Docker runtime as production.
- It does not claim the low-confidence documents above are complete.
- It does not change family registry semantics, client code, DB schema, cloud
  configuration, publication state, or engineering approval authority.
