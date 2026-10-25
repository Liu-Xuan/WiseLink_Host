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
import { assessmentPageFixture } from './fixtures/document-assessment-workspace';

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
    expect(html).toContain('已发布原文可查看，实际读取另见本轮记录');
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
    expect(html).toContain('尚无可计数的来源目录');
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
    expect(html).toContain('7 个内容单元 · 9 条来源目录定位');
    expect(html).toContain('<strong>9</strong> 条来源目录定位');
    expect(html).toContain('实际读取另见本轮记录');
    expect(html).not.toContain('系统查阅了什么');
  });

  it('keeps absent saved work and unresolved counts unknown instead of ready for review', () => {
    const html = renderToStaticMarkup(createElement(EngineeringReasoningTrail, {
      data: page('REQUIRED', null), working: null,
    }));
    expect(html).toContain('尚无已保存评估');
    expect(html).toContain('待确认数量未知');
    expect(html).not.toContain('<strong>0</strong> 项待确认');
    expect(html).not.toContain('<strong>0</strong> 项未闭合');
    expect(html).not.toContain('等待工程师复核');
  });

  it('uses saved work before Overall is available', () => {
    const working = jobAidReadingFixture();
    working.overallStatus = 'NOT_AVAILABLE';
    const html = renderToStaticMarkup(createElement(EngineeringReasoningTrail, {
      data: page('REQUIRED', null), working,
    }));
    expect(html).toContain(`已保存工作第 ${working.current!.workRevision} 版`);
    expect(html).toContain('工作已保存，综合待更新');
    expect(html).toContain('无需等待综合更新');
  });

  it.each(['STALE', 'STALE_REASON'] as const)('keeps an Overall with its own %s separate from saved work', stale => {
    const data = assessmentPageFixture();
    const overall = data.workItem.integratedAssessment!.overallSynthesis!;
    if (stale === 'STALE') overall.status = 'STALE'; else overall.staleReason = 'ENGINEER_REVIEW_CHANGED';
    const working = jobAidReadingFixture(); working.overallStatus = 'CURRENT';
    working.overallBasedOnWorkRevisionRef = working.current!.workRevisionRef;
    const html = renderToStaticMarkup(createElement(EngineeringReasoningTrail, { data, working }));
    expect(html).toContain('工作已保存，综合待更新');
    expect(html).toContain('此前综合另行保留');
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
    expect(html).toContain('暂无已保存的问题评估');
    expect(html).toContain('问题与待确认数量未知');
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
    expect(html).toContain('正文可立即阅读');
    expect(html).toContain('展开对象、阶段与保存版本');
  });

  it.each([false, true])('uses the latest real save or terminal event after a response checkpoint; terminal=%s', terminal => {
    const working = jobAidReadingFixture();
    working.current!.createdAt = '2026-10-25T00:02:00Z';
    working.selectedExecution = { actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
      attemptId: working.current!.actionAttemptId, attemptRef: 'AQ-program', executionMode: 'PROGRAM_CONTROLLED_V1',
      status: terminal ? 'SUCCEEDED' : 'RUNNING', createdAt: '2026-10-25T00:00:00Z', startedAt: '2026-10-25T00:00:00Z',
      completedAt: terminal ? '2026-10-25T00:03:00Z' : null,
      programProgress: { phase: 'MODEL_RESPONSE_SAVED', checkpointRef: 'CP-private', observedAt: '2026-10-25T00:01:00Z' } };
    const html = renderToStaticMarkup(createElement(AssessmentProcessDetails, { data: processPage, working }));
    const recent = html.split('最近有效进展：</strong>')[1].split('</p>')[0];
    expect(recent).toContain(terminal ? '执行状态：' : `工作第 ${working.current!.workRevision} 版已保存`);
    expect(recent).toContain(terminal ? '2026-10-25T00:03:00Z' : working.current!.createdAt);
    expect(recent).not.toContain('完整响应已留存');
    expect(html).not.toContain('CP-private');
    expect(html).toContain('程序评估 · 自主调查未启用');
  });
});
