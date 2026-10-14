import { documentMineruOriginal } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-original-adapter';
import { reconcileMineruTextCoverage } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-text-coverage';
import { documentOriginalStructuredSource, documentOriginalReadingCoverage } from '../../../server/modules/document-management/src/hosted/nest/document-original-adapter';
import { recoveredMineruTableCoversItems } from '../../../server/modules/document-management/src/hosted/nest/document-mineru-cross-page-table';
import type { DocumentPdfPage } from '../../../server/modules/document-management/src/hosted/nest/document-original-pdf';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const binding = { documentVersionId: 'DV', parseRunId: 'PR', parseRevision: 2, sourceArtifactId: 'SRC',
  sourceSha256: 'a'.repeat(64), sourceByteLength: 12 };
function html(rows: string[][]): string {
  return `<table>${rows.map((row: string[]) => `<tr>${row.map((text: string) => `<td>${text}</td>`).join('')}</tr>`).join('')}</table>`;
}
function page(rows: string[][], tops: number[], pageIndex: number): DocumentPdfPage {
  const items: DocumentPdfPage['items'] = rows.flatMap((row: string[], index: number) => row.flatMap((text: string, column: number) =>
    text ? [{ text, transform: [10, 0, 0, 10, [120, 350, 600][column], 990 - tops[index]],
      width: 90, height: 10, hasEOL: true }] : []));
  return { pageIndex, width: 1000, height: 1000, rotation: 0, items, text: items.map((item) => item.text).join('\n') };
}
function fixture(firstPage?: { rows: string[][]; tops: number[]; box: number[] },
  secondPage?: { rows: string[][]; tops: number[]; box: number[] }) {
  const header: string[] = ['Component', 'Code', 'Method'];
  const physicalRows: string[][][] = [firstPage?.rows ?? [header, ['Core', 'CORE', 'Vendor'], ['Print Manager', 'PRINT_APP', 'Service']],
    secondPage?.rows ?? [header, ['Application', '', 'Request'], ['Driver', 'PRINT_CFG', 'Vendor'], ['Operator setup', 'SETUP', 'Operator']]];
  const boxes: number[][] = [firstPage?.box ?? [100, 700, 800, 935], secondPage?.box ?? [100, 100, 800, 280]];
  const blocks = physicalRows.map((rows: string[][], index: number) => [{ type: 'table', bbox: boxes[index],
    content: { html: index ? '' : html([...physicalRows[0], ...physicalRows[1].slice(1)]), table_type: 'simple_table' } }]);
  const middle = { _version_name: '3.0.9', _backend: 'pipeline', pdf_info: physicalRows.map((rows: string[][], index: number) => ({
    page_idx: index, page_size: [1000, 1000], preproc_blocks: [{ type: 'table', bbox: boxes[index], blocks: [{ type: 'table_body',
      lines: [{ spans: [{ type: 'table', html: html(rows) }] }] }] }],
  })) };
  const original = documentMineruOriginal({ binding, documentVersion: { documentVersionId: 'DV', documentId: 'DOC', familyId: 'FAM',
    sourceArtifactId: 'SRC', pdfSha256: binding.sourceSha256, byteLength: 12 },
    result: { sourceSha256: binding.sourceSha256, sourceByteLength: 12,
      rawArtifacts: { markdown: 'Retained raw OCR', contentListV2: blocks, middle }, assets: [] } });
  return { original, extraction: { pageCount: 2, pages: [page(physicalRows[0], firstPage?.tops ?? [720, 820, 920], 0),
    page(physicalRows[1], secondPage?.tops ?? [120, 150, 200, 250], 1)] }, rawMiddle: middle, rawContentListV2: blocks };
}
interface Cell { inlineContent: Array<{ text: string; sourceRefIds: string[] }> }
interface Row { rowId: string; cells: Cell[] }
function grid(result: ReturnType<typeof reconcileMineruTextCoverage>): Row[] {
  return (result.source.units[0].payload.rowGroups as Array<{ rows: Row[] }>)[0].rows;
}

