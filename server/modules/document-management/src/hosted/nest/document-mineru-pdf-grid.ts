import type { MineruTranslationTable } from '../../../../professional-input/mineru/mineru-table';
import type { DocumentPdfPage } from './document-original-pdf';
import { originalPageLayout, type OriginalLayoutRun } from './document-original-layout';

type Box = [number, number, number, number];
interface NativeTable { page: DocumentPdfPage; box: Box; sourcePointer: string; table: MineruTranslationTable }
interface CellMatch { text: string; runs: OriginalLayoutRun[]; box: Box }
interface PhysicalRow { cells: Array<CellMatch | null> }
interface TextMatch {
  sourceRanges: Array<{ sourceRow: number; sourceColumn: number; start: number; end: number }>;
  extraction: 'RAW_TABLE_EXACT' | 'PDFJS_TEXT_LAYER';
  pageIndex: number;
  itemIndexes: number[];
}
interface SourceRun { run: OriginalLayoutRun; pageIndex: number }
interface GridEvidence {
  columnEdges: number[];
  rowEdges: number[];
  openBottom: boolean;
  lineOperatorIndexes: number[];
  rawSpanMatches: TextMatch[];
  sourceOffsetUnit: 'WHITESPACE_NORMALIZED_UTF16';
}
export interface PdfRuledTableGroup {
  tables: NativeTable[];
  located: PhysicalRow[][];
  grids: GridEvidence[];
  mergedSpanMatches: TextMatch[];
}
interface Axis { coordinate: number; intervals: Array<[number, number]> }

/** A second source of grid evidence, not a relaxation of the preproc grid.
 * Every page must have actual ruled columns/rows and exact raw-text accounting.
 * PDF-only text keeps independent page/item identity. Never join across pages. */
export function recoverPdfRuledTableGroup(tables: NativeTable[], merged: MineruTranslationTable): PdfRuledTableGroup | null {
  // This merge form retains every physical header, including polluted headers.
  // Require the original row/cell order exactly, before using independent PDF
  // geometry to repair the reading view. Repeated labels need no guesswork.
  const rawRows: Array<Array<string | null>> = tables.flatMap((table: NativeTable) => table.table.rows);
  if (rawRows.length !== merged.rows.length || rawRows.some((row: Array<string | null>, index: number) =>
    JSON.stringify(row.map((text: string | null) => normalize(text ?? ''))) !==
    JSON.stringify(merged.rows[index].map((text: string | null) => normalize(text ?? ''))))) return null;
  const pages = tables.map((table: NativeTable) => physicalGrid(table));
  if (!tables.length || pages.some((page) => !page)) return null;
  const grids: NonNullable<ReturnType<typeof physicalGrid>>[] = pages.filter((page): page is NonNullable<typeof page> => page !== null);
  const expected: string[] = merged.rows[0].map((text: string | null) => normalize(text ?? ''));
  if (grids.some((grid) => grid.rows[0].cells.length !== expected.length ||
      grid.rows[0].cells.some((cell: CellMatch | null, column: number) => normalize(cell?.text ?? '') !== expected[column]))) return null;
  let rowOffset: number = 0;
  const mergedSpanMatches: TextMatch[] = grids.flatMap((grid, index: number) => {
    const matches: TextMatch[] = grid.evidence.rawSpanMatches.map((match: TextMatch) => ({ ...match,
      sourceRanges: match.sourceRanges.map((range) => ({ ...range, sourceRow: range.sourceRow + rowOffset })) }));
    rowOffset += tables[index].table.rows.length;
    return matches;
  });
  return { located: grids.map((grid) => grid.rows), grids: grids.map((grid) => grid.evidence), mergedSpanMatches,
    tables: tables.map((table: NativeTable, index: number) => ({ ...table, box: grids[index].box,
      table: { caption: table.table.caption, needsVisualReview: false,
        rows: grids[index].rows.map((row: PhysicalRow) => row.cells.map((cell: CellMatch | null) => cell?.text ?? '')),
        cells: grids[index].rows.flatMap((row: PhysicalRow, rowIndex: number) => row.cells.map((_cell, column: number) =>
          ({ row: rowIndex, column, rowSpan: 1, colSpan: 1, header: rowIndex === 0 }))) } })) };
}

