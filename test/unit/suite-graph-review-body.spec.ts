import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { StaticRouter } from 'react-router-dom/server';
import { renderToStaticMarkup } from 'react-dom/server';
import SuiteGraphKnowledgePanel from '../../client/src/pages/RelationGraphPage/SuiteGraphKnowledgePanel';
import { buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import { libraryMatterFixture } from './fixtures/library-matter';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

it.each(['knowledge', 'basis', 'discussion'] as const)('shows display scope instead of stale matter knowledge on %s tab', tab => {
  const data = libraryMatterFixture();
  const matterRead = buildSuiteMatterGraph(data);
  const read = {
    ...matterRead,
    graph: {
      ...matterRead.graph,
      rootKind: 'display' as const,
      groups: [
        { key: 'matters', title: '目录事项', items: [{ id: 'other', title: '其他事项' }] },
        { key: 'documents', title: '当前事项资料', items: [{ id: 'document', title: '资料' }] },
      ],
      relations: [{ id: 'directory', source: 'root', target: 'other', type: 'DIRECTORY_MEMBERSHIP', label: '目录登记' }],
    },
    notices: ['授权目录页有更多事项未加载。'],
  };
  data.working.current!.state.substantiveResult!.content.lead = 'OLD_MATTER_SUMMARY';
  const html = renderToStaticMarkup(createElement(StaticRouter, {location: '/graph'}, createElement(SuiteGraphKnowledgePanel, {
    read, revision: data.working.current, selectedTarget: null, selectedEvent: null, tab, onTabChange: () => {},
  })));
  expect(html).toContain('当前目录范围');
  expect(html).toContain('已加载 1 个目录事项');
  expect(html).toContain('当前打开事项的 1 个资料节点');
  expect(html).not.toContain('OLD_MATTER_SUMMARY');
  expect(html).not.toContain('当前工作没有已保存依据');
});
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({__esModule: true, default: ({result}: {result: unknown}) => createElement('div', null, JSON.stringify(result))}));
it.each(['STALE', 'NOT_AVAILABLE'] as const)('includes selected work problem body for %s without inventing a current overview', status => {
  const data = libraryMatterFixture();
  const content = structuredClone(jobAidReadingFixture().current!.content);
  content.overviewStatus = status;
  data.working.current!.state.substantiveResult!.content.lead = content.understanding;
  data.working.current!.state.substantiveResult!.content.claims = [];
  content.issues[0].question = 'UNIQUE_NEW_PROBLEM_QUESTION';
  data.working.current!.state.substantiveResult!.content.issueArticles = content.issues.map(
    ({ issueKey, issueRef, question, body }) => ({ issueKey, issueRef, question, body }),
  );
  data.working.current!.state.problemWork = content;
  const html = renderToStaticMarkup(createElement(StaticRouter, {location: "/graph"}, createElement(SuiteGraphKnowledgePanel, {read:buildSuiteMatterGraph(data), revision:data.working.current, selectedTarget:null,selectedEvent:null,tab:'knowledge',onTabChange:()=>{}})));
  expect(html).toContain('UNIQUE_NEW_PROBLEM_QUESTION');
  expect(html).toContain('问题与分析');
  expect(html).toContain('仅当构型匹配时才有判断基础');
  expect(html).toContain('依据');
  expect(html).not.toContain('[[evidence-test]]');
  expect(html).toContain('问题理解');
  expect(html).toContain('已保存问题正文');
  if (status === 'STALE') {
    expect(html).toContain('尚未覆盖本工作中的最新问题');
    expect(html).not.toContain('此前综合认识');
  } else {
    expect(html).toContain('当前范围尚未形成综合认识');
    expect(html).not.toContain('此前综合认识');
  }
});

jest.mock('@client/src/components/ui/button', () => ({ Button: ({children, onClick}: {children: ReactNode; onClick?: () => void}) => createElement('button', {onClick}, children) }));

