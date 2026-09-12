import { readOriginalHtmlTable } from '../../../server/modules/document-management/src/hosted/nest/document-original-html-table';
import { composeDocumentOriginal } from '../../../server/modules/document-management/src/hosted/nest/document-original-compose';
import { originalFixture } from './fixtures/document-original.fixture';
import { documentOriginalStructuredSource } from '../../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { buildTranslationSourcePlan } from '../../../server/modules/canonical-host/canonical-translation-source-plan';

const html = '<table><caption>Pressure limits</caption><thead><tr><th>Valve</th><th colspan="2">Range</th></tr></thead><tbody><tr><td rowspan="2">A-12</td><td>-0.25</td><td>12 kPa</td></tr><tr><td>N/A</td><td></td></tr></tbody></table>';
test('HTML caption, entities, blank cells and row/column spans remain structured', () => {
  const table = readOriginalHtmlTable(html)!;
  expect(table.issues).toEqual([]); expect(table.caption).toBe('Pressure limits');
  expect(table.rows[0][1].colSpan).toBe(2); expect(table.rows[1][0].rowSpan).toBe(2);
  expect(table.rows[2].map(cell => [cell.columnIndex, cell.text])).toEqual([[1, 'N/A'], [2, '']]);
  expect(readOriginalHtmlTable('<table><tr><td>A &amp; B<br>C &lt; D</td></tr></table>')!.rows[0][0].text).toBe('A & B\nC < D');
});
test('rowspan zero follows its actual row group and does not bleed into another section', () => {
  const table = readOriginalHtmlTable('<table><tbody><tr><td rowspan="0">A</td><td>B</td></tr><tr><td>C</td></tr></tbody><tfoot><tr><td>D</td></tr></tfoot></table>')!;
  expect(table.rows[0][0].rowSpan).toBe(2); expect(table.rows[2][0].columnIndex).toBe(0);
});
test('invalid or nested layout is not silently flattened into a trustworthy table', () => {
  expect(readOriginalHtmlTable('<table><tr><td><table><tr><td>A</td></tr></table></td></tr></table>')).toBeNull();
  expect(readOriginalHtmlTable('<table><tr><td rowspan="3">A</td></tr></table>')!.issues).toContain('SPAN_OUTSIDE_ROW_GROUP');
});
test('accepted HTML enters the actual original adapter and V2 plan without losing any cell text', () => {
  const fixture = originalFixture(), table = readOriginalHtmlTable(html)!;
  const original = composeDocumentOriginal({ binding: fixture.binding, producer: fixture.producer, markdown: html,
    extraction: { pageCount: 1, pages: [{ pageIndex: 0, text: table.text, width: 600, height: 800, rotation: 0, imagePaintOperations: 0, items: [] }] } });
  expect(original.source.units[0].kind).toBe('table'); expect(original.coverage.unresolvedRanges).toEqual([]);
  expect(original.markdown).toContain('rowspan="2"');
  expect(original.markdown).toContain('colspan="2"');
  const plan = buildTranslationSourcePlan({ documentVersionId: original.binding.documentVersionId,
    packageId: original.binding.parseRunId, source: documentOriginalStructuredSource(original, original.binding), title: 'Test',
    parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'fixture', sha256: 'a'.repeat(64), byteLength: 1, mediaType: 'application/json' } });
  expect(plan.anchors.map(anchor => anchor.sourceText)).toEqual(['Pressure limits', 'Valve', 'Range', 'A-12', '-0.25', '12 kPa', 'N/A']);
});
test('conflicting HTML text never replaces the alternate PDF extraction', () => {
  const fixture = originalFixture();
  const original = composeDocumentOriginal({ binding: fixture.binding, producer: fixture.producer, markdown: html,
    extraction: { pageCount: 1, pages: [{ pageIndex: 0, text: 'Actual source words.', width: 600, height: 800, rotation: 0, imagePaintOperations: 0, items: [] }] } });
  expect(original.source.units[0].payload.text).toBe('Actual source words.');
  expect(original.coverage.unresolvedRanges.some(range => range.reason === 'TEXT_CONFLICT')).toBe(true);
});

test('ragged HTML rows retain their extra cells and report the specific limitation', () => {
  const fixture = originalFixture();
  const original = composeDocumentOriginal({ binding: fixture.binding, producer: fixture.producer,
    markdown: '<table><tr><td>Key</td><td>Value</td></tr><tr><td>A</td><td>12</td><td>Extra</td></tr></table>',
    extraction: { pageCount: 1, pages: [{ pageIndex: 0, text: 'Key Value A 12 Extra', width: 600, height: 800, rotation: 0, imagePaintOperations: 0, items: [] }] } });
  expect(original.source.units[0].kind).toBe('table');
  expect(original.markdown).toContain('Extra');
  expect(original.coverage.unresolvedRanges[0].reason).toBe('STRUCTURE_UNCERTAIN');
});
