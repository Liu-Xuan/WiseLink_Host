import {
  jcsCanonicalize,
  sha256Hex,
  techpubEntityId,
} from '../pure/canonical-hash';
import { ProfessionalInputPureError } from '../pure/professional-input-pure.error';
import type {
  ParsedPdfLayout,
  ParsedPdfTextRun,
  PdfSourceRefValue,
  ProfessionalInputSourceArtifactInput,
  SourceUnit,
  SourceUnitSet,
} from '../pure/professional-input-pure.types';

/**
 * Stage 2: derive the deterministic SourceUnitSet (future frozen.2
 * sourceSegments + sourceRefs) from a ParsedPdfLayout.
 *
 * Segmentation is line-based: text runs are clustered per page by baseline
 * y-coordinate, joined left-to-right into lines, and every non-blank line
 * becomes exactly one source unit anchored by a PDF source ref. The first
 * text unit on each non-blank page carries that page's actual extracted text
 * context; later units retain granular line locators. No unit is dropped, no
 * text is synthesized, and identities are pure hashes of content — the count
 * of units is driven by the bytes, never hardcoded.
 */

export const SEGMENTATION_PROFILE_ID =
  'professional-input-pure-pdf-lines-v1' as const;

export const SEGMENTATION_PROFILE_HASH = `sha256:${sha256Hex(
  `${SEGMENTATION_PROFILE_ID}@frozen.2`,
)}` as const;

/** Maximum baseline distance (user-space units) treated as the same line. */
const LINE_CLUSTER_TOLERANCE = 2;

export function buildSourceUnitSet(
  layout: ParsedPdfLayout,
  options: {
    documentCode: string;
    artifact?: ProfessionalInputSourceArtifactInput;
  },
): SourceUnitSet {
  if (layout.kind !== 'pdf') {
    throw new ProfessionalInputPureError(
      'SOURCE_UNIT_SET_LAYOUT_KIND_UNSUPPORTED',
      `Only pdf layouts are supported, received "${layout.kind}".`,
    );
  }
  if (options.documentCode.trim().length === 0) {
    throw new ProfessionalInputPureError(
      'SOURCE_UNIT_SET_DOCUMENT_CODE_EMPTY',
      'documentCode must be a non-empty string.',
    );
  }

  const artifactId = pdfArtifactEntityId(
    layout,
    options.artifact ?? {
      artifactRef: `artifact://CanonicalArtifactStore/${options.documentCode}.pdf`,
      normalizedPath: `${options.documentCode}.pdf`,
    },
  );
  const lines = collectLines(layout);
  const wholePageQuotes = buildWholePageQuotes(lines);
  const sourcePackageId = pdfSourcePackageId(
    options.documentCode,
    layout.sourceSha256,
  );
  const units: SourceUnit[] = [];
  const sourceRefs: PdfSourceRefValue[] = [];

  // Document-level metadata anchor: page 1, full page box, quote = title or
  // the declared document code. This anchors document identity fields.
  const metadataQuote = layout.metadata.title?.trim() || options.documentCode;
  const metadataRef = buildPageAnchorSourceRef(
    artifactId,
    layout,
    1,
    metadataQuote,
  );
  sourceRefs.push(metadataRef);
  units.push(
    buildUnit({
      artifactId,
      sourcePackageId,
      kind: 'source_metadata',
      semantic: 'metadata',
      order: 0,
      page: 1,
      bbox: fullPageBbox(layout, 1),
      text: metadataQuote,
      sourceRefIds: [metadataRef.sourceRefId],
    }),
  );

  let headingSequence = 0;
  let textSequence = 0;
  let order = 1;
  const pageContextRefsBuilt = new Set<number>();
  for (const line of lines) {
    const text = line.text.trim();
    if (text.length === 0) continue;
    const isHeading =
      line.runs.length > 0 && line.runs.every((run) => run.bold);
    const isReference = /^reference\b/i.test(text);
    let continuityKey: string;
    let kind: SourceUnit['kind'];
    let semantic: SourceUnit['expectedSemantic'];
    if (isHeading) {
      headingSequence += 1;
      continuityKey = `heading-${headingSequence}`;
      kind = 'text_block';
      semantic = 'heading';
    } else if (isReference) {
      textSequence += 1;
      continuityKey = `reference-${textSequence}`;
      kind = 'text_block';
      semantic = 'reference';
    } else {
      textSequence += 1;
      continuityKey = `paragraph-${textSequence}`;
      kind = 'text_block';
      semantic = 'text';
    }
    const sourceRefIds: string[] = [];
    const refsForLine: PdfSourceRefValue[] = [];
    if (!pageContextRefsBuilt.has(line.page)) {
      const pageContextRef = buildWholePageSourceRef(
        artifactId,
        layout,
        line.page,
        wholePageQuotes.get(line.page)!,
      );
      refsForLine.push(pageContextRef);
      sourceRefIds.push(pageContextRef.sourceRefId);
    }
    if (
      pageContextRefsBuilt.has(line.page) ||
      line.origin === 'ocr_tesseract_tsv'
    ) {
      const granularRef = buildRunAnchorSourceRef(artifactId, layout, line);
      refsForLine.push(granularRef);
      sourceRefIds.push(granularRef.sourceRefId);
    }
    pageContextRefsBuilt.add(line.page);
    sourceRefs.push(...refsForLine);
    units.push(
      buildUnit({
        artifactId,
        sourcePackageId,
        kind,
        semantic,
        order,
        page: line.page,
        bbox: runBbox(layout, line),
        text,
        sourceRefIds,
        continuityKey,
      }),
    );
    order += 1;
  }

  const memberHash = sourceUnitSetMemberHash(units, sourceRefs);
  const setHash = `sha256:${memberHash}`;
  return {
    sourceUnitSetId: techpubEntityId('source-segment-set', memberHash),
    sourceUnitSetHash: setHash,
    segmentationProfileId: SEGMENTATION_PROFILE_ID,
    segmentationProfileHash: SEGMENTATION_PROFILE_HASH,
    sourceRefs,
    units,
  };
}

