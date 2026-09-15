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
      item('Status', 40, 160), item('Copyright Synthetic.', 40, 75), item('1 of 2', 270, 40),
      item('FLEET TEAM DIGEST', 190, 765),
    ]);
    const second = page([item('No field reports received.', 40, 680), item('Interim Action', 40, 650),
      item('Avoid disabled options.', 40, 630), item('Copyright Synthetic.', 40, 75),
      item('FLEET TEAM DIGEST', 190, 765)], 1);
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
    expect(result.source.units.find(unit => unit.payload.text === 'Copyright Synthetic.')?.sourceRefIds).toHaveLength(2);
    expect([first, second]).toEqual(before);
    const chars = (value: string) => [...value.replace(/\s/gu, '')].sort().join('');
    expect(chars(result.source.units.map(unit => String(unit.payload.text).repeat(unit.sourceRefIds.length)).join(''))).toBe(chars(before.map(value => value.text).join('')));
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
    const table = result.source.units.find(unit => unit.kind === 'table')!;
    expect(JSON.stringify(table.payload)).toContain('XY- 987');
    expect(JSON.stringify(table.payload)).toContain('- 0.25');
    expect(JSON.stringify(table.payload)).not.toContain('XY-987');
    expect(result.coverage.unresolvedRanges.some(range => ['TEXT_CONFLICT', 'STRUCTURE_UNCERTAIN'].includes(range.reason))).toBe(true);
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

it('rejects a word-identical pseudo table while keeping native prose and its source geometry', () => {
  const p = page([item('Final Action', 40, 650), item('Implement one option.', 40, 630),
    item('1. Keep the existing condition.', 40, 610)]);
  const result = compose([p], '| Final | Action |\n| --- | --- |\n| Implement | one option. |\n| 1. | Keep the existing condition. |');
  expect(result.source.units.some(unit => unit.kind === 'table')).toBe(false);
  expect(texts(result).join(' ')).toContain('Implement one option. 1. Keep the existing condition.');
  expect(result.locations.every(location => location.precision === 'TEXT_ITEM')).toBe(true);
});

it('uses unique neighbors to disambiguate repeated author headings without choosing the first occurrence', () => {
  const result = compose([page([item('Alpha paragraph.', 40, 690), item('Repeated', 40, 670), item('Beta paragraph.', 40, 650),
    item('Gamma paragraph.', 40, 600), item('Repeated', 40, 580), item('Delta paragraph.', 40, 560)])],
  'Gamma paragraph.\n\n## Repeated\n\nDelta paragraph.');
  const heading = result.source.units.find(unit => unit.kind === 'heading');
  expect(heading?.mapping.comparisonStart).toBeGreaterThan(50);
  expect(texts(result).join(' ')).toContain('Alpha paragraph. Repeated Beta paragraph.');
});

it('retains repeated technical warnings and conditions at page edges in their original body scope', () => {
  const warning = 'WARNING: Do not proceed unless the valve is closed.';
  const result = compose([page([item('First body.', 40, 650), item(warning, 40, 75), item('FLEET TEAM DIGEST', 190, 765)]),
    page([item('Second body.', 40, 650), item(warning, 40, 75), item('FLEET TEAM DIGEST', 190, 765)], 1)], '');
  const warnings = result.source.units.filter(unit => unit.payload.text === warning);
  expect(warnings).toHaveLength(2);
  expect(warnings.every(unit => unit.mapping.pageFurniture !== true)).toBe(true);
  expect(result.source.units.findIndex(unit => unit.unitId === warnings[0].unitId))
    .toBeLessThan(result.source.units.findIndex(unit => unit.payload.text === 'Second body.'));
  expect(result.source.units.find(unit => unit.payload.text === 'FLEET TEAM DIGEST')?.sourceRefIds).toHaveLength(2);
});

it('does not hide an unreconstructed real table just because source lines exist', () => {
  const result = compose([page([item('Column A', 40, 650), item('Column B', 200, 650),
    item('Value with uncertain column crossing', 40, 630, 210), item('other', 200, 630)])],
    '| Column A | Column B |\n| --- | --- |\n| Value with uncertain column crossing | other |');
  expect(result.source.units.some(unit => unit.kind === 'table')).toBe(false);
  expect(result.coverage.unresolvedRanges).toEqual(expect.arrayContaining([
    expect.objectContaining({ reason: 'STRUCTURE_UNCERTAIN', readingImpact: 'LIMITATION', pageIndexes: [0] }),
  ]));
});

it('joins a page-edge cell only with an exact same-column full-cell witness and retains both source references', () => {
  const result = compose([page([item('Type', 40, 650), item('Code', 220, 650),
    item('Technical Notice', 40, 630), item('AB-1', 220, 630),
    item('Technical', 40, 600), item('AB-2', 220, 600)]),
    page([item('Notice', 40, 700), item('Technical Notice', 40, 670), item('AB-3', 220, 670)], 1)],
    '| Type | Code |\n| --- | --- |\n| Technical Notice | AB-1 |\n| Technical | AB-2 |\n\n| Notice | |\n| --- | --- |\n| Technical Notice | AB-3 |');
  const tables = result.source.units.filter(unit => unit.kind === 'table');
  expect(tables).toHaveLength(1);
  const groups = tables[0].payload.rowGroups as Array<{ rows: Array<{ cells: Array<{ inlineContent: Array<{ text: string; sourceRefIds: string[] }> }> }> }>;
  expect(groups[0].rows).toHaveLength(4);
  const continued = groups[0].rows[2].cells[0].inlineContent;
  expect(continued.map(item => item.text).join(' ')).toBe('Technical Notice');
  expect(new Set(continued.flatMap(item => item.sourceRefIds)).size).toBe(2);
  expect(result.coverage.unresolvedRanges.filter(range => range.readingImpact === 'LIMITATION')).toEqual([]);
});
