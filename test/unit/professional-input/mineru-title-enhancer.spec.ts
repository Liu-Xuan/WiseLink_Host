import { readMineruArtifacts } from '../../../server/modules/professional-input/mineru/mineru-artifacts';
import { buildMineruTranslationPlan } from '../../../server/modules/professional-input/mineru/mineru-translation';
import { enhanceMineruTitles } from '../../../server/modules/professional-input/mineru/mineru-title-enhancer';

function fixture() {
  const middle = {
    _backend: 'pipeline',
    _version_name: '3.4.5',
    pdf_info: [
      {
        page_idx: 0,
        page_size: [1000, 1000],
        para_blocks: [
          { type: 'title', bbox: [10, 10, 500, 30], level: 1 },
          { type: 'title', bbox: [10, 100, 500, 120], level: 1 },
        ],
      },
    ],
  };
  const contentListV2 = [
    [
      {
        type: 'title',
        bbox: [10, 10, 500, 30],
        content: {
          level: 1,
          title_content: [{ type: 'text', content: 'Scope' }],
        },
      },
      {
        type: 'title',
        bbox: [10, 100, 500, 120],
        content: {
          level: 1,
          title_content: [{ type: 'text', content: 'Limitations' }],
        },
      },
    ],
  ];
  const markdown =
    '# Scope\n\nSource paragraph.\n\n```text\n# not a title\n```\n\n# Limitations\n\nKeep this unchanged.\n';
  return {
    middle,
    contentListV2,
    assets: [],
    document: readMineruArtifacts({
      markdown,
      middle,
      contentListV2,
      assetPaths: [],
    }),
  };
}

describe('MinerU title enhancement (isolated model responses)', () => {
  it('updates MD, middle and v2 together without altering body text or input artifacts', async () => {
    const bundle = fixture();
    const before = structuredClone(bundle);
    const call = jest.fn(async () => ({
      levels: [
        { id: 'page-1-block-1', level: 1 },
        { id: 'page-1-block-2', level: 2 },
      ],
    }));
    const result = await enhanceMineruTitles(bundle, call);
    expect(result.titleEnhancement).toEqual({ status: 'APPLIED' });
    expect(result.document.markdown).toBe(
      bundle.document.markdown.replace('# Limitations', '## Limitations'),
    );
    expect(result.document.blocks.map((b) => b.headingLevel)).toEqual([1, 2]);
    expect(
      (result.middle as typeof bundle.middle).pdf_info[0].para_blocks[1].level,
    ).toBe(2);
    expect(bundle).toEqual(before);
    expect(JSON.stringify(call.mock.calls)).not.toContain('Source paragraph');
  });
  it.each([[2, 2], [2, 4], [5, 6]])(
    'preserves supported levels %s and %s across all views',
    async (first, second) => {
      const bundle = fixture();
      const before = structuredClone(bundle);
      const levels = [first, second];
      const result = await enhanceMineruTitles(bundle, async () => ({
        levels: levels.map((level, index) => ({ id: bundle.document.blocks[index].id, level })),
      }));
      expect(result.titleEnhancement).toEqual({ status: 'APPLIED' });
      expect(result.document.blocks.map(block => block.headingLevel)).toEqual(levels);
      expect((result.middle as typeof bundle.middle).pdf_info[0].para_blocks.map(block => block.level)).toEqual(levels);
      expect((result.contentListV2 as typeof bundle.contentListV2)[0].map(block => block.content.level)).toEqual(levels);
      expect(result.document.markdown).toBe(bundle.document.markdown
        .replace('# Scope', '#'.repeat(first) + ' Scope')
        .replace('# Limitations', '#'.repeat(second) + ' Limitations'));
      expect(bundle).toEqual(before);
    },
  );
  it.each([0, 7, 1.5, '2', null])('rejects unsupported level %s', async level => {
    const bundle = fixture();
    const result = await enhanceMineruTitles(bundle, async () => ({ levels: [
      { id: 'page-1-block-1', level }, { id: 'page-1-block-2', level: 2 },
    ] }));
    expect(result.titleEnhancement).toEqual({ status: 'FAILED', code: 'TITLE_OUTPUT_INVALID' });
    expect(result.document).toBe(bundle.document);
  });
  it.each([
    { levels: [{ id: 'page-1-block-1', level: 1 }, { id: 'page-1-block-1', level: 2 }] },
    { levels: [{ id: 'page-1-block-2', level: 1 }, { id: 'page-1-block-1', level: 2 }] },
    { levels: [{ id: 'page-1-block-1', level: 1 }] },
    { levels: [{ id: 'page-1-block-1', level: 1, text: 'replacement' }, { id: 'page-1-block-2', level: 2 }] },
    { levels: [{ id: 'page-1-block-1', level: 1 }, { id: 'page-1-block-2', level: 2 }], text: 'replacement' },
  ])('retains exact identity, order, count and field validation', async output => {
    const bundle = fixture();
    const result = await enhanceMineruTitles(bundle, async () => output);
    expect(result.titleEnhancement).toEqual({ status: 'FAILED', code: 'TITLE_OUTPUT_INVALID' });
    expect(result.document).toBe(bundle.document);
  });
  it('uses sparse heading levels in the real translation ancestor stack', async () => {
    const bundle = fixture();
    const names = ['Scope', 'Detail', 'Sibling detail', 'Next scope'];
    const levels = [2, 4, 3, 2];
    bundle.middle.pdf_info[0].para_blocks = names.map((_name, index) => ({
      type: 'title', bbox: [10, 10 + index * 100, 500, 30 + index * 100], level: 1,
    }));
    bundle.contentListV2[0] = names.map((name, index) => ({
      type: 'title', bbox: bundle.middle.pdf_info[0].para_blocks[index].bbox,
      content: { level: 1, title_content: [{ type: 'text', content: name }] },
    }));
    bundle.document = readMineruArtifacts({ middle: bundle.middle, contentListV2: bundle.contentListV2,
      markdown: names.map(name => '# ' + name).join('\n\n'), assetPaths: [] });
    const result = await enhanceMineruTitles(bundle, async () => ({
      levels: levels.map((level, index) => ({ id: bundle.document.blocks[index].id, level })),
    }));
    expect(result.titleEnhancement).toEqual({ status: 'APPLIED' });
    const plan = buildMineruTranslationPlan(result.document, { documentVersionId: 'fixture-dv', parseRunId: 'fixture-run' });
    expect(plan.units.map(unit => unit.headingPath)).toEqual([
      ['Scope'], ['Scope', 'Detail'], ['Scope', 'Sibling detail'], ['Next scope'],
    ]);
    expect(plan.units.map(unit => unit.chapterKey)).toEqual([
      'page-1-block-1', 'page-1-block-1', 'page-1-block-1', 'page-1-block-4',
    ]);
  });
  it('does not invoke a model when artifact titles disagree', async () => {
    const bundle = fixture();
    bundle.document.markdown = bundle.document.markdown.replace(
      '# Scope',
      '# Other',
    );
    const call = jest.fn();
    expect((await enhanceMineruTitles(bundle, call)).titleEnhancement).toEqual({
      status: 'FAILED',
      code: 'TITLE_SOURCE_MISMATCH',
    });
    expect(call).not.toHaveBeenCalled();
  });
  it('keeps a visible failure status for a model error', async () => {
    const result = await enhanceMineruTitles(fixture(), async () => {
      throw new Error('fixture outage');
    });
    expect(result.titleEnhancement).toEqual({
      status: 'FAILED',
      code: 'TITLE_MODEL_FAILED',
    });
  });
});
