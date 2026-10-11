import { readFile } from 'node:fs/promises';

import { resolveDocumentFamilyAdapter } from '../../server/modules/document-management/src/migrated/adapters/documentFamilyAdapterRegistry.js';
import {
  detectDocumentDimensions,
  inferSourceType,
} from '../../server/modules/document-management/src/migrated/adapters/parserSourceTypeDetector.js';
import { resolveActualPdfDocumentIdentity } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentIdentityOwner.js';
import { PdfjsDistLayoutExtractor } from '../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import { sha256Raw } from '../../server/modules/unified-reader/unified-reader.utils';
import { recognizeHostNativePdfProfile } from '../../server/modules/canonical-host/host-native-pdf-profile.registry';

const REAL_CAAC_CAD_PATH = process.env.WL31_REAL_CAAC_CAD_PDF_PATH?.trim();
const REAL_AIRBUS_TFU_PATH = process.env.WL31_REAL_AIRBUS_TFU_PDF_PATH?.trim();
const REAL_FAA_AD_PATH = process.env.WL31_REAL_FAA_AD_IDENTITY_PDF_PATH?.trim();

const REAL_FTD_PATH = process.env.WL31_REAL_FTD_IDENTITY_PDF_PATH?.trim();
const REAL_787_SB_PATH = process.env.WL31_REAL_787_SB_IDENTITY_PDF_PATH?.trim();
const REAL_SPECIAL_ATTENTION_SB_PATH = process.env.WL31_REAL_SPECIAL_ATTENTION_SB_IDENTITY_PDF_PATH?.trim();
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
const describe787Sb = REAL_787_SB_PATH ? describe : describe.skip;
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

(REAL_CAAC_CAD_PATH ? describe : describe.skip)('actual CAAC CAD PDF identity owner', () => {
  it('uses its own CAAC identity, amendment and publication date while retaining effective date', async () => {
    const { identity, layout } = await resolveIdentityAndLayout(REAL_CAAC_CAD_PATH as string);
    expect(identity).toMatchObject({ documentCode: 'CAD2024-B777-01', documentFamily: 'AD', issuer: 'CAAC', businessRevision: '', revisionDate: '2024-04-03', pageCount: 2, documentFamilyAdapterId: 'issuer.caac.cad.v1' });
    expect(identity.extractedMetadata.amendment.observations[0].value).toBe('39-11556');
    expect(identity.extractedMetadata.effectiveDate.observations[0]).toMatchObject({ value: '2024-04-23', evidence: [{ page: 2, text: expect.any(String) }] });
    expect(identity.extractedMetadata.title.observations[0].value.replace(/\s+/gu, '')).toBe('指示系统-飞机信息管理系统-软件安装');
    expect(recognizeHostNativePdfProfile(layout, 'AD')).toMatchObject({ adapterId: 'issuer.caac.cad.v1', issuerAuthority: 'CAAC' });
  });
});

(REAL_AIRBUS_TFU_PATH ? describe : describe.skip)('actual Airbus TFU PDF identity owner', () => {
  it('reads graphical-header exports through exact source header and publisher-footer evidence', async () => {
    const { identity, layout } = await resolveIdentityAndLayout(REAL_AIRBUS_TFU_PATH as string);
    expect(identity).toMatchObject({ documentCode: '31.39.00005', documentFamily: 'TFU', issuer: 'AIRBUS', businessRevision: '', revisionDate: '2026-01-22', pageCount: 16, documentFamilyAdapterId: 'issuer.airbus.technical_follow_up.v1', identityAuthority: 'DM_ACTUAL_PDF_HEADER_AND_PUBLISHER_FOOTER' });
    expect(identity.publicationIdentityEvidence.publisher).toMatchObject({ page: 16, sourceLocator: { kind: 'PDF_PAGE', pageIndex: 15 } });
    expect(identity.extractedMetadata.firstIssueDate.observations[0].value).toBe('2024-05-14');
    expect(identity.extractedMetadata.lastCheckDate.observations[0].value).toBe('2026-01-22');
    expect(identity.extractedMetadata.supplier.observations[0].value).toBe('SAFRAN ELECTRONICS & DEFENCE');
    expect(identity.extractedMetadata.issuer.observations[0].evidence[0].page).toBe(16);
    expect(identity.extractedMetadata.title.observations[0].value.replace(/\s+/gu, ' ').trim()).toBe('ELT-DT inadvertent activations');
    expect(recognizeHostNativePdfProfile(layout, 'TFU')).toMatchObject({ family: 'TFU', documentType: 'oem_reference', requiresDmAdapterRelease: true });
  });
});

