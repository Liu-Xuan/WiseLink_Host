import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

jest.mock('node:child_process', () => ({
  spawnSync: jest.fn(),
}));

import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { ProfessionalInputPureError } from '../../../server/modules/professional-input/pure/professional-input-pure.error';

const mockedSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const SOURCE_BYTES = Uint8Array.of(1, 3, 3, 7);

describe('PdfjsDistLayoutExtractor bounded page chunks', () => {
  beforeEach(() => {
    mockedSpawnSync.mockReset();
  });

  it('merges exact ordered page ranges into one deterministic layout', () => {
    mockedSpawnSync
      .mockReturnValueOnce(successfulResult(runnerPayload(130, 1, 64)))
      .mockReturnValueOnce(successfulResult(runnerPayload(130, 65, 128)))
      .mockReturnValueOnce(successfulResult(runnerPayload(130, 129, 130)));

    const layout = extractor().extractLayoutWithDiagnostics(SOURCE_BYTES);

    expect(layout).toMatchObject({
      kind: 'pdf',
      pdfVersion: '1.7',
      pageCount: 130,
      metadata: { title: 'Bounded extraction fixture' },
      sourceByteLength: SOURCE_BYTES.byteLength,
      sourceSha256: `sha256:${createHash('sha256')
        .update(SOURCE_BYTES)
        .digest('hex')}`,
    });
    expect(layout.pageBoxes).toHaveLength(130);
    expect(layout.pageTextLayerDiagnostics).toHaveLength(130);
    expect(layout.textRuns).toHaveLength(130);
    expect(layout.pageBoxes.map((box) => box.page)).toEqual(
      Array.from({ length: 130 }, (_, index) => index + 1),
    );
    expect(layout.textRuns.at(-1)).toMatchObject({
      page: 130,
      text: 'PAGE 130',
    });

    const calls = mockedSpawnSync.mock.calls.map((call) => ({
      range: (call[1] as readonly string[]).slice(-2),
      timeout: (call[2] as { timeout: number }).timeout,
    }));
    expect(calls.map((call) => call.range)).toEqual([
      ['1', '64'],
      ['65', '128'],
      ['129', '192'],
    ]);
    expect(calls.every((call) => call.timeout <= 120_000)).toBe(true);
    expect(calls.every((call) => call.timeout > 0)).toBe(true);
  });

  it('fails the whole extraction when a chunk returns partial page coverage', () => {
    mockedSpawnSync.mockReturnValueOnce(
      successfulResult(runnerPayload(130, 1, 63)),
    );

    expect(
      captureError(() => extractor().extractLayout(SOURCE_BYTES)),
    ).toMatchObject({
      code: 'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
    });
    expect(mockedSpawnSync).toHaveBeenCalledTimes(1);
  });

  it('fails the whole extraction when document identity drifts across chunks', () => {
    mockedSpawnSync
      .mockReturnValueOnce(successfulResult(runnerPayload(65, 1, 64)))
      .mockReturnValueOnce(
        successfulResult(
          runnerPayload(65, 65, 65, {
            title: 'Different document identity',
          }),
        ),
      );

    expect(
      captureError(() =>
        extractor().extractLayoutWithDiagnostics(SOURCE_BYTES),
      ),
    ).toMatchObject({
      code: 'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
    });
    expect(mockedSpawnSync).toHaveBeenCalledTimes(2);
  });

  it('never returns already parsed pages when a later chunk times out', () => {
    mockedSpawnSync
      .mockReturnValueOnce(successfulResult(runnerPayload(65, 1, 64)))
      .mockReturnValueOnce(timeoutResult());

    expect(
      captureError(() =>
        extractor().extractLayoutWithDiagnostics(SOURCE_BYTES),
      ),
    ).toMatchObject({
      code: 'PDFJS_LAYOUT_RUNNER_TIMEOUT',
      diagnostic: {
        pageStart: 65,
        requestedPageEnd: 128,
        pagesPerChunk: 64,
        chunkTimeoutMs: 120_000,
        totalTimeoutMs: 600_000,
      },
    });
    expect(mockedSpawnSync).toHaveBeenCalledTimes(2);
  });

  it('rejects diagnostic counts that do not match the merged text runs', () => {
    const payload = runnerPayload(1, 1, 1);
    payload.pageTextLayerDiagnostics[0].textRunCount = 0;
    mockedSpawnSync.mockReturnValueOnce(successfulResult(payload));

    expect(
      captureError(() =>
        extractor().extractLayoutWithDiagnostics(SOURCE_BYTES),
      ),
    ).toMatchObject({
      code: 'PDFJS_LAYOUT_RUNNER_PAYLOAD_INVALID',
    });
  });

  it('preserves OCR-required fail-closed behavior for an empty page', () => {
    const payload = runnerPayload(1, 1, 1);
    payload.textRuns = [];
    payload.pageTextLayerDiagnostics[0] = pageDiagnostic(1, '', 'EMPTY');
    mockedSpawnSync.mockReturnValueOnce(successfulResult(payload));

    expect(
      captureError(() => extractor().extractLayout(SOURCE_BYTES)),
    ).toMatchObject({
      code: 'PDF_OCR_REQUIRED_UNSUPPORTED',
      diagnostic: expect.objectContaining({
        pageCount: 1,
        ocrRequiredPages: [1],
        emptyTextLayerPages: [1],
      }),
    });
  });
});

