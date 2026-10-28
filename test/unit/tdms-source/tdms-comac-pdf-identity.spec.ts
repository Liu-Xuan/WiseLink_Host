import type { ParsedPdfLayout } from '@server/modules/professional-input/pure/professional-input-pure.types';
import { resolveActualPdfDocumentIdentity } from '@server/modules/document-management/src/migrated/ingress/pdfDocumentIdentityOwner.js';
import { resolveDocumentFamilyAdapter } from '@server/modules/document-management/src/migrated/adapters/documentFamilyAdapterRegistry.js';

function sample(options: { number?: string; original?: string; revised?: string; aircraft?: string; mixedOrder?: boolean } = {}) {
  const lines = [
    ['上海飞机客户服务有限公司', '服务信函'],
    ['编号:', options.number ?? 'SL-99-9999-R00'],
    ['有效性:', options.aircraft ?? 'C919飞机'],
    ['原版日期:', options.original ?? '2026-01-27'],
    ['修订日期:', options.revised ?? 'N/A'],
  ];
  const runs = lines.flatMap((line, index) => line.map((text, column) => ({
    page: 1, text, x: 20 + column * 220, y: 750 - index * 30, width: 200, height: 12, fontName: 'synthetic', fontSize: 12, bold: false,
  })));
  // Real COMAC exports draw labels and values in separate text-object passes.
  if (options.mixedOrder) runs.sort((a, b) => a.x - b.x || b.y - a.y);
  return { kind: 'pdf' as const, pdfVersion: '1.7', pageCount: 1,
    pageBoxes: [{ page: 1, mediaBox: [0, 0, 612, 792] as const }], metadata: { title: null },
    textRuns: runs, pageTextLayerDiagnostics: [],
    sourceSha256: 'sha256:' + 'a'.repeat(64), sourceByteLength: 1000 } satisfies ParsedPdfLayout;
}
function read(layout: ReturnType<typeof sample>) {
  return resolveActualPdfDocumentIdentity({ layout, actualSha256: 'a'.repeat(64), actualByteLength: 1000 });
}
describe('COMAC service letter exact publication identity from observed PDF rows', () => {
  it.each([false, true])('uses visual rows despite separated text-object order (%s)', mixedOrder => {
    const identity = read(sample({ mixedOrder }));
    expect(identity).toMatchObject({ documentCode: 'SL-99-9999', businessRevision: 'R00',
      revisionDate: '2026-01-27', documentFamily: 'SL', issuer: 'COMAC',
      documentFamilyAdapterId: 'issuer.comac.service_letter.v1' });
    expect(resolveDocumentFamilyAdapter({ adapterId: 'issuer.comac.service_letter.v1' }).docFamily).toBe('SL');
  });
  it('binds a revised edition to its actual revised date', () => {
    expect(read(sample({ number: 'SL-99-9999-R02', revised: '2026-02-03' })))
      .toMatchObject({ businessRevision: 'R02', revisionDate: '2026-02-03' });
  });
  it.each([
    { number: 'SL-99-9999-R2' }, { original: '2026-02-30' },
    { revised: '2026-02-01' }, { number: 'SL-99-9999-R02' }, { aircraft: 'UNVERIFIED' },
  ])('refuses unresolved or conflicting header/date facts %j', patch => {
    expect(() => read(sample(patch))).toThrow();
  });
  it('refuses two distinct primary publication codes', () => {
    const layout = sample();
    layout.textRuns.push({ page: 1, x: 20, y: 550, width: 200, height: 12, fontName: 'synthetic', fontSize: 12, bold: false, text: '编号: SL-99-9998-R00' });
    expect(() => read(layout)).toThrow(expect.objectContaining({ code: 'DM_PDF_IDENTITY_CONFLICT' }));
  });
});
