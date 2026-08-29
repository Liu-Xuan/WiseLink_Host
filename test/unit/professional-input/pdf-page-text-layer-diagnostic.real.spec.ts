import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { runProfessionalInputPipeline } from '../../../server/modules/professional-input/builders/professional-input-pipeline';
import { PdfjsDistLayoutExtractor } from '../../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { ProfessionalInputPureError } from '../../../server/modules/professional-input/pure/professional-input-pure.error';
import { Frozen2CandidateReaderService } from '../../../server/modules/unified-reader/frozen2-candidate-reader.service';
import { PythonU0FullPackageValidatorAdapter } from '../../../server/modules/unified-reader/python-u0-full-package-validator.adapter';
import { U0FullValidationService } from '../../../server/modules/unified-reader/u0-full-validation.service';

const UPLOADS_ROOT = '/Volumes/SSD/LLM/WiseLink/Docs/uploads';
const FULL_SCAN_PATH = `${UPLOADS_ROOT}/2233000-916_07351_20230322.pdf`;
const MIXED_PATH =
  `${UPLOADS_ROOT}/AD/AD2020-24-02/` +
  'Airworthiness+Directive+Status+Letter+Delivery+07+26 226A.pdf';
const LOW_TEXT_RASTER_PATH = `${UPLOADS_ROOT}/AD/AD2020-24-02/AD2020-24-02.pdf`;
const BOEING_RASTER_ROUNDING_PATH =
  `${UPLOADS_ROOT}/SB/机身/BOEING/2026/202605/` +
  '737-34-3830 Original.pdf';
const DIGITAL_PATH = `${UPLOADS_ROOT}/FTD/777-FTD-31-21002_Doc_09262025.pdf`;
const describeActualPdf =
  process.env.WL31_RUN_REAL_PDF_TEXT_LAYER_DIAGNOSTICS === '1'
    ? describe
    : describe.skip;

