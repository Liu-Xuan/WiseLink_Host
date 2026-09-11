import type {
  MineruDocumentArtifacts,
  MineruReadingBlock,
} from './mineru-artifacts';
import {
  plainMineruHtml,
  readMineruTranslationTable,
  type MineruTableCell,
} from './mineru-table';

export type MineruTranslationValue =
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: string[] }
  | {
      kind: 'table';
      rows: Array<Array<string | null>>;
      caption?: string;
      notes?: string;
    };
export interface MineruTranslationUnit {
  key: string;
  chapterKey: string;
  headingPath: string[];
  source: Pick<
    MineruReadingBlock,
    'pageIndex' | 'bbox' | 'sourcePointer' | 'assetPath'
  >;
  value: MineruTranslationValue | null;
  mode: 'TRANSLATE' | 'COPY' | 'NEEDS_REVIEW';
  issues: string[];
  /** Host layout only. Never part of the model input or output contract. */
  tableCells?: MineruTableCell[];
}
export interface MineruTranslationPlan {
  documentVersionId: string;
  parseRunId: string;
  units: MineruTranslationUnit[];
}
export interface MineruTranslationModelInput {
  context?: { documentTitle?: string; chapter?: string; terminology?: string };
  units: Array<MineruTranslationValue & { id: number }>;
}
export interface MineruTranslationBatch {
  index: number;
  input: MineruTranslationModelInput;
  /** Host-only binding; response order is not trusted. */
  alignment: Array<{ id: number; unitKey: string }>;
  maxOutputCharacters: number;
}

