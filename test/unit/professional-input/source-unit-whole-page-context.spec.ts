import { buildSourceUnitSet } from '../../../server/modules/professional-input/builders/source-unit-set.builder';
import { buildStructuredParsePackage } from '../../../server/modules/professional-input/builders/structured-parse-package.builder';
import type { ParsedPdfLayout } from '../../../server/modules/professional-input/pure/professional-input-pure.types';

const ARTIFACT = {
  artifactRef: 'artifact://CanonicalArtifactStore/test.pdf',
  normalizedPath: 'test.pdf',
};

describe('professional-input whole-page source context', () => {
  it('keeps a legal blank page while binding a text page to its real page context', () => {
    const layout = pdfLayout([
      {
        page: 1,
        fontName: 'Helvetica',
        bold: false,
        fontSize: 12,
        x: 72,
        y: 700,
        text: 'ACTUAL PAGE TEXT',
      },
    ]);

    const unitSet = buildSourceUnitSet(layout, {
      documentCode: 'TEST-001',
      artifact: ARTIFACT,
    });
    const pageRefs = unitSet.sourceRefs.filter(
      (ref) =>
        ref.charStart === 0 && ref.charOffsetUnit === 'unicode_scalar_value',
    );

    expect(pageRefs).toHaveLength(1);
    expect(pageRefs[0]).toMatchObject({
      pageStart: 1,
      pageEnd: 1,
      bbox: [0, 0, 1000000, 1000000],
      quote: 'ACTUAL PAGE TEXT',
      charStart: 0,
      charEnd: 16,
      charOffsetUnit: 'unicode_scalar_value',
    });
    expect(unitSet.sourceRefs.some((ref) => ref.pageStart === 2)).toBe(false);

    const textUnit = unitSet.units.find(
      (unit) => unit.kind !== 'source_metadata',
    );
    expect(textUnit).toBeDefined();
    expect(textUnit?.sourceRefIds).toEqual([pageRefs[0].sourceRefId]);
    expect(pageRefs[0].quote).toContain(textUnit?.text ?? '');
  });

  it('keeps the existing empty-content failure when every page is blank', () => {
    const layout = pdfLayout([]);
    const unitSet = buildSourceUnitSet(layout, {
      documentCode: 'TEST-001',
      artifact: ARTIFACT,
    });

    expect(unitSet.units).toHaveLength(1);
    expect(unitSet.sourceRefs).toHaveLength(1);
    expect(() =>
      buildStructuredParsePackage({
        layout,
        unitSet,
        artifact: ARTIFACT,
        document: {
          documentCode: 'TEST-001',
          documentType: 'service_bulletin',
          language: 'en-US',
        },
        lineage: {
          generatedAt: '2026-08-28T00:00:00.000Z',
          producerName: 'whole-page-source-context-test',
          producerVersion: 'test',
        },
      }),
    ).toThrow('PACKAGE_CONTENT_UNITS_EMPTY');
  });

  it('keeps whole-page context and appends an exact granular ref for the first OCR line', () => {
    const exactBbox = [123_456, 234_567, 654_321, 345_678] as const;
    const layout = pdfLayout([
      {
        page: 1,
        fontName: 'OCR_TESSERACT_TSV',
        bold: false,
        fontSize: 12,
        x: 72,
        y: 600,
        text: '扫描页 OCR 可追溯内容',
        origin: 'ocr_tesseract_tsv',
        readingOrder: 0,
        pdfUserSpaceBbox: [72, 600, 320, 612],
        normalizedBbox: exactBbox,
        confidence: 96.25,
      },
    ]);

    const unitSet = buildSourceUnitSet(layout, {
      documentCode: 'OCR-TEST-001',
      artifact: ARTIFACT,
    });
    const textUnit = unitSet.units.find(
      (unit) => unit.kind !== 'source_metadata',
    );
    expect(textUnit?.sourceRefIds).toHaveLength(2);

    const boundRefs = textUnit?.sourceRefIds.map((sourceRefId) =>
      unitSet.sourceRefs.find((ref) => ref.sourceRefId === sourceRefId),
    );
    expect(boundRefs?.[0]).toMatchObject({
      pageStart: 1,
      pageEnd: 1,
      bbox: [0, 0, 1_000_000, 1_000_000],
      quote: '扫描页 OCR 可追溯内容',
      charStart: 0,
      charEnd: 13,
      charOffsetUnit: 'unicode_scalar_value',
    });
    expect(boundRefs?.[1]).toMatchObject({
      pageStart: 1,
      pageEnd: 1,
      bbox: exactBbox,
      quote: '扫描页 OCR 可追溯内容',
    });
  });
});

function pdfLayout(textRuns: ParsedPdfLayout['textRuns']): ParsedPdfLayout {
  const pageTextLayerDiagnostics = [1, 2].map((page) => {
    const pageRuns = textRuns.filter((run) => run.page === page);
    const nonWhitespaceCharacterCount = pageRuns.reduce(
      (count, run) => count + run.text.replace(/\s/gu, '').length,
      0,
    );
    return {
      page,
      status:
        nonWhitespaceCharacterCount > 0
          ? ('PRESENT' as const)
          : ('EMPTY' as const),
      textRunCount: pageRuns.length,
      nonWhitespaceCharacterCount,
      rasterVisualCoverage: {
        status: 'NO_MATERIAL_RASTER' as const,
        materialUnverifiedRasterPageFraction: 0.25,
        rasterRegionCount: 0,
        rasterPageAreaRatio: 0,
        unverifiedRasterRegionCount: 0,
        unverifiedRasterPageAreaRatio: 0,
        unverifiedRasterRegions: [],
      },
    };
  });
  return {
    kind: 'pdf',
    pdfVersion: '1.7',
    pageCount: 2,
    pageBoxes: [
      { page: 1, mediaBox: [0, 0, 612, 792] },
      { page: 2, mediaBox: [0, 0, 612, 792] },
    ],
    metadata: { title: null },
    textRuns,
    pageTextLayerDiagnostics,
    sourceSha256: 'a'.repeat(64),
    sourceByteLength: 100,
  } as ParsedPdfLayout & {
    readonly pageTextLayerDiagnostics: typeof pageTextLayerDiagnostics;
  };
}
