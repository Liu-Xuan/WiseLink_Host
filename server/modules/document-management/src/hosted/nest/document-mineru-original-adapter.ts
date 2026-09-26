import type { DocumentOriginalBinding, DocumentOriginalResult } from '@shared/document-original.interface';
import type { TranslationStructuredSourceUnit } from '@shared/canonical-translation-v2.interface';
import { readMineruArtifacts } from '../../../../professional-input/mineru/mineru-artifacts';
import type { MineruDocumentVersionBinding, MineruParseResult } from '../../../../professional-input/mineru/mineru-artifact-store';
import { buildMineruTranslationPlan, type MineruTranslationUnit } from '../../../../professional-input/mineru/mineru-translation';
import { documentOriginalStructuredSource } from './document-original-adapter';

/** Offline conversion only. The caller owns source-byte verification, authorization,
 * persistence and publication. OCR text comes from the retained raw MinerU bundle,
 * never from PDF text matching or a translated/enhanced view. */
export function documentMineruOriginal(input: {
  binding: DocumentOriginalBinding;
  documentVersion: MineruDocumentVersionBinding;
  validatedTitleLevels?: Array<{ id: string; level: number }>;
  result: Pick<MineruParseResult, 'sourceSha256' | 'sourceByteLength' | 'rawArtifacts' | 'assets'>;
}): DocumentOriginalResult {
  const { binding, documentVersion: version, result } = input;
  if (!binding.documentVersionId || !binding.parseRunId || !binding.sourceArtifactId ||
      !Number.isSafeInteger(binding.parseRevision) || binding.parseRevision < 1 ||
      !/^[a-f0-9]{64}$/.test(binding.sourceSha256) ||
      !Number.isSafeInteger(binding.sourceByteLength) || binding.sourceByteLength < 1 ||
      binding.documentVersionId !== version.documentVersionId || binding.sourceArtifactId !== version.sourceArtifactId ||
      binding.sourceSha256 !== version.pdfSha256 || binding.sourceByteLength !== version.byteLength ||
      result.sourceSha256 !== binding.sourceSha256 || result.sourceByteLength !== binding.sourceByteLength)
    throw new Error('DOCUMENT_MINERU_SOURCE_BINDING_MISMATCH');
  const document = readMineruArtifacts({ markdown: result.rawArtifacts.markdown,
    contentListV2: result.rawArtifacts.contentListV2, middle: result.rawArtifacts.middle,
    assetPaths: result.assets.map(asset => asset.path) });
  if (input.validatedTitleLevels) {
    const seen = new Set<string>();
    for (const title of input.validatedTitleLevels) {
      const block = document.blocks.find(item => item.id === title.id && item.type === 'title');
      if (!block || seen.has(title.id) || !Number.isSafeInteger(title.level) || title.level < 1 || title.level > 6)
        throw new Error('DOCUMENT_MINERU_TITLE_LEVELS_INVALID');
      seen.add(title.id); block.headingLevel = title.level;
    }
  }
  if (document.backend !== 'pipeline') throw new Error('DOCUMENT_MINERU_LOCAL_BACKEND_REQUIRED');
  const plan = buildMineruTranslationPlan(document, binding);
  const blocks = new Map([...document.blocks, ...document.discardedBlocks].map(block => [block.id, block]));
  const original: DocumentOriginalResult = {
    schemaVersion: 'wiselink.document.original.v1', binding: structuredClone(binding),
    producer: { kind: 'MINERU_LOCAL', instanceId: 'mineru-local', pluginVersion: document.version,
      engine: { name: 'MinerU', version: document.version, backend: document.backend },
      actionKey: 'pipeline', concreteModel: null, extractedAt: null },
    source: { units: [], modules: [{ moduleId: 'body', order: 0 }], sourceLocators: [], findings: [], references: [] },
    locations: [], coverage: { knownPageCount: document.pages.length, readPageIndexes: [], unresolvedRanges: [] },
    markdown: document.markdown,
  };
  const readPages = new Set<number>();
  for (const unit of plan.units) {
    const block = blocks.get(unit.key);
    if (!block) throw new Error('DOCUMENT_MINERU_BLOCK_BINDING_INVALID');
    const unitId = `${binding.parseRunId}:${block.id}`;
    const ref = `${unitId}:source`;
    const page = document.pages[block.pageIndex];
    if (!page || page.pageIndex !== block.pageIndex) throw new Error('DOCUMENT_MINERU_PAGE_BINDING_INVALID');
    const mapping = { extraction: 'MINERU_LOCAL', blockId: block.id, pageIndex: block.pageIndex,
      sourcePointer: `/raw/contentListV2${block.sourcePointer}`, sourceArtifactPath: 'raw/mineru-candidate.json',
      nativeBbox: block.bbox ? [...block.bbox] : null, nativeCoordinateSpace: 'PAGE_TOP_LEFT_0_1000',
      pageWidth: page.width, pageHeight: page.height };
    const sourceUnit: TranslationStructuredSourceUnit = {
      unitId, kind: 'preserved_source', moduleId: 'body', parentUnitId: null,
      order: original.source.units.length, depth: 0, continuityKey: block.id,
      sourceRefIds: [ref], sourceSegmentIds: [ref], mapping,
      payload: { rawMineruContent: structuredClone(block.content), originalBlockType: block.type,
        ...(block.assetPath ? { assetPath: block.assetPath } : {}) },
    };
    original.source.sourceLocators.push({ sourceRefId: ref, kind: 'PDF_PAGE', artifactId: binding.sourceArtifactId,
      pageStart: block.pageIndex, pageEnd: block.pageIndex, charStart: null, charEnd: null, charOffsetUnit: null,
      normalizedPath: null, xpath: null, elementId: null, quote: null, bbox: null });
    // Retain MinerU-native geometry without declaring it a verified PDF.js text-item box.
    original.locations.push({ sourceRefId: ref, precision: 'NATIVE_SELECTOR', coordinateSpace: null,
      pageIndex: block.pageIndex, viewportWidth: null, viewportHeight: null, boxes: [] });
    const children: TranslationStructuredSourceUnit[] = [];
    if (unit.value?.kind === 'text') {
      sourceUnit.kind = block.type === 'title' ? 'heading'
        : ['image', 'chart'].includes(block.type) ? 'figure'
          : ['paragraph', 'page_footnote', 'page_aside_text', 'algorithm'].includes(block.type) ? 'paragraph' : 'preserved_source';
      sourceUnit.payload.text = unit.value.text;
      if (sourceUnit.kind === 'heading') sourceUnit.payload.level = block.headingLevel;
      if (['page_footnote', 'page_aside_text'].includes(block.type)) sourceUnit.payload.role = block.type;
    } else if (unit.value?.kind === 'table') {
      sourceUnit.kind = 'table';
      const table = unit.value;
      if (!unit.tableCells?.length) throw new Error('DOCUMENT_MINERU_TABLE_CELLS_REQUIRED');
      Object.assign(sourceUnit.payload, { layout: 'grid', columnCount: table.rows[0].length, columns: [],
        caption: table.caption ?? '', rawText: table.notes ?? '',
        rowGroups: [{ rows: table.rows.map((_row, row) => ({ rowId: `${unitId}:r${row}`,
          cells: unit.tableCells!.filter(cell => cell.row === row).map(cell => ({
            cellId: `${unitId}:r${row}:c${cell.column}`, columnIndex: cell.column,
            rowSpan: cell.rowSpan, colSpan: cell.colSpan, isHeader: cell.header,
            textAvailability: table.rows[row][cell.column] ? 'TEXT_AVAILABLE' : 'NO_TEXT_ITEMS',
            inlineContent: [{ text: table.rows[row][cell.column] ?? '', sourceRefIds: [ref] }],
          })),
        })) }] });
    } else if (unit.value?.kind === 'list') {
      sourceUnit.kind = 'list';
      sourceUnit.payload.itemUnitIds = unit.value.items.map((_text, index) => `${unitId}:item${index}`);
      unit.value.items.forEach((text, index) => children.push({ ...sourceUnit, unitId: `${unitId}:item${index}`,
        kind: 'list_item', parentUnitId: unitId, depth: 1, payload: { text },
        mapping: { ...mapping, itemIndex: index } }));
    }
    for (const entry of [sourceUnit, ...children]) {
      entry.order = original.source.units.length;
      original.source.units.push(entry);
    }
    if (hasReadableText(unit)) readPages.add(block.pageIndex);
    const issues = [...unit.issues, ...document.diagnostics.filter(issue => issue.blockId === block.id).map(issue => issue.code)];
    if (['image', 'chart'].includes(block.type) && !issues.includes('VISUAL_TEXT_NOT_VERIFIED'))
      issues.push('VISUAL_TEXT_NOT_VERIFIED');
    if (!unit.value && !issues.length) issues.push('MINERU_STRUCTURE_UNAVAILABLE');
    for (const code of new Set(issues)) {
      if (code === 'NAVIGATION_ONLY') continue;
      const visual = code.includes('VISUAL_TEXT');
      original.coverage.unresolvedRanges.push({ pageIndexes: [block.pageIndex], unitIds: [unitId],
        reason: visual ? 'FIGURE_UNINTERPRETED' : 'STRUCTURE_UNCERTAIN', readingImpact: 'LIMITATION',
        message: visual ? 'MinerU 保留图示及已识别文字；图内信息尚未完整解释或核验。'
          : `MinerU 结构或定位尚需核验（${code}）；原始块内容和页位置已保留。` });
    }
  }
  original.coverage.readPageIndexes = [...readPages].sort((a, b) => a - b);
  for (const page of document.pages) if (!readPages.has(page.pageIndex)) {
    original.coverage.unresolvedRanges.push({ pageIndexes: [page.pageIndex], unitIds: [], reason: 'UNREAD',
      readingImpact: 'LIMITATION', message: '本页未获得可用正文或 OCR 文字；不能据此判定为空白页，请查看原件。' });
  }
  documentOriginalStructuredSource(original, binding);
  return original;
}

function hasReadableText(unit: MineruTranslationUnit): boolean {
  if (!unit.value) return false;
  if (unit.value.kind === 'text') return Boolean(unit.value.text.trim());
  if (unit.value.kind === 'list') return unit.value.items.some(text => text.trim());
  return unit.value.rows.some(row => row.some(text => text?.trim()));
}