/** New MinerU semantic input. No legacy font/line units or source metadata are sent to the LLM. */
export function buildMineruTranslationPlan(
  document: MineruDocumentArtifacts,
  identity: {
    documentVersionId: string;
    parseRunId: string;
  },
): MineruTranslationPlan {
  if (!identity.documentVersionId || !identity.parseRunId)
    throw new Error('MINERU_TRANSLATION_IDENTITY_REQUIRED');
  const blocks = [...document.blocks, ...document.discardedBlocks]
    .filter(
      (block) =>
        !['page_header', 'page_footer', 'page_number'].includes(block.type),
    )
    .sort(
      (a, b) => a.pageIndex - b.pageIndex || pointerIndex(a) - pointerIndex(b),
    );
  const headings: Array<{ level: number; text: string; key: string }> = [];
  const units: MineruTranslationUnit[] = [];
  const keys = new Set<string>();
  for (const block of blocks) {
    if (keys.has(block.id))
      throw new Error('MINERU_TRANSLATION_DUPLICATE_BLOCK');
    keys.add(block.id);
    const unit: MineruTranslationUnit = {
      key: block.id,
      chapterKey: headings[0]?.key ?? 'preamble',
      headingPath: headings.map((h) => h.text),
      source: {
        pageIndex: block.pageIndex,
        bbox: block.bbox,
        sourcePointer: block.sourcePointer,
        assetPath: block.assetPath,
      },
      value: null,
      mode: 'NEEDS_REVIEW',
      issues: [],
    };
    try {
      const content = block.content;
      if (block.type === 'title') {
        const text = spans(content.title_content);
        if (!text.trim() || !block.headingLevel)
          throw new Error('MINERU_TITLE_CONTENT_INVALID');
        while (headings.length && headings.at(-1)!.level >= block.headingLevel)
          headings.pop();
        headings.push({ level: block.headingLevel, text, key: block.id });
        unit.chapterKey = headings[0].key;
        unit.headingPath = headings.map((h) => h.text);
        unit.value = { kind: 'text', text };
      } else if (
        ['paragraph', 'page_footnote', 'page_aside_text'].includes(block.type)
      ) {
        unit.value = {
          kind: 'text',
          text: spans(content[`${block.type}_content`]),
        };
      } else if (block.type === 'list' || block.type === 'index') {
        if (!Array.isArray(content.list_items))
          throw new Error('MINERU_LIST_CONTENT_INVALID');
        unit.value = {
          kind: 'list',
          items: content.list_items.map((item) =>
            spans(record(item).item_content),
          ),
        };
      } else if (block.type === 'table') {
        if (typeof content.html !== 'string')
          throw new Error('MINERU_TABLE_HTML_INVALID');
        const table = readMineruTranslationTable(content.html);
        const caption = optionalSpans(content.table_caption);
        const notes = optionalSpans(content.table_footnote);
        unit.value = {
          kind: 'table',
          rows: table.rows,
          ...(caption ? { caption } : {}),
          ...(notes ? { notes } : {}),
        };
        unit.tableCells = table.cells;
        if (table.needsVisualReview)
          unit.issues.push('EMBEDDED_VISUAL_TEXT_NOT_VERIFIED');
        // The real FTD complex metadata table merged adjacent labels/values.
        // Preserve the candidate and its original image; valid HTML does not
        // establish that merged cells match the source document.
        if (content.table_type === 'complex_table' &&
            table.cells.some(cell => cell.colSpan > 1 || cell.rowSpan > 1))
          unit.issues.push('TABLE_LAYOUT_NOT_VERIFIED');
      } else if (['image', 'chart'].includes(block.type)) {
        const visual = content.content;
        if (visual !== undefined && typeof visual !== 'string')
          throw new Error('MINERU_VISUAL_TEXT_UNSUPPORTED');
        const text = [
          optionalSpans(content[`${block.type}_caption`]),
          visual ? plainMineruHtml(visual as string) : '',
          optionalSpans(content[`${block.type}_footnote`]),
        ]
          .filter(Boolean)
          .join('\n\n');
        unit.value = { kind: 'text', text };
        // A caption does not establish that text inside the raster has been covered.
        unit.issues.push('VISUAL_TEXT_NOT_VERIFIED');
      } else if (block.type === 'equation_interline') {
        if (typeof content.math_content !== 'string')
          throw new Error('MINERU_EQUATION_CONTENT_INVALID');
        unit.value = { kind: 'text', text: content.math_content };
        unit.mode = 'COPY';
      } else if (block.type === 'code') {
        const text = [
          optionalSpans(content.code_caption),
          optionalSpans(content.code_footnote),
        ]
          .filter(Boolean)
          .join('\n\n');
        unit.value = { kind: 'text', text };
        unit.issues.push('CODE_BODY_PRESERVED');
      } else if (block.type === 'algorithm') {
        const text = [
          optionalSpans(content.algorithm_caption),
          spans(content.algorithm_content),
          optionalSpans(content.algorithm_footnote),
        ]
          .filter(Boolean)
          .join('\n\n');
        unit.value = { kind: 'text', text };
      } else throw new Error('MINERU_TRANSLATION_BLOCK_UNSUPPORTED');
      if (unit.mode !== 'COPY')
        unit.mode = valueTexts(unit.value).some(needsTranslation)
          ? 'TRANSLATE'
          : 'COPY';
      if (
        unit.issues.includes('VISUAL_TEXT_NOT_VERIFIED') &&
        !valueTexts(unit.value).some((text) => text.trim())
      )
        unit.mode = 'NEEDS_REVIEW';
      if (block.type === 'index') {
        unit.mode = 'COPY';
        unit.issues.push('NAVIGATION_ONLY');
      }
    } catch (cause) {
      unit.mode = 'NEEDS_REVIEW';
      unit.value = null;
      unit.issues.push(
        cause instanceof Error
          ? cause.message
          : 'MINERU_TRANSLATION_SOURCE_INVALID',
      );
    }
    units.push(unit);
  }
  return { ...identity, units };
}

