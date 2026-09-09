import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TranslationReadingElementV2 } from '@shared/canonical-translation-v2.interface';
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/features/review/InitialAnalysisContinueButton', () => ({
  __esModule: true,
  default: 'button',
}));
jest.mock(
  '@client/src/pages/DocumentParsingPage/TranslationRevisionEditor',
  () => ({ TranslationRevisionEditor: 'div' }),
);
jest.mock(
  '@client/src/pages/DocumentParsingPage/semantic-bilingual-reader.css',
  () => ({}),
);
import { SemanticBilingualReader } from '../../client/src/pages/DocumentParsingPage/SemanticBilingualReader';
import { SemanticBlockContent } from '../../client/src/pages/DocumentParsingPage/SemanticBlockContent';
import {
  semanticReadingCoverage,
  semanticReadingText,
  semanticSourceLinks,
} from '../../client/src/pages/DocumentParsingPage/semantic-reading';
import {
  semanticReadingFixture,
  sourceAnchor,
} from './semantic-reading-ui.fixtures';

describe('semantic document reading', () => {
  it('renders a complete Chinese paragraph once for three anchors on two pages', () => {
    const reading = semanticReadingFixture();
    const html: string = renderToStaticMarkup(
      createElement(SemanticBilingualReader, {
        translation: { status: 'SEMANTIC_READING_AID_AVAILABLE', reading },
        mode: 'translation',
        onSourceRefSelect: jest.fn(),
      }),
    );
    expect(
      html.split('仅适用于上支架，不得用于下支架；应先核实构型。'),
    ).toHaveLength(2);
    expect(html).toContain('连续中文阅读');
    expect(html).toContain('10% 已登记文字可读');
    expect(html).toContain('已保存 800 / 1,000 个原文字符');
    expect(html).toContain('译文已保存，检查完成后在此接续');
    expect(html).toContain('此处待生成，已完成的段落可继续阅读');
    expect(
      semanticSourceLinks(reading.anchors).map((link) => link.label),
    ).toEqual(['第 3 页', '第 3 页', '第 4 页']);
  });
  it('does not turn 100% registered text into complete source or delivery', () => {
    const reading = semanticReadingFixture();
    reading.coverage.readableSourceCharacters = 1000;
    const view = semanticReadingCoverage(reading);
    expect(view.scope).toBe('部分译文候选');
    expect(view.delivery).toBe('尚未形成完整交付产物');
    const html = renderToStaticMarkup(
      createElement(SemanticBilingualReader, {
        translation: { status: 'SEMANTIC_READING_AID_AVAILABLE', reading },
        onSourceRefSelect: jest.fn(),
      }),
    );
    expect(html).toContain('不代表全文或图像内容已经完成');
    reading.coverage.registeredSourceCharacters = 0;
    expect(semanticReadingCoverage(reading).readablePercent).toBeNull();
  });
  it('retains the selected checked revision and does not display missing or blocked bodies', () => {
    const reading = semanticReadingFixture();
    reading.blocks[1].readingStatus = 'BLOCKED';
    reading.blocks[1].issues = [
      {
        code: 'service-test',
        origin: 'SERVICE',
        severity: 'NOTE',
        message: '服务中断，不表示译文有错',
        blockIds: ['pending-test'],
        anchorIds: [],
      },
    ];
    const html = renderToStaticMarkup(
      createElement(SemanticBilingualReader, {
        translation: { status: 'SEMANTIC_READING_AID_AVAILABLE', reading },
        onSourceRefSelect: jest.fn(),
      }),
    );
    expect(html).toContain('正文版本 2');
    expect(html).toContain('此完整语义范围暂不可读');
    expect(html).toContain('执行服务');
    expect(html).toContain('不得用于下支架');
  });
  it('preserves actual table spans, caption multiplicity and footnote ownership', () => {
    const reading = semanticReadingFixture();
    const cell = (
      id: string,
      text: string,
      columnStart: number,
      colSpan = 1,
      rowSpan = 1,
    ) => ({
      cellId: id,
      columnStart,
      colSpan,
      rowSpan,
      role: 'data',
      inlineContent: [{ text }],
    });
    const payload = {
      layout: 'grid',
      columnCount: 2,
      rowGroups: [
        {
          order: 0,
          kind: 'thead',
          rows: [{ order: 0, cells: [cell('h1', 'Torque', 0, 2)] }],
        },
        {
          order: 1,
          kind: 'tbody',
          rows: [
            {
              order: 0,
              cells: [cell('b1', 'Upper only', 0, 1, 2), cell('b2', '8 Nm', 1)],
            },
            { order: 1, cells: [cell('b3', '3 Nm', 1)] },
          ],
        },
        {
          order: 2,
          kind: 'tfoot',
          rows: [
            {
              order: 0,
              cells: [cell('f1', 'Do not use on lower bracket.', 0, 2)],
            },
          ],
        },
      ],
    };
    const tableAnchors = [
      sourceAnchor('caption-1', 'Table', 3, '/payload/caption/0/text'),
      sourceAnchor('caption-2', '1', 3, '/payload/caption/1/text'),
      sourceAnchor(
        'header',
        'Torque',
        3,
        '/payload/rowGroups/0/rows/0/cells/0/inlineContent/0/text',
      ),
      sourceAnchor(
        'upper',
        'Upper only',
        3,
        '/payload/rowGroups/1/rows/0/cells/0/inlineContent/0/text',
      ),
      sourceAnchor(
        'value-8',
        '8 Nm',
        3,
        '/payload/rowGroups/1/rows/0/cells/1/inlineContent/0/text',
      ),
      sourceAnchor(
        'value-3',
        '3 Nm',
        3,
        '/payload/rowGroups/1/rows/1/cells/0/inlineContent/0/text',
      ),
      sourceAnchor(
        'foot',
        'Do not use on lower bracket.',
        3,
        '/payload/rowGroups/2/rows/0/cells/0/inlineContent/0/text',
      ),
    ].map((anchor) => ({ ...anchor, sourceUnitId: 'table-unit' }));
    const elements: TranslationReadingElementV2[] = [
      {
        elementId: 'caption',
        kind: 'caption',
        translatedText: '表一：力矩要求',
        anchorIds: ['caption-1', 'caption-2'],
      },
      ...tableAnchors
        .slice(2)
        .map((anchor) => ({
          elementId: anchor.anchorId,
          kind: 'table_cell' as const,
          translatedText: anchor.sourceText,
          anchorIds: [anchor.anchorId],
        })),
    ];
    const block = structuredClone(reading.blocks[0]);
    block.source.kind = 'table';
    block.source.sourceStructure = [
      { sourceUnitId: 'table-unit', kind: 'table', payload },
    ];
    block.selected!.candidate.elements = elements;
    const html = renderToStaticMarkup(
      createElement(SemanticBlockContent, {
        block,
        anchors: tableAnchors,
        original: false,
        selectedAnchors: [],
        onFocus: jest.fn(),
      }),
    );
    expect(html.split('表一：力矩要求')).toHaveLength(2);
    expect(html).toContain('rowSpan="2"');
    expect(html).toContain('colSpan="2"');
    expect(html).toMatch(/<tfoot>[\s\S]*Do not use on lower bracket\./u);
    expect(block.source.sourceStructure[0].payload).toEqual(payload);
  });
  it('exports whole readable semantics with version, original conditions and explicit gaps', () => {
    const text = semanticReadingText(semanticReadingFixture());
    expect(text).toContain('body-checked-2');
    expect(text).toContain('document-test');
    expect(text).toContain('不得用于下支架');
    expect(text).toContain('Do not use on the lower bracket.');
    expect(text).toContain('pending-test · 已保存，待检查');
    expect(text).toContain('missing-test · 待生成');
    expect(
      semanticSourceLinks([sourceAnchor('no-page', 'Text', null)])[0].label,
    ).toContain('无精确页码');
  });
});