it('restores physical cell pages/boxes, retains all raw content, and consumes the recovered grid in the reading view', () => {
  const input = fixture(), before = structuredClone(input);
  const result = reconcileMineruTextCoverage(input);
  expect(input).toEqual(before);
  expect(result.binding).toEqual(binding);
  expect(result.source.units[0].mapping.tableRecovery).toMatchObject({ method: 'PREPROC_GRID_EXACT_PDF_ITEMS',
    physicalTables: [{ pageIndex: 0 }, { pageIndex: 1 }] });
  const rows = grid(result);
  expect(rows).toHaveLength(5);
  expect(rows[2].cells.map((cell: Cell) => cell.inlineContent.map((run) => run.text).join('')))
    .toEqual(['Print Manager\nApplication', 'PRINT_APP', 'Service\nRequest']);
  expect(rows[2].cells[0].inlineContent.map((run) => result.locations.find((location) => location.sourceRefId === run.sourceRefIds[0])?.pageIndex))
    .toEqual([0, 1]);
  for (const cell of rows[3].cells) for (const run of cell.inlineContent) {
    expect(result.source.sourceLocators.find((locator) => locator.sourceRefId === run.sourceRefIds[0])).toMatchObject({
      artifactId: 'SRC', pageStart: 1, pageEnd: 1, quote: run.text });
    expect(result.locations.find((location) => location.sourceRefId === run.sourceRefIds[0])).toMatchObject({
      pageIndex: 1, precision: 'TEXT_ITEM', coordinateSpace: 'PDF_VIEWPORT_TOP_LEFT', boxes: expect.any(Array) });
  }
  expect(result.source.units[0].payload.rawMineruContent).toEqual(before.original.source.units[0].payload.rawMineruContent);
  expect(result.source.units[1].payload.rawMineruContent).toEqual(before.original.source.units[1].payload.rawMineruContent);
  expect(result.markdown).toContain('Service\nRequest');
  expect(result.markdown).not.toContain('<td>Application</td>');
  expect(documentOriginalStructuredSource(result, binding).sourceLocators.length).toBeGreaterThan(2);
  expect(result.coverage.readPageIndexes).toEqual([0, 1]);
  expect(result.coverage.unresolvedRanges.some((range) => range.reason === 'UNREAD')).toBe(false);
  expect(documentOriginalReadingCoverage(result).unresolvedRanges).toContainEqual(expect.objectContaining({
    reason: 'STRUCTURE_UNCERTAIN', readingImpact: 'LIMITATION', pageIndexes: [0, 1] }));
  const detail = result.coverage.unresolvedRanges.find((range) => range.message.includes('共享行标识'))!;
  const displayed = documentOriginalReadingCoverage(result).unresolvedRanges.find((range) => range.message === detail.message);
  expect(displayed?.message).toContain('共享行标识');
  expect(displayed?.message).toContain('独立空标识行');
  // Persisted older wording is selected by the archived relation, not a wording prefix.
  detail.message = '逐页原始表未保留跨页共享行标识；仍无法独立排除单独的空标识行。';
  expect(documentOriginalReadingCoverage(result).unresolvedRanges.some((range) => range.message === detail.message)).toBe(true);
  expect(result.coverage.unresolvedRanges.some((range) => range.reason === 'TEXT_CONFLICT')).toBe(false);
  expect(recoveredMineruTableCoversItems(result, 1, [0])).toBe(true);
  expect(recoveredMineruTableCoversItems(result, 1, [999])).toBe(false);
});

