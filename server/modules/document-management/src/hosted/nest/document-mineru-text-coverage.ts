import type { DocumentOriginalResult } from '@shared/document-original.interface';
import type { TranslationStructuredSourceUnit } from '@shared/canonical-translation-v2.interface';
import type { DocumentPdfExtraction, DocumentPdfPage } from './document-original-pdf';
import { mineruPageFurniture } from '../../../../professional-input/mineru/mineru-page-furniture';
import { originalPageLayout, type OriginalLayoutLine, type OriginalLayoutRun } from './document-original-layout';
import { normalizeOriginalWhitespace, originalMarkdownText } from './document-original-text';
import { documentOriginalStructuredSource } from './document-original-adapter';
import { recoverMineruCrossPageTables, recoveredMineruTableCoversItems } from './document-mineru-cross-page-table';

type Box = [number, number, number, number];
type Region = { box: Box; discardedFurniture: boolean; native: boolean; footer: boolean; header: boolean;
  blockType: string; sourcePointer: string };
type GeneratedOn = { text: string; date: string; lines: Array<{ line: OriginalLayoutLine; index: number }>; sourcePointer: string };
type LiteralRun = { run: OriginalLayoutRun; box: Box; slot: number; sourcePointer: string;
  supplementation: 'NATIVE_REGION_LITERAL' | 'MATCHED_PARAGRAPH_GAP' | 'FIRST_PAGE_DATE_HEADER' };
