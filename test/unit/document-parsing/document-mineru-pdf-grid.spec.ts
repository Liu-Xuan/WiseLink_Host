import { documentMineruOriginal } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-original-adapter';
import { reconcileMineruTextCoverage } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-text-coverage';
import type { DocumentPdfPage } from '../../../server/modules/document-management/src/hosted/nest/document-original-pdf';

const binding = { documentVersionId: 'DV', parseRunId: 'PR', parseRevision: 2, sourceArtifactId: 'SRC',
  sourceSha256: 'a'.repeat(64), sourceByteLength: 12 };
function html(rows: string[][]): string {
  return `<table>${rows.map((row: string[]) => `<tr>${row.map((text: string) => `<td>${text}</td>`).join('')}</tr>`).join('')}</table>`;
}
function page(pageIndex: number, repeated: boolean): DocumentPdfPage {
  const lines: Array<{ text: string; x: number; y: number }> = [
    { text: 'MSN', x: 300, y: 120 }, { text: 'CONFIGURATION', x: 700, y: 120 },
    ...(pageIndex ? ['echo foxtrot', 'golf hotel', 'india juliet'] : ['alpha bravo', 'charlie delta'])
      .map((text: string, index: number) => ({ text, x: 120, y: 170 + index * 20 })),
    ...(repeated ? [{ text: 'kilo lima', x: 120, y: 250 }] : []),
    ...(pageIndex ? [] : [{ text: '002', x: 700, y: 400 }]),
  ];
  const items = lines.map((line) => ({ text: line.text, transform: [10, 0, 0, 10, line.x, 990 - line.y],
    width: line.text.length * 6, height: 10, hasEOL: true }));
  return { pageIndex, width: 1000, height: 1000, rotation: 0, items,
    text: items.map((item) => item.text).join('\n'),
    ruledLines: [100, 650, 900].map((x: number, index: number) =>
      ({ from: [x, 100] as [number, number], to: [x, 900] as [number, number], operatorIndex: index }))
      .concat([100, 150].map((y: number, index: number) =>
        ({ from: [100, y], to: [900, y], operatorIndex: index + 3 }))) };
}
function fixture(repeated: boolean = false, splitRun: boolean = false) {
  const header = ['MSN', 'CONFIGURATION'];
  const native = [[header, [`alpha bravo charlie delta${repeated ? ' kilo lima' : ''}`, '002']],
    [['MSN echo foxtrot', 'CONFIGURATION'], splitRun ? ['golf', 'hotel india juliet'] : ['golf hotel', 'india juliet']]];
  const merged = native.flat();
  const blocks = [0, 1].map((index: number) => [{ type: 'table', bbox: [100, 100, 900, 900],
    content: { html: index ? '' : html(merged), table_type: 'simple_table' } }]);
  const middle = { _version_name: '3.0.9', _backend: 'pipeline', pdf_info: native.map((rows: string[][], index: number) => ({
    page_idx: index, page_size: [1000, 1000], preproc_blocks: [{ type: 'table', bbox: [100, 100, 900, 900], blocks: [{
      type: 'table_body', lines: [{ spans: [{ type: 'table', html: html(rows) }] }],
    }] }],
  })) };
  const original = documentMineruOriginal({ binding, documentVersion: { documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM', sourceArtifactId: 'SRC',
    pdfSha256: binding.sourceSha256, byteLength: 12 }, result: { sourceSha256: binding.sourceSha256, sourceByteLength: 12,
    rawArtifacts: { markdown: 'Archived original', contentListV2: blocks, middle }, assets: [] } });
  return { original, extraction: { pageCount: 2, pages: [page(0, repeated), page(1, repeated)] }, rawMiddle: middle, rawContentListV2: blocks };
}
interface Row { cells: Array<{ inlineContent: Array<{ text: string; sourceRefIds: string[] }> }> }
function grid(result: ReturnType<typeof reconcileMineruTextCoverage>): Row[] {
  return (result.source.units[0].payload.rowGroups as Array<{ rows: Row[] }>)[0].rows;
}

