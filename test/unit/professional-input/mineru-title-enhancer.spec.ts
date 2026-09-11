import { readMineruArtifacts } from '../../../server/modules/professional-input/mineru/mineru-artifacts';
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
  it.each([
    [
      { id: 'page-1-block-1', level: 1 },
      { id: 'page-1-block-1', level: 2 },
    ],
    [
      { id: 'page-1-block-1', level: 1 },
      { id: 'page-1-block-2', level: 3 },
    ],
    [
      { id: 'page-1-block-1', level: 2 },
      { id: 'page-1-block-2', level: 2 },
    ],
  ])(
    'reports invalid model levels without claiming enhancement',
    async (first, second) => {
      const bundle = fixture();
      const result = await enhanceMineruTitles(bundle, async () => ({
        levels: [first, second],
      }));
      expect(result.titleEnhancement).toEqual({
        status: 'FAILED',
        code: 'TITLE_OUTPUT_INVALID',
      });
      expect(result.document).toBe(bundle.document);
    },
  );
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
