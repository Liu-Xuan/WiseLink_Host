import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CanonicalDocumentParsingPageResponse } from '@shared/api.interface';
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
}));
jest.mock('@client/src/features/review/RevisionTimeline', () => ({
  __esModule: true,
  default: 'section',
}));
jest.mock('@client/src/pages/DocumentParsingPage/work-item-process-workspace.css', () => ({}));
import { EngineeringReasoningTrail } from '../../client/src/pages/DocumentParsingPage/EngineeringReasoningTrail';
import { AssessmentProcessDetails } from '../../client/src/pages/DocumentParsingPage/WorkItemProcessWorkspace';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

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

describe('visible assessment process', () => {
  const processPage = {
    workItem: {
      workItemId: 'WI-process',
      revision: 6,
      source: { documentId: 'SB-100', documentVersionId: 'dv-process' },
      integratedAssessment: null,
    },
    initialAnalysis: {
      stages: {
        translation: { status: 'SUCCEEDED', terminalCode: null },
        applicability: { status: 'SUCCEEDED', terminalCode: null },
        jobAid: { status: 'BUSY', terminalCode: null },
        overall: { status: 'PENDING', terminalCode: null },
      },
    },
  } as unknown as CanonicalDocumentParsingPageResponse;

  it('shows exact input, stages and live attempt before any result is saved', () => {
    const working = jobAidReadingFixture();
    working.current = null;
    working.latestAttempt = {
      attemptId: 'ATT-process',
      status: 'RUNNING',
      inputRevision: 6,
    };
    const html = renderToStaticMarkup(
      createElement(AssessmentProcessDetails, { data: processPage, working }),
    );
    expect(html).toContain('SB-100');
    expect(html).toContain('dv-process');
    expect(html).toContain('输入修订 6');
    expect(html).toContain('尚无已保存的问题评估候选');
    expect(html).not.toContain('已保存候选：');
  });

  it('shows recorded evidence and capabilities only after the work is saved', () => {
    const working = jobAidReadingFixture();
    const html = renderToStaticMarkup(
      createElement(AssessmentProcessDetails, { data: processPage, working }),
    );
    expect(html).toContain('已保存候选：');
    expect(html).toContain('项输入依据');
    expect(html).toContain('条已读来源引用');
    expect(html).toContain('资料能力：');
    expect(html).toContain('候选不会自动成为正式结论');
  });
});
