import { readMineruArtifacts } from '../../../server/modules/professional-input/mineru/mineru-artifacts';
import {
  buildMineruTranslationPlan,
  buildMineruTranslationBatches,
  validateMineruTranslationOutput,
} from '../../../server/modules/professional-input/mineru/mineru-translation';
import { readMineruTranslationTable } from '../../../server/modules/professional-input/mineru/mineru-table';
const text = (content: string) => [{ type: 'text', content }];
const block = (type: string, content: Record<string, unknown>) => ({
  type,
  content,
  bbox: [10, 10, 900, 100],
});
function document() {
  const middle = {
    _version_name: '3.4.5',
    _backend: 'pipeline',
    pdf_info: [0, 1].map((page_idx) => ({ page_idx, page_size: [1000, 1000] })),
  };
  return readMineruArtifacts({
    markdown: '# Scope\n\nFixture reading.',
    middle,
    assetPaths: ['images/diagram.png'],
    contentListV2: [
      [
        block('title', { level: 1, title_content: text('Scope') }),
        block('paragraph', {
          paragraph_content: text('WARNING: Do not operate above 10 °C.'),
        }),
        block('paragraph', {
          paragraph_content: text('Exception: use the alternate procedure.'),
        }),
        block('page_header', { page_header_content: text('REPEATED HEADER') }),
        block('page_footer', { page_footer_content: text('REPEATED FOOTER') }),
        block('page_number', { page_number_content: text('1') }),
        block('list', {
          list_items: [
            { item_content: text('Remove the cover.') },
            { item_content: text('Keep AB-123 in place.') },
          ],
        }),
        block('table', {
          html: '<table><tr><th colspan="2">Limits</th></tr><tr><td>Maximum load</td><td>500</td></tr></table>',
          table_caption: text('Operating limits'),
          table_footnote: text('Exception: only for model 787-8.'),
        }),
        block('page_footnote', {
          page_footnote_content: text('Do not use below freezing.'),
        }),
      ],
      [
        block('title', { level: 2, title_content: text('Applicability') }),
        block('paragraph', { paragraph_content: text('AB-123') }),
        block('equation_interline', { math_content: 'x = 10' }),
        block('image', {
          image_source: { path: 'images/diagram.png' },
          image_caption: [],
          image_footnote: [],
        }),
      ],
    ],
  });
}
const identity = { documentVersionId: 'version', parseRunId: 'run' };
const budgets = {
  maxInputCharacters: 30000,
  maxOutputCharacters: 30000,
  expectedOutputRatio: 2,
};
function responseFor(
  batch: ReturnType<typeof buildMineruTranslationBatches>['batches'][number],
) {
  return {
    units: batch.input.units
      .map(({ kind, ...unit }) => structuredClone(unit))
      .reverse(),
  };
}

