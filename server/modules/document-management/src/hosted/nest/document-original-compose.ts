import { readOriginalHtmlTable } from './document-original-html-table';
import type { DocumentOriginalBinding, DocumentOriginalResult } from '@shared/document-original.interface';
import type { TranslationStructuredSourceUnit } from '@shared/canonical-translation-v2.interface';
import type { DocumentPdfExtraction } from './document-original-pdf';
import { matchOriginalText, normalizeOriginalWhitespace, readOriginalMarkdownTable } from './document-original-text';

interface Candidate { kind: 'paragraph' | 'heading' | 'table'; text: string; payload: Record<string, unknown> }

/** Plugin organization is accepted only where it exactly agrees with the same PDF
 * text layer. Unmatched original ranges remain readable and specifically flagged.
 * Raw PDF items and plugin Markdown must be retained by the artifact writer. */
export function composeDocumentOriginal(input: {
  binding: DocumentOriginalBinding;
  extraction: DocumentPdfExtraction;
  markdown: string;
  producer: DocumentOriginalResult['producer'];
}): DocumentOriginalResult {
  const pages = [...input.extraction.pages].sort((a, b) => a.pageIndex - b.pageIndex);
  const unresolved: DocumentOriginalResult['coverage']['unresolvedRanges'] = [];
  const units: TranslationStructuredSourceUnit[] = [];
  const sourceLocators: DocumentOriginalResult['source']['sourceLocators'] = [];
  const locations: DocumentOriginalResult['locations'] = [];
  const spans: Array<{ pageIndex: number; start: number; end: number }> = [];
  let comparison = '';
  for (const page of pages) {
    if (comparison) comparison += ' ';
    const start = comparison.length;
    comparison += normalizeOriginalWhitespace(page.text);
    spans.push({ pageIndex: page.pageIndex, start, end: comparison.length });
  }
  const organized: Array<{ start: number; end: number; candidate: Candidate }> = [];
  for (const candidate of markdownCandidates(input.markdown)) {
    const match = matchOriginalText(candidate.text, pages);
    const found = match.candidates[0];
    if (match.status !== 'UNIQUE' || organized.some(range => range.start < found.end && range.end > found.start)) {
      unresolved.push({ pageIndexes: [...new Set(match.candidates.flatMap(item => item.pageIndexes))],
        unitIds: [], reason: 'TEXT_CONFLICT', message: match.status === 'AMBIGUOUS'
          ? '插件片段对应多处原文，未指定精确位置；保留 PDF 文本层供阅读。'
          : '插件片段与 PDF 文本层不能唯一对齐；未采用该片段的结构建议。' });
      continue;
    }
    organized.push({ start: found.start, end: found.end, candidate });
  }
  const add = (start: number, end: number, candidate?: Candidate) => {
    const originalText = comparison.slice(start, end).trim();
    if (!originalText) return;
    const unitId = `${input.binding.parseRunId}:u${units.length + 1}`;
    const pageIndexes = spans.filter(span => span.start < end && span.end > start).map(span => span.pageIndex);
    const refs = pageIndexes.map(page => `${unitId}:p${page}`);
    const payload = candidate ? structuredClone(candidate.payload) : { text: originalText };
    if (candidate?.kind === 'table' && payload.rawHtml) {
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
      sourceSegmentIds: refs, mapping: { extraction: 'PDFJS_TEXT_LAYER', comparisonStart: start, comparisonEnd: end }, payload });
    pageIndexes.forEach((pageIndex, index) => {
      sourceLocators.push({ sourceRefId: refs[index], kind: 'PDF_PAGE', artifactId: input.binding.sourceArtifactId,
        pageStart: pageIndex, pageEnd: pageIndex, charStart: null, charEnd: null, charOffsetUnit: null,
        normalizedPath: null, xpath: null, elementId: null, quote: null, bbox: null });
      locations.push({ sourceRefId: refs[index], pageIndex, precision: 'PAGE', coordinateSpace: null,
        viewportWidth: null, viewportHeight: null, boxes: [] });
    });
    if (!candidate) unresolved.push({ pageIndexes, unitIds: [unitId], reason: 'STRUCTURE_UNCERTAIN',
      message: '此范围直接保留 PDF 文本层；插件未给出可验证的对应结构，原页仍为复核依据。' });
  };
  let cursor = 0;
  for (const range of organized.sort((a, b) => a.start - b.start)) {
    add(cursor, range.start); add(range.start, range.end, range.candidate); cursor = range.end;
  }
  add(cursor, comparison.length);
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
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
    if (heading) { candidates.push({ kind: 'heading', text: heading[2], payload: { text: heading[2], level: heading[1].length } }); index++; continue; }
    const group = [lines[index++]];
    while (index < lines.length && lines[index].trim() && !/^#{1,6}\s/.test(lines[index]) && !/^\s*<table\b/i.test(lines[index]) &&
      !(index + 1 < lines.length && lines[index].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]))) group.push(lines[index++]);
    const text = group.join('\n');
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
  const cellText = (cell: typeof rows[number][number]) => cell.inlineContent.map(item => item.text).join('');
  if (rows.some(row => row.some(cell => cell.rowSpan > 1 || cell.colSpan > 1))) {
    const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<table>${caption ? `<caption>${escape(caption)}</caption>` : ''}<tbody>` + rows.map(row => '<tr>' + row.map(cell => {
      const tag = cell.isHeader ? 'th' : 'td';
      return `<${tag} rowspan="${cell.rowSpan}" colspan="${cell.colSpan}">${escape(cellText(cell))}</${tag}>`;
    }).join('') + '</tr>').join('') + '</tbody></table>';
  }
  return (caption ? `${caption}\n\n` : '') + rows.map((row, index) => `| ${row.map(cell => cellText(cell).replace(/\|/g, '\\|')).join(' | ')} |` +
    (index === 0 ? `\n| ${row.map(() => '---').join(' | ')} |` : '')).join('\n');
}
