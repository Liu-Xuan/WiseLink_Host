import { createElement, type ReactNode } from 'react';
import { StaticRouter } from 'react-router-dom/server';
import { renderToStaticMarkup } from 'react-dom/server';
import SuiteGraphKnowledgePanel from '../../client/src/pages/RelationGraphPage/SuiteGraphKnowledgePanel';
import { buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import { libraryMatterFixture } from './fixtures/library-matter';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
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

jest.mock('@client/src/components/ui/button', () => ({ Button: ({children}: {children: ReactNode}) => createElement('button', null, children) }));

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