/** Preserve OCR and independently located PDF text. Literal fragments inside an
 * unreadable native region do not reconstruct its table or column relationships. */
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
  const generatedDates: Array<{ date: string; unitId: string; pageIndex: number }> = [];
  const layouts = input.extraction.pages.map(page => originalPageLayout(page));
  const headingAnchors = originalHeadingAnchors(original.source.units, input.extraction.pages, layouts);
  recoverMineruCrossPageTables({ original, extraction: input.extraction, rawMiddle: input.rawMiddle });
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
    const generated = generatedOnFooter(page, layout.lines, regions, original.source.units);
    if (generated.uncertain) limit('STRUCTURE_UNCERTAIN', pageIndex, [],
      '页脚中的文档生成日期句子或位置无法可靠对应；未自动补入，请核对原页。');
    for (const [occurrence, observation] of generated.statements.entries()) {
      const boxes = observation.lines.map(({ line }) => lineBox(line, page));
      const box: Box = [Math.min(...boxes.map(value => value[0])), Math.min(...boxes.map(value => value[1])),
        Math.max(...boxes.map(value => value[2])), Math.max(...boxes.map(value => value[3]))];
      const slot = insertionSlot(original.source.units, page, box);
      if (slot === null) {
        limit('STRUCTURE_UNCERTAIN', pageIndex, [], '页脚文档生成日期的阅读顺序无法唯一确定；未自动插入，请核对原页。');
        continue;
      }
      const unitId = `${original.binding.parseRunId}:pdfjs:p${pageIndex}:generated:${observation.lines[0].index}:${occurrence}`;
      const ref = `${unitId}:source`;
      additions.push({ unitId, kind: 'paragraph', moduleId: 'body', parentUnitId: null,
        order: 0, depth: 0, continuityKey: unitId, sourceRefIds: [ref], sourceSegmentIds: [ref],
        mapping: { extraction: 'PDFJS_TEXT_LAYER', supplementation: 'EXPLICIT_GENERATED_ON_FOOTER', pageIndex,
          sourcePointer: observation.sourcePointer, sourceArtifactPath: `original/pages-${Math.floor(pageIndex / 8) * 8}.json`,
          textItems: observation.lines.map(({ line }) => ({ pageIndex, itemIndexes: [...line.itemIndexes] })),
          pdfTop: box[1], pdfLeft: box[0] },
        payload: { text: observation.text, role: 'SOURCE_GENERATED_DATE' } });
      insertionSlots.set(unitId, slot);
      generatedDates.push({ date: observation.date, unitId, pageIndex });
      original.source.sourceLocators.push({ sourceRefId: ref, kind: 'PDF_PAGE', artifactId: original.binding.sourceArtifactId,
        pageStart: pageIndex, pageEnd: pageIndex, charStart: null, charEnd: null, charOffsetUnit: null,
        normalizedPath: null, xpath: null, elementId: null, quote: observation.text, bbox: null });
      original.locations.push({ sourceRefId: ref, precision: 'TEXT_ITEM', coordinateSpace: 'PDF_VIEWPORT_TOP_LEFT',
        pageIndex, viewportWidth: page.width, viewportHeight: page.height,
        boxes: boxes.map(value => [value[0], value[1], value[2] - value[0], value[3] - value[1]]) });
      original.source.findings.push({ findingId: `${unitId}:supplement`, code: 'PDF_TEXT_SUPPLEMENT', severity: 'warning',
        readingImpact: 'DIAGNOSTIC', blocking: false,
        message: '原文页脚明确给出的文档生成日期；不替代正文或附件的修订日期。',
        affectedUnitIds: [unitId], sourceRefIds: [ref], pageIndexes: [pageIndex] });
      if (!original.coverage.readPageIndexes.includes(pageIndex)) original.coverage.readPageIndexes.push(pageIndex);
    }
    for (const observation of literalSourceRuns(original, page, layout.lines, layouts, regions,
      (unitIds, message) => limit('STRUCTURE_UNCERTAIN', pageIndex, unitIds, message))) {
      const { run, box } = observation;
      const unitId = `${original.binding.parseRunId}:pdfjs:p${pageIndex}:run:${run.itemIndexes.join('-')}`;
      const ref = `${unitId}:source`;
      additions.push({ unitId, kind: 'paragraph', moduleId: 'body', parentUnitId: null,
        order: 0, depth: 0, continuityKey: unitId, sourceRefIds: [ref], sourceSegmentIds: [ref],
        mapping: { extraction: 'PDFJS_TEXT_LAYER', supplementation: observation.supplementation, pageIndex,
          sourcePointer: observation.sourcePointer, sourceArtifactPath: `original/pages-${Math.floor(pageIndex / 8) * 8}.json`,
          textItems: [{ pageIndex, itemIndexes: [...run.itemIndexes] }], pdfTop: box[1], pdfLeft: box[0] },
        payload: { text: run.text, role: observation.supplementation === 'FIRST_PAGE_DATE_HEADER'
          ? 'SOURCE_HEADER' : 'SOURCE_LITERAL_TEXT' } });
      insertionSlots.set(unitId, observation.slot);
      original.source.sourceLocators.push({ sourceRefId: ref, kind: 'PDF_PAGE', artifactId: original.binding.sourceArtifactId,
        pageStart: pageIndex, pageEnd: pageIndex, charStart: null, charEnd: null, charOffsetUnit: null,
        normalizedPath: null, xpath: null, elementId: null, quote: run.text, bbox: null });
      original.locations.push({ sourceRefId: ref, precision: 'TEXT_ITEM', coordinateSpace: 'PDF_VIEWPORT_TOP_LEFT',
        pageIndex, viewportWidth: page.width, viewportHeight: page.height, boxes: run.boxes.map(value => [...value]) });
      original.source.findings.push({ findingId: `${unitId}:literal`, code: 'PDF_TEXT_SUPPLEMENT', severity: 'warning',
        readingImpact: 'DIAGNOSTIC', blocking: false,
        message: observation.supplementation === 'FIRST_PAGE_DATE_HEADER'
          ? '保留原件首面明确含日期的页眉文字；不据此修改文档日期字段。'
          : '同一原件的独立物理文字片段；原表、栏关系及跨页结构仍须核对，未据此重建。',
        affectedUnitIds: [unitId], sourceRefIds: [ref], pageIndexes: [pageIndex] });
      if (!original.coverage.readPageIndexes.includes(pageIndex)) original.coverage.readPageIndexes.push(pageIndex);
    }
    for (const [lineIndex, line] of layout.lines.entries()) {
      if (recoveredMineruTableCoversItems(original, pageIndex, line.itemIndexes)) continue;
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
  if (new Set(generatedDates.map(value => value.date)).size > 1) {
    for (const pageIndex of new Set(generatedDates.map(value => value.pageIndex)))
      limit('TEXT_CONFLICT', pageIndex, generatedDates.filter(value => value.pageIndex === pageIndex).map(value => value.unitId),
        '原文页脚给出不同的文档生成日期；各处原文均保留，日期关系需核对，未据此修改文档修订日期。');
  }
  // Independent literal fragments cannot prove that an unread native page is
  // complete. Keep its existing limitation, including cross-page table defects.
  const literalModes = new Set(['NATIVE_REGION_LITERAL', 'MATCHED_PARAGRAPH_GAP', 'FIRST_PAGE_DATE_HEADER']);
  const supplementedPages = new Set(additions.filter(unit => !literalModes.has(String(unit.mapping.supplementation)))
    .map(unit => Number(unit.mapping.pageIndex)));
  for (const range of original.coverage.unresolvedRanges) if (range.reason === 'UNREAD' &&
      range.pageIndexes.every(page => supplementedPages.has(page))) {
    range.reason = 'STRUCTURE_UNCERTAIN';
    range.message = 'PDF 文本已补充本页可定位文字；MinerU 正文为空，其他视觉内容仍需核对。';
  }
  const baseUnits = original.source.units;
  original.source.units = [];
  for (let index = 0; index <= baseUnits.length; index++) {
    original.source.units.push(...additions.filter(unit => insertionSlots.get(unit.unitId) === index).sort((left, right) =>
      Number(left.mapping.pageIndex) - Number(right.mapping.pageIndex) || Number(left.mapping.pdfTop) - Number(right.mapping.pdfTop) ||
      Number(left.mapping.pdfLeft) - Number(right.mapping.pdfLeft)));
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
/** Ordinary literal text only. No table cells, inferred branches, cross-column
 * quotes, fuzzy identifier matching, or raw HTML promoted into readable text. */
function literalSourceRuns(original: DocumentOriginalResult, page: DocumentPdfPage, lines: OriginalLayoutLine[],
  layouts: Array<{ lines: OriginalLayoutLine[] }>, regions: Region[],
  onUncertain: (unitIds: string[], message: string) => void): LiteralRun[] {
  const observations: LiteralRun[] = [];
  const delivered = original.source.units.flatMap(canonicalTexts).filter(Boolean).map(literalComparisonText);
  const pageUnits = original.source.units.filter(unit => Number(unit.mapping.pageIndex) === page.pageIndex && !unit.parentUnitId);
  const indexed = lines.flatMap(line => line.runs.map(run => ({ line, run, box: runBox(run, page) })));
  for (const { line, run, box } of indexed) {
    if (!run.text.trim()) continue;
    if (!box) {
      onUncertain([], '独立 PDF 文字片段的原始 item 索引或几何不完整；未自动补入，请核对原页。');
      continue;
    }
    const needle = literalComparisonText(run.text);
    if (delivered.some(text => text.includes(needle))) continue;
    const touched = regions.filter(region => overlaps(box, region.box));
    if (!touched.length || touched.some(region => ['image', 'chart', 'figure'].includes(region.blockType))) continue;

    const dateHeaders = touched.filter(region => region.discardedFurniture && region.header && contains(region.box, box));
    if (dateHeaders.length && page.pageIndex === 0 && box[3] <= page.height * 0.12 && literalDate(run.text) &&
        !/\b(?:copyright|proprietary|export controlled)\b|©/iu.test(run.text) &&
        !layouts.slice(1).some(layout => layout.lines.some(entry => entry.runs.some(value =>
          literalComparisonText(value.text) === needle)))) {
      const slot = line.runs.length === 1 && uniformRunSize(run, page) !== null
        ? insertionSlot(original.source.units, page, box) : null;
      if (slot !== null) observations.push({ run, box, slot, sourcePointer: dateHeaders[0].sourcePointer,
        supplementation: 'FIRST_PAGE_DATE_HEADER' });
      else onUncertain([], '首面含日期的页眉文字或阅读位置无法唯一对应；未自动补入，请核对原页。');
      continue;
    }
    // Omitted furniture cannot be reclassified as body text by a nearby table.
    if (touched.some(region => region.native && region.discardedFurniture)) continue;
    const owners = pageUnits.filter(unit => (unit.kind === 'table' ||
        (unit.kind === 'preserved_source' && unit.payload.originalBlockType === 'table')) &&
      regions.some(region => region.native && region.sourcePointer === unit.mapping.sourcePointer &&
        !region.discardedFurniture && contains(region.box, box)));
    if (owners.length > 1) {
      onUncertain(owners.map(unit => unit.unitId), 'PDF 文字片段对应多个原生表格；未自动补入或重建其关系，请核对原页。');
      continue;
    }
    if (owners.length === 1) {
      const owner = owners[0];
      // A fully populated readable table may contain an OCR glyph conflict,
      // not a missing fragment. No fuzzy identifiers or replacement cells.
      if (owner.kind === 'table' && !hasUnreadCell(owner)) {
        onUncertain([owner.unitId], '可读表格中的文字差异不能确认为缺漏；未自动补入或修订单元格，请核对原页。');
        continue;
      }
      // A partly matched physical run remains a conflict. Do not append its
      // unmatched suffix or replace OCR, even when it resembles a prose table.
      const localTexts = canonicalTexts(owner).filter(Boolean).map(literalComparisonText);
      if (localTexts.some(text => needle.includes(text))) continue;
      const competitors = pageUnits.filter(unit => unit.unitId !== owner.unitId && (() => {
        const bounds = scaledBox(unit.mapping.nativeBbox, page);
        return bounds !== null && overlaps(bounds, box);
      })());
      if (competitors.length) {
        onUncertain([owner.unitId, ...competitors.map(unit => unit.unitId)],
          'PDF 文字片段与多个原生单元重叠；未自动补入或重建其关系，请核对原页。');
        continue;
      }
      observations.push({ run, box, slot: original.source.units.indexOf(owner) + 1,
        sourcePointer: String(owner.mapping.sourcePointer), supplementation: 'NATIVE_REGION_LITERAL' });
      continue;
    }
    // A wrong native bbox must not hide a whole missing paragraph. Require the
    // two real, uniquely matched neighbors in the same physical column instead.
    if (line.runs.length !== 1) continue;
    const gap = matchedParagraphGap(original.source.units, page, indexed, run, box);
    if (gap) observations.push({ run, box, slot: gap.slot, sourcePointer: gap.sourcePointer,
      supplementation: 'MATCHED_PARAGRAPH_GAP' });
  }
  return observations;
}
/** Presence comparison only: PDF typography around an actual hyphen must not
 * create duplicate identifiers. Quotes and raw items retain their exact text;
 * only hyphen glyphs and parentheses padding vary. Spaced ASCII minus signs,
 * spaced en-dash ranges and every letter/digit stay distinct. */
function literalComparisonText(value: string): string {
  return normalizeOriginalWhitespace(value.replace(/\s*[\u2010\u2011]\s*/gu, '-')
    .replace(/(?<=[\p{L}\p{N}])\u2013(?=[\p{L}\p{N}])/gu, '-')
    .replace(/\s*\(\s*/gu, '(').replace(/\s*\)/gu, ')'));
}
function hasUnreadCell(unit: TranslationStructuredSourceUnit): boolean {
  const groups = unit.payload.rowGroups;
  return Array.isArray(groups) && groups.some(group => Array.isArray(group?.rows) &&
    group.rows.some((row: { cells?: Array<{ textAvailability?: string; inlineContent?: Array<{ text?: string }> }> }) =>
      Array.isArray(row?.cells) && row.cells.some(cell => cell.textAvailability === 'NO_TEXT_ITEMS' &&
        Array.isArray(cell.inlineContent) && !cell.inlineContent.map(run => run.text ?? '').join('').trim())));
}
function runBox(run: OriginalLayoutRun, page: DocumentPdfPage): Box | null {
  if (!run.itemIndexes.length || run.itemIndexes.length !== run.boxes.length ||
      new Set(run.itemIndexes).size !== run.itemIndexes.length ||
      run.boxes.some((box, index) => {
        const item = page.items[run.itemIndexes[index]];
        return !item || box.some(value => !Number.isFinite(value)) || box[0] < 0 || box[1] < 0 ||
          box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > page.width + 0.5 || box[1] + box[3] > page.height + 0.5 ||
          box[0] !== item.transform[4] || box[1] !== page.height - item.transform[5] - item.transform[3] ||
          box[2] !== item.width || box[3] !== item.transform[3];
      })) return null;
  return [Math.min(...run.boxes.map(box => box[0])), Math.min(...run.boxes.map(box => box[1])),
    Math.max(...run.boxes.map(box => box[0] + box[2])), Math.max(...run.boxes.map(box => box[1] + box[3]))];
}
function uniformRunSize(run: OriginalLayoutRun, page: DocumentPdfPage): number | null {
  const sizes = run.itemIndexes.map(index => page.items[index]?.transform[3]);
  return sizes.length && sizes.every(size => typeof size === 'number' && Number.isFinite(size) &&
    Math.abs(size - sizes[0]) <= 0.5) ? sizes[0] : null;
}
function literalDate(text: string): boolean {
  const months = 'January|February|March|April|May|June|July|August|September|October|November|December';
  return new RegExp(`(?:\\b[0-9]{4}[-/.][0-9]{1,2}[-/.][0-9]{1,2}\\b|\\b[0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{4}\\b|` +
    `\\b[0-9]{1,2} (?:${months}) [0-9]{4}\\b|\\b(?:${months}) [0-9]{1,2},? [0-9]{4}\\b)`, 'iu').test(text);
}
function matchedParagraphGap(units: TranslationStructuredSourceUnit[], page: DocumentPdfPage,
  indexed: Array<{ line: OriginalLayoutLine; run: OriginalLayoutRun; box: Box | null }>,
  run: OriginalLayoutRun, box: Box): { slot: number; sourcePointer: string } | null {
  const anchors = units.flatMap((unit, index) => {
    if (Number(unit.mapping.pageIndex) !== page.pageIndex || unit.parentUnitId || unit.kind !== 'paragraph' ||
        typeof unit.payload.text !== 'string' || typeof unit.mapping.sourcePointer !== 'string') return [];
    const matches = indexed.filter(value => value.box && value.line.runs.length === 1 &&
      normalizeOriginalWhitespace(value.run.text) === normalizeOriginalWhitespace(String(unit.payload.text)));
    return matches.length === 1 ? [{ unit, index, run: matches[0].run, box: matches[0].box! }] : [];
  });
  const candidates = anchors.flatMap(before => anchors.filter(after => after.index === before.index + 1 &&
    before.box[3] <= box[1] && after.box[1] >= box[3] &&
    Math.abs(before.box[0] - box[0]) <= 2 && Math.abs(after.box[0] - box[0]) <= 2 &&
    uniformRunSize(run, page) !== null && uniformRunSize(before.run, page) === uniformRunSize(run, page) &&
    uniformRunSize(after.run, page) === uniformRunSize(run, page))
    .map(after => ({ slot: after.index, sourcePointer: String(before.unit.mapping.sourcePointer) })));
  return candidates.length === 1 ? candidates[0] : null;
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
    // All text in the candidate region must form one left-aligned column.
    const lefts = touched.map(line => line.x);
    if (Math.max(...lefts) - Math.min(...lefts) > 12 ||
        lineBox(touched[0], page)[1] - box[1] > touched[0].height * 1.5 ||
        box[3] - lineBox(touched.at(-1)!, page)[3] > touched.at(-1)!.height * 1.5 ||
        lines.some(line => lineBox(line, page)[1] < box[3] &&
          lineBox(line, page)[3] > box[1] && !touched.includes(line))) continue;
    if (original.source.units.some(other => {
      if (other.unitId === unit.unitId || Number(other.mapping.pageIndex) !== page.pageIndex) return false;
      const otherBox = scaledBox(other.mapping.nativeBbox, page);
      return otherBox !== null && overlaps(otherBox, box);
    })) continue;
    const pdfText = proseTableText(touched, page);
    if (pdfText === null) continue;
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
/** Infer blank lines only from a stable pitch in the same physical prose column.
 * A larger initial label stays text and never contributes to the body pitch. */
function proseTableText(lines: OriginalLayoutLine[], page: DocumentPdfPage): string | null {
  if (lines.some(line => uniformLineSize(line, page) === null)) return null;
  const sizes = lines.map(line => line.height).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)];
  const first = lines[0];
  const hasLabel = Math.abs(first.height - bodySize) > 0.5;
  if (hasLabel && (first.height < bodySize * 1.2 || first.text.length > 120 ||
      words(first.text).length > 12 || /[.;:。；：!?！？]$/u.test(first.text))) return null;
  const body = lines.slice(hasLabel ? 1 : 0);
  if (body.some(line => Math.abs(line.height - bodySize) > 0.5)) return null;
  if (hasLabel && first.y - body[0].y > Math.max(first.height, bodySize) * 2) return null;
  const gaps = body.slice(1).map((line, index) => body[index].y - line.y);
  const ordinary = gaps.filter(gap => gap >= bodySize && gap <= bodySize * 2).sort((a, b) => a - b);
  if (ordinary.length < 3) return null;
  const pitch = ordinary[Math.floor(ordinary.length / 2)];
  const tolerance = Math.max(0.5, pitch * 0.1);
  if (ordinary.some(gap => Math.abs(gap - pitch) > tolerance)) return null;
  let text = body[0].text;
  for (let index = 1; index < body.length; index++) {
    const gap = gaps[index - 1];
    if (Math.abs(gap - pitch) <= tolerance) text += ` ${body[index].text}`;
    else if (gap >= pitch * 1.8 && gap <= pitch * 2.2 &&
        /[.!?。！？]["'”’)]?$/u.test(body[index - 1].text)) text += `\n\n${body[index].text}`;
    else return null; // Irregular gaps or table-like rows are not paragraph evidence.
  }
  return hasLabel ? `${first.text}\n\n${text}` : text;
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
/** Only a literal declarative source-generation statement in a proven omitted
 * physical footer. No filename dates, body references or cross-column joining. */
function generatedOnFooter(page: DocumentPdfPage, lines: OriginalLayoutLine[], regions: Region[],
  units: TranslationStructuredSourceUnit[]): { statements: GeneratedOn[]; uncertain: boolean } {
  const date = '(?:[0-9]{4}[-/.][0-9]{1,2}[-/.][0-9]{1,2}|[0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{4}|' +
    '[0-9]{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) [0-9]{4}|' +
    '(?:January|February|March|April|May|June|July|August|September|October|November|December) [0-9]{1,2},? [0-9]{4})';
  const prefix = '(?:(?:The|This)\\s+)?document\\s+(?:was\\s+)?generated\\s+on\\s+';
  const literal = new RegExp(`${prefix}${date}`, 'iu');
  const sentence = new RegExp(`(?:^|(?<=[.!?])\\s*)(${prefix}(${date})(?:\\s+by\\s+[^.!?]+)?(?:[.!?]|$))`, 'giu');
  const statements: GeneratedOn[] = [], seen = new Set<string>();
  let uncertain = false;
  for (const region of regions.filter(value => value.discardedFurniture && value.footer && value.box[1] >= page.height * 0.85)) {
    let offset = 0;
    const candidates = lines.map((line, index) => ({ line, index })).filter(({ line }) =>
      contains(region.box, lineBox(line, page))).map(value => {
      const entry = { ...value, start: offset, end: offset + value.line.text.length };
      offset = entry.end + 1;
      return entry;
    });
    const text = candidates.map(value => value.line.text).join(' ');
    if (!literal.test(text)) continue;
    let matched = false;
    for (const match of text.matchAll(sentence)) {
      const start = match.index! + match[0].indexOf(match[1]), end = start + match[1].length;
      const selected = candidates.filter(value => value.start < end && value.end > start);
      const first = selected[0], last = selected.at(-1);
      if (!first || !last) { uncertain = true; continue; }
      const key = `${first.index}:${start - first.start}:${last.index}:${end - last.start}`;
      if (selected.length > 3 || selected.some(({ line }, index) => line.runs.length !== 1 ||
          uniformLineSize(line, page) === null || lineBox(line, page)[1] < page.height * 0.85 ||
          Math.abs(selected[0].line.height - line.height) > 0.5 ||
          regions.some(other => other.native && !other.discardedFurniture && overlaps(other.box, lineBox(line, page))) ||
          units.some(unit => Number(unit.mapping.pageIndex) === page.pageIndex &&
            scaledBox(unit.mapping.nativeBbox, page) !== null && overlaps(scaledBox(unit.mapping.nativeBbox, page)!, lineBox(line, page))) ||
          (index > 0 && (selected[index - 1].index + 1 !== selected[index].index ||
            Math.abs(selected[0].line.x - line.x) > 12 ||
            selected[index - 1].line.y - line.y > Math.max(selected[index - 1].line.height, line.height) * 1.65)))) {
        uncertain = true;
        continue;
      }
      matched = true;
      if (seen.has(key)) continue;
      seen.add(key);
      statements.push({ text: match[1], date: match[2], lines: selected.map(({ line, index }) => ({ line, index })),
        sourcePointer: region.sourcePointer });
    }
    if (!matched) uncertain = true;
  }
  return { statements, uncertain };
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
  for (const [index, raw] of rawV2.entries()) {
    const entry = record(raw), box = scaledBox(entry.bbox, page);
    if (!box) return null;
    regions.push({ box, native: true, discardedFurniture: omitted(entry),
      footer: entry.type === 'page_footer' || (entry.type === 'paragraph' && box[1] >= page.height * 0.85),
      header: entry.type === 'page_header', blockType: String(entry.type),
      sourcePointer: `/raw/contentListV2/${page.pageIndex}/${index}` });
  }
  // Include discarded headers, figures and preprocessing regions omitted from normalized v2.
  for (const key of ['preproc_blocks', 'para_blocks', 'discarded_blocks']) {
    if (middle[key] !== undefined && !Array.isArray(middle[key])) return null;
    for (const [index, raw] of ((middle[key] ?? []) as unknown[]).entries()) {
      const entry = record(raw), box = physicalBox(entry.bbox);
      if (!box) return null;
      regions.push({ box, native: false, discardedFurniture: key === 'discarded_blocks' &&
        ['header', 'page_header', 'footer', 'page_footer', 'page_number'].includes(String(entry.type)),
        footer: key === 'discarded_blocks' && ['footer', 'page_footer'].includes(String(entry.type)),
        header: key === 'discarded_blocks' && ['header', 'page_header'].includes(String(entry.type)), blockType: String(entry.type),
        sourcePointer: `/raw/middle/pdf_info/${page.pageIndex}/${key}/${index}` });
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
      return [unit.payload.caption, unit.payload.readingHtml ?? raw?.html, unit.payload.rawText]
        .filter(value => typeof value === 'string' && value).join('\n\n');
    }
    if (unit.kind === 'figure' && typeof unit.payload.assetPath === 'string')
      return `${unit.payload.text ?? ''}\n\n![图示](${unit.payload.assetPath})`;
    return String(unit.payload.text ?? '');
  }).filter(Boolean).join('\n\n');
}
