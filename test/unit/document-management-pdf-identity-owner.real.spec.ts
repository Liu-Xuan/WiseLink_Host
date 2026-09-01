import { readFile } from 'node:fs/promises';

import { resolveDocumentFamilyAdapter } from '../../server/modules/document-management/src/migrated/adapters/documentFamilyAdapterRegistry.js';
import {
  detectDocumentDimensions,
  inferSourceType,
} from '../../server/modules/document-management/src/migrated/adapters/parserSourceTypeDetector.js';
import { resolveActualPdfDocumentIdentity } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentIdentityOwner.js';
import { PdfjsDistLayoutExtractor } from '../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';

const REAL_FTD_PATH = process.env.WL31_REAL_FTD_IDENTITY_PDF_PATH?.trim();
const REAL_FTD_REFERENCE_DOMINATED_PATH =
  process.env.WL31_REAL_FTD_REFERENCE_DOMINATED_PDF_PATH?.trim();
const REAL_SL_PATH = process.env.WL31_REAL_SL_IDENTITY_PDF_PATH?.trim();
const REAL_SL_BASELINE_PATH =
  process.env.WL31_REAL_SL_BASELINE_PDF_PATH?.trim();
const REAL_SL_LEGACY_PATH = process.env.WL31_REAL_SL_LEGACY_PDF_PATH?.trim();
const REAL_HONEYWELL_SIL_PATH =
  process.env.WL31_REAL_HONEYWELL_SIL_IDENTITY_PDF_PATH?.trim();
const REAL_AIRBUS_RIL_PATH =
  process.env.WL31_REAL_AIRBUS_RIL_IDENTITY_PDF_PATH?.trim();
const REAL_AIRBUS_SBIT_PATH =
  process.env.WL31_REAL_AIRBUS_SBIT_IDENTITY_PDF_PATH?.trim();
const REAL_AIRBUS_AOT_PATH =
  process.env.WL31_REAL_AIRBUS_AOT_IDENTITY_PDF_PATH?.trim();
const REAL_AIRBUS_OIT_PATH =
  process.env.WL31_REAL_AIRBUS_OIT_IDENTITY_PDF_PATH?.trim();
const REAL_AIRBUS_FOT_PATH =
  process.env.WL31_REAL_AIRBUS_FOT_IDENTITY_PDF_PATH?.trim();

const describeFtd = REAL_FTD_PATH ? describe : describe.skip;
const describeReferenceDominatedFtd = REAL_FTD_REFERENCE_DOMINATED_PATH
  ? describe
  : describe.skip;
const describeSl = REAL_SL_PATH ? describe : describe.skip;
const describeSlBaseline = REAL_SL_BASELINE_PATH ? describe : describe.skip;
const describeSlLegacy = REAL_SL_LEGACY_PATH ? describe : describe.skip;
const describeHoneywellSil = REAL_HONEYWELL_SIL_PATH ? describe : describe.skip;
const describeAirbusRil = REAL_AIRBUS_RIL_PATH ? describe : describe.skip;
const describeAirbusSbit = REAL_AIRBUS_SBIT_PATH ? describe : describe.skip;
const describeAirbusAot = REAL_AIRBUS_AOT_PATH ? describe : describe.skip;
const describeAirbusOit = REAL_AIRBUS_OIT_PATH ? describe : describe.skip;
const describeAirbusFot = REAL_AIRBUS_FOT_PATH ? describe : describe.skip;

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