(REAL_FAA_AD_PATH ? describe : describe.skip)('actual FAA AD PDF identity owner', () => {
  it('normalizes the primary Federal Register en-dash identity without a filename fallback', async () => {
    const bytes = await readFile(REAL_FAA_AD_PATH as string);
    expect(bytes.byteLength).toBe(208087);
    expect(sha256Raw(bytes)).toBe('6496c48e43ddf8454e5793a84180e97ba4fe4003087d7b59c5e26e44125d76b4');
    const layout = new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(bytes);
    const rawLayout = JSON.stringify(layout);
    const identity = (resolveActualPdfDocumentIdentity as any)({ layout, actualSha256: sha256Raw(bytes),
      actualByteLength: bytes.byteLength, originalFilename: 'unrelated-name.pdf' });
    expect(identity).toMatchObject({ documentCode: 'AD-2024-04-09', documentFamily: 'AD', sourceType: 'ad',
      issuer: 'FAA', businessRevision: 'ORIGINAL ISSUE', revisionDate: '2024-04-23', sourceGeneratedDate: '',
      pageCount: 11, documentFamilyAdapterId: 'issuer.faa.airworthiness_directive.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES', documentCodeProvenance: {
        inspectedSha256: sha256Raw(bytes), candidates: ['AD-2024-04-09'], conflict: false,
      } });
    expect(JSON.stringify(layout)).toBe(rawLayout);
    expect(recognizeHostNativePdfProfile(layout, 'AD')).toMatchObject({ adapterId: 'issuer.faa.airworthiness_directive.v1',
      family: 'AD', documentType: 'airworthiness_directive', issuerAuthority: 'FAA' });
  });
});

describe('FAA AD primary Federal Register Unicode header', () => {
  const publisher = 'Federal Aviation Administration 14 CFR Part 39';
  const docket = '[Docket No. FAA–2022–0101; Project Identifier AD–2021–0101–T; Amendment 39–0101; AD 2024–01–01]';
  const title = 'Airworthiness Directives; Example Airplanes';
  const date = 'This AD is effective April 23, 2024.';
  it('accepts one primary en-dash header and preserves legacy ASCII identity', () => {
    for (const header of [docket, docket.replace(/–/gu, '-')]) {
      expect(resolveIdentityFromText([publisher, header, title, date].join(' '))).toMatchObject({
        documentCode: 'AD-2024-01-01', issuer: 'FAA', businessRevision: 'ORIGINAL ISSUE', revisionDate: '2024-04-23',
      });
    }
  });
  it.each([
    ['missing publisher', [docket, title, date].join(' ')],
    ['body-only AD citation', [publisher, title, 'Refer to AD 2024–01–01.', date].join(' ')],
    ['body-only docket citation', [publisher, title, 'Refer to', docket, date].join(' ')],
    ['missing Amendment', [publisher, docket.replace('Amendment 39–0101; ', ''), title, date].join(' ')],
    ['unobserved em dash', [publisher, docket.replace(/–/gu, '—'), title, date].join(' ')],
    ['missing effective date', [publisher, docket, title].join(' ')],
  ])('refuses %s instead of inferring identity', (_reason, text) => {
    expect(() => resolveIdentityFromText(text)).toThrow();
  });
  it('rejects distinct primary AD headers instead of choosing the first', () => {
    expect(() => resolveIdentityFromText([publisher, docket, docket.replace('AD 2024–01–01', 'AD 2024–01–02'), title, date].join(' ')))
      .toThrow(expect.objectContaining({ code: 'DM_PDF_IDENTITY_CONFLICT' }));
  });
  it('rejects conflicting effective dates', () => {
    expect(() => resolveIdentityFromText([publisher, docket, title, date, 'This AD is effective April 24, 2024.'].join(' ')))
      .toThrow(expect.objectContaining({ code: 'DM_PDF_IDENTITY_CONFLICT' }));
  });
});

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

