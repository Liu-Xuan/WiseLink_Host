import { resolveActualPdfDocumentIdentity } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentIdentityOwner.js';
import { normalizeUploadDescriptor } from '../../server/modules/document-management/src/migrated/ingress/uploadDescriptor.js';
import {
  compareDocumentIngressVersions,
  documentIngressIdentityFromDescriptor,
} from '../../server/modules/document-management/src/migrated/ingress/documentIngressPreflight.js';
import { normalizeDocumentFamily, resolveDocumentFamilyAdapter } from '../../server/modules/document-management/src/migrated/adapters/documentFamilyAdapterRegistry.js';
import { isAirbusTfuFooterDescriptor } from '../../server/modules/document-management/src/migrated/ingress/pdfPublicationEvidence.js';
import { recognizeHostNativePdfProfile } from '../../server/modules/canonical-host/host-native-pdf-profile.registry';
import type { ParsedPdfLayout } from '../../server/modules/professional-input/pure/professional-input-pure.types';

// Deliberately small synthetic observations, not a parser success fixture.
const CAD_HEADER = '中 国 民 用 航 空 局 C A A C 适 航 指 令 AIRWORTHINESS DIRECTIVE 编号：CAD2042-TEST-01 修正案号：39-12345 一. 标题：Synthetic directive';
const TFU_HEADER = 'Synthetic follow-up Reference: 00.00.10000 Issue date: 22-JAN-2042 Last check date: 23-JAN-2042 Supplier: TEST SUPPLIER Purpose / Reason for revision: Example Engineering Support Status: Open';
const TFU_PAGES = [TFU_HEADER, 'Airbus recommends reviewing the source.', 'First issue date: 14-MAY-2040 Issue date: 22-JAN-2042 Last check date: 23-JAN-2042', '© Airbus SAS, 2042.'];
const SHA = 'a'.repeat(64);

function layout(pages: string[]): ParsedPdfLayout {
  return {
    pageCount: pages.length, sourceSha256: `sha256:${SHA}`, sourceByteLength: 1024,
    metadata: { title: null }, textRuns: pages.map((text, index) => ({ page: index + 1, text })),
  } as unknown as ParsedPdfLayout;
}

function identity(pages: string[], filename = 'source.pdf') {
  return resolveActualPdfDocumentIdentity({
    layout: layout(pages), actualSha256: SHA, actualByteLength: 1024, originalFilename: filename,
  });
}

function descriptor(pages = TFU_PAGES, filename = 'TFU R99.pdf') {
  return { ...identity(pages, filename), sha256: SHA, sizeBytes: 1024, originalFilename: filename };
}

describe('source-owned CAAC CAD identity', () => {
  it('keeps its own code, dates and amendment separate from a cited FAA publication', () => {
    const value = identity([CAD_HEADER + ' References: FAA AD 2041-01-02 issued 2041年1月2日', '五. 生效日期：2042-04-23 六. 颁发日期：2042-04-03']);
    expect(value).toMatchObject({ documentCode: 'CAD2042-TEST-01', documentFamily: 'AD', issuer: 'CAAC', businessRevision: '', revisionDate: '2042-04-03', documentFamilyAdapterId: 'issuer.caac.cad.v1' });
    expect(value.extractedMetadata.amendment?.observations[0].value).toBe('39-12345');
    expect(value.extractedMetadata.issueDate?.observations[0]).toMatchObject({ value: '2042-04-03', evidence: [{ page: 2, text: '颁发日期：2042-04-03' }] });
    expect(value.extractedMetadata.effectiveDate?.observations[0].value).toBe('2042-04-23');
    expect(value.extractedMetadata.documentType.observations[0].value).toBe('CAD');
    expect(recognizeHostNativePdfProfile(layout([CAD_HEADER + ' FAA AD 2041-01-02 Boeing Service Bulletin', '颁发日期：2042-04-03']), 'AD')?.issuerAuthority).toBe('CAAC');
  });

  it.each([
    [CAD_HEADER.replace(/中 国 民 用 航 空 局 C A A C/u, 'TEST MANUFACTURER'), '颁发日期：2042-04-03'],
    [CAD_HEADER, 'Reference publication issued 2042-04-03'],
    [CAD_HEADER, '颁发日期：2042-02-30'],
    [CAD_HEADER, '颁发日期：2042-04-03 颁发日期：2042-04-04'],
    [CAD_HEADER + ' 编号：CAD2042-TEST-02', '颁发日期：2042-04-03'],
  ])('rejects insufficient or conflicting publication evidence %#', (header, dates) => {
    expect(() => identity([header, dates])).toThrow();
  });
});

