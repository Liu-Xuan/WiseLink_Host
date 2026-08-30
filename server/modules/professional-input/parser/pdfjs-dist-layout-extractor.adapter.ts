import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { ProfessionalInputPureError } from '../pure/professional-input-pure.error';
import type {
  ParsedPdfLayout,
  ParsedPdfPageBox,
  ParsedPdfPageTextLayerDiagnostic,
  ParsedPdfRasterRegionDiagnostic,
  ParsedPdfRasterVisualCoverageDiagnostic,
  ParsedPdfTextRun,
} from '../pure/professional-input-pure.types';
import type { PdfLayoutExtractorPort } from './pdf-layout.extractor.port';

/**
 * Mature PDF layout extractor backed by the declared Mozilla pdfjs-dist
 * 4.10.38 dependency's legacy build. The port contract is synchronous, while pdfjs is
 * inherently async — the adapter bridges this by executing a standalone
 * runner child process (pdfjs-layout-extractor.runner.mjs). Source bytes
 * are handed over via a caller-private temp file (argv path), not stdin:
 * stdin pipes are unreliable under test-runner environments (EPIPE), and
 * the file path keeps the exact-bytes contract verifiable by the runner.
 *
 * Determinism: identical bytes produce an identical ParsedPdfLayout value.
 * The adapter adds only caller-derived fields (sourceSha256 over the exact
 * input bytes, sourceByteLength); the runner emits no clock or randomness.
 * Fail-closed: malformed/unsupported bytes throw ProfessionalInputPureError
 * with a stable code — never degraded or synthetic output.
 */
export class PdfjsDistLayoutExtractor implements PdfLayoutExtractorPort {
  readonly extractorId = 'pdfjs-dist-4.10.38-legacy-layout-extractor' as const;

  private readonly runnerPath: string;
  private readonly pdfjsEntrypoint: string;

  constructor(runnerPath?: string, pdfjsEntrypoint = resolvePdfjsEntrypoint()) {
    this.runnerPath =
      runnerPath ?? resolve(__dirname, 'pdfjs-layout-extractor.runner.mjs');
    this.pdfjsEntrypoint = pdfjsEntrypoint;
  }

  extractLayout(bytes: Uint8Array): ParsedPdfLayout {
    const layout = this.extractLayoutWithDiagnostics(bytes);
    assertProductionTextLayerCoverage(layout);
    return layout;
  }

