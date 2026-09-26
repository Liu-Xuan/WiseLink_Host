import {
  readMineruArtifacts,
  safeMineruAssetPath,
} from '../../../server/modules/professional-input/mineru/mineru-artifacts';

// Isolated fixture using the published 3.4.5 pipeline v2 output shape.
const fixture = () => ({
  markdown:
    '# Scope\n\nFirst paragraph.\n\nSecond paragraph.\n\n![Figure](images/figure.jpg)\n',
  middle: {
    _version_name: '3.4.5',
    _backend: 'pipeline',
    pdf_info: [
      {
        page_idx: 0,
        page_size: [612, 792],
        para_blocks: [],
        discarded_blocks: [],
      },
    ],
  },
  contentListV2: [
    [
      {
        type: 'title',
        bbox: [10, 10, 900, 50],
        content: {
          level: 1,
          title_content: [{ type: 'text', content: 'Scope' }],
        },
      },
      {
        type: 'paragraph',
        bbox: [10, 60, 900, 90],
        content: {
          paragraph_content: [{ type: 'text', content: 'First paragraph.' }],
        },
      },
      {
        type: 'paragraph',
        bbox: [10, 95, 900, 130],
        content: {
          paragraph_content: [{ type: 'text', content: 'Second paragraph.' }],
        },
      },
      {
        type: 'image',
        bbox: [10, 140, 900, 800],
        content: {
          image_source: { path: 'images/figure.jpg' },
          image_caption: [],
        },
      },
      {
        type: 'page_number',
        bbox: [450, 950, 550, 990],
        content: { page_number_content: [{ type: 'text', content: '1' }] },
      },
    ],
  ],
  assetPaths: ['images/figure.jpg'],
});

