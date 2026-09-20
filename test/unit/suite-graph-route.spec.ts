import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import SuiteMatterGraphPage from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphPage';
import { libraryMatterFixture } from './fixtures/library-matter';
import { buildSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import type { SuiteGraphActivityCandidate } from '../../client/src/pages/RelationGraphPage/suite-matter-graph';
import type { SuiteMatterGraphViewProps } from '../../client/src/pages/RelationGraphPage/SuiteMatterGraphView';
import type { DocumentActivityRevision } from '@shared/document-activity.interface';
const mockNavigate = jest.fn();
let mockHistorical = false;
let mockProps: SuiteMatterGraphViewProps;
let mockSourcesInput: {
  restorePins?: import('../../client/src/pages/RelationGraphPage/suite-graph-timeline').SuiteGraphTimelineEventPins;
};
const mockData = libraryMatterFixture();
const mockActivities = new Map<string, SuiteGraphActivityCandidate>();
const mockExpandSource = jest.fn();
jest.mock('react-router-dom', () => ({...jest.requireActual('react-router-dom'), useNavigate: () => mockNavigate}));
jest.mock('../../client/src/app/providers/CurrentUserSessionProvider', () => ({useCurrentUserSession: () => ({sessionGeneration: 1, authenticationRequired: false})}));
jest.mock('../../client/src/api/engineering-matter', () => ({getEngineeringMatterDirectory: jest.fn()}));
jest.mock('@client/src/api/canonical-host', () => ({getCanonicalHostClientSessionGeneration: () => 1, getCanonicalLibraryDocuments: jest.fn()}));
jest.mock('../../client/src/pages/RelationGraphPage/useSuiteMatterGraph', () => ({useSuiteMatterGraph: () => ({graph: {...buildSuiteMatterGraph(mockData), historical: mockHistorical}, revision: mockData.working.current, workspace: mockData, loading: false, error: null})}));
jest.mock('../../client/src/pages/RelationGraphPage/useSuiteGraphSources', () => ({useSuiteGraphSources: (input: typeof mockSourcesInput) => {
  mockSourcesInput = input;
  return {
  activities: mockActivities,
  sources: [...mockActivities.keys()].map((documentVersionId) => ({documentVersionId, label: 'SB-001 · R02', status: 'loaded', notice: null})),
  loading: false,
  activeSourceId: null,
  selectSource: jest.fn(),
  expandSource: mockExpandSource,
  };
}}));
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

function catalogEntry(documentVersionId: string) {
  return {
    workItemId: 'wi-timeline', relationRole: 'PRIMARY' as const, linkedAtWorkItemRevision: 1,
    currentWorkItemRevision: 1, workItemChangedSinceLink: false, workItemStatus: 'ACTIVE',
    document: {documentId: 'doc-a', documentVersionId, documentCode: 'SB-001', businessRevision: 'R02', normalizedFamily: 'SB-001'},
    documentCurrentness: {familyId: 'family-a', currentDocumentVersionId: documentVersionId, currentGeneration: 2, selectedVersionIsCurrent: true},
    sourceNavigation: {status: 'AVAILABLE' as const, sourceRefCount: 5, structuredContentPath: `/document-versions/${documentVersionId}`},
  };
}

function activityCandidate(): DocumentActivityRevision {
  return {
    schemaVersion: 'wiselink.document.activity-candidate.v1',
    runRef: 'run-1',
    candidateRevision: 2,
    candidateOnly: true,
    sourceBinding: {original: {documentVersionId: 'dv-a', parseRunId: 'pr-1', parseRevision: 1, sourceArtifactId: 'art-1', sourceSha256: 'sha', sourceByteLength: 10}, semanticRevision: 1},
    producer: {skillVersion: 'skill-1', modelVersion: 'model-1'},
    savedAt: '2026-09-01T00:00:00.000Z',
    readCoverage: {
      status: 'DELIVERED_RANGES_ONLY',
      selection: {sectionIds: ['S1']},
      deliveredRanges: [{sectionId: 'S1', offset: 0, unitIds: ['U1'], anchorIds: ['A1'], nextOffset: null}],
      sourceCoverage: {knownPageCount: 1, readPageIndexes: [0], unresolvedRanges: []},
    },
    statements: [{
      statementKey: 'key-st-1',
      statementId: 'st-1',
      label: '厂家声明',
      quotes: [{anchorId: 'anchor-1', start: 0, end: 4, text: '原文'}],
      time: {role: 'OCCURRED', precision: 'DAY', expression: 'CALENDAR', raw: '2026-02-01', quoteIndex: 0},
      statusRaw: null,
      limitations: [],
    }],
    sourceAnchors: [],
  };
}

it('opens a saved statement timeline with exact pins and graph return state', () => {
  mockData.matter.catalog.entries = [catalogEntry('dv-a')];
  mockActivities.set('dv-a', {candidate: activityCandidate(), familyId: 'family-a'});
  render('&perspective=documents&density=5');
  const event = mockProps.timelineEvents!.find((item) => item.pins?.statementId === 'st-1');
  expect(event).toBeTruthy();
  expect(event!.nodeId).toBeTruthy();
  mockProps.onOpenEventTimeline!(event!);
  const route = new URL(mockNavigate.mock.calls.at(-1)![0], 'https://example.test');
  expect(route.pathname).toBe('/timeline');
  expect(route.searchParams.get('documentVersionId')).toBe('dv-a');
  expect(route.searchParams.get('parseRunId')).toBe('pr-1');
  expect(route.searchParams.get('candidateRevision')).toBe('2');
  expect(route.searchParams.get('runRef')).toBe('run-1');
  expect(route.searchParams.get('statementId')).toBe('st-1');
  expect(route.searchParams.get('anchor')).toBe('anchor-1');
  expect(route.searchParams.get('returnDocumentVersionId')).toBe('dv-a');
  const graph = new URLSearchParams(route.searchParams.get('returnGraphQuery')!);
  expect(graph.get('matterId')).toBe('ui-test-matter');
  expect(graph.get('workRef')).toBe('test-working-3');
  expect(graph.get('perspective')).toBe('documents');
  expect(graph.get('density')).toBe('5');
});

it('requests an unloaded source only through the explicit expand action', () => {
  mockData.matter.catalog.entries = [catalogEntry('dv-a')];
  mockActivities.clear();
  render();
  expect(mockProps.timelineSources).toEqual([]);
  mockProps.onExpandTimelineSource!('dv-a');
  expect(mockExpandSource).toHaveBeenCalledWith('dv-a');
});

it('passes exact returned event pins to the source loader', () => {
  const pins = {
    documentVersionId: 'dv-b',
    familyId: 'family-b',
    parseRunId: 'parse-b',
    candidateRevision: 7,
    runRef: 'run-b',
    statementId: 'statement-b',
    anchorId: 'anchor-b',
  };
  const query = new URLSearchParams({
    eventId: '["event","dv-b","parse-b","7","run-b","statement-b"]',
    eventPins: JSON.stringify(pins),
  });
  render(`&${query}`);
  expect(mockSourcesInput.restorePins).toEqual(pins);
});

it('keeps a usable view when historical work requests an unavailable perspective', () => {
  mockHistorical = true;
  mockProps = undefined as unknown as SuiteMatterGraphViewProps;
  render('&workRef=old-work&perspective=domain');
  expect(mockProps).toBeDefined();
  mockHistorical = false;
});
