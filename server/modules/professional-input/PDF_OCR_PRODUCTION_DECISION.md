# PDF OCR production decision

Decision date: 2026-08-30

Current integration parent: `b964d4bf88a8989dd4b460edde382f5900b873f5`

## Decision

The current Canonical Host has no production-safe OCR owner that can satisfy
the existing `PdfLayoutExtractorPort`. A PDF page without non-whitespace text,
or with material raster-visual coverage not overlapped by its text layer,
therefore fails closed with `PDF_OCR_REQUIRED_UNSUPPORTED`; it must not produce
a `SourceUnitSet`, frozen.2 package, U0 success, or Reader success.

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
- The bound layout provider is `PdfjsDistLayoutExtractor`. The production build
  copies its pinned `pdfjs-dist` runtime, but neither `package.json` nor the
  runtime asset copy contains an OCR engine, OCR language data, or a PDF-page
  raster-to-OCR adapter.
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

## Exact blocker

The missing external input is a Host-owned, Miaoda-deployable OCR/layout
capability whose supported server contract returns, for requested PDF
pages/regions:

1. the same 1-based PDF page identity;
2. real recognized text plus page-relative bbox coordinates;
3. a deterministic success/failure result for every requested page;
4. no external model/provider, local-only service, Docker dependency, or
   undeclared system binary; and
5. a production execution budget proven for the 88-page full-scan document,
   the 97-page mixed document, and mixed text/raster procedure pages.

No currently installed/configured Host capability meets that contract. The
developer machine's Homebrew `pdftoppm` 25.03.0 and Tesseract 5.5.0 are not
production assets; its Tesseract languages are only `eng`, `osd`, and `snum`,
so it also lacks `chi_sim` required to qualify the Chinese scan in the corpus.

## Next adapter boundary

The selected narrow follow-up is one Host-owned composite adapter behind the
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

The adapter must cover all six fully text-layer-empty PDFs, both mixed PDFs,
and material raster regions on otherwise non-empty pages identified by the
b964 audit. It must not introduce another parser, store, or Reader. Until
actual provider bytes pass the same chain, OCR remains unsupported rather than
simulated.

## Non-claims

- This change does not implement OCR.
- It does not qualify the official document-parser plugin as a layout provider.
- It does not reuse historical Tesseract/MinerU/Docker runtime as production.
- It does not make a scan or mixed PDF a successful package.