describeHoneywellSil('actual Honeywell SIL PDF identity owner', () => {
  it('uses the Honeywell publication identity instead of a cited Boeing publication', async () => {
    const { identity, layout } = await resolveIdentityAndLayout(
      REAL_HONEYWELL_SIL_PATH as string,
    );
    expect(identity).toMatchObject({
      documentCode: 'D201908000037',
      documentFamily: 'SIL',
      sourceType: 'supplier_sil',
      issuer: 'HONEYWELL',
      businessRevision: 'R4',
      revisionDate: '2021-04-15',
      documentFamilyAdapterId: 'issuer.honeywell.sil.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    });
    const content = layout.textRuns.map((run: any) => run.text).join('\n');
    const sourceType = (inferSourceType as any)({
      filename: 'SIL D201908000037 R4.pdf',
      content,
    });
    expect(sourceType).toBe('supplier_sil');
    expect(
      (detectDocumentDimensions as any)({
        filename: 'SIL D201908000037 R4.pdf',
        content,
      }),
    ).toMatchObject({ documentCategory: 'sil', parserFormat: 'pdf' });
    expect(
      (resolveDocumentFamilyAdapter as any)({
        filename: 'SIL D201908000037 R4.pdf',
        sourceType,
        content,
      }),
    ).toMatchObject({
      adapterId: 'issuer.honeywell.sil.v1',
      docFamily: 'SIL',
    });
  });
});

describeAirbusRil('actual Airbus RIL PDF identity owner', () => {
  it('binds the source-owned RIL reference, revision and date', async () => {
    const identity = await resolveIdentity(REAL_AIRBUS_RIL_PATH as string);
    expect(identity).toMatchObject({
      documentCode: 'V27M24001856',
      documentFamily: 'SB',
      sourceType: 'airbus_retrofit_information_letter',
      issuer: 'AIRBUS',
      businessRevision: 'R3',
      revisionDate: '2026-03-02',
      documentFamilyAdapterId: 'issuer.airbus.retrofit_information_letter.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    });
  });
});

describeAirbusSbit('actual Airbus SBIT PDF identity owner', () => {
  it('binds the current OIT reference instead of the referenced service bulletin', async () => {
    const identity = await resolveIdentity(REAL_AIRBUS_SBIT_PATH as string);
    expect(identity).toMatchObject({
      documentCode: '24-0015',
      documentFamily: 'SB',
      sourceType: 'airbus_operator_transmission',
      issuer: 'AIRBUS',
      businessRevision: 'R3',
      revisionDate: '2026-03-18',
      documentFamilyAdapterId: 'issuer.airbus.operator_transmission.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    });
  });
});

describeAirbusAot('actual Airbus AOT PDF identity owner', () => {
  it('binds the current AOT reference before the OCR coverage boundary', async () => {
    const identity = await resolveIdentity(REAL_AIRBUS_AOT_PATH as string);
    expect(identity).toMatchObject({
      documentCode: 'A32N033-24',
      documentFamily: 'SB',
      sourceType: 'airbus_operator_transmission',
      issuer: 'AIRBUS',
      businessRevision: 'R3',
      revisionDate: '2026-03-25',
      documentFamilyAdapterId: 'issuer.airbus.operator_transmission.v1',
    });
  });
});

describeAirbusOit('actual Airbus OIT PDF identity owner', () => {
  it('preserves the dotted and slash-separated source reference', async () => {
    const identity = await resolveIdentity(REAL_AIRBUS_OIT_PATH as string);
    expect(identity).toMatchObject({
      documentCode: '999.0013/26',
      documentFamily: 'SB',
      sourceType: 'airbus_operator_transmission',
      issuer: 'AIRBUS',
      businessRevision: 'R0',
      revisionDate: '2026-03-05',
      documentFamilyAdapterId: 'issuer.airbus.operator_transmission.v1',
    });
  });
});

describeAirbusFot('actual Airbus FOT PDF identity owner', () => {
  it('binds the flight-operations transmission as the current publication', async () => {
    const identity = await resolveIdentity(REAL_AIRBUS_FOT_PATH as string);
    expect(identity).toMatchObject({
      documentCode: '999.0062/25',
      documentFamily: 'SB',
      sourceType: 'airbus_operator_transmission',
      issuer: 'AIRBUS',
      businessRevision: 'R0',
      revisionDate: '2026-03-03',
      documentFamilyAdapterId: 'issuer.airbus.operator_transmission.v1',
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
  return (await resolveIdentityAndLayout(path)).identity;
}

async function resolveIdentityAndLayout(path: string) {
  const bytes = await readFile(path);
  const layout = new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(
    bytes,
  );
  const actualSha256 = sha256Raw(bytes);
  const identity = (resolveActualPdfDocumentIdentity as any)({
    layout,
    actualSha256,
    actualByteLength: bytes.byteLength,
    inspectionSha256: actualSha256,
    inspectionByteLength: bytes.byteLength,
    originalFilename: path.split('/').at(-1),
  });
  return { identity, layout };
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
