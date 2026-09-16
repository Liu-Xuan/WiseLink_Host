import { readOriginalHtmlTable } from './document-original-html-table';
import { originalPageLayout, type OriginalLayoutLine } from './document-original-layout';
import type { DocumentOriginalBinding, DocumentOriginalResult } from '@shared/document-original.interface';
import type { TranslationStructuredSourceUnit } from '@shared/canonical-translation-v2.interface';
import type { DocumentPdfExtraction } from './document-original-pdf';
import { matchOriginalText, normalizeOriginalWhitespace, readOriginalMarkdownTable, originalMarkdownText } from './document-original-text';

interface Candidate { kind: 'paragraph' | 'heading' | 'table'; text: string; payload: Record<string, unknown>; fallbackOnly?: boolean }

/** Plugin organization is accepted only where it exactly agrees with the same PDF
 * text layer. Unmatched original ranges remain readable and specifically flagged.
 * Raw PDF items and plugin Markdown must be retained by the artifact writer. */
export function composeDocumentOriginal(input: {
  binding: DocumentOriginalBinding;
  extraction: DocumentPdfExtraction;
  markdown: string;
  producer: DocumentOriginalResult['producer'];
}): DocumentOriginalResult {
  const layouts = [...input.extraction.pages].sort((a, b) => a.pageIndex - b.pageIndex).map(originalPageLayout);
  const pages = layouts.map(layout => layout.page);
  const unresolved: DocumentOriginalResult['coverage']['unresolvedRanges'] = [];
  const units: TranslationStructuredSourceUnit[] = [];
  const sourceLocators: DocumentOriginalResult['source']['sourceLocators'] = [];
  const locations: DocumentOriginalResult['locations'] = [];
  const spans: Array<{ pageIndex: number; start: number; end: number }> = [];
  const lines: Array<OriginalLayoutLine & { pageIndex: number }> = [];
  const breaks: number[] = [];
  let comparison = '';
  for (const page of pages) {
    if (comparison) comparison += ' ';
    const start = comparison.length;
    breaks.push(start);
    for (const line of layouts.find(layout => layout.page.pageIndex === page.pageIndex)!.lines) {
      lines.push({ ...line, start: start + line.start, end: start + line.end, pageIndex: page.pageIndex });
      if (line.breakBefore) breaks.push(start + line.start);
    }
    comparison += normalizeOriginalWhitespace(page.text);
    spans.push({ pageIndex: page.pageIndex, start, end: comparison.length });
  }
  const organized: Array<{ start: number; end: number; candidate: Candidate }> = [];
  const furniture = new Set<number>();
  const repeats = (line: typeof lines[number]) => lines.some(other => other.pageIndex !== line.pageIndex &&
    other.text === line.text && Math.abs(other.y - line.y) < Math.max(line.height, other.height));
  for (const page of pages) {
    let legalContinuation = false;
    for (const line of lines.filter(line => line.pageIndex === page.pageIndex)) {
      const technical = /^(?:WARNING|CAUTION|NOTE|DANGER)\b|\b(?:shall|must|do not|unless|only if)\b/i.test(line.text);
      const legalStart = /^(?:BOEING PROPRIETARY\b|EXPORT CONTROLLED\b|Copyright\s)/i.test(line.text);
      if (legalStart) legalContinuation = true;
      else if (line.breakBefore || technical) legalContinuation = false;
      const recognizedHeader = line.y > page.height * 0.88 && line.text === 'FLEET TEAM DIGEST' && repeats(line);
      const legal = line.y < page.height * 0.13 && legalContinuation && repeats(line);
      const pageNumber = line.y < page.height * 0.13 && line.text === `${line.pageIndex + 1} of ${input.extraction.pageCount}` &&
        lines.some(header => header.pageIndex === page.pageIndex && header.text === 'FLEET TEAM DIGEST' && repeats(header));
      if (recognizedHeader || legal || pageNumber) furniture.add(line.start);
    }
  }
  // Establish author headings from local geometry and surrounding source lines.
  // Large text alone is insufficient: require a separated, single run aligned with its body.
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], next = lines[index + 1];
    if (furniture.has(line.start) || !next || next.pageIndex !== line.pageIndex) continue;
    if (line.breakBefore && line.runs.length === 1 && (Math.abs(line.x - next.x) <= next.height * 1.2 ||
          Math.abs(line.x + line.width / 2 - pages.find(page => page.pageIndex === line.pageIndex)!.width / 2) < 2) &&
        line.height > next.height * 1.2) {
      organized.push({ start: line.start, end: line.end, candidate: { kind: 'heading', text: line.text,
        payload: { text: line.text, level: 2 } } });
      breaks.push(next.start);
    }
    // Explicit Change labels plus indentation establish nested author structure.
    if (line.breakBefore && /^Change \d+:/i.test(line.text)) {
      let endIndex = index;
      while (lines[endIndex + 1]?.pageIndex === line.pageIndex && !lines[endIndex + 1].breakBefore &&
        Math.abs(lines[endIndex + 1].x - line.x) < 2) endIndex++;
      const end = lines[endIndex].end;
      organized.push({ start: line.start, end, candidate: { kind: 'heading', text: comparison.slice(line.start, end),
        payload: { text: comparison.slice(line.start, end), level: 3 } } });
      if (lines[endIndex + 1]) breaks.push(lines[endIndex + 1].start);
    }
  }
  // A physical column header plus aligned following runs supplies table evidence.
  // Wrapped source rows are joined within their columns; no plugin cell text is used.
  for (let index = 0; index < lines.length - 1; index++) {
    const header = lines[index], next = lines[index + 1];
    if (organized.some(range => range.start < header.end && range.end > header.start) || header.runs.length < 2 || furniture.has(header.start) || next.pageIndex !== header.pageIndex ||
        header.y - next.y < header.height * 1.4 || header.runs.some(run => /\d/.test(run.text))) continue;
    const columns = header.runs.map(run => run.x);
    const assign = (line: typeof header): string[] | null => {
      const cells = columns.map(() => '');
      for (const run of line.runs) {
        const column = columns.findIndex(x => Math.abs(run.x - x) < 2);
        if (column < 0 || (column + 1 < columns.length && run.endX >= columns[column + 1] - 2)) return null;
        cells[column] = run.text;
      }
      return cells;
    };
    if (!assign(next)) continue;
    const rows: string[][] = [header.runs.map(run => run.text)];
    let last = index;
    for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex++) {
      const line = lines[rowIndex];
      if (line.pageIndex !== header.pageIndex || furniture.has(line.start) || line.height !== header.height ||
          organized.some(range => range.start < line.end && range.end > line.start)) break;
      const cells = assign(line);
      if (!cells) break;
      // A new separated multi-column label followed by values starts a new key/value group.
      if (rowIndex > index + 1 && line.breakBefore && line.runs.length >= 2 &&
          line.runs.every(run => !/\d/.test(run.text)) && header.y - line.y > header.height * 3 &&
          lines[rowIndex + 1]?.pageIndex === line.pageIndex && line.y - lines[rowIndex + 1].y >= line.height * 1.4) break;
      if (!line.breakBefore && rows.length > 1) cells.forEach((text, column) => {
        if (text) rows[rows.length - 1][column] += (rows[rows.length - 1][column] ? ' ' : '') + text;
      });
      else rows.push(cells);
      last = rowIndex;
    }
    if (last === index || rows.length < 2) continue;
    const end = lines[last].end;
    organized.push({ start: header.start, end, candidate: { kind: 'table', text: comparison.slice(header.start, end),
      payload: { nativeRows: rows, nativeHeader: true, columnStarts: columns, columnCount: columns.length,
        continuation: { continuityKey: `source-table:${header.pageIndex}:${header.start}` } } } });
    // Continue only an existing physical grid at the immediately following page's first body line.
    let endLine = lines[last];
    while (!lines.some(line => line.pageIndex === endLine.pageIndex && line.start > endLine.end && !furniture.has(line.start))) {
      const following = lines.filter(line => line.pageIndex === endLine.pageIndex + 1 && !furniture.has(line.start));
      if (!following.length || !assign(following[0]) || following[0].height !== header.height) break;
      const continued: string[][] = [];
      let finalLine: typeof header | null = null;
      for (const line of following) {
        if (line.height !== header.height || organized.some(range => range.start < line.end && range.end > line.start)) break;
        const cells = assign(line); if (!cells) break;
        if (!line.breakBefore && continued.length) cells.forEach((text, column) => {
          if (text) continued[continued.length - 1][column] += (continued[continued.length - 1][column] ? ' ' : '') + text;
        }); else continued.push(cells);
        finalLine = line;
      }
      if (!finalLine) break;
      organized.push({ start: following[0].start, end: finalLine.end, candidate: { kind: 'table',
        text: comparison.slice(following[0].start, finalLine.end), payload: { nativeRows: continued, nativeHeader: false,
          columnStarts: columns, columnCount: columns.length,
          continuation: { continuityKey: `source-table:${header.pageIndex}:${header.start}` } } } });
      endLine = finalLine;
    }
    index = last;
  }
  const candidates = markdownCandidates(input.markdown);
  const matches = candidates.map(candidate => matchOriginalText(candidate.text, pages));
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const headingLines = candidate.kind === 'heading' ? lines.filter(line => line.text === normalizeOriginalWhitespace(candidate.text)) : [];
    if (candidate.fallbackOnly && !headingLines.length) continue;
    const match = headingLines.length ? {
      status: headingLines.length === 1 ? 'UNIQUE' : 'AMBIGUOUS',
      candidates: headingLines.map(line => ({ start: line.start, end: line.end, pageIndexes: [line.pageIndex] })),
    } : matchOriginalText(candidate.text, pages);
    // Neighboring unique source spans bound repeated phrases without choosing an arbitrary first match.
    const before = matches.slice(0, candidateIndex).reverse().find(item => item.status === 'UNIQUE')?.candidates[0];
    const after = matches.slice(candidateIndex + 1).find(item => item.status === 'UNIQUE')?.candidates[0];
    const scoped = match.candidates.filter(found => (!before || found.start >= before.end) && (!after || found.end <= after.start));
    const found = match.status === 'UNIQUE' ? match.candidates[0] : scoped.length === 1 ? scoped[0] : undefined;
    if (candidate.kind === 'table') {
      // Matching words never certifies row/column relationships. Layout-backed tables are assembled below.
      const headerText = normalizeOriginalWhitespace(candidate.payload.rawMarkdown
        ? readOriginalMarkdownTable(String(candidate.payload.rawMarkdown).split('\n')).header.join(' ')
        : readOriginalHtmlTable(String(candidate.payload.rawHtml))?.rows[0]?.map(cell => cell.text).join(' ') ?? '');
      const headers = lines.filter(line => line.text === headerText && !furniture.has(line.start));
      const header = headers.length === 1 ? headers[0] : undefined;
      const region = found ?? (header ? { start: header.start,
        end: organized.filter(range => range.candidate.kind === 'heading' && range.start > header.start)
          .sort((a, b) => a.start - b.start)[0]?.start ?? comparison.length } : undefined);
      const regionLines = region ? lines.filter(line => line.start < region.end && line.end > region.start && !furniture.has(line.start)) : [];
      const coveredByGrid = (line: typeof lines[number]) => organized.some(range => range.candidate.kind === 'table' &&
        range.start <= line.start && range.end >= line.end);
      const hasSourceHeading = region && organized.some(range => range.candidate.kind === 'heading' && range.start === region.start);
      const enclosingHeading = region && organized.filter(range => range.candidate.kind === 'heading' && range.end <= region.start)
        .sort((a, b) => b.end - a.end)[0];
      // A plugin's continued grid may repeat wrapped cells in reading order instead
      // of PDF line order. Accept its location only when every row is present in
      // one already reconstructed physical grid; never use its proposed columns.
      const parsedRows = candidate.payload.rawMarkdown
        ? (() => { const table = readOriginalMarkdownTable(String(candidate.payload.rawMarkdown).split('\n')); return [table.header, ...table.rows]; })()
        : readOriginalHtmlTable(String(candidate.payload.rawHtml))?.rows.map(row => row.map(cell => cell.text)) ?? [];
      const sameCell = (a: string, b: string) => normalizeOriginalWhitespace(a) === normalizeOriginalWhitespace(b);
      const nativeGroups = new Map<string, string[][]>();
      for (const range of organized.filter(range => range.candidate.kind === 'table')) {
        const key = (range.candidate.payload.continuation as { continuityKey: string }).continuityKey;
        nativeGroups.set(key, [...(nativeGroups.get(key) ?? []), ...range.candidate.payload.nativeRows as string[][]]);
      }
      const locatedInGrid = parsedRows.length > 1 && [...nativeGroups.values()].some(rows => {
        let previous = -1;
        return parsedRows.every(row => {
          const cells = row.filter(Boolean);
          if (!cells.length) return true;
          const index = rows.findIndex((source, index) => index > previous && cells.every(cell => source.some(value => sameCell(cell, value))));
          if (index < 0) return false;
          previous = index; return true;
        });
      });
      const reconstructed = locatedInGrid || regionLines.length > 0 && regionLines.every(coveredByGrid);
      const narrative = (hasSourceHeading || enclosingHeading && header && header.width > pages.find(page => page.pageIndex === header.pageIndex)!.width / 2) && regionLines.length > 1 &&
        regionLines.every(line => line.runs.length === 1 || coveredByGrid(line));
      const unlocated = regionLines.length === 0 && match.candidates.length === 0;
      if (!reconstructed || !found && !locatedInGrid) unresolved.push({
        pageIndexes: [...new Set(regionLines.length ? regionLines.map(line => line.pageIndex) : match.candidates.flatMap(item => item.pageIndexes))], unitIds: [],
        reason: narrative || reconstructed || unlocated ? 'TEXT_CONFLICT' : 'STRUCTURE_UNCERTAIN',
        readingImpact: narrative || reconstructed || unlocated ? 'DIAGNOSTIC' : 'LIMITATION',
        message: unlocated ? '插件表格与 PDF 文本层不能对齐；未采用其结构建议。'
          : narrative || reconstructed ? '候选列关系与原文连续正文不符，按有定位的原文标题和正文组织。'
            : '此处结构尚未可靠重建，请查看原页。',
      });
      continue;
    }
    if (found && organized.some(range => range.start < found.end && range.end > found.start)) continue;
    if (!found) {
      if (candidate.fallbackOnly) continue;
      unresolved.push({ pageIndexes: [...new Set(match.candidates.flatMap(item => item.pageIndexes))],
        unitIds: [], reason: 'TEXT_CONFLICT', message: match.status === 'AMBIGUOUS'
          ? '插件片段对应多处原文，未指定精确位置；保留 PDF 文本层供阅读。'
          : '插件片段与 PDF 文本层不能唯一对齐；未采用该片段的结构建议。' });
      continue;
    }
    // Do not let a plugin heading promote an ordinary indented sentence into a section.
    if (candidate.kind === 'heading' && (/^\d+[.)]?$/.test(candidate.text.trim()) ||
      (lines.length && !lines.some(line => line.start === found.start && line.end === found.end && line.breakBefore)))) continue;
    if (lines.some(line => line.start < found.end && line.end > found.start && furniture.has(line.start))) continue;
    organized.push({ start: found.start, end: found.end, candidate });
  }
  const add = (start: number, end: number, candidate?: Candidate) => {
    const originalText = comparison.slice(start, end).trim();
    if (!originalText) return;
    const unitId = `${input.binding.parseRunId}:u${units.length + 1}`;
    const pageIndexes = spans.filter(span => span.start < end && span.end > start).map(span => span.pageIndex);
    const refs = pageIndexes.map(page => `${unitId}:p${page}`);
    const payload = candidate ? structuredClone(candidate.payload) : { text: originalText };
    if (candidate?.kind !== 'table') payload.text = originalText;
    const memberLines = lines.filter(line => line.start < end && line.end > start);
    const isFurniture = memberLines.length > 0 && memberLines.every(line => furniture.has(line.start));
    if (candidate?.kind === 'table' && Array.isArray(payload.nativeRows)) {
      const rows = payload.nativeRows as string[][];
      delete payload.nativeRows; delete payload.columnStarts;
      const hasHeader = payload.nativeHeader === true; delete payload.nativeHeader;
      Object.assign(payload, { layout: 'grid', columns: [], rowGroups: [{ rows: rows.map((row, rowIndex) => ({
        rowId: `${unitId}:r${rowIndex}`, cells: row.map((text, column) => ({
          cellId: `${unitId}:r${rowIndex}:c${column}`, columnIndex: column, rowSpan: 1, colSpan: 1,
          isHeader: hasHeader && rowIndex === 0, textAvailability: text ? 'TEXT_AVAILABLE' : 'NO_TEXT_ITEMS',
          inlineContent: [{ text, sourceRefIds: refs }],
        })),
      })) }] });
    } else if (candidate?.kind === 'table' && payload.rawHtml) {
      const table = readOriginalHtmlTable(String(payload.rawHtml))!;
      delete payload.rawHtml;
      if (table.issues.length) unresolved.push({ pageIndexes, unitIds: [unitId], reason: 'STRUCTURE_UNCERTAIN',
        message: 'HTML 表格行宽不一致；所有实际单元格保留，未补空或丢列。' });
      Object.assign(payload, { layout: 'grid', columns: [], caption: table.caption, rowGroups: [{ rows: table.rows.map((row, rowIndex) => ({
        rowId: `${unitId}:r${rowIndex}`, cells: row.map((cell, cellIndex) => ({
          cellId: `${unitId}:r${rowIndex}:c${cellIndex}`, columnIndex: cell.columnIndex, rowSpan: cell.rowSpan, colSpan: cell.colSpan,
          isHeader: cell.header, inlineContent: [{ text: cell.text, sourceRefIds: refs }],
        })),
      })) }] });
    } else if (candidate?.kind === 'table') {
      // Layout comes from syntax; model only provides organization, never SourceRef.
      const table = readOriginalMarkdownTable(String(payload.rawMarkdown).split('\n'));
      delete payload.rawMarkdown;
      Object.assign(payload, { layout: 'grid', columns: [], rowGroups: [{ rows: [table.header, ...table.rows].map((row, rowIndex) => ({
        rowId: `${unitId}:r${rowIndex}`, cells: row.map((text, column) => ({
          cellId: `${unitId}:r${rowIndex}:c${column}`, columnIndex: column, rowSpan: 1, colSpan: 1,
          inlineContent: [{ text, sourceRefIds: refs }],
        })),
      })) }] });
      if (table.issues.length) unresolved.push({ pageIndexes, unitIds: [unitId], reason: 'STRUCTURE_UNCERTAIN',
        message: '表格存在多余列或缺列；所有实际单元格保留，未补空或丢列。' });
    }
    units.push({ unitId, kind: candidate?.kind ?? 'paragraph', moduleId: 'body', parentUnitId: null,
      order: units.length, depth: 0, continuityKey: 'body', sourceRefIds: refs,
      sourceSegmentIds: [...refs], mapping: { extraction: 'PDFJS_TEXT_LAYER', comparisonStart: start, comparisonEnd: end,
        ...(isFurniture ? { pageFurniture: true } : {}),
        textItems: memberLines.map(line => ({ pageIndex: line.pageIndex, itemIndexes: line.itemIndexes })) }, payload });
    pageIndexes.forEach((pageIndex, index) => {
      sourceLocators.push({ sourceRefId: refs[index], kind: 'PDF_PAGE', artifactId: input.binding.sourceArtifactId,
        pageStart: pageIndex, pageEnd: pageIndex, charStart: null, charEnd: null, charOffsetUnit: null,
        normalizedPath: null, xpath: null, elementId: null, quote: null, bbox: null });
      const page = pages.find(page => page.pageIndex === pageIndex)!;
      const exactLines = memberLines.filter(line => line.pageIndex === pageIndex && line.start >= start && line.end <= end);
      const exact = exactLines.length > 0 && memberLines.filter(line => line.pageIndex === pageIndex).length === exactLines.length;
      locations.push({ sourceRefId: refs[index], pageIndex, precision: exact ? 'TEXT_ITEM' : 'PAGE',
        coordinateSpace: exact ? 'PDF_VIEWPORT_TOP_LEFT' : null,
        viewportWidth: exact ? page.width : null, viewportHeight: exact ? page.height : null,
        boxes: exact ? exactLines.map(line => [line.x, page.height - line.y - line.height, line.width, line.height]) : [] });
    });

  };
  const addFallback = (start: number, end: number) => {
    let cursor = start;
    for (const boundary of [...new Set(breaks)].filter(value => value > start && value < end).sort((a, b) => a - b)) {
      add(cursor, boundary); cursor = boundary;
    }
    add(cursor, end);
  };
  // Preserve explicit activity/date and condition rows as individually addressable source blocks.
  for (const line of lines) if (!furniture.has(line.start) &&
    (/^[A-Za-z][^:]{0,110}:/.test(line.text) || /^(?:Please note|If an? |Note:)/i.test(line.text))) breaks.push(line.start);
  // Keep repeated edge material out of cross-page sentences while preserving all source locations.
  for (const line of lines) if (furniture.has(line.start)) { breaks.push(line.start, line.end); }
  let cursor = 0;
  for (const range of organized.sort((a, b) => a.start - b.start)) {
    addFallback(cursor, range.start); add(range.start, range.end, range.candidate); cursor = range.end;
  }
  addFallback(cursor, comparison.length);
  const body = units.filter(unit => unit.mapping.pageFurniture !== true);
  const notices: typeof units = [];
  for (const unit of units.filter(unit => unit.mapping.pageFurniture === true)) {
    const existing = notices.find(entry => entry.payload.text === unit.payload.text);
    if (existing) {
      existing.sourceRefIds.push(...unit.sourceRefIds); existing.sourceSegmentIds.push(...unit.sourceSegmentIds);
      const items = existing.mapping.textItems as unknown[];
      items.push(...unit.mapping.textItems as unknown[]);
    } else notices.push(unit);
  }
  // Join a continued physical table using its retained cell refs. Page-edge partial
  // cells are joined only when their concatenation is demonstrated by another full
  // cell in this same column; a single populated first row alone is not sufficient.
  for (let index = 1; index < body.length;) {
    const previous = body[index - 1], current = body[index];
    const key = (unit: typeof previous) => (unit.payload.continuation as { continuityKey?: string } | undefined)?.continuityKey;
    if (previous.kind !== 'table' || current.kind !== 'table' || !key(previous) || key(previous) !== key(current)) { index++; continue; }
    type Cell = { inlineContent: Array<{ text: string; sourceRefIds: string[] }> };
    type Row = { cells: Cell[] };
    const priorRows = (previous.payload.rowGroups as Array<{ rows: Row[] }>)[0].rows;
    const nextRows = (current.payload.rowGroups as Array<{ rows: Row[] }>)[0].rows;
    const text = (cell: Cell) => cell.inlineContent.map(value => value.text).join(' ');
    const first = nextRows[0], last = priorRows.at(-1)!;
    const populated = first.cells.flatMap((cell, column) => text(cell) ? [column] : []);
    if (populated.length === 1) {
      const column = populated[0], joined = `${text(last.cells[column])} ${text(first.cells[column])}`;
      if (text(last.cells[column]) && priorRows.slice(1, -1).some(row => text(row.cells[column]) === joined)) {
        last.cells[column].inlineContent.push(...first.cells[column].inlineContent);
        nextRows.shift();
      } else unresolved.push({ pageIndexes: [...new Set(current.sourceRefIds.map(ref => locations.find(location => location.sourceRefId === ref)!.pageIndex!))],
        unitIds: [previous.unitId], reason: 'STRUCTURE_UNCERTAIN', readingImpact: 'LIMITATION',
        message: '跨页表格的首行关系尚未确认，请查看对应原页。' });
    }
    priorRows.push(...nextRows);
    previous.sourceRefIds.push(...current.sourceRefIds); previous.sourceSegmentIds.push(...current.sourceSegmentIds);
    previous.mapping.comparisonRanges = [
      ...(Array.isArray(previous.mapping.comparisonRanges) ? previous.mapping.comparisonRanges :
        [{ start: previous.mapping.comparisonStart, end: previous.mapping.comparisonEnd }]),
      { start: current.mapping.comparisonStart, end: current.mapping.comparisonEnd },
    ];
    delete previous.mapping.comparisonStart; delete previous.mapping.comparisonEnd;
    (previous.mapping.textItems as unknown[]).push(...current.mapping.textItems as unknown[]);
    body.splice(index, 1);
  }
  units.splice(0, units.length, ...body, ...notices);
  units.forEach((unit, index) => { unit.order = index; if (unit.mapping.pageFurniture) unit.payload.role = 'document_notice'; });
  for (let page = 0; page < input.extraction.pageCount; page++) {
    const extracted = pages.find(item => item.pageIndex === page);
    if (extracted && (extracted.imagePaintOperations === undefined || extracted.imagePaintOperations === null || extracted.imagePaintOperations > 0))
      unresolved.push({ pageIndexes: [page], unitIds: [], reason: 'FIGURE_UNINTERPRETED',
        message: extracted.imagePaintOperations === undefined ? '此页记录未检查图片绘制；文本可读不表示图内信息已读取。'
          : extracted.imagePaintOperations === null ? '此页图片绘制检查未完成；保留已提取文字，图内信息仍未读取。'
          : '此页存在 PDF 图片绘制；原图可在原件页查看，图内信息尚未转录或验证。' });
    if (!extracted || !extracted.text.trim()) unresolved.push({ pageIndexes: [page], unitIds: [], reason: 'UNREAD',
      message: extracted ? '本页无可读文本层，尚未完成视觉转录。' : '本页尚未处理。' });
  }
  if (/!\[[^\]]*\]\(/.test(input.markdown)) unresolved.push({ pageIndexes: [], unitIds: [], reason: 'FIGURE_UNINTERPRETED',
    message: '插件输出含图片引用；图内信息尚未验证，本次原文文本可读不表示图示已理解。' });
  return { schemaVersion: 'wiselink.document.original.v1', binding: structuredClone(input.binding),
    producer: structuredClone(input.producer), source: { units, modules: [{ moduleId: 'body', order: 0 }],
      sourceLocators, findings: [], references: [] }, locations,
    coverage: { knownPageCount: input.extraction.pageCount,
      readPageIndexes: pages.filter(page => page.text.trim()).map(page => page.pageIndex), unresolvedRanges: unresolved },
    markdown: units.map(unit => unit.kind === 'table' ? tableMarkdown(unit) : String(unit.payload.text ?? '')).join('\n\n') };
}

