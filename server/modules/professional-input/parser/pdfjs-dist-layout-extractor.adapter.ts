import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

  constructor(
    runnerPath?: string,
    pdfjsEntrypoint = resolvePdfjsEntrypoint(),
  ) {
    this.runnerPath =
      runnerPath ?? resolve(__dirname, 'pdfjs-layout-extractor.runner.mjs');
    this.pdfjsEntrypoint = pdfjsEntrypoint;
  }

  extractLayout(bytes: Uint8Array): ParsedPdfLayout {
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
      const result = spawnSync(
        process.execPath,
        [this.runnerPath, sourcePath, this.pdfjsEntrypoint],
        {
          maxBuffer: 512 * 1024 * 1024,
          timeout: 120_000,
        },
      );
      if (result.error) {
        throw new ProfessionalInputPureError(
          'PDFJS_LAYOUT_RUNNER_SPAWN_FAILED',
          `Failed to execute pdfjs-dist runner: ${result.error.message}`,
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
          `pdfjs-dist runner exited with status ${result.status ?? 'null'}: ${result.stderr
            .toString('utf8')
            .trim()
            .slice(0, 500)}`,
        );
      }
      const layout = parseRunnerPayload(result.stdout.toString('utf8'));
      assertProductionTextLayerCoverage(layout);
      return {
        kind: 'pdf',
        pdfVersion: layout.pdfVersion,
        pageCount: layout.pageCount,
        pageBoxes: layout.pageBoxes,
        metadata: layout.metadata,
        textRuns: layout.textRuns,
        pageTextLayerDiagnostics: layout.pageTextLayerDiagnostics,
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
  return createRequire(__filename).resolve(
    'pdfjs-dist/legacy/build/pdf.mjs',
  );
}

/** SHA-256 hex over the exact input bytes. */
function sourceSha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface RunnerPayload {
  pdfVersion: unknown;
  pageCount: unknown;
  pageBoxes: unknown;
  metadata: unknown;
  textRuns: unknown;
  pageTextLayerDiagnostics: unknown;
}

const RUNNER_PAYLOAD_BEGIN = '<<<PDFJS-LAYOUT-JSON-BEGIN>>>';
const RUNNER_PAYLOAD_END = '<<<PDFJS-LAYOUT-JSON-END>>>';

function parseRunnerPayload(raw: string): {
  pdfVersion: string;
  pageCount: number;
  pageBoxes: readonly ParsedPdfPageBox[];
  metadata: { title: string | null };
  textRuns: readonly ParsedPdfTextRun[];
  pageTextLayerDiagnostics: readonly ParsedPdfPageTextLayerDiagnostic[];
} {
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
  if (
    typeof value.pdfVersion !== 'string' ||
    typeof value.pageCount !== 'number' ||
    !Number.isSafeInteger(value.pageCount) ||
    value.pageCount < 1 ||
    !Array.isArray(value.pageBoxes) ||
    !Array.isArray(value.textRuns) ||
    !Array.isArray(value.pageTextLayerDiagnostics) ||
    value.pageBoxes.length !== value.pageCount ||
    value.pageTextLayerDiagnostics.length !== value.pageCount
  ) {
    throw new ProfessionalInputPureError(
      'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
      'Runner payload failed structural validation.',
    );
  }
  const pageBoxes = value.pageBoxes.map(
    (box: Record<string, unknown>): ParsedPdfPageBox => ({
      page: Number(box.page),
      mediaBox: [
        Number(box.mediaBox?.[0]),
        Number(box.mediaBox?.[1]),
        Number(box.mediaBox?.[2]),
        Number(box.mediaBox?.[3]),
      ],
    }),
  );
  const metadataValue = value.metadata as { title?: unknown };
  const textRuns = value.textRuns.map(
    (run: Record<string, unknown>): ParsedPdfTextRun => ({
      page: Number(run.page),
      fontName: String(run.fontName),
      bold: Boolean(run.bold),
      fontSize: Number(run.fontSize),
      x: Number(run.x),
      y: Number(run.y),
      text: String(run.text),
    }),
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
        page !== index + 1 ||
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
        throw new ProfessionalInputPureError(
          'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
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
    pageCount: value.pageCount,
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
  const unverifiedRasterRegions = value.unverifiedRasterRegions.map(
    (region) => parseRasterRegion(region),
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
    !isNonNegativeSafeInteger(
      textLayerOverlapNonWhitespaceCharacterCount,
    ) ||
    textLayerOverlapRunCount !== 0 ||
    textLayerOverlapNonWhitespaceCharacterCount !== 0
  ) {
    throw invalidRasterDiagnostic();
  }
  return {
    bbox: [
      Number(bbox[0]),
      Number(bbox[1]),
      Number(bbox[2]),
      Number(bbox[3]),
    ],
    displayedPageAreaRatio,
    sourcePixelWidth,
    sourcePixelHeight,
    textLayerOverlapRunCount,
    textLayerOverlapNonWhitespaceCharacterCount,
  };
}

function nullablePositiveSafeInteger(value: unknown): number | null | undefined {
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

function assertProductionTextLayerCoverage(layout: {
  pageCount: number;
  pageTextLayerDiagnostics: readonly ParsedPdfPageTextLayerDiagnostic[];
}): void {
  const emptyTextLayerPages = layout.pageTextLayerDiagnostics
    .filter((diagnostic) => diagnostic.status === 'EMPTY')
    .map((diagnostic) => diagnostic.page);
  const visualTextUnverifiedDiagnostics = layout.pageTextLayerDiagnostics.filter(
    (diagnostic) =>
      diagnostic.rasterVisualCoverage.status === 'UNVERIFIED',
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
  if (ocrRequiredPages.length === 0) return;

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
  throw new ProfessionalInputPureError(
    'PDF_OCR_REQUIRED_UNSUPPORTED',
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
      ocrProviderStatus: 'UNAVAILABLE_CURRENT_PRODUCTION',
      requiredProvider: 'HOST_BUNDLED_PAGE_OCR_LAYOUT_PROVIDER',
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
