import type { DocumentOriginalResult } from '@shared/document-original.interface';
import type { TranslationStructuredSourceUnit } from '@shared/canonical-translation-v2.interface';
import { readMineruTranslationTable, type MineruTranslationTable } from '../../../../professional-input/mineru/mineru-table';
import { originalPageLayout, type OriginalLayoutRun } from './document-original-layout';
import type { DocumentPdfExtraction, DocumentPdfPage } from './document-original-pdf';
import { recoverPdfRuledTableGroup, type PdfRuledTableGroup } from './document-mineru-pdf-grid';

type Box = [number, number, number, number];
interface NativeTable { page: DocumentPdfPage; box: Box; sourcePointer: string; table: MineruTranslationTable }
interface CellMatch { text: string; runs: OriginalLayoutRun[]; box: Box }
interface PhysicalRow { cells: Array<CellMatch | null> }
interface GridCell { cellId: string; columnIndex: number; rowSpan: number; colSpan: number; isHeader: boolean;
  textAvailability: string; inlineContent: Array<{ text: string; sourceRefIds: string[] }> }
interface GridRow { rowId: string; cells: GridCell[] }
interface RecoveryPage { pageIndex: number; sourcePointer: string; box: Box; itemIndexes: number[];
  ruledGrid?: PdfRuledTableGroup['grids'][number]; pdfSourceArtifactPath?: string }
interface SearchBudget { remaining: number; exhausted: boolean }
// Shared by candidate checks, row combinations and global alignment across one
// merged table's physical pages. Lease checks cannot interrupt synchronous search.
const TABLE_RECOVERY_SEARCH_WORK_LIMIT: number = 100_000;

/** MinerU's merged para_blocks may delete a later table body while preproc_blocks
 * still retain each physical table. Recover only a unique, complete correspondence
 * of those inert grids and the same PDF's text items. Raw OCR stays untouched. */