function markdownCandidates(markdown: string): Candidate[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const candidates: Candidate[] = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index].trim()) { index++; continue; }
    if (/^\s*<table\b/i.test(lines[index])) {
      const group: string[] = [];
      do { group.push(lines[index++]); } while (index < lines.length && !/<\/table\s*>/i.test(group.at(-1)!));
      const html = group.join('\n'), table = readOriginalHtmlTable(html);
      if (table && table.issues.every(issue => issue === 'ROW_WIDTH_MISMATCH')) candidates.push({ kind: 'table', text: table.text, payload: { rawHtml: html } });
      continue;
    }
    if (index + 1 < lines.length && lines[index].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const group = [lines[index++], lines[index++]];
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) group.push(lines[index++]);
      const table = readOriginalMarkdownTable(group);
      candidates.push({ kind: 'table', text: [table.header, ...table.rows].flat().join(' '), payload: { rawMarkdown: group.join('\n') } });
      // A rejected pseudo-table can still contain an independently verifiable
      // section title. Never adopt its incomplete body/cell arrangement.
      const labels = table.header.filter(cell => cell.trim());
      if (labels.length === 1) candidates.push({ kind: 'heading', text: labels[0],
        payload: { text: labels[0], level: 2 }, fallbackOnly: true });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
    if (heading) { candidates.push({ kind: 'heading', text: originalMarkdownText(heading[2]), payload: { text: originalMarkdownText(heading[2]), level: heading[1].length } }); index++; continue; }
    const group = [lines[index++]];
    while (index < lines.length && lines[index].trim() && !/^#{1,6}\s/.test(lines[index]) && !/^\s*<table\b/i.test(lines[index]) &&
      !(index + 1 < lines.length && lines[index].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]))) group.push(lines[index++]);
    const text = originalMarkdownText(group.join('\n'));
    candidates.push({ kind: 'paragraph', text, payload: { text } });
  }
  return candidates;
}

