import type {
  ParsedPdfLayout,
  ParsedPdfPageBox,
  ParsedPdfPageTextLayerDiagnostic,
  ParsedPdfTextRun,
} from '../pure/professional-input-pure.types';
import type { PdfLayoutExtractorPort } from './pdf-layout.extractor.port';
import {
  buildPdfOcrRequiredUnsupportedError,
  PdfjsDistLayoutExtractor,
} from './pdfjs-dist-layout-extractor.adapter';
import {
  TesseractTsvPdfOcrAdapter,
  type TesseractTsvPdfOcrOptions,
} from './tesseract-tsv-pdf-ocr.adapter';
import type {
  PdfOcrRuntimePreflight,
  PdfOcrTarget,
  PdfOcrTargetFailure,
  PdfOcrTargetSuccess,
  TargetedPdfOcrProvider,
} from './targeted-pdf-ocr.port';

const REQUIRED_OCR_LANGUAGES = ['eng', 'chi_sim'] as const;
const DUPLICATE_OR_CONFLICT_OVERLAP = 0.5;
const DUPLICATE_TEXT_SIMILARITY = 0.9;

interface NativeDiagnosticExtractor extends PdfLayoutExtractorPort {
  extractLayoutWithDiagnostics?(bytes: Uint8Array): ParsedPdfLayout;
}

interface OcrRunGroup {
  page: number;
  targetId: string;
  top: number;
  lines: ParsedPdfTextRun[];
}

/**
 * The one canonical PdfLayoutExtractorPort implementation used by the Host
 * producer. Native pdfjs remains authoritative; this private composite only
 * materializes diagnostics-selected OCR pages/regions, then returns one
 * merged ParsedPdfLayout to the existing builders/U0/Reader.
 */
export class PdfjsOcrCompositeLayoutExtractor implements PdfLayoutExtractorPort {
  readonly extractorId: string;

  constructor(
    private readonly nativeExtractor: NativeDiagnosticExtractor = new PdfjsDistLayoutExtractor(),
    private readonly ocrProvider: TargetedPdfOcrProvider = new TesseractTsvPdfOcrAdapter(),
  ) {
    this.extractorId = `${nativeExtractor.extractorId}+${ocrProvider.providerId}`;
  }

  static withOcrRuntime(
    options: TesseractTsvPdfOcrOptions,
  ): PdfjsOcrCompositeLayoutExtractor {
    return new PdfjsOcrCompositeLayoutExtractor(
      new PdfjsDistLayoutExtractor(),
      new TesseractTsvPdfOcrAdapter(options),
    );
  }

  preflight(): PdfOcrRuntimePreflight {
    return this.ocrProvider.preflight();
  }

  extractLayout(bytes: Uint8Array): ParsedPdfLayout {
    const layout = this.nativeExtractor.extractLayoutWithDiagnostics
      ? this.nativeExtractor.extractLayoutWithDiagnostics(bytes)
      : this.nativeExtractor.extractLayout(bytes);
    const targets = selectOcrTargets(layout);
    if (targets.length === 0) return layout;

    const result = this.ocrProvider.recognize({ bytes, layout, targets });
    assertProviderResultIdentity(layout, targets, result);
    const failures = result.targets.filter(
      (target): target is PdfOcrTargetFailure => target.status === 'FAILED',
    );
    if (failures.length > 0) {
      throwCompositeFailure(layout, result.providerId, failures);
    }
    const successes = result.targets.filter(
      (target): target is PdfOcrTargetSuccess => target.status === 'EXTRACTED',
    );
    if (successes.length !== targets.length) {
      throwCompositeFailure(layout, result.providerId, [
        {
          targetId: 'provider-result',
          page: 1,
          status: 'FAILED',
          reason: 'OCR_TARGET_RESULT_INCOMPLETE',
          diagnostic: 'OCR_TARGET_RESULT_INCOMPLETE',
        },
      ]);
    }

    const merged = mergeOcrRuns(layout, successes);
    if (merged.conflicts.length > 0) {
      throwCompositeFailure(layout, result.providerId, [
        {
          targetId: merged.conflicts.join(','),
          page: Number(merged.conflictPages[0] ?? 1),
          status: 'FAILED',
          reason: 'OCR_TARGET_RESULT_INCOMPLETE',
          diagnostic: 'OCR_NATIVE_TEXT_CONFLICT',
        },
      ]);
    }

    return {
      ...layout,
      textRuns: merged.textRuns,
      pageTextLayerDiagnostics: materializeOcrCoverage(
        layout,
        successes,
        merged.textRuns,
        result.providerId,
      ),
    };
  }
}