function buildWholePageQuotes(
  lines: readonly ParsedLine[],
): ReadonlyMap<number, string> {
  const linesByPage = new Map<number, string[]>();
  for (const line of lines) {
    const text = line.text.trim();
    if (text.length === 0) continue;
    const pageLines = linesByPage.get(line.page) ?? [];
    pageLines.push(text);
    linesByPage.set(line.page, pageLines);
  }

  const quotes = new Map<number, string>();
  for (const [page, pageLines] of linesByPage) {
    const quote = pageLines.join('\n');
    quotes.set(page, quote);
  }
  return quotes;
}

/* ------------------------------ line clustering ---------------------- */

interface ParsedLine {
  page: number;
  y: number;
  runs: ParsedPdfTextRun[];
  text: string;
  origin?: 'ocr_tesseract_tsv';
  readingOrder?: number;
  normalizedBbox?: readonly [number, number, number, number];
}

function collectLines(layout: ParsedPdfLayout): ParsedLine[] {
  const lines: ParsedLine[] = [];
  const byPage = new Map<number, ParsedPdfTextRun[]>();
  for (const run of layout.textRuns) {
    if (run.text.trim().length === 0) continue;
    const bucket = byPage.get(run.page) ?? [];
    bucket.push(run);
    byPage.set(run.page, bucket);
  }
  for (let page = 1; page <= layout.pageCount; page += 1) {
    const pageRuns = (byPage.get(page) ?? []).slice();
    const ocrRuns = pageRuns.filter(
      (run) => run.origin === 'ocr_tesseract_tsv',
    );
    const runs = pageRuns.filter((run) => run.origin !== 'ocr_tesseract_tsv');
    const nativeLines: ParsedLine[] = [];
    // Reading order: descending baseline (top of page first), then x.
    runs.sort((left, right) => right.y - left.y || left.x - right.x || 0);
    let current: ParsedPdfTextRun[] = [];
    let currentY: number | null = null;
    const flush = () => {
      if (current.length === 0) return;
      const ordered = current.slice().sort((a, b) => a.x - b.x);
      nativeLines.push({
        page,
        y: currentY ?? ordered[0].y,
        runs: ordered,
        text: ordered.map((run) => run.text).join(''),
      });
      current = [];
      currentY = null;
    };
    for (const run of runs) {
      if (
        currentY === null ||
        Math.abs(run.y - currentY) <= LINE_CLUSTER_TOLERANCE
      ) {
        current.push(run);
        currentY = currentY === null ? run.y : currentY;
      } else {
        flush();
        current = [run];
        currentY = run.y;
      }
    }
    flush();
    if (ocrRuns.length === 0) {
      lines.push(...nativeLines);
      continue;
    }
    const ocrLines = ocrRuns
      .slice()
      .sort(
        (left, right) =>
          assertOcrReadingOrder(left) - assertOcrReadingOrder(right),
      )
      .map(
        (run): ParsedLine => ({
          page,
          y: run.y,
          runs: [run],
          text: run.text,
          origin: 'ocr_tesseract_tsv',
          readingOrder: assertOcrReadingOrder(run),
          normalizedBbox: assertOcrNormalizedBbox(run),
        }),
      );
    lines.push(
      ...[...nativeLines, ...ocrLines].sort((left, right) => {
        const topDifference =
          lineNormalizedTop(left, layout) - lineNormalizedTop(right, layout);
        if (topDifference !== 0) return topDifference;
        if (
          left.origin === 'ocr_tesseract_tsv' &&
          right.origin === 'ocr_tesseract_tsv'
        ) {
          return (left.readingOrder ?? 0) - (right.readingOrder ?? 0);
        }
        return left.origin === 'ocr_tesseract_tsv' ? 1 : -1;
      }),
    );
  }
  return filterPageAuxiliaryLines(lines, layout);
}