/** Caller supplies character budgets derived from its actual model's input/output limits. */
export function buildMineruTranslationBatches(
  plan: MineruTranslationPlan,
  options: {
    maxInputCharacters: number;
    maxOutputCharacters: number;
    expectedOutputRatio: number;
    context?: MineruTranslationModelInput['context'];
  },
): { batches: MineruTranslationBatch[]; oversizedUnitKeys: string[] } {
  if (
    ![options.maxInputCharacters, options.maxOutputCharacters].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    !Number.isFinite(options.expectedOutputRatio) ||
    options.expectedOutputRatio <= 0
  )
    throw new Error('MINERU_TRANSLATION_BUDGET_INVALID');
  const batches: MineruTranslationBatch[] = [];
  const oversizedUnitKeys: string[] = [];
  let current: MineruTranslationUnit[] = [];
  const inputFor = (
    units: MineruTranslationUnit[],
  ): MineruTranslationModelInput => {
    const context = {
      ...options.context,
      chapter:
        [...new Set(units.map((unit) => unit.headingPath[0]).filter(Boolean))]
          .join(' / ') || options.context?.chapter,
    };
    return {
      ...(Object.values(context).some(Boolean) ? { context } : {}),
      units: units.map((unit, index) => ({
        id: index + 1,
        ...structuredClone(unit.value!),
      })),
    };
  };
  const fits = (units: MineruTranslationUnit[]) =>
    JSON.stringify(inputFor(units)).length <= options.maxInputCharacters &&
    Math.ceil(
      JSON.stringify({
        units: units.map((unit, index) => ({
          id: index + 1,
          ...withoutKind(unit.value!),
        })),
      }).length * options.expectedOutputRatio,
    ) <= options.maxOutputCharacters;
  const flush = () => {
    if (!current.length) return;
    batches.push({
      index: batches.length,
      input: inputFor(current),
      alignment: current.map((unit, index) => ({
        id: index + 1,
        unitKey: unit.key,
      })),
      maxOutputCharacters: options.maxOutputCharacters,
    });
    current = [];
  };
  for (const unit of plan.units) {
    if (unit.mode !== 'TRANSLATE' || !unit.value) continue;
    if (
      current.length &&
      !fits([...current, unit])
    )
      flush();
    if (!fits([unit])) {
      flush();
      oversizedUnitKeys.push(unit.key);
      continue;
    }
    current.push(unit);
  }
  flush();
  return { batches, oversizedUnitKeys };
}

/** Validates structure/identity and immutable numeric/math values; semantic review remains Host's job. */
export function validateMineruTranslationOutput(
  batch: MineruTranslationBatch,
  response: unknown,
): Array<{ unitKey: string; value: MineruTranslationValue }> {
  const result = record(response);
  if (
    Object.keys(result).length !== 1 ||
    !Array.isArray(result.units) ||
    result.units.length !== batch.alignment.length ||
    JSON.stringify(response).length > batch.maxOutputCharacters
  )
    throw new Error('MINERU_TRANSLATION_OUTPUT_INVALID');
  const byId = new Map<number, Record<string, unknown>>();
  for (const raw of result.units) {
    const item = record(raw);
    const id = item.id;
    if (
      typeof id !== 'number' ||
      !Number.isSafeInteger(id) ||
      byId.has(id) ||
      !batch.alignment.some((a) => a.id === id)
    )
      throw new Error('MINERU_TRANSLATION_OUTPUT_IDS_INVALID');
    byId.set(id, item);
  }
  return batch.alignment.map((alignment) => {
    const original = batch.input.units.find((item) => item.id === alignment.id);
    const item = byId.get(alignment.id);
    if (!original || !item)
      throw new Error('MINERU_TRANSLATION_OUTPUT_IDS_INVALID');
    const expectedKeys = Object.keys(original)
      .filter((key) => key !== 'kind')
      .sort();
    if (
      JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(expectedKeys)
    )
      throw new Error('MINERU_TRANSLATION_OUTPUT_FIELDS_INVALID');
    let value: MineruTranslationValue;
    if (original.kind === 'text')
      value = { kind: 'text', text: translatedText(original.text, item.text) };
    else if (original.kind === 'list') {
      if (
        !Array.isArray(item.items) ||
        item.items.length !== original.items.length
      )
        throw new Error('MINERU_TRANSLATION_LIST_SHAPE_CHANGED');
      value = {
        kind: 'list',
        items: original.items.map((source, i) =>
          translatedText(source, (item.items as unknown[])[i]),
        ),
      };
    } else {
      if (
        !Array.isArray(item.rows) ||
        item.rows.length !== original.rows.length
      )
        throw new Error('MINERU_TRANSLATION_TABLE_SHAPE_CHANGED');
      const rows = original.rows.map((row, r) => {
        const translated = (item.rows as unknown[])[r];
        if (!Array.isArray(translated) || translated.length !== row.length)
          throw new Error('MINERU_TRANSLATION_TABLE_SHAPE_CHANGED');
        return row.map((cell, c) => {
          if (cell === null) {
            if (translated[c] !== null)
              throw new Error('MINERU_TRANSLATION_TABLE_MERGE_CHANGED');
            return null;
          }
          return translatedText(cell, translated[c]);
        });
      });
      value = {
        kind: 'table',
        rows,
        ...(original.caption !== undefined
          ? { caption: translatedText(original.caption, item.caption) }
          : {}),
        ...(original.notes !== undefined
          ? { notes: translatedText(original.notes, item.notes) }
          : {}),
      };
    }
    return { unitKey: alignment.unitKey, value };
  });
}