  /**
   * The private OCR composite consumes this exact native parse before the
   * public fail-closed coverage assertion. It does not expose another parser
   * seam: the same pdfjs result supplies diagnostics, profile recognition,
   * source units, and the final frozen.2 package.
   */
  extractLayoutWithDiagnostics(bytes: Uint8Array): ParsedPdfLayout {
    if (bytes.byteLength === 0) {
      throw new ProfessionalInputPureError(
        'PDFJS_LAYOUT_EMPTY_INPUT',
        'extractLayout received zero bytes.',
      );
    }
    const tempDir = mkdtempSync(join(tmpdir(), 'wiselink-pdfjs-layout-'));
    const sourcePath = join(tempDir, 'source.pdf');
    try {
      writeFileSync(
        sourcePath,
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
      const extractionStartedAt = performance.now();
      const pageBoxes: ParsedPdfPageBox[] = [];
      const textRuns: ParsedPdfTextRun[] = [];
      const pageTextLayerDiagnostics: ParsedPdfPageTextLayerDiagnostic[] = [];
      let header: RunnerDocumentHeader | null = null;
      let nextPage = 1;

      for (;;) {
        const requestedPageEnd = nextPage + PDFJS_LAYOUT_PAGES_PER_CHUNK - 1;
        const remainingBudgetMs = Math.floor(
          PDFJS_LAYOUT_TOTAL_TIMEOUT_MS -
            (performance.now() - extractionStartedAt),
        );
        if (remainingBudgetMs < 1) {
          throw runnerTimeoutError(nextPage, requestedPageEnd);
        }
        const result = spawnSync(
          process.execPath,
          [
            this.runnerPath,
            sourcePath,
            this.pdfjsEntrypoint,
            String(nextPage),
            String(requestedPageEnd),
          ],
          {
            maxBuffer: 512 * 1024 * 1024,
            timeout: Math.min(PDFJS_LAYOUT_CHUNK_TIMEOUT_MS, remainingBudgetMs),
          },
        );
        if (result.error) {
          if ((result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
            throw runnerTimeoutError(nextPage, requestedPageEnd);
          }
          throw new ProfessionalInputPureError(
            'PDFJS_LAYOUT_RUNNER_SPAWN_FAILED',
            `Failed to execute pdfjs-dist runner for pages ${nextPage}-${requestedPageEnd}: ${result.error.message}`,
          );
        }
        if (result.status === 3) {
          throw new ProfessionalInputPureError(
            'PDFJS_LAYOUT_PARSE_FAILED',
            result.stderr.toString('utf8').trim() ||
              'pdfjs-dist rejected the input bytes.',
          );
        }
        if (result.status !== 0 || result.stdout.length === 0) {
          throw new ProfessionalInputPureError(
            'PDFJS_LAYOUT_RUNNER_FAILED',
            `pdfjs-dist runner exited with status ${result.status ?? 'null'} for pages ${nextPage}-${requestedPageEnd}: ${result.stderr
              .toString('utf8')
              .trim()
              .slice(0, 500)}`,
          );
        }
        const chunk = parseRunnerPayload(
          result.stdout.toString('utf8'),
          nextPage,
          requestedPageEnd,
        );
        if (header === null) {
          header = {
            pdfVersion: chunk.pdfVersion,
            pageCount: chunk.pageCount,
            metadata: chunk.metadata,
          };
        } else if (
          chunk.pdfVersion !== header.pdfVersion ||
          chunk.pageCount !== header.pageCount ||
          chunk.metadata.title !== header.metadata.title
        ) {
          throw invalidRunnerPayload(
            'Runner document identity changed between page chunks.',
          );
        }
        pageBoxes.push(...chunk.pageBoxes);
        textRuns.push(...chunk.textRuns);
        pageTextLayerDiagnostics.push(...chunk.pageTextLayerDiagnostics);

        if (chunk.pageEnd === header.pageCount) break;
        nextPage = chunk.pageEnd + 1;
      }

      if (header === null) {
        throw invalidRunnerPayload('Runner produced no page chunks.');
      }
      assertCompleteRunnerCoverage(
        header.pageCount,
        pageBoxes,
        textRuns,
        pageTextLayerDiagnostics,
      );
      return {
        kind: 'pdf',
        pdfVersion: header.pdfVersion,
        pageCount: header.pageCount,
        pageBoxes,
        metadata: header.metadata,
        textRuns,
        pageTextLayerDiagnostics,
        sourceSha256: `sha256:${sourceSha256Hex(bytes)}`,
        sourceByteLength: bytes.byteLength,
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function resolvePdfjsEntrypoint(): string {
  const hostedRuntimeEntrypoint = resolve(
    __dirname,
    '../../../runtime-assets/professional-input/pdfjs-dist/legacy/build/pdf.mjs',
  );
  if (existsSync(hostedRuntimeEntrypoint)) {
    return hostedRuntimeEntrypoint;
  }
  // A production-path audit asserts this explicit fallback shape.
  // prettier-ignore
  return createRequire(__filename).resolve(
    'pdfjs-dist/legacy/build/pdf.mjs'
  );
}

/** SHA-256 hex over the exact input bytes. */
function sourceSha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// The canonical source is bounded by the existing 100 MiB FileService policy.
// Page chunks bound each synchronous child lifetime/output while the total
// budget prevents an adversarial document from spawning an unbounded sequence.
const PDFJS_LAYOUT_PAGES_PER_CHUNK = 64;
const PDFJS_LAYOUT_CHUNK_TIMEOUT_MS = 120_000;
const PDFJS_LAYOUT_TOTAL_TIMEOUT_MS = 600_000;

function runnerTimeoutError(
  pageStart: number,
  requestedPageEnd: number,
): ProfessionalInputPureError {
  return new ProfessionalInputPureError(
    'PDFJS_LAYOUT_RUNNER_TIMEOUT',
    `pdfjs-dist runner exhausted its bounded extraction time for pages ${pageStart}-${requestedPageEnd}.`,
    {
      pageStart,
      requestedPageEnd,
      pagesPerChunk: PDFJS_LAYOUT_PAGES_PER_CHUNK,
      chunkTimeoutMs: PDFJS_LAYOUT_CHUNK_TIMEOUT_MS,
      totalTimeoutMs: PDFJS_LAYOUT_TOTAL_TIMEOUT_MS,
    },
  );
}

interface RunnerPayload {
  pdfVersion: unknown;
  pageCount: unknown;
  pageStart: unknown;
  pageEnd: unknown;
  pageBoxes: unknown;
  metadata: unknown;
  textRuns: unknown;
  pageTextLayerDiagnostics: unknown;
}

interface RunnerDocumentHeader {
  pdfVersion: string;
  pageCount: number;
  metadata: { title: string | null };
}

interface ParsedRunnerChunk extends RunnerDocumentHeader {
  pageStart: number;
  pageEnd: number;
  pageBoxes: readonly ParsedPdfPageBox[];
  textRuns: readonly ParsedPdfTextRun[];
  pageTextLayerDiagnostics: readonly ParsedPdfPageTextLayerDiagnostic[];
}

const RUNNER_PAYLOAD_BEGIN = '<<<PDFJS-LAYOUT-JSON-BEGIN>>>';
const RUNNER_PAYLOAD_END = '<<<PDFJS-LAYOUT-JSON-END>>>';

function parseRunnerPayload(
  raw: string,
  expectedPageStart: number,
  requestedPageEnd: number,
): ParsedRunnerChunk {
  const beginIndex = raw.indexOf(RUNNER_PAYLOAD_BEGIN);
  const endIndex = raw.lastIndexOf(RUNNER_PAYLOAD_END);
  if (beginIndex < 0 || endIndex <= beginIndex) {
    throw new ProfessionalInputPureError(
      'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
      'Runner stdout carried no sentinel-wrapped JSON payload.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      raw.slice(beginIndex + RUNNER_PAYLOAD_BEGIN.length, endIndex),
    );
  } catch {
    throw new ProfessionalInputPureError(
      'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
      'Runner payload between sentinels was not valid JSON.',
    );
  }
  const value = parsed as RunnerPayload;
  const pageCount = Number(value.pageCount);
  const pageStart = Number(value.pageStart);
  const pageEnd = Number(value.pageEnd);
  const expectedPageEnd = Math.min(requestedPageEnd, pageCount);
  const rangePageCount = pageEnd - pageStart + 1;
  if (
    typeof value.pdfVersion !== 'string' ||
    typeof value.pageCount !== 'number' ||
    typeof value.pageStart !== 'number' ||
    typeof value.pageEnd !== 'number' ||
    !Number.isSafeInteger(pageCount) ||
    pageCount < 1 ||
    pageStart !== expectedPageStart ||
    pageEnd !== expectedPageEnd ||
    !Number.isSafeInteger(pageStart) ||
    !Number.isSafeInteger(pageEnd) ||
    pageStart < 1 ||
    pageEnd < pageStart ||
    !Array.isArray(value.pageBoxes) ||
    !Array.isArray(value.textRuns) ||
    !Array.isArray(value.pageTextLayerDiagnostics) ||
    typeof value.metadata !== 'object' ||
    value.metadata === null ||
    Array.isArray(value.metadata) ||
    value.pageBoxes.length !== rangePageCount ||
    value.pageTextLayerDiagnostics.length !== rangePageCount
  ) {
    throw invalidRunnerPayload('Runner payload failed structural validation.');
  }
  const pageBoxes = value.pageBoxes.map(
    (box: Record<string, unknown>, index: number): ParsedPdfPageBox =>
      parsePageBox(box, pageStart + index),
  );
  const metadataValue = value.metadata as { title?: unknown };
  if (
    metadataValue.title !== null &&
    (typeof metadataValue.title !== 'string' ||
      metadataValue.title.length === 0)
  ) {
    throw invalidRunnerPayload(
      'Runner document metadata failed structural validation.',
    );
  }
  const textRuns = value.textRuns.map(
    (run: Record<string, unknown>): ParsedPdfTextRun => {
      const pdfUserSpaceBbox = parseOptionalBbox(run.pdfUserSpaceBbox, false);
      const normalizedBbox = parseOptionalBbox(run.normalizedBbox, true);
      const parsedRun: ParsedPdfTextRun = {
        page: Number(run.page),
        fontName: String(run.fontName),
        bold: Boolean(run.bold),
        fontSize: Number(run.fontSize),
        x: Number(run.x),
        y: Number(run.y),
        text: String(run.text),
        ...(pdfUserSpaceBbox ? { pdfUserSpaceBbox } : {}),
        ...(normalizedBbox ? { normalizedBbox } : {}),
      };
      if (
        !Number.isSafeInteger(parsedRun.page) ||
        parsedRun.page < pageStart ||
        parsedRun.page > pageEnd ||
        !Number.isFinite(parsedRun.fontSize) ||
        !Number.isFinite(parsedRun.x) ||
        !Number.isFinite(parsedRun.y)
      ) {
        throw invalidRunnerPayload(
          'Runner text run failed structural validation.',
        );
      }
      return parsedRun;
    },
  );
  const pageTextLayerDiagnostics = value.pageTextLayerDiagnostics.map(
    (
      diagnostic: Record<string, unknown>,
      index: number,
    ): ParsedPdfPageTextLayerDiagnostic => {
      const page = Number(diagnostic.page);
      const textRunCount = Number(diagnostic.textRunCount);
      const nonWhitespaceCharacterCount = Number(
        diagnostic.nonWhitespaceCharacterCount,
      );
      const status = diagnostic.status;
      const rasterVisualCoverage = parseRasterVisualCoverage(
        diagnostic.rasterVisualCoverage,
      );
      if (
        page !== pageStart + index ||
        !Number.isSafeInteger(textRunCount) ||
        textRunCount < 0 ||
        !Number.isSafeInteger(nonWhitespaceCharacterCount) ||
        nonWhitespaceCharacterCount < 0 ||
        (status !== 'PRESENT' &&
          status !== 'EMPTY' &&
          status !== 'VISUAL_TEXT_UNVERIFIED') ||
        (status === 'PRESENT' &&
          (nonWhitespaceCharacterCount === 0 ||
            rasterVisualCoverage.status === 'UNVERIFIED')) ||
        (status === 'EMPTY' && nonWhitespaceCharacterCount !== 0) ||
        (status === 'VISUAL_TEXT_UNVERIFIED' &&
          (nonWhitespaceCharacterCount === 0 ||
            rasterVisualCoverage.status !== 'UNVERIFIED'))
      ) {
        throw invalidRunnerPayload(
          'Runner page text-layer diagnostics failed structural validation.',
        );
      }
      return {
        page,
        status,
        textRunCount,
        nonWhitespaceCharacterCount,
        rasterVisualCoverage,
      };
    },
  );
  return {
    pdfVersion: value.pdfVersion,
    pageCount,
    pageStart,
    pageEnd,
    pageBoxes,
    metadata: {
      title:
        typeof metadataValue?.title === 'string' &&
        metadataValue.title.length > 0
          ? metadataValue.title
          : null,
    },
    textRuns,
    pageTextLayerDiagnostics,
  };
}

function assertCompleteRunnerCoverage(
  pageCount: number,
  pageBoxes: readonly ParsedPdfPageBox[],
  textRuns: readonly ParsedPdfTextRun[],
  diagnostics: readonly ParsedPdfPageTextLayerDiagnostic[],
): void {
  if (
    pageBoxes.length !== pageCount ||
    diagnostics.length !== pageCount ||
    pageBoxes.some((box, index) => box.page !== index + 1) ||
    diagnostics.some((diagnostic, index) => diagnostic.page !== index + 1)
  ) {
    throw invalidRunnerPayload(
      'Runner chunks did not provide exact ordered coverage of every PDF page.',
    );
  }

  const observedByPage = new Map<
    number,
    { textRunCount: number; nonWhitespaceCharacterCount: number }
  >();
  for (const run of textRuns) {
    const observed = observedByPage.get(run.page) ?? {
      textRunCount: 0,
      nonWhitespaceCharacterCount: 0,
    };
    observed.textRunCount += 1;
    observed.nonWhitespaceCharacterCount += Array.from(run.text).filter(
      (character) => !/\s/u.test(character),
    ).length;
    observedByPage.set(run.page, observed);
  }
  for (const diagnostic of diagnostics) {
    const observed = observedByPage.get(diagnostic.page) ?? {
      textRunCount: 0,
      nonWhitespaceCharacterCount: 0,
    };
    if (
      diagnostic.textRunCount !== observed.textRunCount ||
      diagnostic.nonWhitespaceCharacterCount !==
        observed.nonWhitespaceCharacterCount
    ) {
      throw invalidRunnerPayload(
        `Runner text-layer diagnostic counts disagree with page ${diagnostic.page} text runs.`,
      );
    }
  }
}

function invalidRunnerPayload(message: string): ProfessionalInputPureError {
  return new ProfessionalInputPureError(
    'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
    message,
  );
}

function parsePageBox(
  box: Record<string, unknown>,
  expectedPage: number,
): ParsedPdfPageBox {
  const page = Number(box.page);
  const mediaBox = parseRequiredBbox(box.mediaBox, false);
  const rotation = Number(box.rotation);
  const userUnit = Number(box.userUnit);
  const viewport = box.viewport as Record<string, unknown> | undefined;
  const transform = Array.isArray(viewport?.transform)
    ? viewport.transform.map(Number)
    : [];
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  if (
    page !== expectedPage ||
    ![0, 90, 180, 270].includes(rotation) ||
    !(userUnit > 0) ||
    !Number.isFinite(userUnit) ||
    !(width > 0) ||
    !(height > 0) ||
    transform.length !== 6 ||
    !transform.every(Number.isFinite)
  ) {
    throw new ProfessionalInputPureError(
      'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
      'Runner page geometry failed structural validation.',
    );
  }
  return {
    page,
    mediaBox,
    rotation,
    userUnit,
    viewport: {
      width,
      height,
      transform: [
        transform[0],
        transform[1],
        transform[2],
        transform[3],
        transform[4],
        transform[5],
      ],
    },
  };
}

function parseRequiredBbox(
  raw: unknown,
  normalized: boolean,
): readonly [number, number, number, number] {
  const bbox = parseOptionalBbox(raw, normalized);
  if (!bbox) {
    throw new ProfessionalInputPureError(
      'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
      'Runner bbox failed structural validation.',
    );
  }
  return bbox;
}

function parseOptionalBbox(
  raw: unknown,
  normalized: boolean,
): readonly [number, number, number, number] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length !== 4) {
    throw invalidRunnerBbox();
  }
  const values = raw.map(Number);
  if (
    !values.every(Number.isFinite) ||
    !(values[2] > values[0]) ||
    !(values[3] > values[1]) ||
    (normalized &&
      (!values.every(Number.isSafeInteger) ||
        values.some((value) => value < 0 || value > 1_000_000)))
  ) {
    throw invalidRunnerBbox();
  }
  return [values[0], values[1], values[2], values[3]];
}

function invalidRunnerBbox(): ProfessionalInputPureError {
  return new ProfessionalInputPureError(
    'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
    'Runner text bbox failed structural validation.',
  );
}

function parseRasterVisualCoverage(
  raw: unknown,
): ParsedPdfRasterVisualCoverageDiagnostic {
  const value = raw as Record<string, unknown>;
  const status = value?.status;
  const materialUnverifiedRasterPageFraction = Number(
    value?.materialUnverifiedRasterPageFraction,
  );
  const rasterRegionCount = Number(value?.rasterRegionCount);
  const rasterPageAreaRatio = Number(value?.rasterPageAreaRatio);
  const unverifiedRasterRegionCount = Number(
    value?.unverifiedRasterRegionCount,
  );
  const unverifiedRasterPageAreaRatio = Number(
    value?.unverifiedRasterPageAreaRatio,
  );
  if (
    (status !== 'NO_MATERIAL_RASTER' &&
      status !== 'TEXT_LAYER_OVERLAP_PRESENT' &&
      status !== 'UNVERIFIED') ||
    materialUnverifiedRasterPageFraction !== 0.25 ||
    !isNonNegativeSafeInteger(rasterRegionCount) ||
    !isUnitRatio(rasterPageAreaRatio) ||
    !isNonNegativeSafeInteger(unverifiedRasterRegionCount) ||
    unverifiedRasterRegionCount > rasterRegionCount ||
    !isUnitRatio(unverifiedRasterPageAreaRatio) ||
    unverifiedRasterPageAreaRatio > rasterPageAreaRatio ||
    !Array.isArray(value?.unverifiedRasterRegions) ||
    value.unverifiedRasterRegions.length !== unverifiedRasterRegionCount ||
    (status === 'NO_MATERIAL_RASTER' && rasterPageAreaRatio >= 0.25) ||
    (status === 'TEXT_LAYER_OVERLAP_PRESENT' &&
      (rasterPageAreaRatio < 0.25 || unverifiedRasterPageAreaRatio >= 0.25)) ||
    (status === 'UNVERIFIED' && unverifiedRasterPageAreaRatio < 0.25)
  ) {
    throw invalidRasterDiagnostic();
  }
  const unverifiedRasterRegions = value.unverifiedRasterRegions.map((region) =>
    parseRasterRegion(region),
  );
  return {
    status,
    materialUnverifiedRasterPageFraction,
    rasterRegionCount,
    rasterPageAreaRatio,
    unverifiedRasterRegionCount,
    unverifiedRasterPageAreaRatio,
    unverifiedRasterRegions,
  };
}

function parseRasterRegion(raw: unknown): ParsedPdfRasterRegionDiagnostic {
  const value = raw as Record<string, unknown>;
  const bbox = Array.isArray(value?.bbox) ? value.bbox.map(Number) : [];
  const displayedPageAreaRatio = Number(value?.displayedPageAreaRatio);
  const sourcePixelWidth = nullablePositiveSafeInteger(value?.sourcePixelWidth);
  const sourcePixelHeight = nullablePositiveSafeInteger(
    value?.sourcePixelHeight,
  );
  const textLayerOverlapRunCount = Number(value?.textLayerOverlapRunCount);
  const textLayerOverlapNonWhitespaceCharacterCount = Number(
    value?.textLayerOverlapNonWhitespaceCharacterCount,
  );
  if (
    bbox.length !== 4 ||
    !bbox.every(Number.isFinite) ||
    !(Number(bbox[2]) > Number(bbox[0])) ||
    !(Number(bbox[3]) > Number(bbox[1])) ||
    !isUnitRatio(displayedPageAreaRatio) ||
    sourcePixelWidth === undefined ||
    sourcePixelHeight === undefined ||
    !isNonNegativeSafeInteger(textLayerOverlapRunCount) ||
    !isNonNegativeSafeInteger(textLayerOverlapNonWhitespaceCharacterCount) ||
    textLayerOverlapRunCount !== 0 ||
    textLayerOverlapNonWhitespaceCharacterCount !== 0
  ) {
    throw invalidRasterDiagnostic();
  }
  return {
    bbox: [Number(bbox[0]), Number(bbox[1]), Number(bbox[2]), Number(bbox[3])],
    displayedPageAreaRatio,
    sourcePixelWidth,
    sourcePixelHeight,
    textLayerOverlapRunCount,
    textLayerOverlapNonWhitespaceCharacterCount,
  };
}

function nullablePositiveSafeInteger(
  value: unknown,
): number | null | undefined {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isUnitRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function invalidRasterDiagnostic(): ProfessionalInputPureError {
  return new ProfessionalInputPureError(
    'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
    'Runner raster visual-coverage diagnostics failed structural validation.',
  );
}

export interface PdfOcrFailureDetails {
  providerStatus?: string;
  providerId?: string;
  message?: string;
  failureReasons?: readonly string[];
  failureTargets?: readonly string[];
  missingLanguages?: readonly string[];
}

function assertProductionTextLayerCoverage(layout: {
  pageCount: number;
  pageTextLayerDiagnostics: readonly ParsedPdfPageTextLayerDiagnostic[];
}): void {
  const error = buildPdfOcrRequiredUnsupportedError(layout);
  if (error) throw error;
}

/**
 * Single public OCR failure seam shared by the native extractor and private
 * composite. Provider-specific reasons stay diagnostic-only; callers always
 * observe the established PDF_OCR_REQUIRED_UNSUPPORTED code.
 */
export function buildPdfOcrRequiredUnsupportedError(
  layout: {
    pageCount: number;
    pageTextLayerDiagnostics: readonly ParsedPdfPageTextLayerDiagnostic[];
  },
  details: PdfOcrFailureDetails = {},
): ProfessionalInputPureError | null {
  const emptyTextLayerPages = layout.pageTextLayerDiagnostics
    .filter((diagnostic) => diagnostic.status === 'EMPTY')
    .map((diagnostic) => diagnostic.page);
  const visualTextUnverifiedDiagnostics =
    layout.pageTextLayerDiagnostics.filter(
      (diagnostic) => diagnostic.rasterVisualCoverage.status === 'UNVERIFIED',
    );
  const visualTextUnverifiedPages = visualTextUnverifiedDiagnostics.map(
    (diagnostic) => diagnostic.page,
  );
  const visualOnlyUnverifiedPageCount = layout.pageTextLayerDiagnostics.filter(
    (diagnostic) => diagnostic.status === 'VISUAL_TEXT_UNVERIFIED',
  ).length;
  const ocrRequiredPages = [
    ...new Set([...emptyTextLayerPages, ...visualTextUnverifiedPages]),
  ].sort((left, right) => left - right);
  if (ocrRequiredPages.length === 0) return null;

  const textLayerStatus =
    emptyTextLayerPages.length === 0
      ? 'PRESENT'
      : emptyTextLayerPages.length === layout.pageCount
        ? 'EMPTY'
        : 'PARTIAL';
  const ocrRequirementKind =
    emptyTextLayerPages.length > 0 && visualOnlyUnverifiedPageCount > 0
      ? 'TEXT_LAYER_EMPTY_AND_VISUAL_TEXT_UNVERIFIED'
      : emptyTextLayerPages.length > 0
        ? 'TEXT_LAYER_EMPTY'
        : 'VISUAL_TEXT_UNVERIFIED';
  return new ProfessionalInputPureError(
    'PDF_OCR_REQUIRED_UNSUPPORTED',
    details.message ??
      `PDF pages ${formatPageRanges(ocrRequiredPages)} of ${layout.pageCount} require OCR. Empty text-layer pages: ${formatPageRangesOrNone(emptyTextLayerPages)}. Visual-text-unverified raster pages: ${formatPageRangesOrNone(visualTextUnverifiedPages)}. No production-safe OCR layout provider is bound.`,
    {
      diagnosticKind: 'PDF_PAGE_TEXT_LAYER_COVERAGE',
      visualCoveragePolicy:
        'PDFJS_OPERATOR_RASTER_UNION_WITHOUT_TEXT_LAYER_OVERLAP',
      ocrRequirementKind,
      textLayerStatus,
      visualTextStatus:
        visualTextUnverifiedPages.length > 0 ? 'UNVERIFIED' : 'NOT_DETECTED',
      pageCount: layout.pageCount,
      ocrRequiredPages,
      ocrRequiredPageRanges: formatPageRanges(ocrRequiredPages),
      ocrRequiredPageCount: ocrRequiredPages.length,
      emptyTextLayerPages,
      emptyTextLayerPageRanges: formatPageRangesOrNone(emptyTextLayerPages),
      emptyTextLayerPageCount: emptyTextLayerPages.length,
      visualTextUnverifiedPages,
      visualTextUnverifiedPageRanges: formatPageRangesOrNone(
        visualTextUnverifiedPages,
      ),
      visualTextUnverifiedPageCount: visualTextUnverifiedPages.length,
      visualTextUnverifiedRasterPageAreaRatios:
        visualTextUnverifiedDiagnostics.map(
          (diagnostic) =>
            diagnostic.rasterVisualCoverage.unverifiedRasterPageAreaRatio,
        ),
      visualTextUnverifiedPageDetails: visualTextUnverifiedDiagnostics.map(
        (diagnostic) =>
          `${diagnostic.page}:textChars=${diagnostic.nonWhitespaceCharacterCount};unverifiedRasterPageAreaRatio=${diagnostic.rasterVisualCoverage.unverifiedRasterPageAreaRatio};regions=${diagnostic.rasterVisualCoverage.unverifiedRasterRegionCount}`,
      ),
      materialUnverifiedRasterPagePercent: 25,
      ocrProviderStatus:
        details.providerStatus ?? 'UNAVAILABLE_CURRENT_PRODUCTION',
      requiredProvider: 'HOST_BUNDLED_PAGE_OCR_LAYOUT_PROVIDER',
      ...(details.providerId ? { ocrProviderId: details.providerId } : {}),
      ...(details.failureReasons?.length
        ? { ocrFailureReasons: details.failureReasons }
        : {}),
      ...(details.failureTargets?.length
        ? { ocrFailureTargets: details.failureTargets }
        : {}),
      ...(details.missingLanguages?.length
        ? { ocrMissingLanguages: details.missingLanguages }
        : {}),
    },
  );
}

function formatPageRangesOrNone(pages: readonly number[]): string {
  return pages.length === 0 ? 'none' : formatPageRanges(pages);
}

function formatPageRanges(pages: readonly number[]): string {
  const ranges: string[] = [];
  let rangeStart = pages[0];
  let rangeEnd = pages[0];
  for (const page of pages.slice(1)) {
    if (page === Number(rangeEnd) + 1) {
      rangeEnd = page;
      continue;
    }
    ranges.push(
      rangeStart === rangeEnd
        ? String(rangeStart)
        : `${rangeStart}-${rangeEnd}`,
    );
    rangeStart = page;
    rangeEnd = page;
  }
  ranges.push(
    rangeStart === rangeEnd ? String(rangeStart) : `${rangeStart}-${rangeEnd}`,
  );
  return ranges.join(',');
}
