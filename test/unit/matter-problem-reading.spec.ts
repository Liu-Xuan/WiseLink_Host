import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MatterProblemWork from '../../client/src/features/matter/MatterProblemWork';
import { readableMatterOverview } from '../../client/src/features/matter/matter-overview-reading';
import { libraryMatterFixture } from './fixtures/library-matter';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/features/matter/OverviewSourceWork', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/matter/OverviewCorrectionNotices', () => ({
  __esModule: true,
  default: () => null,
}));

test('reads saved Matter issues and sources without an overview result', () => {
  const revision = libraryMatterFixture().working.current!;
  const content = structuredClone(jobAidReadingFixture().current!.content);
  content.overviewStatus = 'NOT_AVAILABLE';
  content.issues[0].question = 'SAVED_PROBLEM_QUESTION';
  revision.state.problemWork = content;
  revision.state.substantiveResult = null;
  const html = renderToStaticMarkup(createElement(MatterProblemWork, {
    revision,
    onLocateDocument: () => undefined,
  }));
  expect(html).toContain('SAVED_PROBLEM_QUESTION');
  expect(html).toContain('问题正文可读；综合尚未形成');
  expect(html).toContain(content.issues[0].body.split(' ')[0]);
  expect(html).toContain('仅适用于构型 A。');
  expect(html).toContain('前往这份文档的原文');
});

test('does not restore an old overview when the selected work has no overview', () => {
  const revision = libraryMatterFixture().working.current!;
  const old = revision.state.substantiveResult;
  const content = structuredClone(jobAidReadingFixture().current!.content);
  content.overviewStatus = 'NOT_AVAILABLE';
  revision.state.problemWork = content;
  expect(readableMatterOverview(revision)).toBeNull();
  content.overviewStatus = 'STALE';
  expect(readableMatterOverview(revision)).toBe(old);
  content.overviewStatus = 'CURRENT';
  expect(readableMatterOverview(revision)).toBe(old);
});
