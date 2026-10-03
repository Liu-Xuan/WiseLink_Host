import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PdfjsDistLayoutExtractor } from '../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { extractActualPdfMetadata } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentMetadata.js';

const paths = [
  process.env.WL_DM_METADATA_FTD_PDF_OLD,
  process.env.WL_DM_METADATA_FTD_PDF_NEW,
].filter((value): value is string => Boolean(value));

(paths.length === 2 ? describe : describe.skip)(
  'actual FTD ATA table metadata', () => {
    it('preserves the original same-column ATA cell from both PDF versions', async () => {
      for (const path of paths) {
        const bytes = await readFile(path);
        const layout = new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(bytes);
        const metadata = extractActualPdfMetadata({
          layout,
          actualSha256: createHash('sha256').update(bytes).digest('hex'),
          actualByteLength: bytes.length,
          identity: { documentFamily: 'FTD', issuer: 'BOEING' },
        });
        expect(metadata.ata.status).toBe('PENDING_REVIEW');
        expect(metadata.ata.observations).toHaveLength(1);
        const observation = metadata.ata.observations[0];
        expect(observation.value).toBe('4600-00');
        expect(observation.status).toBe('PENDING_REVIEW');
        expect(observation.evidence).toHaveLength(1);
        expect(observation.evidence[0].page).toBe(1);
        expect(observation.evidence[0].text).toContain('ATA');
        expect(observation.evidence[0].text).toContain(observation.value);
      }
    });
  },
);
