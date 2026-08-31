import { readFile } from 'node:fs/promises';

import { resolveActualPdfDocumentIdentity } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentIdentityOwner.js';
import { PdfjsDistLayoutExtractor } from '../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

const REAL_FTD_PATH = process.env.WL31_REAL_FTD_IDENTITY_PDF_PATH?.trim();
const REAL_FTD_REFERENCE_DOMINATED_PATH =
  process.env.WL31_REAL_FTD_REFERENCE_DOMINATED_PDF_PATH?.trim();
const REAL_SL_PATH = process.env.WL31_REAL_SL_IDENTITY_PDF_PATH?.trim();
const REAL_SL_BASELINE_PATH =
  process.env.WL31_REAL_SL_BASELINE_PDF_PATH?.trim();
const REAL_SL_LEGACY_PATH =
  process.env.WL31_REAL_SL_LEGACY_PDF_PATH?.trim();

const describeFtd = REAL_FTD_PATH ? describe : describe.skip;
const describeReferenceDominatedFtd = REAL_FTD_REFERENCE_DOMINATED_PATH
  ? describe
  : describe.skip;
const describeSl = REAL_SL_PATH ? describe : describe.skip;
const describeSlBaseline = REAL_SL_BASELINE_PATH ? describe : describe.skip;
const describeSlLegacy = REAL_SL_LEGACY_PATH ? describe : describe.skip;

describeFtd('actual Boeing FTD PDF identity owner', () => {
  it('accepts the source-owned generated date sentence without a leading article', async () => {
    const identity = await resolveIdentity(REAL_FTD_PATH as string);
    expect(identity).toMatchObject({
      documentCode: '737MAX-FTD-31-21003',
      documentFamily: 'FTD',
      sourceType: 'boeing_ftd',
      issuer: 'BOEING',
      sourceGeneratedDate: '2023-01-08',
      documentFamilyAdapterId: 'issuer.boeing.ftd.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    });
  });
});

describeReferenceDominatedFtd(
  'actual Boeing FTD PDF with generic registry competition',
  () => {
    it('uses the unambiguous primary identity owner instead of a cited-family score', async () => {
      const identity = await resolveIdentity(
        REAL_FTD_REFERENCE_DOMINATED_PATH as string,
      );
      expect(identity).toMatchObject({
        documentCode: '787-FTD-31-21002',
        documentFamily: 'FTD',
        sourceType: 'boeing_ftd',
        issuer: 'BOEING',
        sourceGeneratedDate: '2026-05-28',
        documentFamilyAdapterId: 'issuer.boeing.ftd.v1',
        identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
      });
    });
  },
);

describeSl('actual Boeing SL PDF identity owner', () => {
  it('normalizes pdfjs-split code separators and keeps the primary SL over cited publications', async () => {
    const identity = await resolveIdentity(REAL_SL_PATH as string);
    expect(identity).toMatchObject({
      documentCode: '737-SL-31-093',
      documentFamily: 'SL',
      sourceType: 'boeing_sl',
      issuer: 'BOEING',
      businessRevision: 'ORIGINAL ISSUE',
      revisionDate: '2026-01-27',
      documentFamilyAdapterId: 'issuer.boeing.service_letter.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    });
  });
});

describeSlBaseline('actual Boeing SL suffix identity baseline', () => {
  it('preserves the source-owned trailing publication suffix', async () => {
    const identity = await resolveIdentity(REAL_SL_BASELINE_PATH as string);
    expect(identity).toMatchObject({
      documentCode: '787-SL-46-034-B',
      documentFamily: 'SL',
      sourceType: 'boeing_sl',
      issuer: 'BOEING',
      businessRevision: 'ORIGINAL ISSUE',
      revisionDate: '2018-01-23',
      documentFamilyAdapterId: 'issuer.boeing.service_letter.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    });
  });
});

describeSlLegacy('actual Boeing SL legacy identity baseline', () => {
  it('accepts a long source-owned masthead before the primary code', async () => {
    const identity = await resolveIdentity(REAL_SL_LEGACY_PATH as string);
    expect(identity).toMatchObject({
      documentCode: '777-SL-45-006',
      documentFamily: 'SL',
      sourceType: 'boeing_sl',
      issuer: 'BOEING',
      businessRevision: 'ORIGINAL ISSUE',
      revisionDate: '2013-11-25',
      documentFamilyAdapterId: 'issuer.boeing.service_letter.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    });
  });
});

describe('DM actual-PDF identity ambiguity', () => {
  it('fails closed when two primary identity owners match one first page', () => {
    expect(() =>
      resolveIdentityFromText(
        [
          'FLEET TEAM DIGEST',
          '737MAX-FTD-31-21003 Issue Title: Example',
          'Document Generated on 01/08/2023 by Fleet Team Digest',
          'SERVICE LETTER 737-SL-31-093 ATA: 3131-00 27 January 2026',
          'BOEING PROPRIETARY',
        ].join(' '),
      ),
    ).toThrow(
      expect.objectContaining({ code: 'DM_PDF_FAMILY_IDENTITY_CONFLICT' }),
    );
  });
});

async function resolveIdentity(path: string) {
  const bytes = await readFile(path);
  const layout = new PdfjsDistLayoutExtractor()
    .extractLayoutWithDiagnostics(bytes);
  const actualSha256 = sha256Raw(bytes);
  return (resolveActualPdfDocumentIdentity as any)({
    layout,
    actualSha256,
    actualByteLength: bytes.byteLength,
    inspectionSha256: actualSha256,
    inspectionByteLength: bytes.byteLength,
    originalFilename: path.split('/').at(-1),
  });
}

function resolveIdentityFromText(text: string) {
  const actualSha256 = 'a'.repeat(64);
  const actualByteLength = Buffer.byteLength(text);
  return (resolveActualPdfDocumentIdentity as any)({
    layout: {
      pageCount: 1,
      sourceSha256: `sha256:${actualSha256}`,
      sourceByteLength: actualByteLength,
      textRuns: [{ page: 1, text }],
      metadata: {},
    },
    actualSha256,
    actualByteLength,
    originalFilename: 'ambiguous.pdf',
  });
}