function assertOcrReadingOrder(run: ParsedPdfTextRun): number {
  if (!Number.isSafeInteger(run.readingOrder) || Number(run.readingOrder) < 0) {
    throw new ProfessionalInputPureError(
      'SOURCE_UNIT_SET_OCR_READING_ORDER_INVALID',
      `OCR run on page ${run.page} has no valid provider reading order.`,
    );
  }
  return Number(run.readingOrder);
}

function assertOcrNormalizedBbox(
  run: ParsedPdfTextRun,
): readonly [number, number, number, number] {
  const bbox = run.normalizedBbox;
  if (
    !bbox ||
    !bbox.every(Number.isSafeInteger) ||
    bbox.some((value) => value < 0 || value > 1_000_000) ||
    bbox[2] <= bbox[0] ||
    bbox[3] <= bbox[1]
  ) {
    throw new ProfessionalInputPureError(
      'SOURCE_UNIT_SET_OCR_BBOX_INVALID',
      `OCR run on page ${run.page} has no valid exact normalized bbox.`,
    );
  }
  return bbox;
}

function lineNormalizedTop(line: ParsedLine, layout: ParsedPdfLayout): number {
  if (line.normalizedBbox) return line.normalizedBbox[1];
  const nativeBboxes = line.runs
    .map((run) => run.normalizedBbox)
    .filter(
      (bbox): bbox is readonly [number, number, number, number] =>
        bbox !== undefined,
    );
  if (nativeBboxes.length === line.runs.length) {
    return Math.min(...nativeBboxes.map((bbox) => bbox[1]));
  }
  const [, y0, , y1] = pageBox(layout, line.page);
  const height = y1 - y0;
  const yMax = Math.max(
    ...line.runs.map((run) => run.y + Math.abs(run.fontSize)),
  );
  return Math.round(Math.min(1, Math.max(0, (y1 - yMax) / height)) * 1_000_000);
}

/**
 * Preserve the first observed top-page label while dropping its repeated
 * copies on later pages, and drop explicit "N of M" page-number lines.
 * This is the layout-native equivalent of the staged mature source-bundle
 * builder's page_header/page_number discarded-block filtering.
 */
function filterPageAuxiliaryLines(
  lines: readonly ParsedLine[],
  layout: ParsedPdfLayout,
): ParsedLine[] {
  const topLabelPages = new Map<string, Set<number>>();
  for (const line of lines) {
    if (!isTopPageLine(line, layout)) continue;
    const key = normalizeAuxiliaryText(line.text);
    if (!key) continue;
    const pages = topLabelPages.get(key) ?? new Set<number>();
    pages.add(line.page);
    topLabelPages.set(key, pages);
  }
  return lines.filter((line) => {
    const compact = normalizeAuxiliaryText(line.text);
    const pageNumber = compact.match(/^(\d+)of(\d+)$/);
    if (
      pageNumber &&
      Number(pageNumber[1]) === line.page &&
      Number(pageNumber[2]) === layout.pageCount
    ) {
      return false;
    }
    const recurringPages = topLabelPages.get(compact);
    if (
      recurringPages &&
      recurringPages.size > 1 &&
      line.page !== Math.min(...recurringPages)
    ) {
      return false;
    }
    return true;
  });
}

