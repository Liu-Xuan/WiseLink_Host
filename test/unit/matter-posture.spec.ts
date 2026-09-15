import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { libraryMatterFixture } from './fixtures/library-matter';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import MatterPosture, {
  postureCoverage,
  matterPostureRoute,
} from '../../client/src/features/matter/MatterPosture';
import { readingReturnTarget } from '../../client/src/features/matter/reading-return';

jest.mock('@client/src/features/matter/matter-posture.css', () => ({}));

function fixture(status: 'CURRENT' | 'STALE' | 'NOT_AVAILABLE' = 'CURRENT') {
  const data = libraryMatterFixture();
  const saved = jobAidReadingFixture().current!;
  saved.content.overviewStatus = status;
  data.working.current!.state.problemWork = saved.content;
  data.working.current!.state.substantiveResult = jobAidReadingResult(saved);
  data.matter.catalog.entries.push({
    workItemId: 'WI-source',
    relationRole: 'PRIMARY',
    linkedAtWorkItemRevision: 1,
    currentWorkItemRevision: 2,
    workItemChangedSinceLink: true,
    workItemStatus: 'ACTIVE',
    document: {
      documentId: 'DOC-source',
      documentVersionId: 'DV/original',
      documentCode: '真实测试来源',
      businessRevision: 'R02',
      normalizedFamily: 'SB',
    },
    documentCurrentness: {
      familyId: 'F-source',
      currentDocumentVersionId: 'DV-new',
      currentGeneration: 3,
      selectedVersionIsCurrent: false,
    },
    sourceNavigation: {
      status: 'NOT_PARSED',
      sourceRefCount: 0,
      structuredContentPath: null,
    },
  });
  return data;
}
function render(data = fixture()) {
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: matterPostureRoute(data.matter.matterId) },
      createElement(MatterPosture, { data }),
    ),
  );
}

describe('selected Matter engineering posture', () => {
  it.each([
    ['NOT_AVAILABLE', '问题分析已保存，尚未形成综合意见'],
    ['STALE', '综合意见尚未纳入最新分析'],
    ['CURRENT', '已保存综合覆盖当前问题工作；不代表正式采用'],
  ] as const)(
    'maps the saved coverage fact %s without inferring execution outcome',
    (status, text) => {
      const data = fixture(status);
      expect(postureCoverage(data)).toBe(text);
      const html = render(data);
      expect(html).toContain(text);
      expect(html).toContain(
        data.working.current!.state.problemWork!.understanding,
      );
      expect(html).not.toContain('本次综合更新未完成');
      expect(html).not.toContain('综合更新中');
    },
  );

  it('keeps no-summary saved problem content and partial completion visible', () => {
    const data = fixture('NOT_AVAILABLE');
    data.working.current!.state.problemWork!.roundCompletion = 'IN_PROGRESS';
    const html = render(data);
    expect(html).toContain('已保存部分分析；其余工作尚未完成');
    expect(html).not.toContain('上次综合的关键判断');
    expect(html).toContain('完整问题正文');
    expect(html).toContain('当前没有可确认的发生频次');
    expect(html).toContain('不能替代有效性验证');
  });

  it('does not fabricate a synthesis or success from historical summary-only work', () => {
    const data = libraryMatterFixture();
    expect(render(data)).toContain('综合覆盖范围尚未核实');
    data.working.current = null;
    const html = render(data);
    expect(html).toContain('尚无可读的事项分析');
    expect(html).toContain(data.matter.title);
    expect(html).not.toContain('已保存综合覆盖');
    expect(html).not.toContain('已保存认识 · 我方候选');
  });

  it('preserves exact DV and original-work return instead of selecting the newer catalog version', () => {
    const html = render();
    const encoded = html
      .match(/href="(\/document-versions\/[^"]+)"/)![1]
      .replaceAll('&amp;', '&');
    const target = new URL(encoded, 'https://test.invalid');
    expect(target.pathname).toBe('/document-versions/DV%2Foriginal');
    expect(target.searchParams.get('returnMatterWorkRef')).toBe(
      'test-working-3',
    );
    expect(target.searchParams.has('parseRunId')).toBe(false);
    expect(readingReturnTarget(target.searchParams, 'DV/original')?.route).toBe(
      '/matters/ui-test-matter?workRef=test-working-3',
    );
    expect(html).not.toContain('/document-versions/DV-new');
  });

  it('keeps failure notices separate from actual saved work and current coverage', () => {
    const data = fixture();
    data.working.current!.overviewCorrectionNotices = [
      {
        attemptRef: 'AQ-test',
        targetWorkRef: 'work-old',
        reason: '待核原综合',
        attemptStatus: 'FAILED',
        savedWorkRef: 'work-saved',
        savedWorkingRevision: 4,
      },
    ];
    const html = render(data);
    expect(html).toContain('已保存综合覆盖当前问题工作');
    expect(html).toContain('请求状态：未完成');
    expect(html).toContain('已保存后续工作');
    expect(html).toContain('workRef=work-old');
    expect(html).toContain('workRef=work-saved');
  });

  it('separates work save time, review conditions, unknown execution and global scope', () => {
    const html = render();
    expect(html).toContain('不是工程事件发生时间');
    expect(html).toContain('复核条件不作为已执行措施');
    expect(html).toContain('非全局统计');
    expect(html).toContain('不能据此判断无故障或措施有效');
    expect(html).not.toMatch(/完成率|故障率|NOT_CONNECTED|SUPPORTS|CAUSES/u);
    expect(html).not.toContain('0%');
  });

  it('registers the independent page with existing read lifecycle and no review/model integration', () => {
    const root = resolve(__dirname, '../../client/src');
    const app = readFileSync(resolve(root, 'app.tsx'), 'utf8');
    const page = readFileSync(
      resolve(root, 'features/matter/MatterPosturePage.tsx'),
      'utf8',
    );
    expect(app).toContain('path="matters/:matterId/posture"');
    expect(page).toContain('useEngineeringMatter(');
    expect(page).toContain('authenticationRequired');
    expect(page).not.toContain('ContinuousReviewPanel');
    expect(page).not.toContain('ContextualDialogue');
    expect(page).not.toContain('fetch(');
    expect(matterPostureRoute('MAT/a')).toBe('/matters/MAT%2Fa/posture');
  });
});
