import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PdfjsDistLayoutExtractor } from '../../server/modules/professional-input/parser/pdfjs-dist-layout-extractor.adapter';
import type { ParsedPdfLayout } from '../../server/modules/professional-input/pure/professional-input-pure.types';
import { resolveActualPdfDocumentIdentity } from '../../server/modules/document-management/src/migrated/ingress/pdfDocumentIdentityOwner.js';

const header = '上海飞机客户服务有限公司 服务信函 编号：SL-99-9999-R00 题目：C919例行资料 有效性：C919飞机 ATA章节：73';
const dates = '原版日期：2025-01-15 修订日期：N/A';

function identity(text: string, filename = 'unrelated.pdf') {
  const bytes = Buffer.from(text);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const layout: ParsedPdfLayout = {
    kind: 'pdf', pdfVersion: '1.7', pageCount: 1,
    pageBoxes: [{ page: 1, mediaBox: [0, 0, 600, 800] }],
    metadata: { title: null }, pageTextLayerDiagnostics: [],
    textRuns: [{ page: 1, text, fontName: 'F1', fontSize: 12, bold: false, x: 0, y: 0 }],
    sourceSha256: `sha256:${sha256}`, sourceByteLength: bytes.length,
  };
  return resolveActualPdfDocumentIdentity({
    layout, actualSha256: sha256, actualByteLength: bytes.length, originalFilename: filename,
  });
}

describe('controlled COMAC C919 service-letter publication identity', () => {
  it('uses the publisher header and separates stable document number from revision', () => {
    expect(identity(`${header} ${dates}`)).toMatchObject({
      documentCode: 'SL-99-9999', businessRevision: 'R00', revisionDate: '2025-01-15',
      documentFamily: 'SL', issuer: 'COMAC', documentFamilyAdapterId: 'issuer.comac.service_letter.v1',
      identityAuthority: 'DM_ACTUAL_PDF_FIRST_THREE_PAGES',
    });
  });
  it('keeps the same family number and takes the explicit revised date for another edition', () => {
    expect(identity(`${header.replace('R00', 'R01')} 原版日期：2025-01-15 修订日期：2025-02-03`))
      .toMatchObject({ documentCode: 'SL-99-9999', businessRevision: 'R01', revisionDate: '2025-02-03' });
  });
  it.each([
    ['publisher absent', header.replace('上海飞机客户服务有限公司', '') + dates],
    ['family heading absent', header.replace('服务信函', '') + dates],
    ['explicit C919 range absent', header.replace('有效性：C919飞机', '') + dates],
    ['primary code absent', header.replace('编号：SL-99-9999-R00', '') + dates],
    ['original date absent', header + ' 修订日期：N/A'],
    ['invalid original date', header + ' 原版日期：2024-02-30 修订日期：N/A'],
    ['revised issue missing revised date', header.replace('R00', 'R01') + dates],
    ['unsupported code suffix', header.replace('R00', 'R00A') + dates],
    ['unsupported annex identity', header.replace('R00', 'R00-ANNEX') + dates],
    ['unsupported lowercase code suffix', header.replace('R00', 'R00a') + dates],
    ['unsupported underscore code suffix', header.replace('R00', 'R00_ANNEX') + dates],
    ['unsupported Unicode code suffix', header.replace('R00', 'R00α') + dates],
    ['unsupported labelled date suffix', header + dates.replace('2025-01-15', '2025-01-15_extra')],
    ['one valid and one invalid original date', `${header} ${dates} 原版日期：2024-02-30`],
    ['one valid and one malformed original date', `${header} ${dates} 原版日期：2024/02/30`],
  ])('refuses %s even when the filename claims the expected code', (_label: string, text: string) => {
    expect(() => identity(text, 'SL-99-9999-R00.pdf')).toThrow();
  });
  it.each([
    `${header} 编号：SL-99-9998-R00 ${dates}`,
    `${header} 编号：SL-99-9999-R01 ${dates}`,
    `${header} 原版日期：2025-01-15 修订日期：2025-02-03`,
  ])('rejects conflicting publication evidence', (text: string) => {
    expect(() => identity(text)).toThrow(expect.objectContaining({ code: 'DM_PDF_IDENTITY_CONFLICT' }));
  });
});

interface ExpectedComacSample {
  sha256: string;
  byteLength: number;
  identity: {
    documentCode: string;
    businessRevision: string;
    revisionDate: string;
    issuer: 'COMAC';
    documentFamily: 'SL';
    pageCount: number;
    documentFamilyAdapterId: 'issuer.comac.service_letter.v1';
  };
}

