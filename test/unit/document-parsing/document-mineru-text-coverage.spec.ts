import { documentMineruOriginal } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-original-adapter';
import { reconcileMineruTextCoverage } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-text-coverage';
import { documentOriginalReadingCoverage } from '../../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import type { DocumentPdfPage } from '../../../server/modules/document-management/src/hosted/nest/document-original-pdf';
const binding = { documentVersionId: 'DV', parseRunId: 'PR', parseRevision: 1, sourceArtifactId: 'SRC', sourceSha256: 'a'.repeat(64), sourceByteLength: 12 };
function paragraph(text: string, bbox: number[]) { return { type: 'paragraph', bbox, content: { paragraph_content: [{ type: 'text', content: text }] } }; }
function page(lines: Array<{ text: string; top: number; x?: number }>, pageIndex = 0): DocumentPdfPage {
  return { pageIndex, width: 1000, height: 1000, rotation: 0, text: lines.map(line => line.text).join('\n'),
    items: lines.map(line => ({ text: line.text, transform: [10, 0, 0, 10, line.x ?? 10, 1000 - line.top - 10], width: 100, height: 10, hasEOL: true })) };
}
function fixture(blocks: unknown[][], pages: DocumentPdfPage[], extra: Record<string, unknown> = {}) {
  const middle = { _version_name: '3.4.5', _backend: 'pipeline', pdf_info: blocks.map((_p, page_idx) => ({ page_idx, page_size: [1000, 1000], ...extra })) };
  const rawArtifacts = { markdown: 'Raw OCR remains archived.', contentListV2: blocks, middle };
  const original = documentMineruOriginal({ binding, documentVersion: { documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM', sourceArtifactId: 'SRC', pdfSha256: binding.sourceSha256, byteLength: 12 },
    result: { sourceSha256: binding.sourceSha256, sourceByteLength: 12, rawArtifacts, assets: [] } });
  return { original, extraction: { pageCount: blocks.length, pages }, rawMiddle: middle, rawContentListV2: blocks };
}
it('preserves repeated text by physical occurrence, inserts only outside-region text, and merges actual reading order', () => {
  const input = fixture([[paragraph('Repeat', [10, 100, 120, 115]), paragraph('Last', [10, 300, 120, 315])]],
    [page([{ text: 'Repeat', top: 100 }, { text: 'Missing condition', top: 180 }, { text: 'Repeat', top: 220 }, { text: 'Last', top: 300 }])]);
  const before = structuredClone(input);
  const result = reconcileMineruTextCoverage(input);
  expect(result.source.units.map(unit => unit.payload.text)).toEqual(['Repeat', 'Missing condition', 'Repeat', 'Last']);
  const supplements = result.source.units.filter(unit => unit.mapping.extraction === 'PDFJS_TEXT_LAYER');
  expect(supplements).toHaveLength(2);
  expect(result.producer).toMatchObject({ kind: 'MINERU_LOCAL_PDFJS', supplementaryExtraction: 'PDFJS_TEXT_LAYER' });
  expect(result.locations.filter(location => location.precision === 'TEXT_ITEM')).toHaveLength(2);
  expect(supplements[0].mapping.textItems).toEqual([{ pageIndex: 0, itemIndexes: [1] }]);
  expect(input).toEqual(before);
});
it('retains a table without injecting a partly unmatched physical line into its relationships', () => {
  const table = { type: 'table', bbox: [10, 100, 200, 200], content: { html: '<table><tr><td>Covered</td></tr></table>' } };
  const result = reconcileMineruTextCoverage(fixture([[table]], [page([{ text: 'Covered extra limit', top: 120 }])]));
  expect(result.source.units).toHaveLength(1); expect(result.source.units[0].kind).toBe('table');
  expect(result.source.units[0].mapping.extraction).toBe('MINERU_LOCAL');
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'TEXT_CONFLICT', readingImpact: 'LIMITATION' }));
  expect(documentOriginalReadingCoverage(result).unresolvedRanges.some(range => range.message.includes('Covered extra limit'))).toBe(true);
});
it('honors discarded/preprocessing regions and keeps geometry-uncertain text as a limitation', () => {
  const result = reconcileMineruTextCoverage(fixture([[paragraph('Body', [10, 300, 120, 315])]], [page([{ text: 'Discarded header', top: 20 }, { text: 'Body', top: 300 }])],
    { discarded_blocks: [{ type: 'header', bbox: [0, 0, 200, 60], lines: [{ spans: [{ content: 'Discarded header' }] }] }] }));
  expect(result.source.units).toHaveLength(1);
  const invalid = fixture([[paragraph('Body', [10, 300, 120, 315])]], [page([{ text: 'Missing', top: 180 }])], { discarded_blocks: [{ type: 'header' }] });
  const limited = reconcileMineruTextCoverage(invalid);
  expect(limited.source.units).toHaveLength(1);
  expect(limited.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'STRUCTURE_UNCERTAIN', readingImpact: 'LIMITATION' }));
});
it('keeps OCR-only scanned pages and does not declare them unread because PDF.js has no text', () => {
  const result = reconcileMineruTextCoverage(fixture([[paragraph('OCR-only warning', [10, 100, 200, 140])]], [page([])]));
  expect(result.source.units[0].payload.text).toBe('OCR-only warning');
  expect(result.coverage.readPageIndexes).toEqual([0]);
  expect(result.coverage.unresolvedRanges.filter(range => range.reason === 'UNREAD')).toEqual([]);
});
it('does not join separated columns or supplement unsupported page rotation', () => {
  const p = page([{ text: 'A', top: 180 }, { text: 'B', top: 180, x: 500 }]);
  const input = fixture([[paragraph('Body', [10, 300, 120, 315])]], [p]);
  const result = reconcileMineruTextCoverage(input);
  expect(result.source.units).toHaveLength(1);
  expect(result.coverage.unresolvedRanges.some(range => range.message.includes('多列'))).toBe(true);
  p.rotation = 90;
  expect(reconcileMineruTextCoverage(input).source.units).toHaveLength(1);
});