export function recoverMineruCrossPageTables(input: {
  original: DocumentOriginalResult; extraction: DocumentPdfExtraction; rawMiddle: unknown;
}): void {
  const { original, extraction } = input;
  const rawPages: unknown = object(input.rawMiddle)?.pdf_info;
  if (!Array.isArray(rawPages)) return;
  for (const unit of original.source.units.filter((entry: TranslationStructuredSourceUnit) => entry.kind === 'table')) {
    const start: number = Number(unit.mapping.pageIndex);
    const continuations: TranslationStructuredSourceUnit[] = [];
    for (let pageIndex: number = start + 1; pageIndex < extraction.pageCount; pageIndex++) {
      const candidates: TranslationStructuredSourceUnit[] = original.source.units.filter((entry: TranslationStructuredSourceUnit) =>
        Number(entry.mapping.pageIndex) === pageIndex && entry.kind === 'preserved_source' &&
        entry.payload.originalBlockType === 'table' && object(entry.payload.rawMineruContent)?.html === '');
      if (candidates.length !== 1) break;
      continuations.push(candidates[0]);
    }
    if (!continuations.length) continue;
    const units: TranslationStructuredSourceUnit[] = [unit, ...continuations];
    const native: Array<NativeTable | null> = units.map((entry: TranslationStructuredSourceUnit) => {
      const page: DocumentPdfPage | undefined = extraction.pages[Number(entry.mapping.pageIndex)];
      return page ? nativeTable(rawPages[page.pageIndex], entry, page) : null;
    });
    let tables: NativeTable[] = native.filter((entry: NativeTable | null): entry is NativeTable => entry !== null);
    const merged: MineruTranslationTable | null = inertTable(object(unit.payload.rawMineruContent)?.html);
    let ruled: PdfRuledTableGroup | null = null;
    if (tables.length !== units.length || !merged || !sameMergedRows(merged, tables)) {
      ruled = tables.length === units.length && merged ? recoverPdfRuledTableGroup(tables, merged) : null;
      if (!ruled) {
        uncertain(original, unit, units, '合并表与保留的逐页原始表无法唯一对应；未重建单元格或跨页行，请核对原页。');
        continue;
      }
      tables = ruled.tables;
    }
    const budget: SearchBudget = { remaining: TABLE_RECOVERY_SEARCH_WORK_LIMIT, exhausted: false };
    const located: Array<PhysicalRow[] | null> = ruled?.located ?? tables.map((table: NativeTable) => locateTable(table, budget));
    if (located.some((rows: PhysicalRow[] | null) => rows === null)) {
      uncertain(original, unit, units, budget.exhausted
        ? `跨页表匹配已达到 ${TABLE_RECOVERY_SEARCH_WORK_LIMIT} 步预算，尚未确定完整对应；保留原表。`
        : '逐页表格与 PDF 文字、列位置或阅读顺序未完整且唯一对应；保留原候选，请核对原页。');
      continue;
    }
    const rows: GridRow[] = [];
    const pages: RecoveryPage[] = [];
    const joinedRows: Array<{ rowId: string; continuationRowId: string; pageIndexes: number[] }> = [];
    for (const [tableIndex, table] of tables.entries()) {
      const physical: PhysicalRow[] = located[tableIndex]!;
      pages.push({ pageIndex: table.page.pageIndex, box: table.box, sourcePointer: table.sourcePointer,
        ...(ruled ? { ruledGrid: ruled.grids[tableIndex],
          pdfSourceArtifactPath: `original/pages-${Math.floor(table.page.pageIndex / 8) * 8}.json` } : {}),
        itemIndexes: physical.flatMap((row: PhysicalRow) => row.cells.flatMap((cell: CellMatch | null) =>
          cell?.runs.flatMap((run: OriginalLayoutRun) => run.itemIndexes) ?? [])) });
      for (const [rowIndex, row] of physical.entries()) {
        const grid: GridRow = { rowId: `${unit.unitId}:p${table.page.pageIndex}:r${rowIndex}`, cells: [] };
        for (const [column, match] of row.cells.entries()) {
          const parts: Array<CellMatch | null> = ruled && match ? match.runs.map((run: OriginalLayoutRun) =>
            ({ text: run.text, runs: [run], box: runBox(run) })) : [match];
          const inlineContent = parts.map((part: CellMatch | null, index: number) => {
            const ref: string = `${grid.rowId}:c${column}${ruled && part ? `:run${index}` : ''}:source`;
            original.source.sourceLocators.push({ sourceRefId: ref, kind: 'PDF_PAGE', artifactId: original.binding.sourceArtifactId,
              pageStart: table.page.pageIndex, pageEnd: table.page.pageIndex, charStart: null, charEnd: null, charOffsetUnit: null,
              normalizedPath: null, xpath: null, elementId: null, quote: part?.text ?? null, bbox: null });
            original.locations.push({ sourceRefId: ref, precision: part ? 'TEXT_ITEM' : 'NATIVE_SELECTOR',
              coordinateSpace: part ? 'PDF_VIEWPORT_TOP_LEFT' : null, pageIndex: table.page.pageIndex,
              viewportWidth: part ? table.page.width : null, viewportHeight: part ? table.page.height : null,
              boxes: part?.runs.flatMap((run: OriginalLayoutRun) => run.boxes.map((box: Box) => [...box] as Box)) ?? [] });
            unit.sourceRefIds.push(ref); unit.sourceSegmentIds.push(ref);
            return { text: `${index ? '\n' : ''}${part?.text ?? ''}`, sourceRefIds: [ref] };
          });
          grid.cells.push({ cellId: `${grid.rowId}:c${column}`, columnIndex: column, rowSpan: 1, colSpan: 1,
            isHeader: table.table.cells[rowIndex * row.cells.length + column].header,
            textAvailability: match ? 'TEXT_AVAILABLE' : 'NO_TEXT_ITEMS', inlineContent });
        }
        if (tableIndex > 0 && rowIndex === 0) continue; // Repeated physical header refs remain archived above.
        if (!ruled && tableIndex > 0 && rowIndex === 1 && boundaryContinuation(tables, located, tableIndex)) {
          const previous: GridRow = rows[rows.length - 1];
          for (const [column, cell] of grid.cells.entries()) if (row.cells[column])
            previous.cells[column].inlineContent.push(...cell.inlineContent.map((run: { text: string; sourceRefIds: string[] }) =>
              ({ ...run, text: `\n${run.text}` })));
          joinedRows.push({ rowId: previous.rowId, continuationRowId: grid.rowId,
            pageIndexes: [tables[tableIndex - 1].page.pageIndex, table.page.pageIndex] });
        } else rows.push(grid);
      }
      // PDF-only text has the existing literal-supplement reading qualification,
      // now inside its physical cell instead of a duplicate paragraph. A ruled
      // grid alone does not upgrade the unresolved page/configuration semantics.
      const pdfSupplement: boolean = ruled?.grids[tableIndex].rawSpanMatches
        .some((match) => match.extraction === 'PDFJS_TEXT_LAYER') ?? false;
      if ((!ruled || pdfSupplement) && !original.coverage.readPageIndexes.includes(table.page.pageIndex))
        original.coverage.readPageIndexes.push(table.page.pageIndex);
    }
    unit.payload.rowGroups = [{ rows }];
    unit.payload.readingHtml = gridHtml(rows);
    unit.mapping = { ...unit.mapping, supplementation: 'CROSS_PAGE_TABLE_CELLS',
      textItems: pages.map((page: RecoveryPage) => ({ pageIndex: page.pageIndex, itemIndexes: page.itemIndexes })),
      tableRecovery: { method: ruled ? 'PDF_RULED_GRID_EXACT_PAGE_SPANS' : 'PREPROC_GRID_EXACT_PDF_ITEMS',
        physicalTables: pages, joinedRows, ...(ruled ? { mergedSpanMatches: ruled.mergedSpanMatches } : {}) } };
    for (const entry of continuations) entry.mapping.tableRecovery = { recoveredByUnitId: unit.unitId };
    for (const range of original.coverage.unresolvedRanges) {
      const recoveredEmpty: boolean = range.reason === 'STRUCTURE_UNCERTAIN' && range.unitIds.length > 0 &&
        range.unitIds.every((id: string) => continuations.some((entry: TranslationStructuredSourceUnit) => entry.unitId === id));
      if (recoveredEmpty || (range.reason === 'UNREAD' && range.pageIndexes.every((pageIndex: number) =>
        pages.some((page: RecoveryPage) => page.pageIndex === pageIndex)))) {
        range.reason = 'STRUCTURE_UNCERTAIN'; range.readingImpact = ruled ? 'LIMITATION' : 'DIAGNOSTIC';
        range.unitIds = [...new Set([...range.unitIds, unit.unitId])];
        range.message = ruled
          ? 'PDF 线网格及原候选文字已核对，原件独有文字按页补入；空配置未补值，跨页行和配置关系仍未确认。'
          : 'MinerU 合并后留下空表块；保留的逐页原始表已与同源 PDF 文字完整对应，单元格物理页和文字位置已恢复。';
      }
    }
    original.source.findings.push({ findingId: `${unit.unitId}:cross-page-table-recovery`, code: 'PDF_TABLE_PAGE_RECOVERY',
      severity: 'warning', readingImpact: ruled ? 'LIMITATION' : 'DIAGNOSTIC', blocking: false,
      message: ruled
        ? 'PDF 线网格及全部原候选文字已核对，原件独有文字按页补入；阅读投影按物理页分行，原始候选和引用保留。'
        : '逐页原始表与 PDF 文字逐格完整核对；原合并表、空续表块和原始指针保留，页内单元格来源已恢复。',
      affectedUnitIds: units.map((entry: TranslationStructuredSourceUnit) => entry.unitId),
      sourceRefIds: [...unit.sourceRefIds], pageIndexes: pages.map((page: RecoveryPage) => page.pageIndex) });
    for (const joined of joinedRows) original.coverage.unresolvedRanges.push({ reason: 'STRUCTURE_UNCERTAIN',
      readingImpact: 'LIMITATION', pageIndexes: joined.pageIndexes, unitIds: [unit.unitId],
      message: '逐页原始表未保留跨页共享行标识；空标识列和页末位置支持续接，尚不能排除独立空标识行。原行片段和各页文字来源保留。' });
  }
}