function requireExpectedComacSample(raw: unknown): ExpectedComacSample {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('COMAC_SAMPLE_EXPECTED_IDENTITY_REQUIRED');
  const expected = raw as Record<string, unknown>;
  if (typeof expected.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expected.sha256) ||
      typeof expected.byteLength !== 'number' || !Number.isSafeInteger(expected.byteLength) || expected.byteLength < 1 ||
      !expected.identity || typeof expected.identity !== 'object' || Array.isArray(expected.identity))
    throw new Error('COMAC_SAMPLE_EXPECTED_IDENTITY_INVALID');
  const supplied = expected.identity as Record<string, unknown>;
  if (typeof supplied.documentCode !== 'string' || !/^SL-\d{2}-\d{4}$/u.test(supplied.documentCode) ||
      typeof supplied.businessRevision !== 'string' || !/^R\d{2}$/u.test(supplied.businessRevision) ||
      typeof supplied.revisionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(supplied.revisionDate) ||
      supplied.issuer !== 'COMAC' || supplied.documentFamily !== 'SL' ||
      typeof supplied.pageCount !== 'number' || !Number.isSafeInteger(supplied.pageCount) || supplied.pageCount < 1 ||
      supplied.documentFamilyAdapterId !== 'issuer.comac.service_letter.v1')
    throw new Error('COMAC_SAMPLE_EXPECTED_IDENTITY_INVALID');
  return {
    sha256: expected.sha256,
    byteLength: expected.byteLength,
    identity: {
      documentCode: supplied.documentCode,
      businessRevision: supplied.businessRevision,
      revisionDate: supplied.revisionDate,
      issuer: supplied.issuer,
      documentFamily: supplied.documentFamily,
      pageCount: supplied.pageCount,
      documentFamilyAdapterId: supplied.documentFamilyAdapterId,
    },
  };
}

describe('external COMAC sample expectations', () => {
  const sample = () => ({
    sha256: 'a'.repeat(64), byteLength: 123,
    identity: {
      documentCode: 'SL-99-9999', businessRevision: 'R00', revisionDate: '2025-01-15',
      issuer: 'COMAC', documentFamily: 'SL', pageCount: 1,
      documentFamilyAdapterId: 'issuer.comac.service_letter.v1',
    },
  });
  it('keeps all seven supplied identity assertions for a complete synthetic sample', () => {
    const raw = sample();
    const expected = requireExpectedComacSample(raw);
    expect(expected).toEqual(raw);
    expect(identity(`${header} ${dates}`)).toMatchObject(expected.identity);
  });
  it('rejects an empty identity instead of accepting an empty partial match', () => {
    expect(() => requireExpectedComacSample({ ...sample(), identity: {} }))
      .toThrow('COMAC_SAMPLE_EXPECTED_IDENTITY_INVALID');
  });
  it.each([
    'documentCode', 'businessRevision', 'revisionDate', 'issuer', 'documentFamily', 'pageCount', 'documentFamilyAdapterId',
  ])('rejects a missing %s assertion', (field) => {
    const raw = sample();
    const supplied: Record<string, unknown> = { ...raw.identity };
    delete supplied[field];
    expect(() => requireExpectedComacSample({ ...raw, identity: supplied }))
      .toThrow('COMAC_SAMPLE_EXPECTED_IDENTITY_INVALID');
  });
  it.each([
    ['documentCode', 123], ['businessRevision', 0], ['revisionDate', 123], ['issuer', 123],
    ['documentFamily', 123], ['pageCount', '1'], ['documentFamilyAdapterId', 123],
    ['documentCode', ''], ['businessRevision', ''], ['revisionDate', ''], ['issuer', ''],
    ['documentFamily', ''], ['pageCount', 0], ['pageCount', 1.5], ['documentFamilyAdapterId', ''],
    ['issuer', 'OTHER'], ['documentFamily', 'SB'], ['documentFamilyAdapterId', 'issuer.other.service_letter.v1'],
  ])('rejects an invalid %s assertion (%s)', (field, value) => {
    const raw = sample();
    expect(() => requireExpectedComacSample({ ...raw, identity: { ...raw.identity, [field]: value } }))
      .toThrow('COMAC_SAMPLE_EXPECTED_IDENTITY_INVALID');
  });
});

const realPath = process.env.WL31_REAL_COMAC_SL_PDF_PATH?.trim();
// Private originals and their identities stay outside the public repository.
(realPath ? describe : describe.skip)('externally supplied COMAC original', () => {
  it('checks supplied original bytes and identity through the native extractor without a filename identity', async () => {
    const expected = requireExpectedComacSample(
      JSON.parse(process.env.WL31_REAL_COMAC_SL_EXPECTED_IDENTITY_JSON ?? 'null') as unknown,
    );
    const bytes = await readFile(realPath as string);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(bytes.length).toBe(expected.byteLength);
    expect(sha256).toBe(expected.sha256);
    const layout = new PdfjsDistLayoutExtractor().extractLayoutWithDiagnostics(bytes);
    const result = resolveActualPdfDocumentIdentity({
      layout, actualSha256: sha256, actualByteLength: bytes.length, originalFilename: 'unrelated.pdf',
    });
    expect(result).toMatchObject(expected.identity);
  });
});