it('labels problem work understanding without presenting it as a separate overview', () => {
  const data = libraryMatterFixture();
  const content = structuredClone(jobAidReadingFixture().current!.content);
  content.overviewStatus = 'CURRENT';
  content.understanding = 'CURRENT_PROBLEM_UNDERSTANDING';
  data.working.current!.state.problemWork = content;
  data.working.current!.state.substantiveResult!.content.lead = content.understanding;
  data.working.current!.state.substantiveResult!.content.claims = [];
  const html = renderToStaticMarkup(createElement(StaticRouter, {location:'/graph'}, createElement(SuiteGraphKnowledgePanel, {read:buildSuiteMatterGraph(data),revision:data.working.current,selectedTarget:null,selectedEvent:null,tab:'knowledge',onTabChange:()=>{}})));
  expect(html).toContain('问题理解');
  expect(html).toContain('CURRENT_PROBLEM_UNDERSTANDING');
  expect(html).not.toContain('综合摘要');
});

it('treats saved issue articles as readable knowledge when atomic claims are empty', () => {
  const data = libraryMatterFixture();
  const content = structuredClone(jobAidReadingFixture().current!.content);
  content.overviewStatus = 'CURRENT';
  content.issues[0].body = 'EXACT_SAVED_ISSUE_BODY';
  data.working.current!.state.problemWork = content;
  data.working.current!.state.substantiveResult!.content.claims = [];
  data.working.current!.state.substantiveResult!.content.issueArticles = [
    {
      issueKey: content.issues[0].issueKey,
      issueRef: content.issues[0].issueRef,
      question: content.issues[0].question,
      body: content.issues[0].body,
    },
  ];
  const html = renderToStaticMarkup(createElement(StaticRouter, {location:'/graph'}, createElement(SuiteGraphKnowledgePanel, {read:buildSuiteMatterGraph(data),revision:data.working.current,selectedTarget:null,selectedEvent:null,tab:'knowledge',onTabChange:()=>{}})));
  expect(html).toContain('当前工作已保存 1 项完整问题正文');
  expect(html).toContain('EXACT_SAVED_ISSUE_BODY');
  expect(html).not.toContain('当前工作尚未保存可供阅读的认识正文');
});

it.each(['CURRENT', 'STALE', 'NOT_AVAILABLE'] as const)(
  'renders modern problem work as saved issue bodies for %s',
  status => {
    const data = libraryMatterFixture();
    const content = structuredClone(jobAidReadingFixture().current!.content);
    const evidenceRef = content.evidence[0].evidenceRef;
    content.overviewStatus = status;
    content.issues[0].body = `FIRST_LINE\nSECOND_LINE [[${evidenceRef}]]`;
    data.working.current!.state.problemWork = content;
    data.working.current!.state.substantiveResult!.content.lead = content.understanding;
    data.working.current!.state.substantiveResult!.content.claims = [];
    data.working.current!.state.substantiveResult!.content.issueArticles = content.issues.map(
      ({ issueKey, issueRef, question, body }) => ({ issueKey, issueRef, question, body }),
    );
    const html = renderToStaticMarkup(createElement(StaticRouter, {location:'/graph'}, createElement(SuiteGraphKnowledgePanel, {read:buildSuiteMatterGraph(data),revision:data.working.current,selectedTarget:null,selectedEvent:null,tab:'knowledge',onTabChange:()=>{}})));
    expect(html).toContain('已保存问题正文');
    expect(html).toContain('whitespace-pre-wrap');
    expect(html).toContain('FIRST_LINE\nSECOND_LINE');
    expect(html).toContain('依据');
    expect(html).not.toContain(`[[${evidenceRef}]]`);
    expect(html).not.toContain('此前综合认识');
  },
);