function physicalGrid(table: NativeTable): { rows: PhysicalRow[]; box: Box; evidence: GridEvidence } | null {
  const rules = table.page.ruledLines;
  const layout = originalPageLayout(table.page);
  if (!rules?.length || !layout.lines.length) return null;
  const retained = rules.filter((rule) => [rule.from, rule.to].every((point: number[]) =>
    point[0] >= table.box[0] - 4 && point[0] <= table.box[2] + 4 &&
    point[1] >= table.box[1] - 4 && point[1] <= table.box[3] + 4));
  const vertical: Axis[] = axes(retained.filter((line) => Math.abs(line.from[0] - line.to[0]) <= 0.01)
    .map((line) => [line.from[0], Math.min(line.from[1], line.to[1]), Math.max(line.from[1], line.to[1])]));
  const horizontal: Axis[] = axes(retained.filter((line) => Math.abs(line.from[1] - line.to[1]) <= 0.01)
    .map((line) => [line.from[1], Math.min(line.from[0], line.to[0]), Math.max(line.from[0], line.to[0])]));
  if (vertical.length < 3 || horizontal.length < 2) return null;
  const left: number = vertical[0].coordinate, right: number = vertical.at(-1)!.coordinate;
  const top: number = horizontal[0].coordinate;
  const ends: number[] = vertical.map((axis: Axis) => Math.max(...axis.intervals.map((interval: number[]) => interval[1])));
  const bottom: number = Math.min(...ends);
  if (Math.max(...ends) - bottom > 1 || vertical.some((axis: Axis) => !covers(axis, top, bottom)) ||
      horizontal.some((axis: Axis) => !covers(axis, left, right)) ||
      Math.abs(left - table.box[0]) > 4 || Math.abs(right - table.box[2]) > 4 ||
      Math.abs(top - table.box[1]) > 4 || Math.abs(bottom - table.box[3]) > 4) return null;
  const rows: number[] = horizontal.map((axis: Axis) => axis.coordinate);
  const openBottom: boolean = Math.abs(rows.at(-1)! - bottom) > 1;
  if (openBottom) rows.push(bottom);
  if (rows.length < 3 || rows.some((y: number, index: number) => index > 0 && y - rows[index - 1] <= 4)) return null;
  const columns: number[] = vertical.map((axis: Axis) => axis.coordinate);
  if (columns.some((x: number, index: number) => index > 0 && x - columns[index - 1] <= 4)) return null;
  const bounds: Box = [left, top, right, rows.at(-1)!];
  const cells: OriginalLayoutRun[][][] = rows.slice(1).map(() => columns.slice(1).map(() => []));
  const touched: OriginalLayoutRun[] = layout.lines.flatMap((line) => line.runs)
    .filter((run: OriginalLayoutRun) => overlaps(runBox(run), table.box) || overlaps(runBox(run), bounds));
  for (const run of touched) {
    const box: Box = runBox(run);
    if (!inside(bounds, box) || run.boxes.some((value: Box) => value[2] <= 0 || value[3] <= 0)) return null;
    const candidates: Array<[number, number]> = [];
    for (let row: number = 0; row < rows.length - 1; row++) for (let column: number = 0; column < columns.length - 1; column++) {
      const cell: Box = [columns[column], rows[row], columns[column + 1], rows[row + 1]];
      const center: [number, number] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
      if (inside(cell, box) && center[0] > cell[0] && center[0] < cell[2] && center[1] > cell[1] && center[1] < cell[3])
        candidates.push([row, column]);
    }
    if (candidates.length !== 1) return null;
    const [row, column] = candidates[0]; cells[row][column].push(run);
  }
  const physical: PhysicalRow[] = cells.map((row: OriginalLayoutRun[][]) => ({ cells: row.map((runs: OriginalLayoutRun[]) => {
    if (!runs.length) return null;
    const boxes: Box[] = runs.map((run: OriginalLayoutRun) => runBox(run));
    return { text: runs.map((run: OriginalLayoutRun) => run.text).join('\n'), runs,
      box: [Math.min(...boxes.map((box: Box) => box[0])), Math.min(...boxes.map((box: Box) => box[1])),
        Math.max(...boxes.map((box: Box) => box[2])), Math.max(...boxes.map((box: Box) => box[3]))] as Box };
  }) }));
  if (!physical.length || physical[0].cells.some((cell: CellMatch | null) => !cell) ||
      physical.slice(1).some((row: PhysicalRow) => row.cells.every((cell: CellMatch | null) => !cell))) return null;
  const runs: OriginalLayoutRun[] = physical.flatMap((row: PhysicalRow) => row.cells.flatMap((cell: CellMatch | null) => cell?.runs ?? []));
  const rawSpanMatches: TextMatch[] | null = consumeText(table.table.rows,
    runs.map((run: OriginalLayoutRun) => ({ run, pageIndex: table.page.pageIndex })));
  if (!rawSpanMatches) return null;
  return { rows: physical, box: bounds, evidence: { columnEdges: columns, rowEdges: rows, openBottom,
    lineOperatorIndexes: [...new Set(retained.map((line) => line.operatorIndex))], rawSpanMatches,
    sourceOffsetUnit: 'WHITESPACE_NORMALIZED_UTF16' } };
}