export function mineruBlockText(block: MineruReadingBlock): string {
  const field =
    block.type === 'title' ? 'title_content' : `${block.type}_content`;
  return spans(block.content[field]);
}
function spans(value: unknown): string {
  if (!Array.isArray(value)) throw new Error('MINERU_TEXT_SPANS_INVALID');
  return value
    .map((raw) => {
      const span = record(raw);
      if (typeof span.content !== 'string')
        throw new Error('MINERU_TEXT_SPAN_INVALID');
      if (span.type === 'equation_inline') return `$${span.content}$`;
      if (span.type === 'text' || span.type === 'phonetic') return span.content;
      throw new Error('MINERU_TEXT_SPAN_UNSUPPORTED');
    })
    .join('')
    .trim();
}
function optionalSpans(value: unknown): string {
  return value === undefined ? '' : spans(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('MINERU_TRANSLATION_OBJECT_INVALID');
  return value as Record<string, unknown>;
}
function pointerIndex(block: MineruReadingBlock): number {
  const match = block.sourcePointer.match(/^\/(\d+)\/(\d+)$/);
  if (!match || Number(match[1]) !== block.pageIndex)
    throw new Error('MINERU_TRANSLATION_SOURCE_POINTER_INVALID');
  return Number(match[2]);
}
function valueTexts(value: MineruTranslationValue): string[] {
  if (value.kind === 'text') return [value.text];
  if (value.kind === 'list') return value.items;
  return [
    ...value.rows.flat().filter((cell): cell is string => cell !== null),
    value.caption ?? '',
    value.notes ?? '',
  ];
}
function needsTranslation(text: string): boolean {
  if (!/\p{L}/u.test(text)) return false;
  // Preserve isolated part numbers/codes; do not filter full warnings or numeric conditions.
  return !(/^[A-Z0-9_.\/-]+$/.test(text.trim()) && /\d/.test(text));
}
function withoutKind(value: MineruTranslationValue) {
  const { kind, ...fields } = value;
  return fields;
}
function translatedText(source: string, target: unknown): string {
  if (typeof target !== 'string' || (source.trim() && !target.trim()))
    throw new Error('MINERU_TRANSLATION_TEXT_EMPTY');
  if (!needsTranslation(source) && target !== source)
    throw new Error('MINERU_TRANSLATION_PRESERVED_VALUE_CHANGED');
  const literals = (text: string) =>
    [
      ...(text.match(/\$[^$]+\$/g) ?? []),
      ...(text
        .replace(/\$[^$]+\$/g, '')
        .match(/[+-]?\d+(?:[.,]\d+)*(?:%|°)?/g) ?? []),
      ...(text.match(
        /\b(?=[A-Z0-9._/-]*[A-Z])(?=[A-Z0-9._/-]*\d)[A-Z0-9]+(?:[._/-][A-Z0-9]+)*\b/g,
      ) ?? []),
    ].sort();
  if (JSON.stringify(literals(source)) !== JSON.stringify(literals(target)))
    throw new Error('MINERU_TRANSLATION_LITERAL_CHANGED');
  return target;
}
