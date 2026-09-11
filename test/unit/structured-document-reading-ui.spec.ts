import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CanonicalStructuredContentUnit } from '@shared/api.interface';
import {
  StructuredDocumentArticle,
  structuredReadingGroups,
} from '../../client/src/pages/DocumentParsingPage/StructuredDocumentArticle';

function unit(
  ordinal: number,
  displayKind: CanonicalStructuredContentUnit['displayKind'],
  displayText: string,
  page = 1,
): CanonicalStructuredContentUnit {
  return {
    ordinal,
    displayKind,
    displayText,
    outlineKind: displayKind === 'section' ? 'SECTION' : 'NONE',
    sectionTitle: displayKind === 'section' ? displayText : null,
    sourceRefIds: [`source-${ordinal}`],
    sourceLocators: [
      {
        sourceRefId: `source-${ordinal}`,
        kind: 'PAGE',
        pageStart: page,
        pageEnd: page,
        quote: displayText,
      },
    ],
  };
}

describe('continuous structured document reading', () => {
  it('preserves explicit paragraph boundaries and the package heading hierarchy', () => {
    const units = [
      {
        ...unit(1, 'section', 'Scope'),
        reading: { kind: 'heading' as const, level: 1 },
      },
      {
        ...unit(2, 'body', 'First paragraph.'),
        reading: { kind: 'paragraph' as const },
      },
      {
        ...unit(3, 'body', 'Separate paragraph.'),
        reading: { kind: 'paragraph' as const },
      },
      {
        ...unit(4, 'section', 'Applicability'),
        reading: { kind: 'heading' as const, level: 2 },
      },
    ];
    expect(structuredReadingGroups(units).map((group) => group.length)).toEqual(
      [1, 1, 1, 1],
    );
    const html = renderToStaticMarkup(
      createElement(StructuredDocumentArticle, {
        units,
        requestedSourceRef: 'source-3',
        onLocateSourceRef: jest.fn(),
      }),
    );
    expect(html).toContain('<h1');
    expect(html).toContain('<h2');
    expect(html.match(/<p\b/g)).toHaveLength(2);
    expect(html).toContain('structured-unit-3');
  });
  it('never joins separate units merely because they are on the same page', () => {
    const units = [
      unit(1, 'section', 'Scope'),
      unit(2, 'body', 'Only for upper'),
      unit(3, 'body', 'brackets. Never use below.'),
      unit(4, 'body', 'Next page', 2),
      unit(5, 'unavailable', 'Table requires source inspection', 2),
    ];
    const before = structuredClone(units);
    expect(
      structuredReadingGroups(units).map((group) =>
        group.map((item) => item.ordinal),
      ),
    ).toEqual([[1], [2], [3], [4], [5]]);
    const html = renderToStaticMarkup(
      createElement(StructuredDocumentArticle, {
        units,
        requestedSourceRef: 'source-3',
        onLocateSourceRef: jest.fn(),
      }),
    );
    expect(html).toContain('连续结构化文档');
    expect(html).toContain('<h3');
    expect(html).toContain('Never use below.');
    expect(html).toContain('structured-unit-3');
    expect(html).toContain('第 1 页');
    expect(html).not.toContain('structured-browser-unit-meta');
    expect(html).not.toContain('展开全文');
    expect(units).toEqual(before);
  });

  it('keeps the full long body and markup as text, without per-unit action cards', () => {
    const longText =
      'Full paragraph. '.repeat(70) + '<script>not executable</script>';
    const html = renderToStaticMarkup(
      createElement(StructuredDocumentArticle, {
        units: [unit(1, 'body', longText)],
        requestedSourceRef: '',
        onLocateSourceRef: jest.fn(),
      }),
    );
    expect(html).toContain('Full paragraph. '.repeat(70));
    expect(html).toContain('&lt;script&gt;not executable&lt;/script&gt;');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('is-collapsed');
  });
});
