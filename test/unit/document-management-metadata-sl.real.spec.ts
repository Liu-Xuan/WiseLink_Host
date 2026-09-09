import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { PdfjsDistLayoutExtractor } from '../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { extractActualPdfMetadata } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentMetadata.js';

const uploads = process.env.WL_DM_METADATA_REAL_UPLOADS?.trim();
(uploads ? describe : describe.skip)(
  'actual SL title wrapping and SB regression',
  () => {
    it.each([
      {
        filename:
          '777 Airplane Information Management System 2 (AIMS-2) Block Point (BP) V18 Update/777-SL-31-064.pdf',
        family: 'SL',
        pages: 8,
        title:
          'AIRPLANE INFORMATION MANAGEMENT SYSTEMS (AIMS) BLOCKPOINT VERSION 18 (BP V18) OPERATIONAL PROGRAM SOFTWARE (OPS) UPGRADE FOR THE AIMS-2 PLATFORM',
      },
      {
        filename: 'SL-787-46-034-B.pdf',
        family: 'SL',
        pages: 11,
        title: 'ELECTRONIC FLIGHT BAG (EFB) BLOCK POINT (BP) 4.7',
      },
      {
        filename: '737-46-1061_Original.pdf',
        family: 'SB',
        pages: 18,
        title:
          'INFORMATION SYSTEMS - Onboard Network System - Network File Server Software Change',
      },
    ])(
      'reads the complete title without the next field: $filename',
      async ({ filename, family, pages, title }) => {
        const bytes = await readFile(join(uploads!, filename));
        const layout =
          new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(bytes);
        const metadata = extractActualPdfMetadata({
          layout,
          actualSha256: createHash('sha256').update(bytes).digest('hex'),
          actualByteLength: bytes.length,
          identity: { documentFamily: family, issuer: 'BOEING' },
        });
        expect(metadata.pageCount).toBe(pages);
        expect(metadata.title.observations).toEqual([
          {
            value: title,
            status: 'PENDING_REVIEW',
            evidence: [{ page: 1, text: expect.stringContaining(title) }],
          },
        ]);
        expect(metadata.applicabilityAssessment).toBe('NOT_EVALUATED');
      },
    );
  },
);