describe('MinerU artifact reading', () => {
  it('removes observed FTD furniture misclassifications from reading while keeping original input and operational notes', () => {
    const block = (type: string, text: string, y: number) => ({ type, bbox: [50, y, 940, y + 20],
      content: { [`${type}_content`]: [{ type: 'text', content: text }], ...(type === 'title' ? { level: 1 } : {}) } });
    const notice = 'BOEING PROPRIETARY - The information contained herein is Proprietary to The Boeing Company.';
    const copyright = 'Copyright © 2025 Boeing. All rights reserved.';
    const note = 'Note: Only requesting single system configuration uplinks will impact report generation.';
    const warning = 'WARNING: Do not apply below freezing.';
    const markdown = `FLEET TEAM DIGEST\n<table><tr><td>787</td></tr></table>\n\n${notice}\n\n${copyright}\n\n# FLEET TEAM DIGEST\n\n# Interim Action\n\n${note}\n\n${warning}\n\n${notice}\n`;
    const input = { markdown, assetPaths: [], middle: { _version_name: '3.4.5', _backend: 'pipeline',
      pdf_info: [0, 1].map(page_idx => ({ page_idx, page_size: [595, 842], para_blocks: [] })) }, contentListV2: [
      [{ type: 'table', bbox: [50, 104, 940, 340], content: { table_caption: [{ type: 'text', content: 'FLEET TEAM DIGEST' }],
        html: '<table><tr><td>787</td></tr></table>' } }, block('paragraph', notice, 885), block('paragraph', copyright, 917)],
      [block('title', 'FLEET TEAM DIGEST', 61), block('title', 'Interim Action', 159), block('paragraph', note, 700),
        block('page_footnote', warning, 860), block('paragraph', notice, 885), block('page_footer', copyright, 917)],
    ] };
    const before = structuredClone(input);
    const result = readMineruArtifacts(input);
    expect(input).toEqual(before);
    expect(result.markdown).not.toMatch(/FLEET TEAM DIGEST|BOEING PROPRIETARY|Copyright/);
    expect(result.markdown).toContain(note);
    expect(result.markdown).toContain(warning);
    expect(result.blocks.map(item => item.type)).toEqual(['table', 'title', 'paragraph']);
    expect(result.blocks[0].content.table_caption).toEqual([]);
    expect(result.blocks[1].sourcePointer).toBe('/1/1');
    expect(result.discardedBlocks).toHaveLength(1);
    expect(result.discardedBlocks[0].content.page_footnote_content).toEqual([{ type: 'text', content: warning }]);
  });

  it('preserves markdown, nested-page reading order, independent paragraphs and image identity', () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = readMineruArtifacts(input);
    expect(result.markdown).toBe(input.markdown);
    expect(result.blocks.map((b) => b.type)).toEqual([
      'title',
      'paragraph',
      'paragraph',
      'image',
    ]);
    expect(result.blocks[0].headingLevel).toBe(1);
    expect(result.blocks[3].assetPath).toBe('images/figure.jpg');
    expect(result.blocks[2].sourcePointer).toBe('/0/2');
    expect(result.discardedBlocks).toEqual([]);
    expect(input).toEqual(before);
    expect(result.diagnostics).toEqual([]);
  });
  it('excludes running headers, footers and page numbers but retains meaningful footnotes', () => {
    const input = fixture();
    const furniture = (type: string, text: string) => ({
      type,
      bbox: [10, 950, 900, 990],
      content: { paragraph_content: [{ type: 'text', content: text }] },
    });
    const result = readMineruArtifacts({
      ...input,
      contentListV2: [
        [
          ...input.contentListV2[0],
          furniture('page_header', 'Repeated document title'),
          furniture('page_footer', 'Repeated company footer'),
          furniture('page_footnote', 'Exception: do not apply below freezing.'),
        ],
      ],
    });
    expect(
      [...result.blocks, ...result.discardedBlocks].some((block) =>
        ['page_header', 'page_footer', 'page_number'].includes(block.type),
      ),
    ).toBe(false);
    expect(result.discardedBlocks.map((block) => block.type)).toEqual([
      'page_footnote',
    ]);
    expect(result.blocks[2].sourcePointer).toBe('/0/2');
  });
  it('rejects a flat v1 list and mismatched pages instead of guessing its schema', () => {
    const input = fixture();
    expect(() =>
      readMineruArtifacts({ ...input, contentListV2: input.contentListV2[0] }),
    ).toThrow('PAGE_COUNT_MISMATCH');
  });
  it('requires each referenced asset and rejects traversal or remote resources', () => {
    expect(() => readMineruArtifacts({ ...fixture(), assetPaths: [] })).toThrow(
      'ASSET_MISSING',
    );
    for (const path of [
      'images/../secret',
      'https://host/image.png',
      'images/%2e%2e/file',
      '/tmp/image.png',
    ]) {
      expect(() => safeMineruAssetPath(path)).toThrow('ASSET_PATH_INVALID');
    }
  });
  it('keeps unsupported blocks visible as diagnostics and does not invent geometry', () => {
    const input = fixture();
    input.contentListV2[0][1].type = 'future_block';
    input.contentListV2[0][1].bbox = [-2, 0, 10, 20];
    const result = readMineruArtifacts(input);
    expect(result.blocks[1].bbox).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      'BBOX_UNAVAILABLE',
      'UNSUPPORTED_BLOCK_TYPE',
    ]);
  });
});


/** Geometry and field shapes from the two-page offline 3.0.9 pipeline run.
 * Text and asset names are synthetic; no source document content is committed. */