describe('dedicated Airbus TFU intake', () => {
  it('binds the graphical-header export to its own reference/date and exact publisher footer', () => {
    const value = descriptor();
    expect(value).toMatchObject({ documentCode: '00.00.10000', documentFamily: 'TFU', sourceType: 'airbus_tfu', issuer: 'AIRBUS', businessRevision: '', revisionDate: '2042-01-22', sourceGeneratedDate: '', identityAuthority: 'DM_ACTUAL_PDF_HEADER_AND_PUBLISHER_FOOTER' });
    expect(value.publicationIdentityEvidence).toMatchObject({ sourceSha256: SHA, sourceByteLength: 1024, primaryHeaderLocator: { kind: 'PDF_PAGE', pageIndex: 0 }, publisher: { page: 4, sourceLocator: { kind: 'PDF_PAGE', pageIndex: 3 } } });
    const metadata = value.extractedMetadata;
    expect(metadata.issuer.observations[0]).toMatchObject({ value: 'AIRBUS', evidence: [{ page: 4, text: '© Airbus SAS, 2042' }] });
    expect(metadata.supplier?.observations[0].value).toBe('TEST SUPPLIER');
    expect(metadata.issueDate?.observations[0].value).toBe('2042-01-22');
    expect(metadata.firstIssueDate?.observations[0].value).toBe('2040-05-14');
    expect(metadata.lastCheckDate?.observations[0].value).toBe('2042-01-23');
    const normalized = normalizeUploadDescriptor(value);
    expect(normalized).toMatchObject({ canonicalDocumentFamily: 'TFU', sourceType: 'airbus_tfu', adapterRelease: { adapterId: 'issuer.airbus.technical_follow_up.v1' } });
    expect(isAirbusTfuFooterDescriptor(value)).toBe(true);
    expect(isAirbusTfuFooterDescriptor(normalized)).toBe(true);
    expect(recognizeHostNativePdfProfile(layout(TFU_PAGES), 'TFU')).toMatchObject({ family: 'TFU', issuerAuthority: 'AIRBUS', documentType: 'oem_reference', requiresDmAdapterRelease: true });
  });

  it.each(['TFU', 'Technical Follow-Up', 'airbus_tfu'])('normalizes the actual governed type %s', value => {
    expect(normalizeDocumentFamily(value)).toBe('TFU');
  });

  it('requires an independent publisher masthead rather than an Airbus body recommendation', () => {
    const pages = ['Airbus recommends reviewing the source. ' + TFU_HEADER, 'No publisher declaration.'];
    expect(() => identity(pages)).toThrow();
    expect(recognizeHostNativePdfProfile(layout(pages), 'TFU')).toBeNull();
    const source = layout([TFU_HEADER, 'No footer needed with a publisher masthead.']);
    const publisherLayout = { ...source, textRuns: [{ ...source.textRuns[0], text: 'AIRBUS SAS' }, ...source.textRuns] };
    const value = resolveActualPdfDocumentIdentity({ layout: publisherLayout, actualSha256: SHA, actualByteLength: 1024 });
    expect(value).toMatchObject({ documentFamily: 'TFU', issuer: 'AIRBUS', identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
      publicationIdentityEvidence: { publisher: { source: 'PRIMARY_HEADER', page: 1, text: 'AIRBUS SAS' } } });
  });

  it.each([
    [...TFU_PAGES.slice(0, 3), '© TEST SUPPLIER, 2042.'],
    [...TFU_PAGES.slice(0, 3), 'Airbus recommends reviewing the source.'],
    [TFU_HEADER.replace('22-JAN-2042', '30-FEB-2042'), ...TFU_PAGES.slice(1)],
    [TFU_HEADER.replace('Issue date: 22-JAN-2042', 'Issue date: missing'), ...TFU_PAGES.slice(1)],
    [TFU_HEADER, TFU_PAGES[1], 'Issue date: 24-JAN-2042', TFU_PAGES[3]],
    [TFU_HEADER + ' Reference: 00.00.10001', ...TFU_PAGES.slice(1)],
  ])('refuses absent publisher or inconsistent primary identity %#', (...pages: string[]) => {
    expect(() => identity(pages, 'TFU source.pdf')).toThrow();
  });

  it('does not activate TFU from a filename or unrelated Airbus support material', () => {
    expect(() => identity(['A general source with no primary publication fields.'], 'TFU 00.00.10000.pdf')).toThrow();
    for (const content of ['AIRBUS CONCESSION Description of Divergence', 'AIRBUS REVISION RECORD']) {
      expect(resolveDocumentFamilyAdapter({ content }).docFamily).toBe('GENERIC');
      expect(recognizeHostNativePdfProfile(layout([content]), 'TFU')).toBeNull();
      expect(() => identity([content])).toThrow();
    }
  });

  it.each(['documentFamily', 'issuer', 'documentFamilyAdapterId', 'sha256', 'sizeBytes', 'pageCount'])('refuses a changed %s in footer authority readback', key => {
    const value = descriptor();
    expect(isAirbusTfuFooterDescriptor({ ...value, [key]: key === 'sizeBytes' || key === 'pageCount' ? 0 : 'WRONG' })).toBe(false);
  });

  it('requires the stored publisher locator and byte evidence, not the authority string alone', () => {
    const value = descriptor();
    expect(isAirbusTfuFooterDescriptor({ ...value, publicationIdentityEvidence: undefined })).toBe(false);
    expect(isAirbusTfuFooterDescriptor({ ...value, publicationIdentityEvidence: { ...value.publicationIdentityEvidence, publisher: { ...value.publicationIdentityEvidence!.publisher, sourceLocator: { kind: 'PDF_PAGE', pageIndex: 0 } } } })).toBe(false);
  });

  it('uses source issue dates for ordering without promoting a filename revision or check date', () => {
    const value = descriptor();
    const incoming = documentIngressIdentityFromDescriptor(value, normalizeUploadDescriptor(value));
    expect(incoming).toMatchObject({ businessRevision: '', comparableVersion: 'DATE:2042-01-22', issuerAuthority: 'AIRBUS', documentTypeFamily: 'TFU', revisionFamilyKey: 'AIRBUS|TFU|00.00.10000' });
    expect(compareDocumentIngressVersions(incoming, { ...incoming })).toBe(0);
    const laterValue = descriptor(TFU_PAGES.map(page => page.replaceAll('22-JAN-2042', '24-JAN-2042')));
    const later = documentIngressIdentityFromDescriptor(laterValue, normalizeUploadDescriptor(laterValue));
    expect(compareDocumentIngressVersions(later, incoming)).toBe(1);
  });
});