it.each([{ count: 40, note: true, second: false }, { count: 20, note: false, second: true }])
  ('bounds repeated-row search and never treats exhausted partial search as recovery ($count rows, note=$note, second=$second)', ({ count, note, second }) => {
    const rows: string[][] = [['Component', 'Code', 'Method'], ...Array.from({ length: count }, () => ['A', 'B', 'C'])];
    const repeated = { rows, tops: [110, ...Array.from({ length: count }, (_value, index: number) => 130 + index * 14)],
      box: [100, 100, 800, 950] };
    const input = second ? fixture(undefined, repeated) : fixture(repeated);
    if (note) {
      const first: DocumentPdfPage = input.extraction.pages[0];
      first.items.push({ text: 'Unlisted note', transform: [10, 0, 0, 10, 120, 100], width: 90, height: 10, hasEOL: true });
      first.text = first.items.map(item => item.text).join('\n');
    }
    // A process timeout prevents a future synchronous-search regression from
    // freezing the test runner; ordinary Jest timeouts cannot interrupt it.
    const script: string = `
      const fs = require('node:fs');
      const { reconcileMineruTextCoverage } = require(process.argv[1]);
      const { documentOriginalReadingCoverage } = require(process.argv[2]);
      const input = JSON.parse(fs.readFileSync(0, 'utf8'));
      const result = reconcileMineruTextCoverage(input);
      const unit = result.source.units.find(value => value.unitId === input.original.source.units[0].unitId);
      const reading = documentOriginalReadingCoverage(result);
      process.stdout.write(JSON.stringify({
        recovered: Boolean(unit.mapping.tableRecovery),
        payloadPreserved: JSON.stringify(unit.payload) === JSON.stringify(input.original.source.units[0].payload),
        originalRefsPreserved: input.original.source.sourceLocators.every(old =>
          result.source.sourceLocators.some(value => JSON.stringify(value) === JSON.stringify(old))),
        unread: result.coverage.unresolvedRanges.some(range => range.reason === 'UNREAD' && range.pageIndexes.includes(1)),
        budgetRecorded: result.coverage.unresolvedRanges.some(range => range.message.includes('步预算')),
        readingMessage: reading.unresolvedRanges.find(range => range.message.includes('对齐尚未完成'))?.message,
      }));`;
    const child = spawnSync(process.execPath, ['-r', 'ts-node/register', '-e', script,
      resolve('server/modules/document-management/src/hosted/nest/document-mineru-text-coverage.ts'),
      resolve('server/modules/document-management/src/hosted/nest/document-original-adapter.ts')], {
      cwd: process.cwd(), env: { ...process.env, TS_NODE_PROJECT: resolve('tsconfig.jest.json') },
      input: JSON.stringify(input), encoding: 'utf8', timeout: 8_000, killSignal: 'SIGKILL', maxBuffer: 1_000_000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    expect(JSON.parse(child.stdout)).toEqual({ recovered: false, payloadPreserved: true,
      originalRefsPreserved: true, unread: true, budgetRecorded: true,
      readingMessage: '跨页表逐页对齐尚未完成，已保留原表。' });
  }, 12_000);

it.each(['missing text', 'extra text', 'crossing table edge', 'columns swapped', 'zero-width geometry', 'rotation', 'native page mismatch', 'duplicate native table'])
  ('refuses recovery when %s prevents complete and unique physical correspondence', (failure: string) => {
    const input = fixture();
    const continuation: DocumentPdfPage = input.extraction.pages[1];
    if (failure === 'missing text') continuation.items[3].text = 'Wrong header';
    if (failure === 'extra text') continuation.items.push({ text: 'Additional requirement', transform: [10, 0, 0, 10, 120, 760],
      width: 90, height: 10, hasEOL: true });
    if (failure === 'crossing table edge') continuation.items.push({ text: 'Crossing requirement', transform: [10, 0, 0, 10, 790, 760],
      width: 90, height: 10, hasEOL: true });
    if (failure === 'columns swapped') {
      continuation.items[3].transform[4] = 600; continuation.items[4].transform[4] = 120;
    }
    if (failure === 'zero-width geometry') continuation.items.forEach((item) => { item.width = 0; });
    if (failure === 'rotation') continuation.rotation = 90;
    if (failure === 'native page mismatch') input.rawMiddle.pdf_info[1].preproc_blocks[0].bbox = [20, 100, 800, 280];
    if (failure === 'duplicate native table') input.rawMiddle.pdf_info[1].preproc_blocks.push(structuredClone(input.rawMiddle.pdf_info[1].preproc_blocks[0]));
    continuation.text = continuation.items.map((item) => item.text).join('\n');
    const result = reconcileMineruTextCoverage(input);
    expect(result.source.units[0].mapping.tableRecovery).toBeUndefined();
    expect(grid(result)).toHaveLength(6);
    expect(result.locations.some((location) => location.sourceRefId.startsWith('PR:page-1-block-1:p1:'))).toBe(false);
    expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'UNREAD', pageIndexes: [1] }));
    expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'STRUCTURE_UNCERTAIN',
      readingImpact: 'LIMITATION', pageIndexes: [0, 1] }));
  });

