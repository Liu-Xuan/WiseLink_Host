import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
import { EngineeringReasoningTrail } from '../../client/src/pages/DocumentParsingPage/EngineeringReasoningTrail';

function page(
  status: 'REQUIRED' | 'NOT_READY',
  parsedPackage: { contentUnitCount: number; sourceRefCount: number } | null,
): CanonicalDocumentParsingPageResponse {
  return {
    workItem: {
      classification: { normalizedFamily: 'SB' },
      package: parsedPackage,
      integratedAssessment: null,
    },
    timeline: { events: [] },
    queryResults: [],
    initialAnalysis: { status },
  } as unknown as CanonicalDocumentParsingPageResponse;
}

describe('engineering reasoning source progress', () => {
  it('shows a published original as ready without inventing a source count', () => {
    const html = renderToStaticMarkup(
      createElement(EngineeringReasoningTrail, {
        data: page('REQUIRED', null),
      }),
    );
    expect(html).toContain('已发布原文可查看');
    expect(html).toContain('来源依据以已发布原文的实际阅读结果为准');
    expect(html).not.toContain('等待解析结果');
    expect(html).not.toContain('<strong>0</strong> 条来源依据');
  });

  it('keeps an original without a published parse in the pending state', () => {
    const html = renderToStaticMarkup(
      createElement(EngineeringReasoningTrail, {
        data: page('NOT_READY', null),
      }),
    );
    expect(html).toContain('等待解析结果');
    expect(html).toContain('尚无可计数的来源依据');
    expect(html).not.toContain('已发布原文可查看');
  });

  it('keeps exact counts for a structured package', () => {
    const html = renderToStaticMarkup(
      createElement(EngineeringReasoningTrail, {
        data: page('NOT_READY', {
          contentUnitCount: 7,
          sourceRefCount: 9,
        }),
      }),
    );
    expect(html).toContain('结构化原文可查看');
    expect(html).toContain('7 个内容单元 · 9 条来源依据');
    expect(html).toContain('<strong>9</strong> 条来源依据');
  });
});
