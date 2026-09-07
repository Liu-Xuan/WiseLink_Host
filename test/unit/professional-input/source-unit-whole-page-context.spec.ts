import { buildSourceUnitSet } from '../../../server/modules/professional-input/builders/source-unit-set.builder';
import { buildStructuredParsePackage } from '../../../server/modules/professional-input/builders/structured-parse-package.builder';
import type { ParsedPdfLayout } from '../../../server/modules/professional-input/pure/professional-input-pure.types';

const ARTIFACT = {
  artifactRef: 'artifact://CanonicalArtifactStore/test.pdf',
  normalizedPath: 'test.pdf',
};

describe('professional-input whole-page source context', () => {
  it('preserves explicit native spaces without changing heading style or adding blank units', () => {
    const layout = pdfLayout([
      nativeRun('TITLE', 72, 98, { bold: true }),
      nativeRun('  ', 98, 105),
      nativeRun('PAGE', 105, 131, { bold: true }),
      nativeRun('   ', 72, 90, { page: 2 }),
    ]);
    const unitSet = buildSourceUnitSet(layout, {
      documentCode: 'TEST-001',
      artifact: ARTIFACT,
    });
    const content = unitSet.units.filter(
      (unit) => unit.kind !== 'source_metadata',
    );

    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({
      text: 'TITLE  PAGE',
      expectedSemantic: 'heading',
    });
    expect(unitSet.sourceRefs.find((ref) => ref.charStart === 0)?.quote).toBe(
      'TITLE  PAGE',
    );
    expect(unitSet.sourceRefs.some((ref) => ref.pageStart === 2)).toBe(false);
  });

  it('separates PDF columns with measured gaps and keeps their exact source text in page context', () => {
    const layout = pdfLayout([
      nativeRun('TITLE PAGE', 81, 138.4, { bold: true }),
      nativeRun('B787-81205-SB310019-00', 446.94, 567, { bold: true }),
      nativeRun('List of Effective Data Modules', 84.557, 374.687, { y: 600 }),
      nativeRun('001', 415.757, 432.437, { y: 600 }),
      nativeRun('New', 448.157, 467.957, { y: 600 }),
      nativeRun('2020', 512.957, 535.197, { y: 600 }),
    ]);
    const unitSet = buildSourceUnitSet(layout, {
      documentCode: 'TEST-001',
      artifact: ARTIFACT,
    });
    const content = unitSet.units.filter(
      (unit) => unit.kind !== 'source_metadata',
    );

    expect(content.map((unit) => unit.text)).toEqual([
      'TITLE PAGE B787-81205-SB310019-00',
      'List of Effective Data Modules 001 New 2020',
    ]);
    expect(unitSet.sourceRefs.find((ref) => ref.charStart === 0)?.quote).toBe(
      content.map((unit) => unit.text).join('\n'),
    );
    const granularRef = unitSet.sourceRefs.find(
      (ref) => ref.sourceRefId === content[1].sourceRefIds[0],
    );
    expect(granularRef).toMatchObject({
      pageStart: 1,
      pageEnd: 1,
      quote: 'List of Effective Data Modules 001 New 2020',
    });
  });

  it.each([
    { gap: 0, withBounds: true },
    { gap: 0.5, withBounds: true },
    { gap: 30, withBounds: false },
  ])(
    'keeps adjacent identifier fragments contiguous for %j',
    ({ gap, withBounds }) => {
      const runs = [
        nativeRun('COL4A-', 72, 105),
        nativeRun('0018-0003', 105 + gap, 155 + gap),
      ].map((run) => ({
        ...run,
        pdfUserSpaceBbox: withBounds ? run.pdfUserSpaceBbox : undefined,
      }));
      const unitSet = buildSourceUnitSet(pdfLayout(runs), {
        documentCode: 'TEST-001',
        artifact: ARTIFACT,
      });

      expect(
        unitSet.units.find((unit) => unit.kind !== 'source_metadata')?.text,
      ).toBe('COL4A-0018-0003');
    },
  );

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

function nativeRun(
  text: string,
  x: number,
  right: number,
  options: { y?: number; page?: number; bold?: boolean } = {},
): ParsedPdfLayout['textRuns'][number] {
  const y = options.y ?? 700;
  return {
    page: options.page ?? 1,
    fontName: 'Helvetica',
    bold: options.bold ?? false,
    fontSize: 10,
    x,
    y,
    text,
    pdfUserSpaceBbox: [x, y, right, y + 10],
  };
}

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