/** Exact characters may cross adjacent HTML cells in their original order.
 * Every raw character must be consumed once; PDF-only runs retain independent
 * provenance. No identifier parsing, value sorting or configuration inference. */
function consumeText(rows: Array<Array<string | null>>, runs: SourceRun[]): TextMatch[] | null {
  const spans = rows.flatMap((row: Array<string | null>, sourceRow: number) => row.map((text: string | null, sourceColumn: number) =>
    ({ text: normalize(text ?? ''), sourceRow, sourceColumn, offset: 0, used: [] as Array<[number, number]> })));
  let text: string = '';
  for (const span of spans) if (span.text) {
    if (text) text += ' ';
    span.offset = text.length; text += span.text;
  }
  const matches: TextMatch[] = [];
  for (const { run, pageIndex } of runs) {
    const needle: string = normalize(run.text);
    if (!needle) return null;
    const candidates: Array<Array<{ span: typeof spans[number]; start: number; end: number }>> = [];
    let start: number = text.indexOf(needle);
    while (start !== -1) {
      const end: number = start + needle.length;
      const pieces = spans.flatMap((span) => {
        const from: number = Math.max(start, span.offset), to: number = Math.min(end, span.offset + span.text.length);
        return from < to ? [{ span, start: from - span.offset, end: to - span.offset }] : [];
      });
      if ((start === 0 || text[start - 1] === ' ') && (end === text.length || text[end] === ' ') &&
          pieces.every((piece) => (piece.span.used.at(-1)?.[1] ?? 0) <= piece.start)) candidates.push(pieces);
      if (candidates.length > 1) return null;
      start = text.indexOf(needle, start + 1);
    }
    const pieces = candidates[0] ?? [];
    for (const piece of pieces) piece.span.used.push([piece.start, piece.end]);
    matches.push({ sourceRanges: pieces.map((piece) => ({ sourceRow: piece.span.sourceRow, sourceColumn: piece.span.sourceColumn,
      start: piece.start, end: piece.end })), extraction: pieces.length ? 'RAW_TABLE_EXACT' : 'PDFJS_TEXT_LAYER',
    pageIndex, itemIndexes: [...run.itemIndexes] });
  }
  return spans.every((span) => {
    let end: number = 0;
    for (const interval of span.used) {
      if (span.text.slice(end, interval[0]).trim()) return false;
      end = interval[1];
    }
    return !span.text.slice(end).trim();
  }) ? matches : null;
}
function normalize(text: string): string { return text.replace(/\s+/gu, ' ').trim(); }
function axes(lines: number[][]): Axis[] {
  const result: Axis[] = [];
  for (const line of lines.sort((a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1])) {
    const last: Axis | undefined = result.at(-1);
    if (last && Math.abs(last.coordinate - line[0]) <= 0.75) last.intervals.push([line[1], line[2]]);
    else result.push({ coordinate: line[0], intervals: [[line[1], line[2]]] });
  }
  return result;
}
function covers(axis: Axis, start: number, end: number): boolean {
  let edge: number = start;
  for (const interval of [...axis.intervals].sort((a: number[], b: number[]) => a[0] - b[0])) {
    if (interval[0] > edge + 1) return false;
    edge = Math.max(edge, interval[1]);
  }
  return edge >= end - 1;
}
function runBox(run: OriginalLayoutRun): Box {
  return [Math.min(...run.boxes.map((box: Box) => box[0])), Math.min(...run.boxes.map((box: Box) => box[1])),
    Math.max(...run.boxes.map((box: Box) => box[0] + box[2])), Math.max(...run.boxes.map((box: Box) => box[1] + box[3]))];
}
function inside(outer: Box, inner: Box): boolean {
  return inner[0] >= outer[0] - 2 && inner[1] >= outer[1] - 2 && inner[2] <= outer[2] + 2 && inner[3] <= outer[3] + 2;
}
function overlaps(a: Box, b: Box): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}