describe('MinerU translation input and Host alignment', () => {
  it('keeps valuable paragraphs/list/table/notes together across pages without sending layout or source IDs', () => {
    const plan = buildMineruTranslationPlan(document(), identity);
    expect(plan.units).toHaveLength(10);
    expect(plan.units.map((unit) => unit.value)).not.toContainEqual({
      kind: 'text',
      text: 'REPEATED HEADER',
    });
    const { batches, oversizedUnitKeys } = buildMineruTranslationBatches(
      plan,
      budgets,
    );
    expect(batches).toHaveLength(1);
    expect(oversizedUnitKeys).toEqual([]);
    expect(batches[0].input.units).toHaveLength(7);
    const sent = JSON.stringify(batches[0].input);
    expect(sent).toContain('WARNING: Do not operate above 10');
    expect(sent).toContain('Exception: only for model 787-8.');
    expect(sent).toContain('Do not use below freezing.');
    for (const forbidden of [
      'bbox',
      'pageIndex',
      'sourcePointer',
      'sourceArtifactId',
      'page-1-block',
      'images/',
      'REPEATED',
      'colSpan',
      'rowSpan',
    ])
      expect(sent).not.toContain(forbidden);
    expect(plan.units.find((unit) => unit.key === 'page-2-block-2')?.mode).toBe(
      'COPY',
    );
    expect(plan.units.find((unit) => unit.key === 'page-2-block-3')?.mode).toBe(
      'COPY',
    );
    expect(plan.units.find((unit) => unit.key === 'page-2-block-4')?.mode).toBe(
      'NEEDS_REVIEW',
    );
    expect(
      plan.units.find((unit) => unit.value?.kind === 'table')?.tableCells?.[0],
    ).toMatchObject({ row: 0, column: 0, colSpan: 2 });
  });
  it('aligns a reordered response by short ID, and rejects missing/duplicate IDs instead of shifting later paragraphs', () => {
    const { batches } = buildMineruTranslationBatches(
      buildMineruTranslationPlan(document(), identity),
      budgets,
    );
    const batch = batches[0];
    const response = responseFor(batch);
    const translated = validateMineruTranslationOutput(batch, response);
    expect(translated.map((value) => value.unitKey)).toEqual(
      batch.alignment.map((value) => value.unitKey),
    );
    expect(translated[1].value).toMatchObject({
      text: 'WARNING: Do not operate above 10 °C.',
    });
    const duplicate = structuredClone(response);
    duplicate.units[0].id = duplicate.units[1].id;
    expect(() => validateMineruTranslationOutput(batch, duplicate)).toThrow(
      'IDS_INVALID',
    );
    expect(() =>
      validateMineruTranslationOutput(batch, {
        units: response.units.slice(1),
      }),
    ).toThrow('OUTPUT_INVALID');
  });
  it('keeps table geometry and numeric values Host-controlled', () => {
    const batch = buildMineruTranslationBatches(
      buildMineruTranslationPlan(document(), identity),
      budgets,
    ).batches[0];
    const response = responseFor(batch);
    const table = response.units.find((unit) => 'rows' in unit)!;
    if (!('rows' in table)) throw new Error('FIXTURE_TABLE_REQUIRED');
    table.rows[0][0] = '限制';
    table.rows[1][0] = '最大载荷';
    const accepted = validateMineruTranslationOutput(batch, response);
    expect(
      accepted.find((unit) => unit.value.kind === 'table')?.value,
    ).toMatchObject({
      rows: [
        ['限制', null],
        ['最大载荷', '500'],
      ],
    });
    table.rows[0][1] = 'unexpected';
    expect(() => validateMineruTranslationOutput(batch, response)).toThrow(
      'TABLE_MERGE_CHANGED',
    );
    table.rows[0][1] = null;
    table.rows[1][1] = '501';
    expect(() => validateMineruTranslationOutput(batch, response)).toThrow(
      'PRESERVED_VALUE_CHANGED',
    );
    const altered = responseFor(batch);
    const warning = altered.units.find(
      (unit) => 'text' in unit && unit.text.includes('WARNING'),
    )!;
    if (!('text' in warning)) throw new Error('FIXTURE_WARNING_REQUIRED');
    warning.text = '警告：不得在 11 °C 以上运行。';
    expect(() => validateMineruTranslationOutput(batch, altered)).toThrow(
      'LITERAL_CHANGED',
    );
  });
  it('packs small chapters together and splits only when the output budget requires it', () => {
    const plan = buildMineruTranslationPlan(document(), identity);
    const first = plan.units.find((unit) => unit.mode === 'TRANSLATE')!;
    plan.units = ['Scope', 'Applicability', 'Procedure'].map((heading, index) => ({
      ...first,
      key: `unit-${index}`,
      chapterKey: `chapter-${index}`,
      headingPath: [heading],
      value: { kind: 'text' as const, text: 'Translate this complete paragraph.' },
    }));
    const merged = buildMineruTranslationBatches(plan, budgets);
    expect(merged.batches).toHaveLength(1);
    expect(merged.batches[0].input.context?.chapter).toBe('Scope / Applicability / Procedure');
    expect(merged.batches[0].alignment.map((entry) => entry.unitKey)).toEqual(['unit-0', 'unit-1', 'unit-2']);
    const limited = buildMineruTranslationBatches(plan, {
      ...budgets,
      maxOutputCharacters: 150,
    });
    expect(limited.batches).toHaveLength(3);
    expect(limited.oversizedUnitKeys).toEqual([]);
  });
  it('reports oversized atomic units instead of chopping paragraphs to satisfy a small model budget', () => {
    const doc = document();
    doc.blocks[1].content.paragraph_content = text(
      'Long source condition. '.repeat(300),
    );
    const plan = buildMineruTranslationPlan(doc, identity);
    const output = buildMineruTranslationBatches(plan, {
      maxInputCharacters: 800,
      maxOutputCharacters: 1600,
      expectedOutputRatio: 2,
    });
    expect(output.oversizedUnitKeys).toContain(doc.blocks[1].id);
    expect(
      output.batches.every(
        (batch) => JSON.stringify(batch.input).length <= 800,
      ),
    ).toBe(true);
    expect(
      output.batches
        .flatMap((batch) => batch.alignment)
        .some((item) => item.unitKey === doc.blocks[1].id),
    ).toBe(false);
    expect(plan.units[1].value).toEqual({
      kind: 'text',
      text: 'Long source condition. '.repeat(300).trim(),
    });
  });
  it('does not label unsupported nested tables as translated or silently convert them to empty text', () => {
    const doc = document();
    const table = doc.blocks.find((block) => block.type === 'table')!;
    table.content.html =
      '<table><tr><td>Outer<table><tr><td>Nested condition</td></tr></table></td></tr></table>';
    const plan = buildMineruTranslationPlan(doc, identity);
    const unit = plan.units.find((unit) => unit.key === table.id)!;
    expect(unit.mode).toBe('NEEDS_REVIEW');
    expect(unit.issues).toContain('MINERU_TABLE_NESTING_UNSUPPORTED');
    expect(
      buildMineruTranslationBatches(plan, budgets)
        .batches.flatMap((batch) => batch.alignment)
        .some((item) => item.unitKey === unit.key),
    ).toBe(false);
  });
  it('parses entities and rowspan as inert data without passing HTML attributes or scripts into model text', () => {
    const table = readMineruTranslationTable(
      '<table onclick="bad()"><tr><td rowspan="2">A &amp; B<script>bad()</script></td><td>First</td></tr><tr><td><img src="https://tracker"/>Second</td></tr></table>',
    );
    expect(table.rows).toEqual([
      ['A & B', 'First'],
      [null, 'Second'],
    ]);
    expect(table.needsVisualReview).toBe(true);
    expect(() =>
      readMineruTranslationTable(
        '<table><tr><td rowspan="0">Invalid</td></tr></table>',
      ),
    ).toThrow('SPAN_INVALID');
  });
});
