import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import SuiteMatterGraphPage from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphPage';
import { libraryMatterFixture } from './fixtures/library-matter';
import { buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import type { SuiteMatterGraphViewProps } from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphView';
const mockNavigate = jest.fn();
let mockProps: SuiteMatterGraphViewProps;
const mockData = libraryMatterFixture();
jest.mock('react-router-dom', () => ({...jest.requireActual('react-router-dom'), useNavigate: () => mockNavigate}));
jest.mock('../../client/src/app/providers/CurrentUserSessionProvider', () => ({useCurrentUserSession: () => ({sessionGeneration: 1, authenticationRequired: false})}));
jest.mock('../../client/src/pages/RelationGraphPage/useSuiteMatterGraph', () => ({useSuiteMatterGraph: () => ({graph: buildSuiteMatterGraph(mockData), revision: mockData.working.current, workspace: mockData, loading: false, error: null})}));
jest.mock('../../client/src/pages/RelationGraphPage/SuiteMatterGraphView', () => ({__esModule: true, default: (props: SuiteMatterGraphViewProps) => {mockProps = props; return null;}}));
function render(search = '') { return renderToStaticMarkup(createElement(StaticRouter, {location: `/graph?matterId=ui-test-matter${search}`}, createElement(SuiteMatterGraphPage, {matterId: 'ui-test-matter'}))); }
it('rejects ambiguous explicit work refs instead of showing current work', () => {
  expect(render('&workRef=a&workRef=b')).toContain('指定工作身份无效');
  expect(render('&workRef=')).toContain('指定工作身份无效');
});
it('opens exact work and exact original source from graph actions', () => {
  render();
  mockProps.onOpenWiki!();
  expect(mockNavigate.mock.calls.at(-1)![0]).toContain('workRef=test-working-3');
  mockProps.onOpenProcess!();
  const processRoute = new URL(mockNavigate.mock.calls.at(-1)![0], 'https://example.test');
  expect(processRoute.pathname).toBe('/matters/ui-test-matter/process');
  expect(processRoute.searchParams.get('workRef')).toBe('test-working-3');
  expect(new URLSearchParams(processRoute.searchParams.get('returnGraphQuery')!).get('matterId')).toBe('ui-test-matter');
  mockProps.onLocateEvidence!({kind: 'DOCUMENT_PASSAGE', evidenceRef: 'e1', title: '原文', versionLabel: 'R1', excerpt: '条件', workItemId: null, documentVersionId: 'old-version', sourceRefId: 'source-a', locator: JSON.stringify({parseRunId: 'old-run', sourceRefId: 'source-a'})});
  const route = new URL(mockNavigate.mock.calls.at(-1)![0], 'https://example.test');
  expect(route.pathname).toBe('/document-versions/old-version');
  expect(route.searchParams.get('parseRunId')).toBe('old-run');
  expect(route.searchParams.get('sourceRef')).toBe('source-a');
  expect(new URLSearchParams(route.searchParams.get('returnGraphQuery')!).get('workRef')).toBe('test-working-3');
});

it('opens a linked document timeline with exact version and graph return state', () => {
  mockData.matter.catalog.entries = [{
    workItemId: 'wi-timeline', relationRole: 'PRIMARY', linkedAtWorkItemRevision: 1,
    currentWorkItemRevision: 1, workItemChangedSinceLink: false, workItemStatus: 'ACTIVE',
    document: {documentId: 'doc-a', documentVersionId: 'dv-a', documentCode: 'SB-001', businessRevision: 'R02', normalizedFamily: 'SB-001'},
    documentCurrentness: {familyId: 'family-a', currentDocumentVersionId: 'dv-a', currentGeneration: 2, selectedVersionIsCurrent: true},
    sourceNavigation: {status: 'AVAILABLE', sourceRefCount: 5, structuredContentPath: '/document-versions/dv-a'},
  }];
  render('&perspective=documents&density=5');
  expect(mockProps.timelineSources?.map(item => item.document.documentVersionId)).toEqual(['dv-a']);
  mockProps.onOpenTimelineSource!(mockProps.timelineSources![0]);
  const route = new URL(mockNavigate.mock.calls.at(-1)![0], 'https://example.test');
  expect(route.pathname).toBe('/timeline');
  expect(route.searchParams.get('documentVersionId')).toBe('dv-a');
  expect(route.searchParams.get('returnDocumentVersionId')).toBe('dv-a');
  const graph = new URLSearchParams(route.searchParams.get('returnGraphQuery')!);
  expect(graph.get('matterId')).toBe('ui-test-matter');
  expect(graph.get('workRef')).toBe('test-working-3');
  expect(graph.get('perspective')).toBe('documents');
  expect(graph.get('density')).toBe('5');
});