const localPipelineFixture = () => ({
  markdown: '# Local example\n\n<table><tr><td colspan="2">Condition</td></tr><tr><td>A</td><td>B</td></tr></table>\n\nFirst paragraph.\n\nSecond page paragraph.\n\n1\n\n2\n',
  middle: { _version_name: '3.0.9', _backend: 'pipeline', pdf_info: [0, 1].map(page_idx => ({
    page_idx, page_size: [595, 841],
    para_blocks: [{ type: 'text', bbox: [36, 365, 534, 406],
      lines: [{ spans: [{ type: 'text', content: 'Preserved source span.' }] }] }],
    discarded_blocks: [],
  })) },
  contentListV2: [[
    { type: 'title', bbox: [314, 61, 682, 91],
      content: { title_content: [{ type: 'text', content: 'Local example' }], level: 1 } },
    { type: 'table', bbox: [58, 104, 939, 340], content: {
      image_source: { path: 'images/local-table.jpg' }, table_caption: [], table_footnote: [],
      html: '<table><tr><td colspan="2">Condition</td></tr><tr><td>A</td><td>B</td></tr></table>',
      table_type: 'complex_table', table_nest_level: 1,
    } },
    { type: 'paragraph', bbox: [60, 434, 897, 483],
      content: { paragraph_content: [{ type: 'text', content: 'First paragraph.' }] } },
    { type: 'page_number', bbox: [480, 958, 517, 970],
      content: { page_number_content: [{ type: 'text', content: '1' }] } },
  ], [
    { type: 'paragraph', bbox: [62, 131, 781, 164],
      content: { paragraph_content: [{ type: 'text', content: 'Second page paragraph.' }] } },
    { type: 'page_number', bbox: [480, 958, 517, 970],
      content: { page_number_content: [{ type: 'text', content: '2' }] } },
  ]], assetPaths: ['images/local-table.jpg'],
});

describe('explicit local MinerU 3.0.9 pipeline compatibility', () => {
  it('preserves producer, page identities, complex table HTML, image binding and source spans', () => {
    const input = localPipelineFixture();
    const before = structuredClone(input);
    const result = readMineruArtifacts(input);
    expect(result.version).toBe('3.0.9');
    expect(result.backend).toBe('pipeline');
    expect(result.pages).toEqual([0, 1].map(pageIndex => ({
      pageIndex, width: 595, height: 841, middlePointer: `/pdf_info/${pageIndex}`,
    })));
    expect(result.blocks.map(block => [block.pageIndex, block.type, block.sourcePointer]))
      .toEqual([[0, 'title', '/0/0'], [0, 'table', '/0/1'], [0, 'paragraph', '/0/2'], [1, 'paragraph', '/1/0']]);
    const table = result.blocks[1];
    expect(table.content).toEqual(input.contentListV2[0][1].content);
    expect(table.assetPath).toBe('images/local-table.jpg');
    expect(table.bbox).toEqual([58, 104, 939, 340]);
    expect(result.blocks[2].content.paragraph_content).toEqual([{ type: 'text', content: 'First paragraph.' }]);
    expect(result.middle).toEqual(input.middle);
    expect(result.middle).not.toBe(input.middle);
    expect(result.markdown).toContain('colspan="2"');
    expect(result.markdown).not.toMatch(/\n[12]\n/);
    expect(result.diagnostics).toEqual([]);
    expect(input).toEqual(before);
  });
  it('retains missing-asset, path traversal, flat-v1 and page-geometry rejection for 3.0.9', () => {
    const input = localPipelineFixture();
    expect(() => readMineruArtifacts({ ...input, assetPaths: [] })).toThrow('MINERU_ASSET_MISSING');
    expect(() => readMineruArtifacts({ ...input, contentListV2: input.contentListV2.flat() }))
      .toThrow('MINERU_PAGE_COUNT_MISMATCH');
    const drift = structuredClone(input);
    drift.middle.pdf_info[1].page_idx = 0;
    expect(() => readMineruArtifacts(drift)).toThrow('MINERU_PAGE_GEOMETRY_INVALID:1');
    const traversal = structuredClone(input);
    traversal.contentListV2[0][1].content.image_source = { path: 'images/../outside.jpg' };
    expect(() => readMineruArtifacts(traversal)).toThrow('MINERU_ASSET_PATH_INVALID');
  });
  it('rejects unverified versions and unverified 3.0.9 backends without relabeling', () => {
    for (const version of ['3.0.8', '3.0.10', '3.4.6', '4.0.0']) {
      const input = localPipelineFixture(); input.middle._version_name = version;
      expect(() => readMineruArtifacts(input)).toThrow(`MINERU_VERSION_UNSUPPORTED:${version}`);
    }
    const input = localPipelineFixture(); input.middle._backend = 'vlm';
    expect(() => readMineruArtifacts(input)).toThrow('MINERU_BACKEND_UNSUPPORTED:3.0.9:vlm');
  });
});