it('reports body present only in raw middle as undelivered, without blindly supplementing it', () => {
  const result = reconcileMineruTextCoverage(fixture([[paragraph('Body', [10, 300, 120, 315])]],
    [page([{ text: 'Hidden body', top: 100 }])],
    { preproc_blocks: [{ type: 'text', bbox: [10, 100, 200, 120], lines: [{ spans: [{ content: 'Hidden body' }] }] }] }));
  expect(result.source.units.map(unit => unit.payload.text)).toEqual(['Body']);
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'TEXT_CONFLICT', message: expect.stringContaining('Hidden body') }));
});
it('preserves column-major OCR order when appending a footer and limits ambiguous middle insertion', () => {
  const input = fixture([[paragraph('Left top', [10, 100, 120, 115]), paragraph('Left bottom', [10, 300, 120, 315]),
    paragraph('Right top', [500, 100, 620, 115])]], [page([{ text: 'Middle', top: 200 }, { text: 'Footer', top: 500 }])]);
  const result = reconcileMineruTextCoverage(input);
  expect(result.source.units.map(unit => unit.payload.text)).toEqual(['Left top', 'Left bottom', 'Right top', 'Footer']);
  expect(result.source.units.filter(unit => unit.mapping.extraction !== 'PDFJS_TEXT_LAYER').map(unit => unit.unitId))
    .toEqual(input.original.source.units.map(unit => unit.unitId));
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'STRUCTURE_UNCERTAIN', message: expect.stringContaining('Middle') }));
});

it('matches a visible multi-cell table row without mixing structural identities into its text', () => {
  const table = { type: 'table', bbox: [10, 100, 400, 200],
    content: { html: '<table><tr><td>Alpha</td><td>Beta</td></tr></table>' } };
  const result = reconcileMineruTextCoverage(fixture([[table]], [page([{ text: 'Alpha Beta', top: 120 }])]));
  expect(result.source.units).toHaveLength(1);
  expect(result.coverage.unresolvedRanges.filter(range => range.reason === 'TEXT_CONFLICT')).toEqual([]);
});

it('reuses Reader furniture omission only inside the omitted native region', () => {
  const footer = { type: 'page_footer', bbox: [0, 900, 300, 940],
    content: { page_footer_content: [{ type: 'text', content: 'Publication footer' }] } };
  const input = fixture([[paragraph('Body', [10, 100, 120, 115]), footer,
    paragraph('PROPRIETARY notice', [0, 950, 300, 980])]],
  [page([{ text: 'Publication footer', top: 910 }, { text: 'PROPRIETARY notice', top: 960 }, { text: 'Missing body', top: 880 }])],
  { preproc_blocks: [{ type: 'text', bbox: [0, 870, 300, 980] }] });
  const result = reconcileMineruTextCoverage(input);
  const conflicts = result.coverage.unresolvedRanges.filter(range => range.reason === 'TEXT_CONFLICT');
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].message).toContain('Missing body');
  expect(result.source.units.map(unit => unit.payload.text)).toEqual(['Body']);
});

it('does not exclude a PDF line only partially overlapping an omitted native footer', () => {
  const footer = { type: 'page_footer', bbox: [0, 900, 300, 940],
    content: { page_footer_content: [{ type: 'text', content: 'Footer' }] } };
  const result = reconcileMineruTextCoverage(fixture([[paragraph('Body', [10, 100, 120, 115]), footer]],
    [page([{ text: 'Edge body', top: 895 }])]));
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({
    reason: 'TEXT_CONFLICT', message: expect.stringContaining('Edge body'), readingImpact: 'LIMITATION' }));
});