describe787Sb('actual Boeing 787 publication-module SB identity owner', () => {
  it('binds the complete primary publication code and issue from the actual PDF', async () => {
    const identity = await resolveIdentity(REAL_787_SB_PATH as string);
    expect(identity).toMatchObject({
      documentCode: 'B787-81205-SB310019-00',
      documentFamily: 'SB',
      sourceType: 'boeing_sb',
      issuer: 'BOEING',
      businessRevision: 'ISSUE 001',
      revisionDate: '2020-09-24',
      pageCount: 13,
      documentFamilyAdapterId: 'issuer.boeing.service_bulletin.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    });
  });
});

(REAL_SPECIAL_ATTENTION_SB_PATH ? describe : describe.skip)('actual Boeing SPECIAL ATTENTION SB identity owner', () => {
  it('binds the independent cover Number row without a filename fallback', async () => {
    const bytes = await readFile(REAL_SPECIAL_ATTENTION_SB_PATH as string);
    expect(bytes.byteLength).toBe(736492);
    expect(sha256Raw(bytes)).toBe('7fce5d19d2d358f1c98cdc901c8e92a6b37224d9340bf1effcbd89068a35c003');
    const layout = new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(bytes);
    const identity = (resolveActualPdfDocumentIdentity as any)({ layout, actualSha256: sha256Raw(bytes),
      actualByteLength: bytes.byteLength, originalFilename: 'unrelated-name.pdf' });
    expect(identity).toMatchObject({ documentCode: '737-34-3657', documentFamily: 'SB', sourceType: 'boeing_sb',
      issuer: 'BOEING', businessRevision: 'ORIGINAL ISSUE', revisionDate: '2026-04-01', sourceGeneratedDate: '',
      pageCount: 64, documentFamilyAdapterId: 'issuer.boeing.service_bulletin.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES', documentCodeProvenance: {
        inspectedSha256: sha256Raw(bytes), candidates: ['737-34-3657'], conflict: false,
      } });
    expect(recognizeHostNativePdfProfile(layout, 'SB')).toMatchObject({ adapterId: 'issuer.boeing.service_bulletin.v1',
      family: 'SB', documentType: 'service_bulletin', issuerAuthority: 'BOEING' });
  });
});

describe('Boeing SB primary publication layout variants', () => {
  const masthead = 'BOEING PROPRIETARY AIRCRAFT SERVICE BULLETIN';
  it('uses the publication row rather than a cited data module or filename alias', () => {
    expect(
      resolveIdentityFromText(
        [
          masthead,
          'Service Bulletin B787-81205-SB310019-00 Primary Display System',
          'Publication: B787-81205-SB310019-00 Issue 001, 24 Sep 2020',
          'Refer to Data Module SB B787-A-31-00-0019-00A-932A-D.',
        ].join(' '),
      ),
    ).toMatchObject({
      documentCode: 'B787-81205-SB310019-00',
      businessRevision: 'ISSUE 001',
      revisionDate: '2020-09-24',
    });
  });

  it.each([
    'References: B787-81205-SB310019-00 Issue 001, 24 Sep 2020',
    'Publication: B787-81205-SB310019-00',
  ])(
    'does not accept a reference or an incomplete primary row (%s)',
    (text) => {
      expect(() => resolveIdentityFromText(`${masthead} ${text}`)).toThrow(
        expect.objectContaining({
          code: 'DM_PDF_IDENTITY_UNRESOLVED',
          statusCode: 422,
        }),
      );
    },
  );

  it('rejects conflicting publication rows', () => {
    expect(() =>
      resolveIdentityFromText(
        [
          masthead,
          'Publication: B787-81205-SB310019-00 Issue 001, 24 Sep 2020',
          'Publication: B787-81205-SB310020-00 Issue 001, 24 Sep 2020',
        ].join(' '),
      ),
    ).toThrow(expect.objectContaining({ code: 'DM_PDF_IDENTITY_CONFLICT' }));
  });

  it('preserves the traditional Boeing SB masthead and current revision', () => {
    expect(
      resolveIdentityFromText(
        [
          masthead,
          'SERVICE BULLETIN NUMBER: 737-46-1053',
          'ORIGINAL ISSUE: January 15, 2010 REVISION 4: March 20, 2020',
        ].join(' '),
      ),
    ).toMatchObject({
      documentCode: '737-46-1053',
      businessRevision: 'R4',
      revisionDate: '2020-03-20',
    });
  });
});

describe('Boeing SB separated cover Number geometry', () => {
  const run = (text: string, x: number, y: number, fontSize = 10) => ({ page: 1, text, x, y, fontSize,
    fontName: 'fixture', bold: false });
  function coverRuns() {
    return [run('BOEING PROPRIETARY', 101, 740), run('Service Bulletin', 423, 700, 18),
      run('SPECIAL ATTENTION', 250, 679, 14), run('Number:', 101, 660), run('737-34-3657', 171, 660),
      run('Original Issue:', 101, 648), run('April 01, 2026', 171, 648), run('ATA System: 3461', 101, 636),
      run('SUBJECT: Synthetic system update', 101, 624), run('Original Issue: April 01, 2026', 81, 50)];
  }
  function resolveRuns(textRuns: ReturnType<typeof coverRuns>) {
    const sourceSha256 = 'a'.repeat(64);
    const sourceByteLength = Buffer.byteLength(JSON.stringify(textRuns));
    return (resolveActualPdfDocumentIdentity as any)({ layout: { pageCount: 1, textRuns,
      sourceSha256: `sha256:${sourceSha256}`, sourceByteLength, metadata: {} }, actualSha256: sourceSha256,
      actualByteLength: sourceByteLength, originalFilename: '737-34-3657 Original.pdf' });
  }
  it('joins the unique Number baseline and binds the date in the same primary header', () => {
    const runs = coverRuns(); const before = structuredClone(runs);
    expect(resolveRuns(runs)).toMatchObject({ documentCode: '737-34-3657', issuer: 'BOEING',
      documentFamily: 'SB', businessRevision: 'ORIGINAL ISSUE', revisionDate: '2026-04-01' });
    expect(runs).toEqual(before);
  });
  it('does not use a cited same-number legacy row and revision below SUBJECT as its own current revision', () => {
    expect(resolveRuns([...coverRuns(), run('Service Bulletin Number: 737-34-3657 Revision 9: May 02, 2026', 101, 500)]))
      .toMatchObject({ documentCode: '737-34-3657', businessRevision: 'ORIGINAL ISSUE', revisionDate: '2026-04-01' });
  });
  it('uses only the cover current revision and retains its separately labelled original date', () => {
    const runs = coverRuns(); runs[7].y = 612; runs[8].y = 600;
    runs.push(run('Revision 2: May 02, 2026', 101, 636));
    expect(resolveRuns(runs)).toMatchObject({ businessRevision: 'R2', revisionDate: '2026-05-02' });
  });
  it.each(['body/footer number', 'split baseline', 'distant column', 'missing publisher', 'missing masthead',
    'only footer date', 'date before number'])('refuses an unproved primary header: %s', reason => {
    let runs = coverRuns();
    if (reason === 'body/footer number') { runs[3].y = 400; runs[4].y = 400; }
    else if (reason === 'split baseline') runs[4].y = 656;
    else if (reason === 'distant column') runs[4].x = 500;
    else if (reason === 'missing publisher') runs = runs.slice(1);
    else if (reason === 'missing masthead') runs.splice(1, 1);
    else if (reason === 'only footer date') runs.splice(5, 2);
    else { runs[5].y = 670; runs[6].y = 670; }
    expect(() => resolveRuns(runs)).toThrow(expect.objectContaining({ code: 'DM_PDF_IDENTITY_UNRESOLVED', statusCode: 422 }));
  });
  it('rejects two primary Number codes before the date', () => {
    expect(() => resolveRuns([...coverRuns(), run('Number: 737-34-3658', 101, 655)]))
      .toThrow(expect.objectContaining({ code: 'DM_PDF_IDENTITY_CONFLICT' }));
  });
  it('rejects conflicting original issue dates in the primary header', () => {
    const runs = coverRuns(); runs[7].y = 612; runs[8].y = 600;
    runs.push(run('Original Issue: May 02, 2026', 101, 636));
    expect(() => resolveRuns(runs)).toThrow(expect.objectContaining({ code: 'DM_PDF_IDENTITY_CONFLICT' }));
  });
  it('rejects conflicting current revision dates in the primary header', () => {
    const runs = coverRuns(); runs[7].y = 600; runs[8].y = 588;
    runs.push(run('Revision 2: May 02, 2026', 101, 636), run('Revision 2: May 03, 2026', 101, 624));
    expect(() => resolveRuns(runs)).toThrow(expect.objectContaining({ code: 'DM_PDF_IDENTITY_CONFLICT' }));
  });
  it('rejects distinct primary current revision numbers instead of choosing the largest', () => {
    const runs = coverRuns(); runs[7].y = 600; runs[8].y = 588;
    runs.push(run('Revision 2: May 02, 2026', 101, 636), run('Revision 3: May 03, 2026', 101, 624));
    expect(() => resolveRuns(runs)).toThrow(expect.objectContaining({ code: 'DM_PDF_IDENTITY_CONFLICT' }));
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