function normalizeAuxiliaryText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function isTopPageLine(line: ParsedLine, layout: ParsedPdfLayout): boolean {
  const [x0, y0, x1, y1] = pageBox(layout, line.page);
  void x0;
  void x1;
  return line.y >= y0 + (y1 - y0) * 0.85;
}

/* ------------------------------ source refs -------------------------- */

/** Deterministic artifact identity for the parsed PDF source bytes. */
export function pdfArtifactEntityId(
  layout: ParsedPdfLayout,
  artifact: ProfessionalInputSourceArtifactInput,
): string {
  return techpubEntityId(
    'artifact',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-artifact-id-v1',
        origin: 'source',
        role: 'pdf',
        sha256: layout.sourceSha256,
        mediaType: 'application/pdf',
        byteLength: layout.sourceByteLength,
        normalizedPath: artifact.normalizedPath,
      }),
    ),
  );
}

function buildPageAnchorSourceRef(
  artifactId: string,
  layout: ParsedPdfLayout,
  page: number,
  quote: string,
): PdfSourceRefValue {
  const bbox = fullPageBbox(layout, page);
  const anchorTextHash = `sha256:${sha256Hex(quote)}`;
  const sourceRefId = techpubEntityId(
    'source-ref',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-source-ref-id-v1',
        kind: 'pdf',
        artifactId,
        pageStart: page,
        pageEnd: page,
        bbox,
        quote,
        anchorTextHash,
      }),
    ),
  );
  return {
    sourceRefId,
    kind: 'pdf',
    artifactId,
    pageStart: page,
    pageEnd: page,
    bbox,
    quote,
    anchorTextHash,
  };
}

function buildRunAnchorSourceRef(
  artifactId: string,
  layout: ParsedPdfLayout,
  line: ParsedLine,
): PdfSourceRefValue {
  const bbox = runBbox(layout, line);
  const quote = line.text.trim();
  const anchorTextHash = `sha256:${sha256Hex(quote)}`;
  const sourceRefId = techpubEntityId(
    'source-ref',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-source-ref-id-v1',
        kind: 'pdf',
        artifactId,
        pageStart: line.page,
        pageEnd: line.page,
        bbox,
        quote,
        anchorTextHash,
      }),
    ),
  );
  return {
    sourceRefId,
    kind: 'pdf',
    artifactId,
    pageStart: line.page,
    pageEnd: line.page,
    bbox,
    quote,
    anchorTextHash,
  };
}

function buildWholePageSourceRef(
  artifactId: string,
  layout: ParsedPdfLayout,
  page: number,
  quote: string,
): PdfSourceRefValue {
  const bbox = fullPageBbox(layout, page);
  const charStart = 0;
  const charEnd = [...quote].length;
  const charOffsetUnit = 'unicode_scalar_value' as const;
  const anchorTextHash = `sha256:${sha256Hex(quote)}`;
  const sourceRefId = techpubEntityId(
    'source-ref',
    sha256Hex(
      jcsCanonicalize({
        namespace: 'techpub-source-ref-id-v1',
        kind: 'pdf',
        artifactId,
        pageStart: page,
        pageEnd: page,
        bbox,
        charStart,
        charEnd,
        charOffsetUnit,
        quote,
        anchorTextHash,
      }),
    ),
  );
  return {
    sourceRefId,
    kind: 'pdf',
    artifactId,
    pageStart: page,
    pageEnd: page,
    bbox,
    charStart,
    charEnd,
    charOffsetUnit,
    quote,
    anchorTextHash,
  };
}

/* ------------------------------ units -------------------------------- */