function selectOcrTargets(layout: ParsedPdfLayout): PdfOcrTarget[] {
  const targets: PdfOcrTarget[] = [];
  for (const diagnostic of layout.pageTextLayerDiagnostics) {
    const pageBox = pageBoxFor(layout, diagnostic.page);
    if (diagnostic.status === 'EMPTY') {
      targets.push({
        targetId: `page-${diagnostic.page}-full`,
        page: diagnostic.page,
        reason: 'TEXT_LAYER_EMPTY',
        scope: 'FULL_PAGE',
        pdfUserSpaceBbox: pageBox.mediaBox,
        requiredLanguages: REQUIRED_OCR_LANGUAGES,
      });
      continue;
    }
    if (diagnostic.rasterVisualCoverage.status !== 'UNVERIFIED') continue;
    diagnostic.rasterVisualCoverage.unverifiedRasterRegions.forEach(
      (region, index): void => {
        targets.push({
          targetId: `page-${diagnostic.page}-raster-${index + 1}`,
          page: diagnostic.page,
          reason: 'UNRESOLVED_REQUIRED_RASTER_REGION',
          scope: 'RASTER_REGION',
          pdfUserSpaceBbox: region.bbox,
          requiredLanguages: REQUIRED_OCR_LANGUAGES,
        });
      },
    );
  }
  return targets;
}

function assertProviderResultIdentity(
  layout: ParsedPdfLayout,
  targets: readonly PdfOcrTarget[],
  result: ReturnType<TargetedPdfOcrProvider['recognize']>,
): void {
  const expectedTargets = new Map(
    targets.map((target: PdfOcrTarget) => [target.targetId, target]),
  );
  const observedIds = new Set<string>();
  let valid =
    result.sourceSha256 === layout.sourceSha256 &&
    result.sourceByteLength === layout.sourceByteLength &&
    result.pageCount === layout.pageCount &&
    result.targets.length === targets.length;
  for (const targetResult of result.targets) {
    const expected = expectedTargets.get(targetResult.targetId);
    if (
      !expected ||
      expected.page !== targetResult.page ||
      observedIds.has(targetResult.targetId)
    ) {
      valid = false;
    }
    observedIds.add(targetResult.targetId);
  }
  if (valid && observedIds.size === expectedTargets.size) return;
  throwCompositeFailure(layout, result.providerId, [
    {
      targetId: 'provider-identity',
      page: 1,
      status: 'FAILED',
      reason: 'OCR_TARGET_RESULT_INCOMPLETE',
      diagnostic: 'OCR_SOURCE_IDENTITY_OR_TARGET_ECHO_MISMATCH',
    },
  ]);
}

function throwCompositeFailure(
  layout: ParsedPdfLayout,
  providerId: string,
  failures: readonly PdfOcrTargetFailure[],
): never {
  const reasons = failures.map(
    (failure: PdfOcrTargetFailure): string => failure.reason,
  );
  const failureTargets = failures.map(
    (failure: PdfOcrTargetFailure): string => failure.targetId,
  );
  const missingLanguages = [
    ...new Set(
      failures.flatMap(
        (failure: PdfOcrTargetFailure): readonly string[] =>
          failure.missingLanguages ?? [],
      ),
    ),
  ].sort();
  const providerStatus = reasons.includes('OCR_LANGUAGE_ASSET_MISSING')
    ? 'UNAVAILABLE_RUNTIME_ASSETS'
    : reasons.includes('OCR_LOW_CONFIDENCE')
      ? 'REVIEW_REQUIRED_LOW_CONFIDENCE'
      : 'FAILED_CLOSED';
  const error = buildPdfOcrRequiredUnsupportedError(layout, {
    providerStatus,
    providerId,
    failureReasons: reasons,
    failureTargets,
    missingLanguages,
    message:
      `Required PDF OCR targets were not completely materialized by the ` +
      `Host provider (${providerStatus}); no parsed package was emitted.`,
  });
  if (error) throw error;
  throw new Error('PDF_OCR_REQUIRED_DIAGNOSTIC_MISSING');
}