/** Coverage is proven by retained item identity, not by concatenating columns or
 * suppressing warnings whose words happen to occur elsewhere in the document. */
export function recoveredMineruTableCoversItems(original: DocumentOriginalResult, pageIndex: number, indexes: number[]): boolean {
  return indexes.length > 0 && original.source.units.some((unit: TranslationStructuredSourceUnit) => {
    const pages: unknown = object(unit.mapping.tableRecovery)?.physicalTables;
    return Array.isArray(pages) && pages.some((value: unknown) => {
      const page: Record<string, unknown> | null = object(value);
      return page?.pageIndex === pageIndex && Array.isArray(page.itemIndexes) &&
        indexes.every((index: number) => (page.itemIndexes as unknown[]).includes(index));
    });
  });
}

function nativeTable(rawPage: unknown, unit: TranslationStructuredSourceUnit, page: DocumentPdfPage): NativeTable | null {
  const blocks: unknown = object(rawPage)?.preproc_blocks;
  const normalized: Box | null = box(unit.mapping.nativeBbox);
  if (!Array.isArray(blocks) || !normalized) return null;
  const bounds: Box = [normalized[0] * page.width / 1000, normalized[1] * page.height / 1000,
    normalized[2] * page.width / 1000, normalized[3] * page.height / 1000];
  const candidates: NativeTable[] = [];
  for (const [blockIndex, raw] of blocks.entries()) {
    const block: Record<string, unknown> | null = object(raw);
    const native: Box | null = box(block?.bbox);
    if (block?.type !== 'table' || !native || native.some((value: number, index: number) => Math.abs(value - bounds[index]) > 3) ||
        !Array.isArray(block.blocks)) continue;
    for (const [childIndex, childRaw] of block.blocks.entries()) {
      const child: Record<string, unknown> | null = object(childRaw);
      if (child?.type !== 'table_body' || !Array.isArray(child.lines)) continue;
      for (const [lineIndex, lineRaw] of child.lines.entries()) {
        const spans: unknown = object(lineRaw)?.spans;
        if (!Array.isArray(spans)) continue;
        for (const [spanIndex, spanRaw] of spans.entries()) {
          const span: Record<string, unknown> | null = object(spanRaw);
          const table: MineruTranslationTable | null = span?.type === 'table' ? inertTable(span.html) : null;
          if (table) candidates.push({ page, box: native, table,
            sourcePointer: `/raw/middle/pdf_info/${page.pageIndex}/preproc_blocks/${blockIndex}/blocks/${childIndex}/lines/${lineIndex}/spans/${spanIndex}/html` });
        }
      }
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}
function inertTable(html: unknown): MineruTranslationTable | null {
  if (typeof html !== 'string' || !html.trim()) return null;
  try {
    const table: MineruTranslationTable = readMineruTranslationTable(html);
    return table.rows.length >= 2 && table.rows[0].length >= 2 && !table.needsVisualReview &&
      table.cells.every((cell) => cell.rowSpan === 1 && cell.colSpan === 1) ? table : null;
  } catch { return null; } // Recovery refuses malformed data; existing source and its limitations survive.
}
function sameMergedRows(merged: MineruTranslationTable, tables: NativeTable[]): boolean {
  const header: string = signature(tables[0].table.rows[0]);
  if (tables.some((table: NativeTable) => signature(table.table.rows[0]) !== header)) return false;
  const rows: Array<Array<string | null>> = tables.flatMap((table: NativeTable, index: number) => table.table.rows.slice(index ? 1 : 0));
  return rows.length === merged.rows.length && rows.every((row: Array<string | null>, index: number) =>
    signature(row) === signature(merged.rows[index]));
}
function signature(row: Array<string | null>): string { return JSON.stringify(row.map((text: string | null) => compact(text ?? ''))); }
function compact(text: string): string { return text.replace(/\s/gu, ''); }

function locateTable(table: NativeTable, budget: SearchBudget): PhysicalRow[] | null {
  if (!spendSearchWork(budget)) return null;
  const lines = originalPageLayout(table.page).lines;
  const touched: OriginalLayoutRun[] = lines.flatMap((line) => line.runs).filter((run: OriginalLayoutRun) => {
    const value: Box = runBox(run);
    return value[0] < table.box[2] && value[2] > table.box[0] && value[1] < table.box[3] && value[3] > table.box[1];
  });
  if (touched.some((run: OriginalLayoutRun) => !inside(table.box, runBox(run)) ||
      run.boxes.some((value: Box) => value[2] <= 0 || value[3] <= 0))) return null;
  const runs: OriginalLayoutRun[] = touched;
  if (!runs.length) return null;
  const choices: PhysicalRow[][] = [];
  for (const row of table.table.rows) {
    if (!spendSearchWork(budget)) return null;
    const matches: Array<Array<CellMatch | null>> = row.map((text: string | null) => text?.trim()
      ? cellMatches(text, runs, budget) : [null]);
    if (budget.exhausted) return null;
    if (matches.some((values: Array<CellMatch | null>) => !values.length)) return null;
    const combinations: PhysicalRow[] = [];
    combine(0, [], null);
    if (budget.exhausted || !combinations.length || combinations.length > 64) return null;
    choices.push(combinations);
    function combine(column: number, cells: Array<CellMatch | null>, intersection: [number, number] | null): void {
      if (combinations.length > 64 || !spendSearchWork(budget)) return;
      if (column === matches.length) { combinations.push({ cells }); return; }
      for (const match of matches[column]) {
        if (!spendSearchWork(budget)) return;
        const previous: CellMatch | undefined = cells.filter((cell: CellMatch | null): cell is CellMatch => cell !== null).at(-1);
        if (match && previous && previous.box[2] > match.box[0] + 2) continue;
        const overlap: [number, number] | null = match ? [Math.max(intersection?.[0] ?? -Infinity, match.box[1]),
          Math.min(intersection?.[1] ?? Infinity, match.box[3])] : intersection;
        if (overlap && overlap[0] > overlap[1] + 2) continue;
        combine(column + 1, [...cells, match], overlap);
      }
    }
  }
  const all: number[] = runs.flatMap((run: OriginalLayoutRun) => run.itemIndexes);
  const solutions: PhysicalRow[][] = [];
  select(0, [], -Infinity, new Set<number>());
  // One solution before exhaustion does not prove uniqueness/completeness of
  // the remaining alternatives. Never publish a partially searched recovery.
  return !budget.exhausted && solutions.length === 1 ? solutions[0] : null;
  function select(index: number, rows: PhysicalRow[], bottom: number, used: Set<number>): void {
    if (solutions.length > 1 || !spendSearchWork(budget)) return;
    if (index === choices.length) {
      if (used.size === all.length && all.every((item: number) => used.has(item))) solutions.push(rows);
      return;
    }
    for (const row of choices[index]) {
      if (!spendSearchWork(budget)) return;
      const cells: CellMatch[] = row.cells.filter((cell: CellMatch | null): cell is CellMatch => cell !== null);
      if (!cells.length || Math.min(...cells.map((cell: CellMatch) => cell.box[1])) < bottom - 2) continue;
      const items: number[] = cells.flatMap((cell: CellMatch) => cell.runs.flatMap((run: OriginalLayoutRun) => run.itemIndexes));
      if (new Set(items).size !== items.length || items.some((item: number) => used.has(item))) continue;
      select(index + 1, [...rows, row], Math.max(...cells.map((cell: CellMatch) => cell.box[3])), new Set([...used, ...items]));
    }
  }
}
function cellMatches(text: string, runs: OriginalLayoutRun[], budget: SearchBudget): CellMatch[] {
  const needle: string = compact(text);
  const matches: CellMatch[] = [];
  for (const start of runs) {
    if (!spendSearchWork(budget)) return [];
    let selected: OriginalLayoutRun[] = [start];
    let current: string = compact(start.text);
    let bounds: Box = runBox(start);
    let commonLeft: number = bounds[0], commonRight: number = bounds[2];
    while (needle.startsWith(current)) {
      if (current === needle) { matches.push({ runs: selected, box: bounds, text: selected.map((run: OriginalLayoutRun) => run.text).join(' ') }); break; }
      const last: Box = runBox(selected[selected.length - 1]);
      const next: OriginalLayoutRun[] = [];
      for (const run of runs) {
        if (!spendSearchWork(budget)) return [];
        const value: Box = runBox(run);
        if (value[1] > last[1] + 0.5 && value[1] - last[1] <= (last[3] - last[1]) * 1.8 &&
            Math.max(value[0], commonLeft) < Math.min(value[2], commonRight)) next.push(run);
      }
      next.sort((left: OriginalLayoutRun, right: OriginalLayoutRun) => runBox(left)[1] - runBox(right)[1]);
      if (!next.length || (next.length > 1 && Math.abs(runBox(next[0])[1] - runBox(next[1])[1]) < 0.5)) break;
      const value: Box = runBox(next[0]);
      selected = [...selected, next[0]]; current += compact(next[0].text);
      commonLeft = Math.max(commonLeft, value[0]); commonRight = Math.min(commonRight, value[2]);
      bounds = [Math.min(bounds[0], value[0]), bounds[1], Math.max(bounds[2], value[2]), value[3]];
    }
  }
  return matches;
}
function spendSearchWork(budget: SearchBudget): boolean {
  if (budget.remaining === 0) { budget.exhausted = true; return false; }
  budget.remaining -= 1;
  return true;
}
function runBox(run: OriginalLayoutRun): Box {
  return [Math.min(...run.boxes.map((value: Box) => value[0])), Math.min(...run.boxes.map((value: Box) => value[1])),
    Math.max(...run.boxes.map((value: Box) => value[0] + value[2])), Math.max(...run.boxes.map((value: Box) => value[1] + value[3]))];
}
function boundaryContinuation(tables: NativeTable[], located: Array<PhysicalRow[] | null>, index: number): boolean {
  const current: PhysicalRow[] = located[index]!, previous: PhysicalRow[] = located[index - 1]!;
  const first: PhysicalRow = current[1], last: PhysicalRow = previous[previous.length - 1];
  const blanks: number[] = first.cells.flatMap((cell: CellMatch | null, column: number) => cell ? [] : [column]);
  if (current.length < 3 || !blanks.length || first.cells.filter(Boolean).length < 2 || last.cells.some((cell: CellMatch | null) => !cell) ||
      current.slice(2).some((row: PhysicalRow) => row.cells.some((cell: CellMatch | null) => !cell))) return false;
  // Blank identifiers alone are insufficient. Require aligned physical columns,
  // edge rows, and a populated unique identifier column in all other source rows.
  const rows: PhysicalRow[] = [...previous.slice(1), ...current.slice(2)];
  if (!blanks.every((column: number) => new Set(rows.map((row: PhysicalRow) => compact(row.cells[column]?.text ?? ''))).size === rows.length)) return false;
  const a: Box = tables[index - 1].box, b: Box = tables[index].box;
  if (Math.abs(a[0] / tables[index - 1].page.width - b[0] / tables[index].page.width) > 0.005 ||
      Math.abs(a[2] / tables[index - 1].page.width - b[2] / tables[index].page.width) > 0.005) return false;
  const lastBottom: number = Math.max(...last.cells.map((cell: CellMatch | null) => cell?.box[3] ?? -Infinity));
  const headerBottom: number = Math.max(...current[0].cells.map((cell: CellMatch | null) => cell?.box[3] ?? -Infinity));
  const firstTop: number = Math.min(...first.cells.map((cell: CellMatch | null) => cell?.box[1] ?? Infinity));
  return a[3] - lastBottom <= 20 && firstTop - headerBottom <= 20 && first.cells.every((cell: CellMatch | null, column: number) =>
    !cell || Math.abs(cell.runs[0].x / tables[index].page.width - last.cells[column]!.runs[0].x / tables[index - 1].page.width) <= 0.005);
}
function gridHtml(rows: GridRow[]): string {
  const escape = (text: string): string => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
  return `<table>${rows.map((row: GridRow) => `<tr>${row.cells.map((cell: GridCell) =>
    `<${cell.isHeader ? 'th' : 'td'}>${escape(cell.inlineContent.map((run) => run.text).join(''))}</${cell.isHeader ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`;
}
function uncertain(original: DocumentOriginalResult, unit: TranslationStructuredSourceUnit, units: TranslationStructuredSourceUnit[], message: string): void {
  original.coverage.unresolvedRanges.push({ reason: 'STRUCTURE_UNCERTAIN', readingImpact: 'LIMITATION',
    unitIds: [unit.unitId], pageIndexes: units.map((entry: TranslationStructuredSourceUnit) => Number(entry.mapping.pageIndex)), message });
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function box(value: unknown): Box | null {
  return Array.isArray(value) && value.length === 4 && value.every((item: unknown) => typeof item === 'number' && Number.isFinite(item)) &&
    value[0] >= 0 && value[1] >= 0 && value[2] > value[0] && value[3] > value[1] ? value as Box : null;
}
function inside(outer: Box, inner: Box): boolean {
  return inner[0] >= outer[0] - 2 && inner[1] >= outer[1] - 2 && inner[2] <= outer[2] + 2 && inner[3] <= outer[3] + 2;
}
