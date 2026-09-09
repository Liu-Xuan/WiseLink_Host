import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PdfjsDistLayoutExtractor } from '../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { extractActualPdfMetadata } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentMetadata.js';
import type { DocumentExtractedMetadata } from '@shared/api.interface';

const actualPdf = process.env.WL_DM_METADATA_737_REAL_PDF_PATH?.trim();
(actualPdf ? describe : describe.skip)(
  'actual Boeing 737-46-1053 R4 metadata',
  () => {
    let metadata: DocumentExtractedMetadata;
    beforeAll(async () => {
      const bytes = await readFile(actualPdf!);
      const layout =
        new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(bytes);
      metadata = extractActualPdfMetadata({
        layout,
        actualSha256: createHash('sha256').update(bytes).digest('hex'),
        actualByteLength: bytes.length,
        identity: { documentFamily: 'SB', issuer: 'BOEING' },
      });
    });
    it('keeps complete source title and four-digit ATA identity', () => {
      expect(metadata.title.observations.map((item) => item.value)).toEqual([
        'INFORMATION SYSTEMS - Onboard Network System - Installation of Network File Server Operational Program Configuration Software',
      ]);
      expect(metadata.ata.observations).toEqual([
        expect.objectContaining({
          value: '4613',
          evidence: expect.arrayContaining([
            expect.objectContaining({ page: 1, text: 'ATA System: 4613' }),
          ]),
        }),
      ]);
    });
    it('excludes production line numbers, retains real models and preserves the whole referenced model list', () => {
      const values = metadata.mentionedAircraftModels.observations.map(
        (item) => item.value,
      );
      expect([...values].sort()).toEqual(
        [
          '737',
          '737 MAX',
          '737-8',
          '737-9',
          '737-8200',
          '737-7/8/8200/9/10',
        ].sort(),
      );
      expect(
        metadata.mentionedAircraftModels.observations.find(
          (item) => item.value === '737-8200',
        ),
      ).toMatchObject({
        evidence: expect.arrayContaining([
          expect.objectContaining({ page: 9 }),
        ]),
      });
      expect(values.filter((value) => /^\d{4}$/u.test(value))).toEqual([]);
      expect(values).not.toContain('737-7');
      expect(metadata.applicabilityAssessment).toBe('NOT_EVALUATED');
    });
  },
);
