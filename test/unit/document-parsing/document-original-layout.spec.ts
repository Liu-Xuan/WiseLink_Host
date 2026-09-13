import { originalPageLayout } from '../../../server/modules/document-management/src/hosted/nest/document-original-layout';
import { composeDocumentOriginal } from '../../../server/modules/document-management/src/hosted/nest/document-original-compose';
import type { DocumentPdfPage } from '../../../server/modules/document-management/src/hosted/nest/document-original-pdf';
import { originalFixture } from './fixtures/document-original.fixture';

// Synthetic layout only: no manufacturer PDF or private text is embedded here.
function item(text: string, x: number, y: number, width = text.length * 5) {
  return { text, transform: [10, 0, 0, 10, x, y], width, height: 10, hasEOL: false };
}
function page(items: DocumentPdfPage['items'], pageIndex = 0): DocumentPdfPage {
  return { pageIndex, items, text: items.map(value => value.text).join(' '),
    width: 600, height: 800, rotation: 0, imagePaintOperations: 0 };
}
function compose(pages: DocumentPdfPage[], markdown: string) {
  const fixture = originalFixture();
  return composeDocumentOriginal({ binding: fixture.binding, producer: fixture.producer, markdown,
    extraction: { pageCount: pages.length, pages } });
}
function texts(result: ReturnType<typeof compose>) {
  return result.source.units.filter(unit => unit.kind !== 'table').map(unit => String(unit.payload.text));
}

describe('original comparison layout (synthetic coordinate evidence)', () => {
  it('repairs late list markers, isolates page margins, and retains rejected pseudo-table words', () => {
    const first = page([
      item('Background', 40, 650), item('There are two cases.', 40, 630),
      item('Use a disabled option only when allowed.', 55, 600), item('1.', 40, 600),
      item('Do not repeat the invalid request.', 55, 570), item('2.', 40, 570),
      item('All combined requests are not affected. Only single requests fail.', 40, 540),
      item('Status', 40, 160), item('Confidential footer.', 40, 75), item('1 of 2', 270, 40),
      item('SYNTHETIC HEADER', 190, 765),
    ]);
    const second = page([item('No field reports received.', 40, 680), item('Interim Action', 40, 650),
      item('Avoid disabled options.', 40, 630), item('Confidential footer.', 40, 75),
      item('SYNTHETIC HEADER', 190, 765)], 1);
    const before = structuredClone([first, second]);
    const result = compose([first, second], '| Background | |\n| --- | --- |\n| There | two cases. |\n\n### Status\n\n| Interim Action | |\n| --- | --- |\n| Avoid | options. |');
    const output = texts(result);
    expect(output).toContain('1. Use a disabled option only when allowed.');
    expect(output).toContain('2. Do not repeat the invalid request.');
    expect(output).toContain('All combined requests are not affected. Only single requests fail.');
    expect(output).toContain('No field reports received.');
    expect(result.source.units.filter(unit => unit.kind === 'heading').map(unit => unit.payload.text))
      .toEqual(['Background', 'Status', 'Interim Action']);
    expect(result.source.units.some(unit => unit.kind === 'table')).toBe(false);
    expect(result.source.units.every(unit => unit.sourceRefIds.length === 1)).toBe(true);
    expect([first, second]).toEqual(before);
    const chars = (value: string) => [...value.replace(/\s/gu, '')].sort().join('');
    expect(chars(output.join(''))).toBe(chars(before.map(value => value.text).join('')));
  });

  it('restores verified columns and genuine blank cells using touching identifier fragments', () => {
    const result = compose([page([
      item('Type', 40, 650), item('Code', 130, 650), item('Revision', 250, 650), item('Date', 370, 650),
      item('Other', 40, 630), item('XY-', 130, 630, 15), item('987', 145, 630), item('2030-01-02', 370, 630),
    ])], '| Type | Code | Revision | Date |\n| --- | --- | --- | --- |\n| Other | XY-987 | | 2030-01-02 |');
    expect(result.source.units).toHaveLength(1);
    expect(result.source.units[0].kind).toBe('table');
    const payload = result.source.units[0].payload as { rowGroups: Array<{ rows: Array<{ cells: Array<{ columnIndex: number; inlineContent: Array<{ text: string }> }> }> }> };
    expect(payload.rowGroups[0].rows[1].cells.map(cell => [cell.columnIndex, cell.inlineContent[0].text]))
      .toEqual([[0, 'Other'], [1, 'XY-987'], [2, ''], [3, '2030-01-02']]);
    expect(result.coverage.unresolvedRanges).toEqual([]);
  });

  it('does not merge a spaced minus or bridge a column gap to accept a plugin table', () => {
    const p = page([item('Code', 40, 650), item('Value', 200, 650),
      item('XY-', 40, 630, 15), item('987', 70, 630), item('- 0.25', 200, 630)]);
    expect(originalPageLayout(p).page.text).toContain('XY- 987 - 0.25');
    const result = compose([p], '| Code | Value |\n| --- | --- |\n| XY-987 | -0.25 |');
    expect(result.source.units.some(unit => unit.kind === 'table')).toBe(false);
    expect(result.coverage.unresolvedRanges.some(range => range.reason === 'TEXT_CONFLICT')).toBe(true);
  });

  it('matches a whole heading line instead of an occurrence inside another title', () => {
    const result = compose([page([item('Revision Description', 40, 650), item('No changes.', 40, 630),
      item('Description', 40, 600), item('The actual body.', 40, 580)])], '## Revision Description\n\n## Description');
    expect(result.source.units.filter(unit => unit.kind === 'heading').map(unit => unit.payload.text))
      .toEqual(['Revision Description', 'Description']);
    expect(texts(result)).toContain('The actual body.');
  });

  it('retains the original view when geometry is incomplete or rotated', () => {
    const p = page([item('Second', 40, 630), item('First', 40, 650)]);
    for (const input of [{ ...p, rotation: 90 }, { ...p, text: p.text + ' missing geometry' },
      { ...p, items: [{ ...p.items[0], transform: [10, 1, 0, 10, 40, 630] }, p.items[1]] }]) {
      expect(originalPageLayout(input)).toEqual({ page: input, lines: [] });
    }
  });

  it('does not promote a rejected table label without an independently verified heading line', () => {
    const p = { ...page([]), text: 'Background prose has omitted words.' };
    const result = compose([p], '| Background | |\n| --- | --- |\n| prose | words. |');
    expect(result.source.units.map(unit => unit.kind)).toEqual(['paragraph']);
    expect(texts(result)).toEqual([p.text]);
  });
});
