import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import {
  SavedJobAidMethodNotice,
  SavedJobAidIssueContext,
} from '@client/src/features/matter/SavedJobAidReadingContext';
import MatterProblemWork from '@client/src/features/matter/MatterProblemWork';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

jest.mock('@client/src/features/matter/saved-jobaid-reading.css', () => ({}));
jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
const { JSDOM } = require('jsdom');

function revision(): EngineeringMatterWorkingRevisionReadModel {
  const saved = jobAidReadingFixture().current!;
  const reading = jobAidReadingResult(saved);
  reading.scope = { kind: 'ENGINEERING_MATTER', matterId: 'MAT-test' };
  return {
    matterWorkRevisionId: 'MWR-exact-old', matterId: 'MAT-test', workingRevision: 3,
    basedOnMatterRevisionId: 'MR-test', updateKind: 'INITIAL_SYNTHESIS', changeSummary: '测试保存记录',
    substantiveResultRef: reading.resultRef, substantiveResultRevision: reading.resultRevision,
    state: { schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1', focus: { question: '测试问题', targetRefs: [] },
      substantiveResult: reading, problemWork: saved.content, openQuestions: [], reviewConditions: [], substantiveInputs: [], coverage: [] },
    change: { changedBecause: '测试保存记录', addedClaimIds: [], replacedClaimIds: [], retiredClaims: [], explicitlyUnchangedClaimIds: [], openQuestionDelta: null, reviewConditionDelta: null, coverageUpdates: [] },
    source: null, createdAt: saved.createdAt,
  };
}

function render(work: EngineeringMatterWorkingRevisionReadModel) {
  return renderToStaticMarkup(createElement(StaticRouter, { location: '/matters/MAT-test?workRef=MWR-exact-old' },
    createElement(MatterProblemWork, { revision: work, onLocateDocument: jest.fn() })));
}

describe('saved JobAid context inside existing reading surfaces', () => {
  it('keeps the complete body, every condition/unknown/measure outside a closed analysis disclosure', () => {
    const work = revision();
    const before = JSON.stringify(work);
    const html = render(work);
    const dom = new JSDOM(html);
    for (const text of ['未按要求核实构型', '当前没有可确认的发生频次', '仅对构型 A',
      '当前构型是什么？', '下一步所需依据：受控构型记录', '措施限制：不能替代有效性验证',
      '尚未确认构型，不得认定必须实施。']) {
      const node = [...dom.window.document.querySelectorAll('p, span')].find((item: Element) => item.textContent?.includes(text));
      expect(node).toBeDefined();
      expect(node?.closest('details')).toBeNull();
    }
    expect(dom.window.document.querySelectorAll('details[open]')).toHaveLength(0);
    expect(html.match(/尚未确认构型，不得认定必须实施。/gu)).toHaveLength(1);
    expect(html).toContain('展开本问题的分析理由与方法依据');
    expect(JSON.stringify(work)).toBe(before);
  });

  it('never upgrades an unbound confirmed label to a controlled method or original read', () => {
    const work = revision().state.problemWork!;
    const html = renderToStaticMarkup(createElement(SavedJobAidMethodNotice, { work }));
    expect(html).toContain('受控版本身份待确认');
    expect(html).toContain('R00 内容转述，与 R01 正文配套待核');
    expect(html).toContain('可含此前沿用资料');
    expect(html).not.toContain('本版登记版本已确认');
    expect(html).not.toContain('合规');
    expect(html).toContain('不能宣称本轮已读取全部原件');
  });

  it('does not invent attachment 5 facts for a missing historical method binding', () => {
    const work = revision().state.problemWork!;
    delete (work as Partial<typeof work>).methodBinding;
    const html = renderToStaticMarkup(createElement(SavedJobAidMethodNotice, { work }));
    expect(html).toContain('未取得本版方法绑定');
    expect(html).toContain('未取得本版附件 5 的绑定');
    expect(html).not.toContain('R00 内容转述');
    expect(html).not.toContain('本版登记版本已确认');
  });

  it('shows missing structured records and body honestly without generating summary claims', () => {
    const work = revision();
    const issue = work.state.problemWork!.issues[0];
    issue.body = '';
    issue.riskScenarios = []; issue.requirementHandling = []; issue.openQuestions = []; issue.measures = [];
    const html = render(work);
    expect(html).toContain('未取得本版保存正文');
    expect(html).toContain('未登记结构化条件或局限');
    expect(html).toContain('未登记未决问题，不等于不存在未知');
    expect(html).toContain('未登记风险情景，不等于没有风险');
    expect(html).toContain('未登记要求处理记录，不能认定方法已覆盖');
    expect(html).not.toContain('0 分');
    expect(work.state.substantiveResult!.content.claims).toEqual([]);
  });

  it('keeps unclassified risks unknown and the saved candidate effectiveness limited', () => {
    const work = revision().state.problemWork!;
    work.issues[0].measures[0].status = 'VERIFIED_EFFECTIVE';
    const html = renderToStaticMarkup(createElement(SavedJobAidIssueContext, {
      issue: work.issues[0], evidence: work.evidence, onLocateDocument: jest.fn(),
    }));
    expect(html.match(/未定级/gu)).toHaveLength(3);
    expect(html).toContain('依据不足，未计算');
    expect(html).toContain('保存候选认为有效');
    expect(html).toContain('不能证明控制有效，也不能据此降低剩余风险');
    expect(html).not.toContain('Host 已验证');
    expect(html).not.toContain('0 分');
  });

  it('keeps stale overview scope, original-source failure and empty applicability basis visible', () => {
    const work = revision();
    work.state.problemWork!.overviewStatus = 'STALE';
    work.state.problemWork!.issues[0].requirementHandling[0].treatment = 'NOT_APPLICABLE_WITH_BASIS';
    work.state.problemWork!.issues[0].requirementHandling[0].basisRefs = [];
    work.state.problemWork!.evidence = [];
    const html = render(work);
    expect(html).toContain('现有综合尚未覆盖本次问题更新');
    expect(html).toContain('未登记对象依据，不能将处理状态视为覆盖已核实');
    expect(html).toContain('未能读回，不能视为已核实');
    expect(html).not.toContain('仅适用于构型 A。');
    expect(work.matterWorkRevisionId).toBe('MWR-exact-old');
  });

  it('creates no phantom work or independent page when the authorized revision is unavailable', () => {
    const html = renderToStaticMarkup(createElement(MatterProblemWork, { revision: null, onLocateDocument: jest.fn() }));
    expect(html).toBe('');
  });
});