it.each(['CURRENT', 'STALE'] as const)(
  'retains saved atomic claims for historical problem work with %s overview',
  status => {
    const data = libraryMatterFixture();
    const content = structuredClone(jobAidReadingFixture().current!.content);
    content.historicalSourceSchema = 'wiselink.jobaid-problem-work.v2';
    content.overviewStatus = status;
    data.working.current!.state.problemWork = content;
    data.working.current!.state.substantiveResult!.content.lead = content.understanding;
    data.working.current!.state.substantiveResult!.content.claims = [{
      claimId: 'HISTORICAL_CLAIM',
      text: 'HISTORICAL_CLAIM_TEXT',
      basis: 'CONDITIONAL_INFERENCE',
      premises: [],
    }];
    const html = renderToStaticMarkup(createElement(StaticRouter, {location:'/graph'}, createElement(SuiteGraphKnowledgePanel, {read:buildSuiteMatterGraph(data),revision:data.working.current,selectedTarget:null,selectedEvent:null,tab:'knowledge',onTabChange:()=>{}})));
    expect(html).toContain('HISTORICAL_CLAIM_TEXT');
    expect(html).toContain(status === 'STALE' ? '此前综合认识' : '当前认识');
  },
);

it('provides a direct Wiki reading action from the knowledge overview', () => {
  const data = libraryMatterFixture();
  const html = renderToStaticMarkup(createElement(StaticRouter, {location:'/graph'}, createElement(SuiteGraphKnowledgePanel, {
    read: buildSuiteMatterGraph(data),
    revision: data.working.current,
    selectedTarget: null,
    selectedEvent: null,
    tab: 'knowledge',
    onTabChange: () => {},
    onOpenWiki: () => {},
  })));
  expect(html).toContain('阅读完整事项 Wiki');
});

it.each([false, true])('keeps issue-level pending questions and identity, duplicate state question=%s', duplicate => {
  const data = libraryMatterFixture();
  const content = structuredClone(jobAidReadingFixture().current!.content);
  const pending = { question: 'Exact pending question', affects: 'Scope remains unknown', nextEvidence: 'Controlled scope record', reason: 'No supplied scope evidence' };
  content.issues[0].openQuestions = [pending];
  content.issues.push({...structuredClone(content.issues[0]), issueKey: 'second-issue', issueRef: 'issue:second', openQuestions: [{...pending, affects: 'Second issue impact'}]});
  data.working.current!.state.problemWork = content;
  data.working.current!.state.openQuestions = duplicate ? [{itemId:'top-question',text:pending.question,basisRefs:[]}] : [];
  data.working.current!.state.reviewConditions = [];
  const html = renderToStaticMarkup(createElement(StaticRouter, {location:'/graph'}, createElement(SuiteGraphKnowledgePanel, {read:buildSuiteMatterGraph(data),revision:data.working.current,selectedTarget:null,selectedEvent:null,tab:'discussion',onTabChange:()=>{}})));
  expect(html.match(/未决问题：Exact pending question/g)).toHaveLength(1);
  expect(html).toContain(content.issues[0].issueRef);
  expect(html).toContain(content.issues[1].issueRef);
  expect(html).toContain('Scope remains unknown');
  expect(html).toContain('Second issue impact');
  expect(html).toContain('Controlled scope record');
  expect(html).not.toContain('当前工作没有已保存的未决问题');
});

it('shows each pending question once in the knowledge summary', () => {
  const data = libraryMatterFixture();
  const content = structuredClone(jobAidReadingFixture().current!.content);
  const pending = { question: 'ONE_PENDING_QUESTION', affects: '', nextEvidence: '', reason: '' };
  content.issues[0].openQuestions = [pending];
  data.working.current!.state.problemWork = content;
  data.working.current!.state.openQuestions = [{itemId:'same-question',text:pending.question,basisRefs:[]}];
  data.working.current!.state.reviewConditions = [];
  const html = renderToStaticMarkup(createElement(StaticRouter, {location:'/graph'}, createElement(SuiteGraphKnowledgePanel, {read:buildSuiteMatterGraph(data),revision:data.working.current,selectedTarget:null,selectedEvent:null,tab:'knowledge',onTabChange:()=>{}})));
  expect(html.match(/ONE_PENDING_QUESTION/g)).toHaveLength(1);
});