function tableMarkdown(unit: TranslationStructuredSourceUnit): string {
  const payload = unit.payload as { rowGroups: Array<{ rows: Array<{ cells: Array<{
    rowSpan: number; colSpan: number; isHeader?: boolean; inlineContent: Array<{ text: string }>;
  }> }> }> };
  const rows = payload.rowGroups.flatMap(group => group.rows).map(row => row.cells);
  const caption = typeof unit.payload.caption === 'string' ? unit.payload.caption : '';
  const cellText = (cell: typeof rows[number][number]) => cell.inlineContent.map(item => item.text).join(' ');
  if (rows[0]?.every(cell => cell.isHeader === false) || rows.some(row => row.some(cell => cell.rowSpan > 1 || cell.colSpan > 1))) {
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<table>${caption ? `<caption>${escape(caption)}</caption>` : ''}<tbody>` + rows.map(row => '<tr>' + row.map(cell => {
      const tag = cell.isHeader ? 'th' : 'td';
      return `<${tag} rowspan="${cell.rowSpan}" colspan="${cell.colSpan}">${escape(cellText(cell))}</${tag}>`;
    }).join('') + '</tr>').join('') + '</tbody></table>';
  }
  return (caption ? `${caption}\n\n` : '') + rows.map((row, index) => `| ${row.map(cell => cellText(cell).replace(/\|/g, '\\|')).join(' | ')} |` +
    (index === 0 ? `\n| ${row.map(() => '---').join(' | ')} |` : '')).join('\n');
}
