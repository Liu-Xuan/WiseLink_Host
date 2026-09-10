import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssessmentReadingResult } from '@shared/assessment-reading.interface';
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
}));
jest.mock('@client/src/features/review/InitialAnalysisContinueButton', () => ({
  __esModule: true,
  default: 'button',
}));
jest.mock(
  '@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css',
  () => ({}),
);
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({
  __esModule: true,
  default: (props: { result: AssessmentReadingResult }) =>
    createElement(
      'section',
      {},
      ...props.result.content.claims.map((claim) =>
        createElement('p', { key: claim.claimId }, claim.text),
      ),
    ),
}));
import { JobAidProblemReading } from '../../client/src/pages/DocumentParsingPage/JobAidProblemWorkspace';
import {
  preserveJobAidRead,
  jobAidReadAfterFailure,
} from '../../client/src/pages/DocumentParsingPage/useJobAidWorkingRead';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import MatterProblemWork from '../../client/src/features/matter/MatterProblemWork';
import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';

describe('problem-oriented JobAid reading', () => {
  it('uses the same complete issue reader for a saved Matter investigation', () => {
    const saved = jobAidReadingFixture().current!;
    const reading = jobAidReadingResult(saved);
    reading.scope = { kind: 'ENGINEERING_MATTER', matterId: 'MAT-test' };
    const html = renderToStaticMarkup(createElement(MatterProblemWork, {
      revision: {
        matterWorkRevisionId: 'MWR-test', matterId: 'MAT-test', workingRevision: 1,
        basedOnMatterRevisionId: 'MR-test', updateKind: 'INITIAL_SYNTHESIS', changeSummary: '本轮问题',
        substantiveResultRef: reading.resultRef, substantiveResultRevision: reading.resultRevision,
        state: { schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1', focus: { question: '措施是否有效？', targetRefs: [] },
          substantiveResult: reading, problemWork: saved.content, openQuestions: [], reviewConditions: [], substantiveInputs: [], coverage: [] },
        change: { changedBecause: '核查条件', addedClaimIds: [], replacedClaimIds: [], retiredClaims: [], explicitlyUnchangedClaimIds: [], openQuestionDelta: null, reviewConditionDelta: null, coverageUpdates: [] },
        source: null, createdAt: saved.createdAt,
      }, onLocateDocument: jest.fn(),
    }));
    expect(html).toContain('已保存的问题分析');
    expect(html).toContain('仅对构型 A');
    expect(html).toContain('不能替代有效性验证');
    expect(html).toContain('依据不足，未计算');
    expect(html).toContain('EO 属性');
    expect(html).not.toContain('0 分');
  });
  it('keeps saved work, material conditions and real questions visible after failed execution', () => {
    const data = jobAidReadingFixture();
    const html = renderToStaticMarkup(
      createElement(JobAidProblemReading, {
        data,
        onLocateDocument: jest.fn(),
      }),
    );
    expect(html).toContain('data-work-revision-ref="work-current-test"');
    expect(html).toContain('本轮问题');
    expect(html).toContain('措施是否对当前构型有效？');
    expect(html).toContain('分析进行中');
    expect(html).toContain('执行失败');
    expect(html).toContain('新分析没有被旧整体意见替代');
    expect(html).toContain('尚未确认构型，不得认定必须实施');
    expect(html).toContain('来源规定应在 30 天内完成核查');
    expect(html).toContain('仅对构型 A');
    expect(html).toContain('不能替代有效性验证');
    expect(html).not.toContain('150');
    expect(html).not.toContain('逐项评估尚未形成');
    expect(html).not.toMatch(/<details[^>]*>\s*<summary[^>]*>措施是否/u);
  });
  it('shows unknown grades as unknown and keeps other classification identities separate', () => {
    const html = renderToStaticMarkup(
      createElement(JobAidProblemReading, {
        data: jobAidReadingFixture(),
        onLocateDocument: jest.fn(),
      }),
    );
    expect(html).toContain('JA-AC 严重性');
    expect(html).toContain('JA-AC 可能性');
    expect(html).toContain('JA-AC 风险等级');
    expect(html.match(/未定级/gu)).toHaveLength(3);
    expect(html).toContain('依据不足，未计算');
    expect(html).toContain('EO 属性');
    expect(html).toContain('只描述文件属性，不换算风险等级');
    expect(html).not.toContain('0 分');
    expect(html).not.toContain('49');
    expect(html).not.toContain('低风险');
  });
  it('does not create default empty questions when the saved work has none', () => {
    const data = jobAidReadingFixture();
    data.current!.content.issues = [];
    data.current!.content.decisiveIssueKeys = [];
    const html = renderToStaticMarkup(
      createElement(JobAidProblemReading, {
        data,
        onLocateDocument: jest.fn(),
      }),
    );
    expect(html).toContain(data.current!.content.headline);
    expect(html).not.toContain('实际问题目录');
    expect(html).not.toContain('N/A');
    expect(html).not.toContain('未定级');
  });
  it('retains an immutable work on identical polling and ordinary read failure, but clears access loss', () => {
    const data = jobAidReadingFixture();
    expect(preserveJobAidRead(data, structuredClone(data))).toBe(data);
    const updated = structuredClone(data);
    updated.current!.workRevisionRef = 'work-new-test';
    expect(preserveJobAidRead(data, updated)).toBe(updated);
    expect(jobAidReadAfterFailure(data, { statusCode: 503 })).toBe(data);
    expect(jobAidReadAfterFailure(data, {})).toBe(data);
    for (const statusCode of [401, 403, 404])
      expect(jobAidReadAfterFailure(data, { statusCode })).toBeNull();
  });
});