function buildUnit(input: {
  artifactId: string;
  sourcePackageId: string;
  kind: SourceUnit['kind'];
  semantic: SourceUnit['expectedSemantic'];
  order: number;
  page: number;
  bbox: readonly [number, number, number, number];
  text: string;
  sourceRefIds: readonly string[];
  continuityKey?: string;
}): SourceUnit {
  const continuityKey =
    input.continuityKey ?? `${input.semantic}-${input.order}`;
  const hashSourceRefIds = [...input.sourceRefIds].sort();
  const unitHash = `sha256:${sha256Hex(
    jcsCanonicalize({
      kind: input.kind,
      expectedSemantic: input.semantic,
      sourceRefIds: hashSourceRefIds,
    }),
  )}`;
  return {
    sourceUnitId: techpubEntityId(
      'source-segment',
      sha256Hex(
        jcsCanonicalize({
          namespace: 'techpub-source-segment-id-v1',
          sourcePackageId: input.sourcePackageId,
          continuityKey,
          kind: input.kind,
        }),
      ),
    ),
    continuityKey,
    kind: input.kind,
    expectedSemantic: input.semantic,
    order: input.order,
    sourceRefIds: input.sourceRefIds,
    unitHash,
    text: input.text,
  };
}

function sourceUnitSetMemberHash(
  units: readonly SourceUnit[],
  sourceRefs: readonly PdfSourceRefValue[],
): string {
  return sha256Hex(
    jcsCanonicalize(
      units
        .map((unit) => ({
          sourceSegmentId: unit.sourceUnitId,
          segmentHash: unit.unitHash,
          coverageRequired: true,
        }))
        .sort((left, right) =>
          left.sourceSegmentId < right.sourceSegmentId
            ? -1
            : left.sourceSegmentId > right.sourceSegmentId
              ? 1
              : 0,
        ),
    ),
  );
}

export function pdfSourcePackageId(
  documentCode: string,
  sourceSha256: string,
): string {
  return `pdf:${documentCode}:${sourceSha256}`;
}

/* ------------------------------ bbox helpers ------------------------- */

function pageBox(
  layout: ParsedPdfLayout,
  page: number,
): readonly [number, number, number, number] {
  const box = layout.pageBoxes.find((entry) => entry.page === page);
  if (!box) {
    throw new ProfessionalInputPureError(
      'SOURCE_UNIT_SET_PAGE_BOX_MISSING',
      `No MediaBox is available for page ${page}.`,
    );
  }
  return box.mediaBox;
}

/**
 * Convert user-space coordinates into the frozen.2 bbox encoding:
 * integer thousandths-of-page-percent, origin top-left.
 */
function toBboxUnits(
  layout: ParsedPdfLayout,
  page: number,
  xMin: number,
  yMinUser: number,
  xMax: number,
  yMaxUser: number,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = pageBox(layout, page);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) {
    throw new ProfessionalInputPureError(
      'SOURCE_UNIT_SET_PAGE_BOX_INVALID',
      `MediaBox for page ${page} has non-positive extent.`,
    );
  }
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  const left = Math.round(clamp01((xMin - x0) / width) * 1_000_000);
  const right = Math.round(clamp01((xMax - x0) / width) * 1_000_000);
  const top = Math.round(clamp01((y1 - yMaxUser) / height) * 1_000_000);
  const bottom = Math.round(clamp01((y1 - yMinUser) / height) * 1_000_000);
  return [
    Math.min(left, 999_999),
    Math.min(top, 999_999),
    Math.max(right, left + 1),
    Math.max(bottom, top + 1),
  ];
}

function fullPageBbox(
  layout: ParsedPdfLayout,
  page: number,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = pageBox(layout, page);
  return toBboxUnits(layout, page, x0, y0, x1, y1);
}

function runBbox(
  layout: ParsedPdfLayout,
  line: ParsedLine,
): [number, number, number, number] {
  if (line.origin === 'ocr_tesseract_tsv') {
    const bbox = line.normalizedBbox;
    if (!bbox) {
      throw new ProfessionalInputPureError(
        'SOURCE_UNIT_SET_OCR_BBOX_INVALID',
        `OCR line on page ${line.page} has no exact normalized bbox.`,
      );
    }
    return [bbox[0], bbox[1], bbox[2], bbox[3]];
  }
  const xMin = Math.min(...line.runs.map((run) => run.x));
  const xMax = Math.max(
    ...line.runs.map((run) => run.x + estimateRunWidth(run)),
  );
  const yMax = Math.max(...line.runs.map((run) => run.y + run.fontSize));
  const yMin = Math.min(...line.runs.map((run) => run.y));
  return toBboxUnits(layout, line.page, xMin, yMin, xMax, yMax);
}

/** Helvetica average glyph width approximation for bbox estimation only. */
function estimateRunWidth(run: ParsedPdfTextRun): number {
  return run.text.length * run.fontSize * 0.5;
}
