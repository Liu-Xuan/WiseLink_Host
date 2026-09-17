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
  if (status === 'NOT_AVAILABLE') data.working.current!.state.substantiveResult = null;
  content.issues[0].question = 'UNIQUE_NEW_PROBLEM_QUESTION';
  data.working.current!.state.problemWork = content;
  const html = renderToStaticMarkup(createElement(StaticRouter, {location: "/graph"}, createElement(SuiteGraphKnowledgePanel, {read:buildSuiteMatterGraph(data), revision:data.working.current, selectedTarget:null,selectedEvent:null,tab:'knowledge',onTabChange:()=>{}})));
  expect(html).toContain('UNIQUE_NEW_PROBLEM_QUESTION');
});

jest.mock('@client/src/components/ui/button', () => ({ Button: ({children}: {children: ReactNode}) => createElement('button', null, children) }));

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