describeActualPdf('actual PDF page text-layer diagnostics', () => {
  jest.setTimeout(180_000);

  it('fails closed for the fixed two-page full scan with exact pages', async () => {
    const bytes = await actualBytes(
      FULL_SCAN_PATH,
      '26eb990db1df1745b25600252bce1175879447367d5b05999481cbe290025c31',
    );

    const error = capturePipelineFailure(bytes, '2233000-916_07351_20230322');

    expect(error.code).toBe('PDF_OCR_REQUIRED_UNSUPPORTED');
    expect(error.diagnostic).toMatchObject({
      diagnosticKind: 'PDF_PAGE_TEXT_LAYER_COVERAGE',
      ocrRequirementKind: 'TEXT_LAYER_EMPTY',
      textLayerStatus: 'EMPTY',
      visualTextStatus: 'UNVERIFIED',
      pageCount: 2,
      ocrRequiredPages: [1, 2],
      ocrRequiredPageRanges: '1-2',
      emptyTextLayerPages: [1, 2],
      emptyTextLayerPageCount: 2,
      visualTextUnverifiedPages: [1, 2],
      ocrProviderStatus: 'UNAVAILABLE_CURRENT_PRODUCTION',
    });
  });

  it('fails closed for a mixed PDF with the exact missing-page ranges', async () => {
    const bytes = await actualBytes(
      MIXED_PATH,
      'fffc67e44e7d2ee83ad30fd5622647753b1186b98cf59fb50ef1fc1c153b4e91',
    );

    const error = capturePipelineFailure(bytes, 'AD-2020-24-02-MIXED');

    expect(error.code).toBe('PDF_OCR_REQUIRED_UNSUPPORTED');
    expect(error.diagnostic).toMatchObject({
      textLayerStatus: 'PARTIAL',
      pageCount: 97,
      emptyTextLayerPages: [26, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37, 48, 49],
      emptyTextLayerPageCount: 13,
      emptyTextLayerPageRanges: '26-27,29-37,48-49',
    });
  });

  it('fails closed when a non-empty text layer does not cover material raster procedures', async () => {
    const bytes = await actualBytes(
      LOW_TEXT_RASTER_PATH,
      '4b3462ec9f55232c7a920698d9b688c0bf8ea9faa24967f69f55433b84809ccb',
    );

    const error = capturePipelineFailure(bytes, 'AD-2020-24-02');
    const visualPages = error.diagnostic
      .visualTextUnverifiedPages as readonly number[];
    const details = error.diagnostic
      .visualTextUnverifiedPageDetails as readonly string[];
    const visualRatios = error.diagnostic
      .visualTextUnverifiedRasterPageAreaRatios as readonly number[];

    expect(error.code).toBe('PDF_OCR_REQUIRED_UNSUPPORTED');
    expect(error.diagnostic).toMatchObject({
      ocrRequirementKind: 'VISUAL_TEXT_UNVERIFIED',
      textLayerStatus: 'PRESENT',
      visualTextStatus: 'UNVERIFIED',
      pageCount: 55,
      ocrRequiredPages: [47, 48, 49, 50, 51, 52, 53],
      ocrRequiredPageRanges: '47-53',
      emptyTextLayerPages: [],
      visualTextUnverifiedPages: [47, 48, 49, 50, 51, 52, 53],
      visualTextUnverifiedPageRanges: '47-53',
      materialUnverifiedRasterPagePercent: 25,
    });
    expect(visualPages).toEqual([47, 48, 49, 50, 51, 52, 53]);
    expect(visualRatios[visualPages.indexOf(48)]).toBeGreaterThanOrEqual(0.25);
    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^48:textChars=2;/u),
      ]),
    );
  });

  it('uses one raw-coordinate union basis for real Boeing raster pages', async () => {
    const bytes = await actualBytes(
      BOEING_RASTER_ROUNDING_PATH,
      'add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a',
    );

    const error = capturePipelineFailure(bytes, '737-34-3830');
    const ocrRequiredPages = error.diagnostic
      .ocrRequiredPages as readonly number[];
    const details = error.diagnostic
      .visualTextUnverifiedPageDetails as readonly string[];

    expect(error.code).toBe('PDF_OCR_REQUIRED_UNSUPPORTED');
    expect(error.diagnostic).toMatchObject({
      pageCount: 22,
      visualTextStatus: 'UNVERIFIED',
      ocrProviderStatus: 'UNAVAILABLE_CURRENT_PRODUCTION',
    });
    expect(ocrRequiredPages).toEqual(expect.arrayContaining([7, 21]));
    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^7:textChars=/u),
        expect.stringMatching(/^21:textChars=/u),
      ]),
    );
  });

  it('keeps a real digital PDF on the existing SPP/U0/Reader path', async () => {
    const bytes = await actualBytes(
      DIGITAL_PATH,
      'b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c',
    );

    const pipeline = runProfessionalInputPipeline(
      pipelineInput(bytes, '777-FTD-31-21002'),
      { extractor: new PdfjsDistLayoutExtractor() },
    );

    expect(pipeline.layout.pageCount).toBe(5);
    expect(pipeline.layout.pageTextLayerDiagnostics).toHaveLength(5);
    expect(
      pipeline.layout.pageTextLayerDiagnostics.every(
        (diagnostic) =>
          diagnostic.status === 'PRESENT' &&
          diagnostic.rasterVisualCoverage.rasterRegionCount > 0 &&
          diagnostic.rasterVisualCoverage.status === 'NO_MATERIAL_RASTER',
      ),
    ).toBe(true);
    expect(pipeline.unitSet.units.length).toBeGreaterThan(1);
    expect(pipeline.pkg.contentUnits.length).toBeGreaterThan(0);
    expect(pipeline.u0Input.packageId).toBe(pipeline.pkg.packageId);

    const validator = new U0FullValidationService(
      new PythonU0FullPackageValidatorAdapter({
        pythonExecutable: process.env.WL31_U0_PYTHON?.trim() || 'python3',
        contractRoot: resolve(
          process.cwd(),
          'server/runtime-assets/technical-publication-parsed-package/v1-frozen-2',
        ),
        contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
        validatorRevision: 'pdf-page-text-layer-diagnostic-real-test',
      }),
    );
    await expect(validator.validate(pipeline.u0Input)).resolves.toMatchObject({
      status: 'FULL_STRICT_VALIDATOR_PASSED',
      packageId: pipeline.pkg.packageId,
    });

    const readback = new Frozen2CandidateReaderService().read(
      pipeline.u0Input.artifact,
      pipeline.u0Input.bytes,
      'AIMS-2',
    );
    expect(readback).toMatchObject({
      packageId: pipeline.pkg.packageId,
      sourceKind: 'pdf',
      resultStatus: 'complete',
    });
    expect(readback.queryResults.length).toBeGreaterThan(0);
    expect(
      readback.queryResults.every((result) => result.sourceRefIds.length > 0),
    ).toBe(true);
  });
});

async function actualBytes(
  path: string,
  expectedSha256: string,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(await readFile(path));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(expectedSha256);
  return bytes;
}

function capturePipelineFailure(
  bytes: Uint8Array,
  documentCode: string,
): ProfessionalInputPureError {
  try {
    runProfessionalInputPipeline(pipelineInput(bytes, documentCode), {
      extractor: new PdfjsDistLayoutExtractor(),
    });
  } catch (error) {
    expect(error).toBeInstanceOf(ProfessionalInputPureError);
    return error as ProfessionalInputPureError;
  }
  throw new Error('EXPECTED_PDF_OCR_REQUIRED_UNSUPPORTED');
}

function pipelineInput(pdfBytes: Uint8Array, documentCode: string) {
  return {
    pdfBytes,
    artifact: {
      artifactRef: `artifact://CanonicalArtifactStore/${documentCode}.pdf`,
      normalizedPath: `${documentCode}.pdf`,
    },
    document: {
      documentCode,
      documentType: 'service_bulletin' as const,
      language: 'en-US',
    },
    lineage: {
      generatedAt: '2026-08-30T00:00:00.000Z',
      producerName: 'pdf-page-text-layer-diagnostic-real-test',
      producerVersion: 'professional-input-pure.v1.candidate.1',
    },
  };
}