it.each([
  'saved-summary',
  'saved-list-brief',
  'problem-understanding',
  'problem-list-brief',
  'claim-overview',
  'selected-claim',
  'display-selected-claim',
] as const)('reads inline evidence in %s with source context and a visible unresolved-reference warning', surface => {
  const data = libraryMatterFixture();
  const revision = data.working.current!;
  const result = revision.state.substantiveResult!;
  const content = structuredClone(jobAidReadingFixture().current!.content);
  const source = content.evidence[0];
  const body = `GRAPH_BODY_HEAD\nGRAPH_BODY_TAIL [[${source.evidenceRef}]] [[unresolved-evidence]]`;
  result.evidence = [source];
  if (surface === 'saved-summary') result.content.lead = body;
  if (surface === 'saved-list-brief') {
    result.content.lead = '';
    result.content.listBrief = body;
  }
  if (surface === 'problem-understanding' || surface === 'problem-list-brief') {
    content.understanding = surface === 'problem-understanding' ? body : '';
    content.listBrief = body;
    revision.state.problemWork = content;
  }
  const selecting = surface === 'selected-claim' || surface === 'display-selected-claim';
  if (surface === 'claim-overview' || selecting) result.content.claims[0].text = body;
  const read = buildSuiteMatterGraph(data);
  if (surface === 'display-selected-claim') read.graph.rootKind = 'display';
  const selectedTarget = selecting
    ? [...read.targets.values()].find(target => target.kind === 'claim')!
    : null;
  const before = JSON.stringify(revision);
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/graph' },
    createElement(SuiteGraphKnowledgePanel, {
      read, revision, selectedTarget, selectedEvent: null,
      tab: 'knowledge', onTabChange: () => {}, onLocateEvidence: () => {},
    })));
  expect(html).toContain('GRAPH_BODY_HEAD\nGRAPH_BODY_TAIL');
  expect(html).toContain('whitespace-pre-wrap');
  expect(html).toContain('依据');
  expect(html).toContain(source.title);
  expect(html).toContain(source.excerpt);
  expect(html).toContain('前往这份文档的原文');
  expect(html).toContain('［依据无法读回］');
  expect(html).not.toContain(`[[${source.evidenceRef}]]`);
  expect(html).not.toContain('[[unresolved-evidence]]');
  expect(JSON.stringify(revision)).toBe(before);
});

it.each(['summary', 'claim-overview', 'selected-claim'] as const)(
  'locates the exact saved source from an inline %s reference', async surface => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/graph' });
    const globals: Record<string, unknown> = {
      window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    const descriptors = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(globals)) {
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    const container = dom.window.document.getElementById('root') as HTMLElement;
    const root = createRoot(container);
    try {
      const data = libraryMatterFixture();
      const revision = data.working.current!;
      const result = revision.state.substantiveResult!;
      const source = structuredClone(jobAidReadingFixture().current!.content.evidence[0]);
      const body = `INLINE_SAVED_TEXT [[${source.evidenceRef}]]`;
      result.evidence = [source];
      if (surface === 'summary') result.content.lead = body;
      else result.content.claims[0].text = body;
      const read = buildSuiteMatterGraph(data);
      const selectedTarget = surface === 'selected-claim'
        ? [...read.targets.values()].find(target => target.kind === 'claim')!
        : null;
      const onLocateEvidence = jest.fn();
      await act(async () => root.render(createElement(StaticRouter, { location: '/graph' },
        createElement(SuiteGraphKnowledgePanel, {
          read, revision, selectedTarget, selectedEvent: null,
          tab: 'knowledge', onTabChange: () => {}, onLocateEvidence,
        }))));
      const locateButton = Array.from(container.querySelectorAll('button'))
        .find(button => button.textContent === '前往这份文档的原文');
      expect(locateButton).toBeDefined();
      await act(async () => locateButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      expect(onLocateEvidence).toHaveBeenCalledTimes(1);
      expect(onLocateEvidence).toHaveBeenCalledWith(source);
      expect(onLocateEvidence.mock.calls[0][0]).toBe(source);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  },
);
