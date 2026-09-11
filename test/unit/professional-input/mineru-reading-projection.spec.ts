import { readMineruArtifacts } from '../../../server/modules/professional-input/mineru/mineru-artifacts';
import { buildMineruReadingProjection } from '../../../server/modules/professional-input/mineru/mineru-reading-projection';

describe('MinerU reading/source projection', () => {
  it('uses actual paragraph/table/image geometry and preserves meaningful notes without exposing raw page furniture or storage', () => {
    const text = (content: string) => [{ type: 'text', content }];
    const document = readMineruArtifacts({
      markdown: '# Scope\n\nRetain the warning.',
      middle: {
        _backend: 'pipeline',
        _version_name: '3.4.5',
        pdf_info: [{ page_idx: 0, page_size: [612, 792] }],
      },
      assetPaths: ['images/figure.png', 'images/table.png'],
      contentListV2: [
        [
          {
            type: 'title',
            bbox: [10, 10, 900, 60],
            content: { level: 1, title_content: text('Scope') },
          },
          {
            type: 'paragraph',
            bbox: [10, 70, 900, 120],
            content: { paragraph_content: text('Retain the warning.') },
          },
          {
            type: 'table',
            bbox: [10, 130, 900, 220],
            content: {
              html: '<table><tr><td colspan="2">Limit</td></tr><tr><td>Maximum</td><td>500</td></tr></table>',
              table_type: 'complex_table',
              image_source: { path: 'images/table.png' },
            },
          },
          {
            type: 'image',
            bbox: [10, 230, 900, 800],
            content: {
              image_source: { path: 'images/figure.png' },
              image_caption: [],
            },
          },
          {
            type: 'page_footnote',
            bbox: [10, 850, 900, 900],
            content: {
              page_footnote_content: text(
                'Exception: do not operate below 0 °C.',
              ),
            },
          },
          {
            type: 'page_footer',
            bbox: [10, 950, 900, 990],
            content: { page_footer_content: text('FOOTER MUST NOT APPEAR') },
          },
        ],
      ],
    });
    const projection = buildMineruReadingProjection(document, {
      documentVersionId: 'version',
      parseRunId: 'run',
    });
    expect(projection.sources).toHaveLength(5);
    expect(projection.sources[1]).toMatchObject({
      blockId: 'page-1-block-2',
      sourcePointer: '/0/1',
      pageIndex: 0,
      bbox: [10, 70, 900, 120],
      text: 'Retain the warning.',
    });
    expect(
      projection.sources.find((source) => source.kind === 'table')?.cells,
    ).toEqual(['Limit', 'Maximum', '500']);
    expect(projection.sources.find(source => source.kind === 'table')?.imagePath).toBe('images/table.png');
    expect(projection.issues).toContainEqual({ blockId: 'page-1-block-3', code: 'TABLE_LAYOUT_NOT_VERIFIED' });
    expect(
      projection.sources.find((source) => source.kind === 'image')?.imagePath,
    ).toBe('images/figure.png');
    expect(projection.notes).toEqual([
      {
        id: 'page-1-block-5-note',
        text: 'Exception: do not operate below 0 °C.',
      },
    ]);
    expect(JSON.stringify(projection)).not.toContain('FOOTER MUST NOT APPEAR');
    expect(JSON.stringify(projection)).not.toContain('pdf_info');
    expect(JSON.stringify(projection)).not.toContain('bucketId');
  });
});
