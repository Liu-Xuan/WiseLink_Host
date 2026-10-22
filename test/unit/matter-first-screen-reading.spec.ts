import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { JSDOM } from 'jsdom';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import MatterFirstScreenReading from '../../client/src/features/matter/MatterFirstScreenReading';
import { libraryMatterFixture } from './fixtures/library-matter';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

jest.mock('@client/src/features/matter/saved-jobaid-reading.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));

function member(id: string, aircraft: string): EngineeringMatterCatalogEntry {
  return {
    workItemId: `WI-${id}`,
    relationRole: 'PRIMARY',
    linkedAtWorkItemRevision: 1,
    currentWorkItemRevision: 2,
    workItemChangedSinceLink: true,
    workItemStatus: 'ACTIVE',
    document: {
      documentId: `DOC-${id}`,
      documentVersionId: `DV-${id}`,
      documentCode: `SB-${id}`,
      businessRevision: 'R02',
      normalizedFamily: 'SB',
    },
    documentCurrentness: {
      familyId: `F-${id}`,
      currentDocumentVersionId: `DV-${id}`,
      currentGeneration: 1,
      selectedVersionIsCurrent: true,
    },
    sourceNavigation: {
      status: 'NOT_PARSED',
      sourceRefCount: 0,
      structuredContentPath: null,
    },
    applicability: {
      documentVersionId: `DV-${id}`,
      inputRevision: 1,
      status: 'CANDIDATE_ONLY',
      currentness: 'CURRENT',
      staleReason: null,
      decision: 'APPLICABLE',
      aircraftNumber: aircraft,
      assessmentAsOf: '2026-10-22',
      blockingUnknownCount: 0,
    },
  };
}
function fixture() {
  const revision = libraryMatterFixture().working.current!;
  revision.state.problemWork = jobAidReadingFixture().current!.content;
  const work = revision.state.problemWork;
  work.issues[0].riskScenarios[0].conditions = [
    '只有构型 A 才适用，不得用于构型 B。',
  ];
  work.decisiveIssueKeys = [work.issues[0].issueKey];
  work.issues[0].openQuestions[0].nextEvidence = '取得目标飞机的准确软件清单。';
  revision.changeSummary = '新增修订仅改变构型 A 的检查条件。';
  return {
    revision,
    members: [member('A', 'TEST-001'), member('B', 'TEST-002')],
    pendingInputs: [],
    historical: false,
    onLocateDocument: jest.fn(),
    onOpenClaim: jest.fn(),
  };
}
function render(props = fixture()) {
  return renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: '/' },
      createElement(MatterFirstScreenReading, props),
    ),
  );
}

it('keeps all three reading groups, a complete decisive condition and a concrete next step visible', () => {
  const html = render();
  const document = new JSDOM(html).window.document;
  expect(
    [...document.querySelectorAll('.matter-first-screen > section > h2')].map(
      (node) => node.textContent,
    ),
  ).toEqual(['当前判断与范围', '公司安排与落实', '变化与下一步']);
  for (const text of [
    '只有构型 A 才适用，不得用于构型 B。',
    '取得目标飞机的准确软件清单。',
  ]) {
    const paragraph = [...document.querySelectorAll('p')].find((node) =>
      node.textContent?.includes(text),
    );
    expect(paragraph).toBeDefined();
    expect(paragraph!.closest('details')).toBeNull();
  }
  expect(html).toContain('新增修订仅改变构型 A 的检查条件');
  expect(html).toContain('系统评估建议 · 保存候选');
  expect(html).toContain('本次事项读取');
  expect(html).toContain('尚未提供可核对的公司批准意见清单');
  expect(html).not.toContain('暂无措施颁发');
});

it('shows each exact applicability object and preserves stale or unknown module results', () => {
  const props = fixture();
  props.members[1].applicability = {
    ...props.members[1].applicability!,
    status: 'STALE',
    currentness: 'STALE',
    staleReason: 'FLEET_FACTS_CHANGED',
    decision: 'NOT_APPLICABLE',
    blockingUnknownCount: 2,
  };
  const html = render(props);
  expect(html).toContain('TEST-001');
  expect(html).toContain('TEST-002');
  expect(html).toContain('模块候选结论：适用');
  expect(html).toContain('原模块结论已过期，需重新核对');
  expect(html).toContain('原结论：不适用');
  expect(html).toContain('2 项决定性事实待确认');
  props.members[0].applicability!.documentVersionId = 'OTHER-VERSION';
  expect(render(props)).toContain('适用性结果与资料版本不一致');
  props.members[0].applicability = null;
  props.members[0].applicabilityUnavailableReason = 'SOURCE_MISMATCH';
  expect(render(props)).toContain(
    '适用性结果的来源与此资料版本不一致，本次未展示，待核对',
  );
});

it('never overlays current applicability or pending inputs on the exact historical revision', () => {
  const props = fixture();
  props.historical = true;
  props.revision.matterWorkRevisionId = 'historical-exact-work';
  props.revision.changeSummary = '本版保存的原变化。';
  const html = render(props);
  expect(html).toContain('data-matter-work-ref="historical-exact-work"');
  expect(html).toContain('本版判断与范围');
  expect(html).toContain('本版保存的原变化');
  expect(html).not.toContain('TEST-001');
  expect(html).not.toContain('TEST-002');
  expect(html).not.toContain('SB-A');
  expect(html).toContain('不叠加当前适用性模块结果');
});

it('expands long lists without dropping their text or hiding the sole next step', () => {
  const props = fixture();
  props.revision.state.openQuestions = [
    { itemId: 'first', text: '首先核对准确对象。', basisRefs: [] },
    {
      itemId: 'second',
      text: '随后核对完整否定条件，不得省略。',
      basisRefs: [],
    },
  ];
  const document = new JSDOM(render(props)).window.document;
  const first = [...document.querySelectorAll('p')].find((node) =>
    node.textContent?.includes('首先核对准确对象'),
  )!;
  const second = [...document.querySelectorAll('p')].find((node) =>
    node.textContent?.includes('随后核对完整否定条件，不得省略'),
  )!;
  expect(first.closest('details')).toBeNull();
  expect(second.closest('details')?.open).toBe(false);
});

it.each([
  ['STALE', '此前保存的系统候选判断，尚未覆盖本次问题更新'],
  ['NOT_AVAILABLE', '已保存的问题摘要，尚未形成综合判断'],
] as const)(
  'labels %s saved headings locally instead of presenting them as a current synthesis',
  (status, label) => {
    const props = fixture();
    props.revision.state.problemWork!.overviewStatus = status;
    const document = new JSDOM(render(props)).window.document;
    const paragraph = [...document.querySelectorAll('p')].find(
      (node) => node.textContent === label,
    );
    expect(paragraph).toBeDefined();
    expect(paragraph!.closest('details')).toBeNull();
  },
);