function mergeOcrRuns(
  layout: ParsedPdfLayout,
  successes: readonly PdfOcrTargetSuccess[],
): {
  textRuns: readonly ParsedPdfTextRun[];
  conflicts: readonly string[];
  conflictPages: readonly number[];
} {
  const nativeRuns = [...layout.textRuns];
  const groups: OcrRunGroup[] = [];
  const acceptedOcr: ParsedPdfTextRun[] = [];
  const conflicts: string[] = [];
  const conflictPages: number[] = [];

  for (const success of successes) {
    const groupLines: ParsedPdfTextRun[] = [];
    for (const line of success.lines) {
      if (
        line.page !== success.page ||
        line.origin !== 'ocr_tesseract_tsv' ||
        !line.normalizedBbox ||
        !line.pdfUserSpaceBbox ||
        !Number.isSafeInteger(line.readingOrder) ||
        line.readingOrder < 0 ||
        !line.text.trim()
      ) {
        throwCompositeFailure(layout, 'invalid-ocr-provider-result', [
          {
            targetId: success.targetId,
            page: success.page,
            status: 'FAILED',
            reason: 'OCR_TARGET_RESULT_INCOMPLETE',
            diagnostic: 'OCR_LINE_RESULT_INVALID',
          },
        ]);
      }
      const overlappingNative = nativeRuns.filter(
        (native: ParsedPdfTextRun): boolean =>
          native.page === line.page &&
          Boolean(native.normalizedBbox) &&
          overlapOverSmaller(
            line.normalizedBbox as readonly [number, number, number, number],
            native.normalizedBbox as readonly [number, number, number, number],
          ) >= DUPLICATE_OR_CONFLICT_OVERLAP,
      );
      const nativeText = overlappingNative
        .map((native: ParsedPdfTextRun): string => native.text)
        .join('');
      if (
        nativeText &&
        textSimilarity(line.text, nativeText) >= DUPLICATE_TEXT_SIMILARITY
      ) {
        continue;
      }
      if (nativeText) {
        conflicts.push(success.targetId);
        conflictPages.push(success.page);
        continue;
      }
      const duplicateOcr = acceptedOcr.some(
        (existing: ParsedPdfTextRun): boolean =>
          existing.page === line.page &&
          Boolean(existing.normalizedBbox) &&
          overlapOverSmaller(
            line.normalizedBbox,
            existing.normalizedBbox as readonly [
              number,
              number,
              number,
              number,
            ],
          ) >= DUPLICATE_OR_CONFLICT_OVERLAP &&
          textSimilarity(line.text, existing.text) >= DUPLICATE_TEXT_SIMILARITY,
      );
      if (duplicateOcr) continue;
      groupLines.push(line);
      acceptedOcr.push(line);
    }
    if (groupLines.length === 0 && conflicts.length === 0) {
      throwCompositeFailure(layout, 'ocr-provider-empty-after-dedupe', [
        {
          targetId: success.targetId,
          page: success.page,
          status: 'FAILED',
          reason: 'OCR_EMPTY_REQUIRED_REGION',
          diagnostic: 'OCR_TARGET_EMPTY_AFTER_DEDUPE',
        },
      ]);
    }
    const top = Math.min(
      ...groupLines.map(
        (line: ParsedPdfTextRun): number => line.normalizedBbox?.[1] ?? 0,
      ),
    );
    groups.push({
      page: success.page,
      targetId: success.targetId,
      top,
      lines: groupLines,
    });
  }

  const textRuns: ParsedPdfTextRun[] = [];
  for (let page = 1; page <= layout.pageCount; page += 1) {
    const pageNative = nativeRuns.filter(
      (run: ParsedPdfTextRun): boolean => run.page === page,
    );
    const pageGroups = groups
      .filter((group: OcrRunGroup): boolean => group.page === page)
      .sort(
        (left: OcrRunGroup, right: OcrRunGroup): number =>
          left.top - right.top || left.targetId.localeCompare(right.targetId),
      );
    if (pageGroups.length === 0) {
      textRuns.push(...pageNative);
      continue;
    }
    const entries: Array<{
      top: number;
      priority: number;
      runs: ParsedPdfTextRun[];
    }> = pageNative.map((run: ParsedPdfTextRun) => ({
      top: run.normalizedBbox?.[1] ?? normalizedTopFallback(run, layout),
      priority: 0,
      runs: [run],
    }));
    pageGroups.forEach((group: OcrRunGroup): void => {
      entries.push({ top: group.top, priority: 1, runs: group.lines });
    });
    entries.sort(
      (left, right): number =>
        left.top - right.top || left.priority - right.priority,
    );
    let ocrReadingOrder = 0;
    for (const entry of entries) {
      for (const run of entry.runs) {
        if (run.origin === 'ocr_tesseract_tsv') {
          textRuns.push({ ...run, readingOrder: ocrReadingOrder });
          ocrReadingOrder += 1;
        } else {
          textRuns.push(run);
        }
      }
    }
  }
  return { textRuns, conflicts, conflictPages };
}