function extractor(): PdfjsDistLayoutExtractor {
  return new PdfjsDistLayoutExtractor(
    '/fixture/runner.mjs',
    '/fixture/pdf.mjs',
  );
}

function runnerPayload(
  pageCount: number,
  pageStart: number,
  pageEnd: number,
  overrides: { title?: string } = {},
) {
  const pages = Array.from(
    { length: pageEnd - pageStart + 1 },
    (_, index) => pageStart + index,
  );
  return {
    pdfVersion: '1.7',
    pageCount,
    pageStart,
    pageEnd,
    pageBoxes: pages.map((page) => ({
      page,
      mediaBox: [0, 0, 612, 792],
      rotation: 0,
      userUnit: 1,
      viewport: {
        width: 612,
        height: 792,
        transform: [1, 0, 0, -1, 0, 792],
      },
    })),
    metadata: {
      title: overrides.title ?? 'Bounded extraction fixture',
    },
    textRuns: pages.map((page) => ({
      page,
      fontName: 'FixtureFont',
      bold: false,
      fontSize: 10,
      x: 10,
      y: 20,
      text: `PAGE ${page}`,
    })),
    pageTextLayerDiagnostics: pages.map((page) =>
      pageDiagnostic(page, `PAGE ${page}`, 'PRESENT'),
    ),
  };
}

function pageDiagnostic(
  page: number,
  text: string,
  status: 'PRESENT' | 'EMPTY',
) {
  return {
    page,
    status,
    textRunCount: text.length > 0 ? 1 : 0,
    nonWhitespaceCharacterCount: Array.from(text).filter(
      (character) => !/\s/u.test(character),
    ).length,
    rasterVisualCoverage: {
      status: 'NO_MATERIAL_RASTER',
      materialUnverifiedRasterPageFraction: 0.25,
      rasterRegionCount: 0,
      rasterPageAreaRatio: 0,
      unverifiedRasterRegionCount: 0,
      unverifiedRasterPageAreaRatio: 0,
      unverifiedRasterRegions: [],
    },
  };
}

function successfulResult(payload: unknown): ReturnType<typeof spawnSync> {
  return {
    pid: 123,
    output: [],
    stdout: Buffer.from(
      `<<<PDFJS-LAYOUT-JSON-BEGIN>>>${JSON.stringify(payload)}<<<PDFJS-LAYOUT-JSON-END>>>`,
    ),
    stderr: Buffer.alloc(0),
    status: 0,
    signal: null,
  };
}

function timeoutResult(): ReturnType<typeof spawnSync> {
  return {
    pid: 124,
    output: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    status: null,
    signal: 'SIGTERM',
    error: Object.assign(new Error('spawnSync ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    }),
  };
}

function captureError(run: () => unknown): ProfessionalInputPureError {
  try {
    run();
  } catch (error) {
    if (error instanceof ProfessionalInputPureError) return error;
    throw error;
  }
  throw new Error('EXPECTED_PROFESSIONAL_INPUT_FAILURE');
}
