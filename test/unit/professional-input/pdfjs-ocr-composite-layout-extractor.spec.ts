import { createHash } from 'node:crypto';

import { runProfessionalInputPipelineFromLayout } from '../../../server/modules/professional-input/builders/professional-input-pipeline';
import { PdfjsOcrCompositeLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-ocr-composite-layout-extractor.adapter';
import type {
  PdfOcrTarget,
  TargetedPdfOcrProvider,
  TargetedPdfOcrResult,
} from '../../../server/modules/professional-input/parser/targeted-pdf-ocr.port';
import { ProfessionalInputPureError } from '../../../server/modules/professional-input/pure/professional-input-pure.error';
import type { ParsedPdfLayout } from '../../../server/modules/professional-input/pure/professional-input-pure.types';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';

const BYTES = Uint8Array.of(1, 2, 3, 4);

describe('PdfjsOcrCompositeLayoutExtractor', () => {
  it('returns a digital native layout unchanged and never invokes OCR', () => {
    const layout = nativeLayout('PRESENT');
    const recognize = jest.fn<TargetedPdfOcrResult, never>();
    const composite = compositeFor(layout, providerWith(recognize));

    const observed = composite.extractLayout(BYTES);

    expect(observed).toBe(layout);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('does not promote below-policy observable raster regions into OCR targets', () => {
    const layout = nativeLayout('PRESENT');
    layout.pageTextLayerDiagnostics[0].rasterVisualCoverage = {
      status: 'NO_MATERIAL_RASTER',
      materialUnverifiedRasterPageFraction: 0.25,
      rasterRegionCount: 1,
      rasterPageAreaRatio: 0.1,
      unverifiedRasterRegionCount: 1,
      unverifiedRasterPageAreaRatio: 0.1,
      unverifiedRasterRegions: [
        {
          bbox: [0, 0, 61.2, 79.2],
          displayedPageAreaRatio: 0.1,
          sourcePixelWidth: 300,
          sourcePixelHeight: 300,
          textLayerOverlapRunCount: 0,
          textLayerOverlapNonWhitespaceCharacterCount: 0,
        },
      ],
    };
    const recognize = jest.fn<TargetedPdfOcrResult, never>();
    const composite = compositeFor(layout, providerWith(recognize));

    expect(composite.extractLayout(BYTES)).toBe(layout);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('materializes an empty page into the same SPP/U0/Reader path with exact refs', () => {
    const layout = nativeLayout('EMPTY');
    const recognize = jest.fn(
      (input: {
        bytes: Uint8Array;
        layout: ParsedPdfLayout;
        targets: readonly PdfOcrTarget[];
      }): TargetedPdfOcrResult => ({
        sourceSha256: input.layout.sourceSha256,
        sourceByteLength: input.layout.sourceByteLength,
        pageCount: input.layout.pageCount,
        providerId: 'test-host-ocr',
        targets: input.targets.map((target) => ({
          targetId: target.targetId,
          page: target.page,
          status: 'EXTRACTED' as const,
          lines: [ocrLine('扫描页 OCR 可追溯内容')],
          confidence: {
            characterWeightedMean: 96.25,
            wordsBelow60Ratio: 0,
            wordCount: 6,
          },
        })),
      }),
    );
    const composite = compositeFor(layout, providerWith(recognize));

    const merged = composite.extractLayout(BYTES);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize.mock.calls[0][0].targets).toEqual([
      {
        targetId: 'page-1-full',
        page: 1,
        reason: 'TEXT_LAYER_EMPTY',
        scope: 'FULL_PAGE',
        pdfUserSpaceBbox: [0, 0, 612, 792],
        requiredLanguages: ['eng', 'chi_sim'],
      },
    ]);
    expect(merged.textRuns).toEqual([
      expect.objectContaining({
        origin: 'ocr_tesseract_tsv',
        readingOrder: 0,
        normalizedBbox: [100_000, 200_000, 700_000, 240_000],
      }),
    ]);
    expect(merged.pageTextLayerDiagnostics[0]).toMatchObject({
      status: 'PRESENT',
      ocrCoverage: {
        status: 'OCR_COVERED',
        providerId: 'test-host-ocr',
        requiredLanguages: ['eng', 'chi_sim'],
        targetCount: 1,
        acceptedLineCount: 1,
      },
    });

    const pipeline = runProfessionalInputPipelineFromLayout(merged, {
      artifact: {
        artifactRef: 'artifact://CanonicalArtifactStore/ocr-test.pdf',
        normalizedPath: 'ocr-test.pdf',
      },
      document: {
        documentCode: 'OCR-TEST-001',
        documentType: 'service_bulletin',
        language: 'zh-CN',
      },
      lineage: {
        generatedAt: '2026-08-30T00:00:00.000Z',
        producerName: 'pdfjs-ocr-composite-test',
        producerVersion: 'test',
      },
    });
    const textUnit = pipeline.unitSet.units.find(
      (unit) => unit.kind !== 'source_metadata',
    );
    expect(textUnit?.sourceRefIds).toHaveLength(2);
    expect(
      textUnit?.sourceRefIds.map(
        (sourceRefId) =>
          pipeline.unitSet.sourceRefs.find(
            (sourceRef) => sourceRef.sourceRefId === sourceRefId,
          )?.bbox,
      ),
    ).toEqual([
      [0, 0, 1_000_000, 1_000_000],
      [100_000, 200_000, 700_000, 240_000],
    ]);

    const readback = new Frozen2CandidateReaderService().read(
      pipeline.u0Input.artifact,
      pipeline.u0Input.bytes,
      '可追溯',
    );
    expect(readback).toMatchObject({
      packageId: pipeline.pkg.packageId,
      sourceKind: 'pdf',
      resultStatus: 'complete',
    });
    expect(readback.queryResults[0].sourceRefIds).toHaveLength(2);
  });

  it.each([
    {
      reason: 'OCR_LANGUAGE_ASSET_MISSING' as const,
      providerStatus: 'UNAVAILABLE_RUNTIME_ASSETS',
      missingLanguages: ['chi_sim'],
    },
    {
      reason: 'OCR_LOW_CONFIDENCE' as const,
      providerStatus: 'REVIEW_REQUIRED_LOW_CONFIDENCE',
      missingLanguages: undefined,
    },
  ])(
    'maps $reason to the existing observable fail-closed error',
    ({ reason, providerStatus, missingLanguages }) => {
      const layout = nativeLayout('EMPTY');
      const provider = providerWith((input) => ({
        sourceSha256: input.layout.sourceSha256,
        sourceByteLength: input.layout.sourceByteLength,
        pageCount: input.layout.pageCount,
        providerId: 'test-host-ocr',
        targets: input.targets.map((target) => ({
          targetId: target.targetId,
          page: target.page,
          status: 'FAILED' as const,
          reason,
          diagnostic: reason,
          ...(missingLanguages ? { missingLanguages } : {}),
        })),
      }));

      const error = captureFailure(compositeFor(layout, provider));

      expect(error.code).toBe('PDF_OCR_REQUIRED_UNSUPPORTED');
      expect(error.diagnostic).toMatchObject({
        ocrProviderStatus: providerStatus,
        ocrProviderId: 'test-host-ocr',
        ocrFailureReasons: [reason],
        ocrFailureTargets: ['page-1-full'],
        ...(missingLanguages ? { ocrMissingLanguages: missingLanguages } : {}),
      });
    },
  );

  it('fails closed when OCR conflicts with overlapping native text', () => {
    const layout = nativeLayout('VISUAL_TEXT_UNVERIFIED');
    const provider = providerWith((input) => ({
      sourceSha256: input.layout.sourceSha256,
      sourceByteLength: input.layout.sourceByteLength,
      pageCount: input.layout.pageCount,
      providerId: 'test-host-ocr',
      targets: input.targets.map((target) => ({
        targetId: target.targetId,
        page: target.page,
        status: 'EXTRACTED' as const,
        lines: [ocrLine('CONFLICTING ENGINEERING INSTRUCTION')],
        confidence: {
          characterWeightedMean: 97,
          wordsBelow60Ratio: 0,
          wordCount: 3,
        },
      })),
    }));

    const error = captureFailure(compositeFor(layout, provider));

    expect(error.code).toBe('PDF_OCR_REQUIRED_UNSUPPORTED');
    expect(error.diagnostic).toMatchObject({
      ocrProviderStatus: 'FAILED_CLOSED',
      ocrFailureReasons: ['OCR_TARGET_RESULT_INCOMPLETE'],
    });
  });
});

function compositeFor(
  layout: ParsedPdfLayout,
  provider: TargetedPdfOcrProvider,
): PdfjsOcrCompositeLayoutExtractor {
  return new PdfjsOcrCompositeLayoutExtractor(
    {
      extractorId: 'test-native-pdfjs',
      extractLayout: () => layout,
      extractLayoutWithDiagnostics: () => layout,
    },
    provider,
  );
}

function providerWith(
  recognize: TargetedPdfOcrProvider['recognize'],
): TargetedPdfOcrProvider {
  return {
    providerId: 'test-host-ocr',
    preflight: () => ({
      status: 'READY',
      providerId: 'test-host-ocr',
      rendererVersion: '25.03.0',
      engineVersion: '5.5.0',
      tessdataRevision: 'tessdata_fast-4.1.0',
      installedLanguages: ['chi_sim', 'eng'],
      missingLanguages: [],
      reasons: [],
    }),
    recognize,
  };
}

function captureFailure(
  composite: PdfjsOcrCompositeLayoutExtractor,
): ProfessionalInputPureError {
  try {
    composite.extractLayout(BYTES);
  } catch (error) {
    expect(error).toBeInstanceOf(ProfessionalInputPureError);
    return error as ProfessionalInputPureError;
  }
  throw new Error('EXPECTED_PDF_OCR_REQUIRED_UNSUPPORTED');
}

function nativeLayout(
  status: 'PRESENT' | 'EMPTY' | 'VISUAL_TEXT_UNVERIFIED',
): ParsedPdfLayout {
  const hasText = status !== 'EMPTY';
  const hasUnverifiedRaster = status === 'VISUAL_TEXT_UNVERIFIED';
  return {
    kind: 'pdf',
    pdfVersion: '1.7',
    pageCount: 1,
    pageBoxes: [
      {
        page: 1,
        mediaBox: [0, 0, 612, 792],
        rotation: 0,
        userUnit: 1,
        viewport: {
          width: 612,
          height: 792,
          transform: [1, 0, 0, -1, 0, 792],
        },
      },
    ],
    metadata: { title: null },
    textRuns: hasText
      ? [
          {
            page: 1,
            fontName: 'Helvetica',
            bold: false,
            fontSize: 12,
            x: 61.2,
            y: 601.92,
            text: 'NATIVE TEXT LAYER CONTENT',
            pdfUserSpaceBbox: [61.2, 601.92, 428.4, 633.6],
            normalizedBbox: [100_000, 200_000, 700_000, 240_000],
          },
        ]
      : [],
    pageTextLayerDiagnostics: [
      {
        page: 1,
        status,
        textRunCount: hasText ? 1 : 0,
        nonWhitespaceCharacterCount: hasText ? 22 : 0,
        rasterVisualCoverage: {
          status: hasUnverifiedRaster ? 'UNVERIFIED' : 'NO_MATERIAL_RASTER',
          materialUnverifiedRasterPageFraction: 0.25,
          rasterRegionCount: hasUnverifiedRaster ? 1 : 0,
          rasterPageAreaRatio: hasUnverifiedRaster ? 1 : 0,
          unverifiedRasterRegionCount: hasUnverifiedRaster ? 1 : 0,
          unverifiedRasterPageAreaRatio: hasUnverifiedRaster ? 1 : 0,
          unverifiedRasterRegions: hasUnverifiedRaster
            ? [
                {
                  bbox: [0, 0, 612, 792],
                  displayedPageAreaRatio: 1,
                  sourcePixelWidth: 2550,
                  sourcePixelHeight: 3300,
                  textLayerOverlapRunCount: 0,
                  textLayerOverlapNonWhitespaceCharacterCount: 0,
                },
              ]
            : [],
        },
      },
    ],
    sourceSha256: `sha256:${createHash('sha256').update(BYTES).digest('hex')}`,
    sourceByteLength: BYTES.byteLength,
  };
}

function ocrLine(text: string): ParsedPdfLayout['textRuns'][number] {
  return {
    page: 1,
    fontName: 'OCR_TESSERACT_TSV',
    bold: false,
    fontSize: 31.68,
    x: 61.2,
    y: 601.92,
    text,
    origin: 'ocr_tesseract_tsv',
    readingOrder: 0,
    pdfUserSpaceBbox: [61.2, 601.92, 428.4, 633.6],
    normalizedBbox: [100_000, 200_000, 700_000, 240_000],
    confidence: 96.25,
  };
}