function materializeOcrCoverage(
  layout: ParsedPdfLayout,
  successes: readonly PdfOcrTargetSuccess[],
  textRuns: readonly ParsedPdfTextRun[],
  providerId: string,
): ParsedPdfPageTextLayerDiagnostic[] {
  return layout.pageTextLayerDiagnostics.map(
    (
      diagnostic: ParsedPdfPageTextLayerDiagnostic,
    ): ParsedPdfPageTextLayerDiagnostic => {
      const pageTargets = successes.filter(
        (success: PdfOcrTargetSuccess): boolean =>
          success.page === diagnostic.page,
      );
      if (pageTargets.length === 0) return diagnostic;
      const pageRuns = textRuns.filter(
        (run: ParsedPdfTextRun): boolean => run.page === diagnostic.page,
      );
      const ocrRuns = pageRuns.filter(
        (run: ParsedPdfTextRun): boolean => run.origin === 'ocr_tesseract_tsv',
      );
      const wordCount = pageTargets.reduce(
        (sum: number, target: PdfOcrTargetSuccess): number =>
          sum + target.confidence.wordCount,
        0,
      );
      const meanConfidence = pageTargets.reduce(
        (sum: number, target: PdfOcrTargetSuccess): number =>
          sum +
          target.confidence.characterWeightedMean * target.confidence.wordCount,
        0,
      );
      const lowConfidenceRatio = pageTargets.reduce(
        (sum: number, target: PdfOcrTargetSuccess): number =>
          sum +
          target.confidence.wordsBelow60Ratio * target.confidence.wordCount,
        0,
      );
      const raster = diagnostic.rasterVisualCoverage;
      return {
        page: diagnostic.page,
        status: 'PRESENT',
        textRunCount: pageRuns.length,
        nonWhitespaceCharacterCount: pageRuns.reduce(
          (count: number, run: ParsedPdfTextRun): number =>
            count + run.text.replace(/\s/gu, '').length,
          0,
        ),
        rasterVisualCoverage: {
          ...raster,
          status:
            raster.rasterPageAreaRatio >=
            raster.materialUnverifiedRasterPageFraction
              ? 'TEXT_LAYER_OVERLAP_PRESENT'
              : 'NO_MATERIAL_RASTER',
          unverifiedRasterRegionCount: 0,
          unverifiedRasterPageAreaRatio: 0,
          unverifiedRasterRegions: [],
        },
        ocrCoverage: {
          status: 'OCR_COVERED',
          providerId,
          requiredLanguages: REQUIRED_OCR_LANGUAGES,
          targetCount: pageTargets.length,
          acceptedLineCount: ocrRuns.length,
          characterWeightedMeanConfidence:
            wordCount > 0 ? round6(meanConfidence / wordCount) : 0,
          wordsBelow60Ratio:
            wordCount > 0 ? round6(lowConfidenceRatio / wordCount) : 0,
        },
      };
    },
  );
}

function pageBoxFor(layout: ParsedPdfLayout, page: number): ParsedPdfPageBox {
  const pageBox = layout.pageBoxes.find(
    (candidate: ParsedPdfPageBox): boolean => candidate.page === page,
  );
  if (!pageBox) throw new Error(`PDF_PAGE_BOX_MISSING:${page}`);
  return pageBox;
}

function normalizedTopFallback(
  run: ParsedPdfTextRun,
  layout: ParsedPdfLayout,
): number {
  const pageBox = pageBoxFor(layout, run.page).mediaBox;
  const height = pageBox[3] - pageBox[1];
  if (!(height > 0)) return 0;
  return Math.round(
    Math.min(1, Math.max(0, (pageBox[3] - run.y) / height)) * 1_000_000,
  );
}

function overlapOverSmaller(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(left[2], right[2]) - Math.max(left[0], right[0]),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left[3], right[3]) - Math.max(left[1], right[1]),
  );
  const intersection = intersectionWidth * intersectionHeight;
  const leftArea =
    Math.max(1, left[2] - left[0]) * Math.max(1, left[3] - left[1]);
  const rightArea =
    Math.max(1, right[2] - right[0]) * Math.max(1, right[3] - right[1]);
  return intersection / Math.min(leftArea, rightArea);
}

function textSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  if (
    Math.min(normalizedLeft.length, normalizedRight.length) >= 6 &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  ) {
    return (
      Math.min(normalizedLeft.length, normalizedRight.length) /
      Math.max(normalizedLeft.length, normalizedRight.length)
    );
  }
  const leftTokens = new Set(normalizedLeft.split(' ').filter(Boolean));
  const rightTokens = new Set(normalizedRight.split(' ').filter(Boolean));
  const intersection = [...leftTokens].filter((token: string): boolean =>
    rightTokens.has(token),
  ).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
}

function round6(value: number): number {
  return Number(value.toFixed(6));
}