it('replaces the bad reading grid once with actual physical cells while archiving raw data and original references', () => {
  const input = fixture(), before = structuredClone(input);
  const result = reconcileMineruTextCoverage(input);
  expect(input).toEqual(before);
  expect(result.source.units).toHaveLength(2);
  expect(grid(result).map((row: Row) => row.cells.map((cell) => cell.inlineContent.map((run) => run.text).join(''))))
    .toEqual([['MSN', 'CONFIGURATION'], ['alpha bravo\ncharlie delta', '002'], ['echo foxtrot\ngolf hotel\nindia juliet', '']]);
  expect(result.source.units[0].mapping.tableRecovery).toMatchObject({ method: 'PDF_RULED_GRID_EXACT_PAGE_SPANS',
    physicalTables: [{ pageIndex: 0, ruledGrid: { openBottom: true } }, { pageIndex: 1, ruledGrid: { openBottom: true } }], joinedRows: [] });
  expect(result.source.units[0].payload.rawMineruContent).toEqual(before.original.source.units[0].payload.rawMineruContent);
  expect(result.source.units[1].payload).toEqual(before.original.source.units[1].payload);
  expect(result.source.sourceLocators).toEqual(expect.arrayContaining(before.original.source.sourceLocators));
  expect(result.locations).toEqual(expect.arrayContaining(before.original.locations));
  const ref = grid(result)[2].cells[0].inlineContent[0].sourceRefIds[0];
  expect(result.source.sourceLocators.find((value) => value.sourceRefId === ref)).toMatchObject({
    pageStart: 1, pageEnd: 1, quote: 'echo foxtrot' });
  expect(result.locations.find((value) => value.sourceRefId === ref)).toMatchObject({ pageIndex: 1, precision: 'TEXT_ITEM', boxes: expect.any(Array) });
  for (const text of ['echo foxtrot', 'golf hotel', 'india juliet']) expect(result.markdown.split(text)).toHaveLength(2);
  expect(result.markdown).not.toContain('<td>india juliet</td>');
  expect(result.coverage.readPageIndexes).toEqual(before.original.coverage.readPageIndexes);
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'STRUCTURE_UNCERTAIN',
    readingImpact: 'LIMITATION', pageIndexes: [1] }));
});

it('maps a full PDF run across adjacent old HTML cells without retaining their wrong column assignment', () => {
  const input = fixture(false, true);
  const result = reconcileMineruTextCoverage(input);
  const recovery = result.source.units[0].mapping.tableRecovery as { physicalTables: Array<{
    ruledGrid: { rawSpanMatches: Array<{ sourceRanges: unknown[]; itemIndexes: number[] }> };
  }> };
  const run = recovery.physicalTables[1].ruledGrid.rawSpanMatches.find((match) => match.itemIndexes.includes(3));
  expect(run?.sourceRanges).toEqual([{ sourceRow: 1, sourceColumn: 0, start: 0, end: 4 },
    { sourceRow: 1, sourceColumn: 1, start: 0, end: 5 }]);
  expect(grid(result)[2].cells[1].inlineContent.map((value) => value.text).join('')).toBe('');
});

it('keeps a PDF-only repeated occurrence at its own page and prevents an additional literal paragraph', () => {
  // The second page's literal also occurs earlier in the merged table. Global
  // text deduplication used to suppress its independent physical occurrence.
  const input = fixture(true);
  const result = reconcileMineruTextCoverage(input);
  const occurrences = result.source.sourceLocators.filter((locator) => locator.quote === 'kilo lima');
  expect(occurrences.map((locator) => locator.pageStart)).toEqual([0, 1]);
  expect(result.source.units).toHaveLength(2);
  expect(result.source.units.some((unit) => unit.mapping.supplementation === 'NATIVE_REGION_LITERAL')).toBe(false);
  expect(result.source.units[0].mapping.tableRecovery).toMatchObject({ physicalTables: [{}, {
    ruledGrid: { rawSpanMatches: expect.arrayContaining([expect.objectContaining({
      pageIndex: 1, extraction: 'PDFJS_TEXT_LAYER', sourceRanges: [],
    })]) },
  }] });
  expect(result.markdown.split('kilo lima')).toHaveLength(3);
  expect(result.coverage.readPageIndexes).toEqual([0, 1]);
  expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ readingImpact: 'LIMITATION', pageIndexes: [1] }));
});

it.each(['missing column rule', 'crossing column', 'extra raw text', 'ambiguous raw span', 'wrong merged table', 'legacy cached page'])
  ('retains the old candidate when %s prevents independent physical proof', (failure: string) => {
    const input = fixture();
    const continuation = input.extraction.pages[1];
    if (failure === 'missing column rule') continuation.ruledLines!.splice(1, 1);
    if (failure === 'crossing column') continuation.items[2].width = 650;
    if (failure === 'extra raw text' || failure === 'ambiguous raw span') {
      const value = input.rawMiddle.pdf_info[1].preproc_blocks[0].blocks[0].lines[0].spans[0];
      value.html = value.html.replace('india juliet', failure === 'extra raw text' ? 'india juliet additional requirement' : 'india juliet echo foxtrot');
    }
    if (failure === 'wrong merged table') (input.original.source.units[0].payload.rawMineruContent as Record<string, unknown>).html =
      html([['MSN', 'CONFIGURATION'], ['alpha bravo charlie delta', '002']]);
    if (failure === 'legacy cached page') delete continuation.ruledLines;
    const before = structuredClone(input.original);
    const result = reconcileMineruTextCoverage(input);
    expect(result.source.units[0].mapping.tableRecovery).toBeUndefined();
    expect(result.source.units[0].payload).toEqual(before.source.units[0].payload);
    expect(result.source.sourceLocators).toEqual(expect.arrayContaining(before.source.sourceLocators));
    expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'UNREAD', pageIndexes: [1] }));
  });
