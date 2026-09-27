import type { DocumentOriginalResult } from '@shared/document-original.interface';
import type { TranslationStructuredSourceUnit } from '@shared/canonical-translation-v2.interface';
import type { DocumentPdfExtraction, DocumentPdfPage } from './document-original-pdf';
import { mineruPageFurniture } from '../../../../professional-input/mineru/mineru-page-furniture';
import { originalPageLayout, type OriginalLayoutLine } from './document-original-layout';
import { normalizeOriginalWhitespace, originalMarkdownText } from './document-original-text';
import { documentOriginalStructuredSource } from './document-original-adapter';

type Box = [number, number, number, number];
type Region = { box: Box; discardedFurniture: boolean; native: boolean };
/** Preserve OCR; add independently located text outside MinerU regions. A narrowly
 * evidenced, single-column prose table may be replaced by its PDF text layer. */
export function reconcileMineruTextCoverage(input: {
  original: DocumentOriginalResult; extraction: DocumentPdfExtraction; rawMiddle: unknown; rawContentListV2: unknown;
}): DocumentOriginalResult {
  const original = structuredClone(input.original);
  if (original.producer.kind !== 'MINERU_LOCAL') throw new Error('DOCUMENT_MINERU_COVERAGE_PRODUCER_INVALID');
  const middle = record(input.rawMiddle);
  if (!Array.isArray(middle.pdf_info) || !Array.isArray(input.rawContentListV2) ||
      middle.pdf_info.length !== input.extraction.pageCount || input.rawContentListV2.length !== input.extraction.pageCount ||
      input.extraction.pages.length !== input.extraction.pageCount || original.coverage.knownPageCount !== input.extraction.pageCount)
    throw new Error('DOCUMENT_MINERU_COVERAGE_PAGE_MISMATCH');
  const furniture = mineruPageFurniture(input.rawContentListV2);
  const additions: TranslationStructuredSourceUnit[] = [];
  const insertionSlots = new Map<string, number>();
  const layouts = input.extraction.pages.map(page => originalPageLayout(page));
  const headingAnchors = originalHeadingAnchors(original.source.units, input.extraction.pages, layouts);
  for (let pageIndex = 0; pageIndex < input.extraction.pageCount; pageIndex++) {
    const page = input.extraction.pages[pageIndex];
    if (page.pageIndex !== pageIndex) throw new Error('DOCUMENT_MINERU_COVERAGE_PAGE_MISMATCH');
    const layout = layouts[pageIndex];
    const rawPage = record(middle.pdf_info[pageIndex]);
    const regions = pageRegions(rawPage, input.rawContentListV2[pageIndex], page, furniture.omitted);
    if (!page.text.trim()) continue; // No text layer: retain all original OCR and its own limitations.
    if (!layout.lines.length || !regions) {
      limit('STRUCTURE_UNCERTAIN', pageIndex, [], 'PDF 文本层与 MinerU 的位置无法可靠对应；未自动补入文字，请核对原页。');
      continue;
    }
    recoverProseTables(original, page, layout.lines, input.rawContentListV2[pageIndex]);
    for (const [lineIndex, line] of layout.lines.entries()) {
      const box: Box = [line.x, page.height - line.y - line.height, line.x + line.width, page.height - line.y];
      const touched = regions.filter(region => overlaps(box, region.box));
      if (touched.length) {
        const needle = normalizeOriginalWhitespace(line.text);
        const canonical = original.source.units.filter(unit => {
          const region = scaledBox(unit.mapping.nativeBbox, page);
          return Number(unit.mapping.pageIndex) === pageIndex && region !== null && overlaps(box, region);
        });
        // Raw middle blocks only bound unsafe territory; they do not prove delivery.
        const nativeTouched = touched.filter(region => region.native);
        const excludedNative = nativeTouched.length > 0 && nativeTouched.every(region => region.discardedFurniture) &&
          nativeTouched.some(region => contains(region.box, box));
        const excludedFurniture = !canonical.length && (excludedNative ||
          (nativeTouched.length === 0 && touched.every(region => region.discardedFurniture)));
        if (!excludedFurniture && !canonical.some(unit => canonicalTexts(unit).some(text => text.includes(needle)))) {
          limit('TEXT_CONFLICT', pageIndex, canonical.map(unit => unit.unitId),
            `PDF 文本“${line.text}”与此处 MinerU 内容未确切对应；保留原结构，请核对原页。`);
        }
        continue;
      }
      // Separate physical runs may be columns; no automatic reconstruction of their relationship.
      if (line.runs.length !== 1) {
        limit('STRUCTURE_UNCERTAIN', pageIndex, [], `MinerU 范围外有多列 PDF 文字“${line.text}”；未拼接其关系，请核对原页。`);
        continue;
      }
      const slot = insertionSlot(original.source.units, page, box);
      if (slot === null) {
        limit('STRUCTURE_UNCERTAIN', pageIndex, [], `MinerU 范围外文字“${line.text}”的阅读顺序无法唯一确定；未自动插入，请核对原页。`);
        continue;
      }
      const unitId = `${original.binding.parseRunId}:pdfjs:p${pageIndex}:l${lineIndex}`;
      const ref = `${unitId}:source`;
      const heading = supplementedHeading(line, lineIndex, layout.lines, page, headingAnchors);
      if (heading.plausible && !heading.level)
        limit('STRUCTURE_UNCERTAIN', pageIndex, [unitId],
          `PDF 文本“${line.text}”具有标题外观，但原件中没有足够一致的已识别标题来确认层级；按正文保留，请核对原页。`);
      const unit: TranslationStructuredSourceUnit = { unitId, kind: heading.level ? 'heading' : 'paragraph', moduleId: 'body', parentUnitId: null,
        order: 0, depth: 0, continuityKey: unitId, sourceRefIds: [ref], sourceSegmentIds: [ref],
        mapping: { extraction: 'PDFJS_TEXT_LAYER', supplementation: 'OUTSIDE_MINERU_REGIONS', pageIndex,
          sourceArtifactPath: `original/pages-${Math.floor(pageIndex / 8) * 8}.json`,
          textItems: [{ pageIndex, itemIndexes: [...line.itemIndexes] }], pdfTop: box[1], pdfLeft: box[0] },
        payload: { text: line.text, ...(heading.level ? { level: heading.level } : {}) } };
      if (heading.level) unit.mapping.headingRecovery = { method: 'MATCHED_PDF_GEOMETRY', anchorUnitIds: heading.anchorUnitIds };
      additions.push(unit);
      insertionSlots.set(unitId, slot);
      original.source.sourceLocators.push({ sourceRefId: ref, kind: 'PDF_PAGE', artifactId: original.binding.sourceArtifactId,
        pageStart: pageIndex, pageEnd: pageIndex, charStart: null, charEnd: null, charOffsetUnit: null,
        normalizedPath: null, xpath: null, elementId: null, quote: line.text, bbox: null });
      original.locations.push({ sourceRefId: ref, precision: 'TEXT_ITEM', coordinateSpace: 'PDF_VIEWPORT_TOP_LEFT',
        pageIndex, viewportWidth: page.width, viewportHeight: page.height, boxes: [[box[0], box[1], line.width, line.height]] });
      original.source.findings.push({ findingId: `${unitId}:supplement`, code: 'PDF_TEXT_SUPPLEMENT', severity: 'warning',
        readingImpact: 'DIAGNOSTIC', blocking: false, message: '此段由同一原件的 PDF 文本层补充；不在 MinerU 已识别区域内。',
        affectedUnitIds: [unitId], sourceRefIds: [ref], pageIndexes: [pageIndex] });
      if (!original.coverage.readPageIndexes.includes(pageIndex)) original.coverage.readPageIndexes.push(pageIndex);
    }
  }
  const supplementedPages = new Set(additions.map(unit => Number(unit.mapping.pageIndex)));
  for (const range of original.coverage.unresolvedRanges) if (range.reason === 'UNREAD' &&
      range.pageIndexes.every(page => supplementedPages.has(page))) {
    range.reason = 'STRUCTURE_UNCERTAIN';
    range.message = 'PDF 文本已补充本页可定位文字；MinerU 正文为空，其他视觉内容仍需核对。';
  }
  const baseUnits = original.source.units;
  original.source.units = [];
  for (let index = 0; index <= baseUnits.length; index++) {
    original.source.units.push(...additions.filter(unit => insertionSlots.get(unit.unitId) === index));
    if (index < baseUnits.length) original.source.units.push(baseUnits[index]);
  }
  original.source.units.forEach((unit, index) => { unit.order = index; });
  original.coverage.readPageIndexes.sort((a, b) => a - b);
  original.producer.kind = 'MINERU_LOCAL_PDFJS';
  original.producer.actionKey = 'pipeline-with-pdf-text-coverage';
  original.producer.supplementaryExtraction = 'PDFJS_TEXT_LAYER';
  // The canonical Reader uses ordered units. This plain reading view follows the same order;
  // raw Markdown and all raw OCR remain independently archived and unchanged.
  original.markdown = readingMarkdown(original.source.units);
  documentOriginalStructuredSource(original, original.binding);
  return original;

  function limit(reason: 'TEXT_CONFLICT' | 'STRUCTURE_UNCERTAIN', pageIndex: number, unitIds: string[], message: string) {
    original.coverage.unresolvedRanges.push({ reason, pageIndexes: [pageIndex], unitIds, readingImpact: 'LIMITATION', message });
  }
}
function recoverProseTables(original: DocumentOriginalResult, page: DocumentPdfPage,
  lines: OriginalLayoutLine[], rawPage: unknown): void {
  if (!Array.isArray(rawPage)) return;
  for (const unit of original.source.units) {
    if (unit.kind !== 'table' || Number(unit.mapping.pageIndex) !== page.pageIndex) continue;
    const pointer = unit.mapping.sourcePointer;
    const match = typeof pointer === 'string' && /^\/raw\/contentListV2\/\d+\/\d+$/u.exec(pointer);
    if (!match) continue;
    const parts = pointer.split('/');
    if (Number(parts[3]) !== page.pageIndex) continue;
    const rawIndex = Number(parts[4]);
    const raw = rawPage[rawIndex];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    if (entry.type !== 'table' || !singleColumnProseTable(unit, entry)) continue;
    const box = scaledBox(unit.mapping.nativeBbox, page);
    if (!box) continue;
    // Reader may omit furniture from source.units, but its raw region still blocks recovery.
    if (rawPage.some((other, index) => {
      if (index === rawIndex) return false;
      const otherBox = scaledBox(record(other).bbox, page);
      return otherBox !== null && overlaps(otherBox, box);
    })) continue;
    const touched = lines.filter(line => overlaps(lineBox(line, page), box));
    if (touched.length < 4 || touched.some(line => line.runs.length !== 1 ||
        !contains(box, lineBox(line, page)) || !line.text.trim())) continue;
    // All text in the candidate region must form one continuous, left-aligned run.
    const lefts = touched.map(line => line.x);
    if (Math.max(...lefts) - Math.min(...lefts) > 12 ||
        lineBox(touched[0], page)[1] - box[1] > touched[0].height * 1.5 ||
        box[3] - lineBox(touched.at(-1)!, page)[3] > touched.at(-1)!.height * 1.5 ||
        lines.some(line => lineBox(line, page)[1] < box[3] &&
          lineBox(line, page)[3] > box[1] && !touched.includes(line)) ||
        touched.some((line, index) => index > 0 &&
          touched[index - 1].y - line.y > Math.max(line.height, touched[index - 1].height) * 2)) continue;
    if (original.source.units.some(other => {
      if (other.unitId === unit.unitId || Number(other.mapping.pageIndex) !== page.pageIndex) return false;
      const otherBox = scaledBox(other.mapping.nativeBbox, page);
      return otherBox !== null && overlaps(otherBox, box);
    })) continue;
    const pdfText = touched.map(line => line.text).join(' ');
    const ocrText = tableRows(unit).join(' ');
    const pdfWords = words(pdfText), ocrWords = words(ocrText);
    if (pdfWords.length < 35 || ocrWords.length < 12 ||
        pdfText.length < ocrText.length * 1.2 || !sharedPhrase(pdfWords, ocrWords, 5) ||
        !touched.some(line => line.text.length >= 35 &&
          words(line.text).filter(word => ocrWords.includes(word)).length < words(line.text).length * 0.55)) continue;
    unit.kind = 'paragraph';
    unit.mapping = { ...unit.mapping, extraction: 'PDFJS_TEXT_LAYER',
      supplementation: 'INSIDE_MINERU_PROSE_TABLE',
      textItems: touched.map(line => ({ pageIndex: page.pageIndex, itemIndexes: [...line.itemIndexes] })) };
    unit.payload = { rawMineruContent: unit.payload.rawMineruContent,
      originalBlockType: unit.payload.originalBlockType, text: pdfText };
    const ref = unit.sourceRefIds[0];
    const locator = original.source.sourceLocators.find(item => item.sourceRefId === ref);
    if (locator) locator.quote = pdfText;
    const location = original.locations.find(item => item.sourceRefId === ref);
    if (location) Object.assign(location, { precision: 'TEXT_ITEM', coordinateSpace: 'PDF_VIEWPORT_TOP_LEFT',
      viewportWidth: page.width, viewportHeight: page.height,
      boxes: touched.map(line => {
        const bounds = lineBox(line, page);
        return [bounds[0], bounds[1], line.width, line.height];
      }) });
    original.source.findings.push({ findingId: `${unit.unitId}:pdf-prose-recovery`,
      code: 'PDF_TEXT_REGION_RECOVERY', severity: 'warning', readingImpact: 'DIAGNOSTIC', blocking: false,
      message: 'MinerU 将单栏连续正文识别为一列表格；同源 PDF 文本层提供局部阅读恢复，原始块及指针已保留。决定性工程判断仍须核对 PDF 原页。',
      affectedUnitIds: [unit.unitId], sourceRefIds: [ref], pageIndexes: [page.pageIndex] });
  }
}
function singleColumnProseTable(unit: TranslationStructuredSourceUnit, raw: Record<string, unknown>): boolean {
  const content = raw.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false;
  const table = content as Record<string, unknown>;
  if (table.table_nest_level !== 1 || table.table_type !== 'simple_table' ||
      (table.table_caption !== undefined &&
        (!Array.isArray(table.table_caption) || table.table_caption.length > 0)) ||
      (table.table_footnote !== undefined &&
        (!Array.isArray(table.table_footnote) || table.table_footnote.length > 0)) ||
      (typeof unit.payload.caption === 'string' && unit.payload.caption.trim()) ||
      (typeof unit.payload.rawText === 'string' && unit.payload.rawText.trim()) ||
      unit.payload.columnCount !== 1) return false;
  const rows = unit.payload.rowGroups;
  if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0]?.rows) ||
      rows[0].rows.length < 3) return false;
  return rows[0].rows.every((row: { cells?: Array<{ rowSpan?: number; colSpan?: number; isHeader?: boolean }> }) =>
    Array.isArray(row.cells) && row.cells.length === 1 && row.cells[0].rowSpan === 1 &&
    row.cells[0].colSpan === 1 && row.cells[0].isHeader === false);
}
function tableRows(unit: TranslationStructuredSourceUnit): string[] {
  const groups = unit.payload.rowGroups as Array<{ rows: Array<{ cells: Array<{
    inlineContent: Array<{ text: string }> }> }> }>;
  return groups[0].rows.map(row => row.cells[0].inlineContent.map(item => item.text).join(''));
}
function words(value: string): string[] {
  return value.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? [];
}
function sharedPhrase(left: string[], right: string[], length: number): boolean {
  const phrases = new Set<string>();
  for (let index = 0; index <= right.length - length; index++)
    phrases.add(right.slice(index, index + length).join(' '));
  for (let index = 0; index <= left.length - length; index++)
    if (phrases.has(left.slice(index, index + length).join(' '))) return true;
  return false;
}
function lineBox(line: OriginalLayoutLine, page: DocumentPdfPage): Box {
  return [line.x, page.height - line.y - line.height, line.x + line.width, page.height - line.y];
}
type HeadingAnchor = { unitId: string; lineKey: string; level: number; size: number; x: number; width: number; height: number };
function originalHeadingAnchors(units: TranslationStructuredSourceUnit[], pages: DocumentPdfPage[],
  layouts: Array<{ lines: OriginalLayoutLine[] }>): HeadingAnchor[] {
  const anchors: HeadingAnchor[] = [];
  for (const unit of units) {
    if (unit.kind !== 'heading' || unit.parentUnitId) continue;
    const pageIndex = Number(unit.mapping.pageIndex);
    const page = pages[pageIndex];
    const level = Number(unit.payload.level);
    const box = page && scaledBox(unit.mapping.nativeBbox, page);
    if (!box || !Number.isInteger(level) || level < 1 || level > 6 || typeof unit.payload.text !== 'string') continue;
    const matches = layouts[pageIndex].lines.filter(line =>
      normalizeOriginalWhitespace(line.text) === normalizeOriginalWhitespace(String(unit.payload.text)) &&
      overlaps(lineBox(line, page), box) && uniformLineSize(line, page) !== null);
    if (matches.length !== 1) continue;
    const line = matches[0];
    if (!contains(box, lineBox(line, page))) continue;
    anchors.push({ unitId: unit.unitId, lineKey: `${pageIndex}:${line.itemIndexes.join(',')}`,
      level, size: line.height, x: line.x, width: page.width, height: page.height });
  }
  return anchors.filter(anchor => anchors.filter(other => other.lineKey === anchor.lineKey).length === 1);
}
function uniformLineSize(line: OriginalLayoutLine, page: DocumentPdfPage): number | null {
  if (!line.itemIndexes.length) return null;
  const sizes = line.itemIndexes.map(index => page.items[index]?.transform[3]);
  return sizes.every(size => typeof size === 'number' && Number.isFinite(size) &&
    Math.abs(size - line.height) <= 0.5) ? line.height : null;
}
function supplementedHeading(line: OriginalLayoutLine, index: number, lines: OriginalLayoutLine[],
  page: DocumentPdfPage, anchors: HeadingAnchor[]): { plausible: boolean; level?: number; anchorUnitIds: string[] } {
  const size = uniformLineSize(line, page);
  const text = line.text.trim();
  const bodySizes = lines.map(entry => entry.height).filter(value => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  // The lower quartile is a conservative body-size reference on short pages
  // where known headings can otherwise dominate a median.
  const bodySize = bodySizes[Math.floor((bodySizes.length - 1) / 4)] ?? Infinity;
  const next = lines[index + 1];
  const plausible = size !== null && size >= bodySize * 1.2 && line.breakBefore &&
    text.length <= 120 && (text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) <= 12 &&
    !/[.;:。；：!?！？]$/u.test(text) && next !== undefined && !next.breakBefore &&
    next.height < size * 0.9 && Math.abs(next.x - line.x) <= 12;
  if (!plausible) return { plausible: false, anchorUnitIds: [] };
  const matches = anchors.filter(anchor => anchor.width === page.width && anchor.height === page.height &&
    Math.abs(anchor.size - size) <= 0.5 && Math.abs(anchor.x - line.x) <= 2);
  const levels = new Set(matches.map(anchor => anchor.level));
  if (matches.length < 2 || levels.size !== 1) return { plausible: true, anchorUnitIds: [] };
  return { plausible: true, level: matches[0].level, anchorUnitIds: matches.map(anchor => anchor.unitId) };
}
function pageRegions(middle: Record<string, unknown>, rawV2: unknown, page: DocumentPdfPage, omitted: (block: Record<string, unknown>) => boolean): Region[] | null {
  if (page.rotation !== 0 || !Array.isArray(middle.page_size) || middle.page_size.length !== 2 || !Array.isArray(rawV2) ||
      Math.abs(Number(middle.page_size[0]) - page.width) > 2 || Math.abs(Number(middle.page_size[1]) - page.height) > 2) return null;
  const regions: Region[] = [];
  for (const raw of rawV2) {
    const entry = record(raw), box = scaledBox(entry.bbox, page);
    if (!box) return null;
    regions.push({ box, native: true, discardedFurniture: omitted(entry) });
  }
  // Include discarded headers, figures and preprocessing regions omitted from normalized v2.
  for (const key of ['preproc_blocks', 'para_blocks', 'discarded_blocks']) {
    if (middle[key] !== undefined && !Array.isArray(middle[key])) return null;
    for (const raw of (middle[key] ?? []) as unknown[]) {
      const entry = record(raw), box = physicalBox(entry.bbox);
      if (!box) return null;
      regions.push({ box, native: false, discardedFurniture: key === 'discarded_blocks' &&
        ['header', 'page_header', 'footer', 'page_footer', 'page_number'].includes(String(entry.type)) });
    }
  }
  return regions;
}
/** A slot must respect every original unit, including column-major ordering. */
function insertionSlot(units: TranslationStructuredSourceUnit[], page: DocumentPdfPage, box: Box): number | null {
  const relations = units.map(unit => {
    const index = Number(unit.mapping.pageIndex);
    if (index < page.pageIndex) return -1;
    if (index > page.pageIndex) return 1;
    const region = scaledBox(unit.mapping.nativeBbox, page);
    if (!region) return 0;
    return region[3] <= box[1] ? -1 : region[1] >= box[3] ? 1 : 0;
  });
  const candidates: number[] = [];
  for (let slot = 0; slot <= units.length; slot++) {
    if (slot < units.length && units[slot].parentUnitId) continue;
    if (relations.slice(0, slot).every(value => value === -1) &&
        relations.slice(slot).every(value => value === 1)) candidates.push(slot);
  }
  return candidates.length === 1 ? candidates[0] : null;
}
function canonicalTexts(unit: TranslationStructuredSourceUnit): string[] {
  // Only visible fields; structural IDs and source bindings are not reading text.
  const { text, caption, rawText, rowGroups } = unit.payload;
  const texts: unknown[] = [text, caption, rawText];
  if (Array.isArray(rowGroups)) for (const group of rowGroups) {
    if (!group || !Array.isArray(group.rows)) continue;
    for (const row of group.rows) {
      if (!row || !Array.isArray(row.cells)) continue;
      texts.push(row.cells.map((cell: { inlineContent?: Array<{ text?: unknown }> }) =>
        Array.isArray(cell?.inlineContent) ? cell.inlineContent.map(run =>
          typeof run.text === 'string' ? run.text : '').join('') : '').join(' '));
    }
  }
  return texts.filter((value): value is string => typeof value === 'string').map(value =>
    normalizeOriginalWhitespace(originalMarkdownText(value).replace(/<[^>]*>/gu, ' ')));
}
function physicalBox(value: unknown): Box | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(item => typeof item === 'number' && Number.isFinite(item)) ||
      value[0] < 0 || value[1] < 0 || value[2] <= value[0] || value[3] <= value[1]) return null;
  return [value[0], value[1], value[2], value[3]];
}
function scaledBox(value: unknown, page: DocumentPdfPage): Box | null {
  const box = physicalBox(value);
  return box && box[2] <= 1000 && box[3] <= 1000 && page ? [box[0] * page.width / 1000, box[1] * page.height / 1000, box[2] * page.width / 1000, box[3] * page.height / 1000] : null;
}
function contains(outer: Box, inner: Box): boolean {
  return outer[0] <= inner[0] + 2 && outer[1] <= inner[1] + 2 && outer[2] >= inner[2] - 2 && outer[3] >= inner[3] - 2;
}
function overlaps(a: Box, b: Box): boolean {
  // Small geometry tolerance prevents a rounding gap being treated as unread territory.
  return a[0] < b[2] + 2 && a[2] > b[0] - 2 && a[1] < b[3] + 2 && a[3] > b[1] - 2;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DOCUMENT_MINERU_COVERAGE_STRUCTURE_INVALID');
  return value as Record<string, unknown>;
}
function readingMarkdown(units: TranslationStructuredSourceUnit[]): string {
  return units.filter(unit => !unit.parentUnitId).map(unit => {
    if (unit.kind === 'heading') return `${'#'.repeat(Math.min(6, Number(unit.payload.level) || 1))} ${unit.payload.text ?? ''}`;
    if (unit.kind === 'list') return units.filter(child => child.parentUnitId === unit.unitId).map(child => `- ${child.payload.text ?? ''}`).join('\n');
    if (unit.kind === 'table') {
      const raw = unit.payload.rawMineruContent as Record<string, unknown> | undefined;
      return [unit.payload.caption, raw?.html, unit.payload.rawText].filter(value => typeof value === 'string' && value).join('\n\n');
    }
    if (unit.kind === 'figure' && typeof unit.payload.assetPath === 'string')
      return `${unit.payload.text ?? ''}\n\n![图示](${unit.payload.assetPath})`;
    return String(unit.payload.text ?? '');
  }).filter(Boolean).join('\n\n');
}
