import type { DocumentOriginalResult } from '@shared/document-original.interface';
import type { TranslationStructuredSourceUnit } from '@shared/canonical-translation-v2.interface';
import type { DocumentPdfExtraction, DocumentPdfPage } from './document-original-pdf';
import { mineruPageFurniture } from '../../../../professional-input/mineru/mineru-page-furniture';
import { originalPageLayout } from './document-original-layout';
import { normalizeOriginalWhitespace, originalMarkdownText } from './document-original-text';
import { documentOriginalStructuredSource } from './document-original-adapter';

type Box = [number, number, number, number];
type Region = { box: Box; discardedFurniture: boolean; native: boolean };
/** Preserve OCR; add only independently located text outside every known MinerU region.
 * Text inside an uncertain/incorrect region is reported, never spliced into its structure. */
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
  for (let pageIndex = 0; pageIndex < input.extraction.pageCount; pageIndex++) {
    const page = input.extraction.pages[pageIndex];
    if (page.pageIndex !== pageIndex) throw new Error('DOCUMENT_MINERU_COVERAGE_PAGE_MISMATCH');
    const layout = originalPageLayout(page);
    const rawPage = record(middle.pdf_info[pageIndex]);
    const regions = pageRegions(rawPage, input.rawContentListV2[pageIndex], page, furniture.omitted);
    if (!page.text.trim()) continue; // No text layer: retain all original OCR and its own limitations.
    if (!layout.lines.length || !regions) {
      limit('STRUCTURE_UNCERTAIN', pageIndex, [], 'PDF 文本层与 MinerU 的位置无法可靠对应；未自动补入文字，请核对原页。');
      continue;
    }
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
      const unit: TranslationStructuredSourceUnit = { unitId, kind: 'paragraph', moduleId: 'body', parentUnitId: null,
        order: 0, depth: 0, continuityKey: unitId, sourceRefIds: [ref], sourceSegmentIds: [ref],
        mapping: { extraction: 'PDFJS_TEXT_LAYER', supplementation: 'OUTSIDE_MINERU_REGIONS', pageIndex,
          sourceArtifactPath: `original/pages-${Math.floor(pageIndex / 8) * 8}.json`,
          textItems: [{ pageIndex, itemIndexes: [...line.itemIndexes] }], pdfTop: box[1], pdfLeft: box[0] },
        payload: { text: line.text } };
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