it('retains an independent first body row when its identifier column is populated', () => {
  const input = fixture();
  input.rawMiddle.pdf_info[1].preproc_blocks[0].blocks[0].lines[0].spans[0].html =
    input.rawMiddle.pdf_info[1].preproc_blocks[0].blocks[0].lines[0].spans[0].html.replace('<td></td>', '<td>APP</td>');
  input.rawContentListV2[0][0].content.html = input.rawContentListV2[0][0].content.html.replace('<td></td>', '<td>APP</td>');
  // Rebuild the source from the new raw candidate, as normal publication does.
  const table = input.original.source.units[0];
  (table.payload.rawMineruContent as Record<string, unknown>).html = input.rawContentListV2[0][0].content.html;
  const continuation: DocumentPdfPage = input.extraction.pages[1];
  continuation.items.push({ text: 'APP', transform: [10, 0, 0, 10, 350, 840], width: 90, height: 10, hasEOL: true });
  continuation.text = continuation.items.map((item) => item.text).join('\n');
  const result = reconcileMineruTextCoverage(input);
  expect(grid(result)).toHaveLength(6);
  expect(result.source.units[0].mapping.tableRecovery).toMatchObject({ joinedRows: [] });
  expect(result.coverage.readPageIndexes).toEqual([0, 1]);
});

it('does not infer a continuation from a blank column with repeated identifiers elsewhere in the source tables', () => {
  const input = fixture();
  const replace = (text: string): string => text.replace('SETUP', 'CORE');
  input.rawMiddle.pdf_info[1].preproc_blocks[0].blocks[0].lines[0].spans[0].html = replace(input.rawMiddle.pdf_info[1].preproc_blocks[0].blocks[0].lines[0].spans[0].html);
  input.rawContentListV2[0][0].content.html = replace(input.rawContentListV2[0][0].content.html);
  (input.original.source.units[0].payload.rawMineruContent as Record<string, unknown>).html = input.rawContentListV2[0][0].content.html;
  const continuation: DocumentPdfPage = input.extraction.pages[1];
  continuation.items.find((item) => item.text === 'SETUP')!.text = 'CORE';
  continuation.text = continuation.items.map((item) => item.text).join('\n');
  const result = reconcileMineruTextCoverage(input);
  expect(grid(result)).toHaveLength(6);
  expect(result.source.units[0].mapping.tableRecovery).toMatchObject({ joinedRows: [] });
});

it('preserves missing provenance and merged-cell candidates as concrete limitations', () => {
  for (const failure of ['missing provenance', 'merged cell']) {
    const input = fixture();
    if (failure === 'missing provenance') input.rawMiddle.pdf_info[1].preproc_blocks = [];
    else input.rawMiddle.pdf_info[1].preproc_blocks[0].blocks[0].lines[0].spans[0].html =
      input.rawMiddle.pdf_info[1].preproc_blocks[0].blocks[0].lines[0].spans[0].html.replace('<td>Application', '<td colspan="2">Application');
    const result = reconcileMineruTextCoverage(input);
    expect(result.source.units[0].mapping.tableRecovery).toBeUndefined();
    expect(result.coverage.unresolvedRanges).toContainEqual(expect.objectContaining({ reason: 'UNREAD', pageIndexes: [1] }));
  }
});
