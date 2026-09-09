import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PdfjsDistLayoutExtractor } from '../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { extractActualPdfMetadata } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentMetadata.js';
import type { DocumentExtractedMetadata } from '@shared/api.interface';

const actualPdf = process.env.WL_DM_METADATA_REAL_PDF_PATH?.trim();
(actualPdf ? describe : describe.skip)('actual Boeing 787 PDF metadata', () => {
  let metadata: DocumentExtractedMetadata;
  beforeAll(async () => {
    const bytes = await readFile(actualPdf!);
    const layout = new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(
      bytes,
    );
    metadata = extractActualPdfMetadata({
      layout,
      actualSha256: createHash('sha256').update(bytes).digest('hex'),
      actualByteLength: bytes.length,
      identity: { documentFamily: 'SB', issuer: 'BOEING' },
    });
  });
  it('reads the unlabelled multi-line publication title from page one', () => {
    expect(metadata.title.observations).toEqual([
      expect.objectContaining({
        value:
          'INDICATING/RECORDING SYSTEM - Primary Display System - Maintenance Control Display Function Operational Program for Windows 10 Support Software Change',
        status: 'PENDING_REVIEW',
        evidence: [expect.objectContaining({ page: 1 })],
      }),
    ]);
  });
  it('excludes the trademark list but preserves real 787 applicability mentions as pending observations', () => {
    const values = metadata.mentionedAircraftModels.observations.map(
      (item) => item.value,
    );
    expect(values).toEqual(
      expect.arrayContaining(['787-8', '787-9', '787-10']),
    );
    expect(values).not.toEqual(expect.arrayContaining(['707']));
    expect(
      values.filter((value) =>
        /^(?:B)?(?:707|717|727|737|747|757|767|777)/u.test(value),
      ),
    ).toEqual([]);
    const model = metadata.mentionedAircraftModels.observations.find(
      (item) => item.value === '787-8',
    );
    expect(model).toMatchObject({
      status: 'PENDING_REVIEW',
      evidence: expect.arrayContaining([expect.objectContaining({ page: 1 })]),
    });
    expect(metadata.applicabilityAssessment).toBe('NOT_EVALUATED');
  });
});
