import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom';
import DocumentParsingPage from '../../client/src/pages/DocumentParsingPage/DocumentParsingPage';
import { readingReturnTarget } from '../../client/src/features/matter/reading-return';
import type { DocumentAssessmentEvidence } from '../../client/src/features/matter/assessment-reading';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';

const { JSDOM } = require('jsdom');
const mockPageRead = jest.fn();
const mockOriginalRead = jest.fn();
const mockStartParse = jest.fn();
const mockToast = jest.fn();
const mockPublish = jest.fn();
const mockRefresh = jest.fn();
let mockWorking = jobAidReadingFixture();

jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToast(...args) } }));
jest.mock('@client/src/api', () => ({ canonicalHost: {
  getCanonicalHostClientSessionGeneration: () => 1,
  getCanonicalHostIdentityContext: async () => ({ userId: 'synthetic-user', tenantId: 'synthetic-tenant' }),
  getDocumentParsingPage: (...args: unknown[]) => mockPageRead(...args),
  isCanonicalObjectNotFound: () => false,
} }));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  readParsedDocument: (...args: unknown[]) => mockOriginalRead(...args),
  startDocumentParse: (...args: unknown[]) => mockStartParse(...args),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ authenticationRequired: false, sessionGeneration: 1 }),
}));
jest.mock('@client/src/app/providers/CurrentObjectContextProvider', () => ({
  useCurrentObjectContext: () => ({ publishCurrentObject: mockPublish }),
}));
jest.mock('@client/src/features/navigation/contextual-navigation', () => ({ buildCurrentObjectContext: () => null }));
jest.mock('@client/src/utils/recent-work-items', () => ({ rememberRecentWorkItem: jest.fn(), forgetRecentWorkItem: jest.fn() }));
jest.mock('@client/src/pages/DocumentParsingPage/useJobAidWorkingRead', () => ({
  useJobAidWorkingRead: () => ({ data: mockWorking, error: null, temporaryError: null, refresh: mockRefresh,
    refreshing: false, baseFallbackAllowed: false }),
}));
jest.mock('@client/src/features/workitem/useOverallRegeneration', () => ({ useOverallRegeneration: () => ({ disabled: true }) }));
jest.mock('@client/src/features/workitem/useReviewOverallProjection', () => ({ useReviewOverallProjection: () => ({ visible: false }) }));
jest.mock('@client/src/services/viewModelMappers', () => ({ toWorkItemView: () => ({}), staleReasonLabel: () => '' }));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) =>
    createElement('button', { onClick, disabled }, children),
}));
jest.mock('@client/src/components/ui/native-select', () => ({ NativeSelect: 'select', NativeSelectOption: 'option' }));
jest.mock('@client/src/components/ui/textarea', () => ({ Textarea: 'textarea' }));
jest.mock('@client/src/features/workbench/WorkbenchShell', () => ({
  __esModule: true, default: ({ children }: { children: ReactNode }) => createElement('main', null, children),
}));
jest.mock('@client/src/features/workbench/RetainedWorkbenchPanel', () => ({
  __esModule: true, default: ({ active, children }: { active: boolean; children: ReactNode }) => active ? children : null,
  useWorkbenchPanelActive: () => true,
}));
jest.mock('@client/src/pages/DocumentParsingPage/WorkItemAssessmentWorkspace', () => ({
  __esModule: true, default: ({ children }: { children: ReactNode }) => children,
}));
// Keep the actual Page -> JobAidProblemWorkspace -> EngineeringIssueBody ->
// AssessmentEvidenceContext button chain. Unrelated workbench surfaces are inert.
jest.mock('@client/src/pages/DocumentParsingPage/runtime-monitor/WorkItemRuntimeDiagnostic', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/JobAidExecutionActivity', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/WorkItemProcessWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/AeoAuthoringWorkspace', () => ({ AeoAuthoringWorkspace: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/ApplicabilitySelectionPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/AssessmentRuleWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/AssessmentSemanticsOverview', () => ({ AssessmentSemanticsOverview: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentReaderWorkspace', () => ({ DocumentReaderWorkspace: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/PdfSourcePane', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/ReferenceMentionPreview', () => ({ ReferenceMentionPreview: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/StructuredContentBrowser', () => ({ StructuredContentBrowser: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentUnavailableReview', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/review/ReviewImpactPreview', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/review/ContinuousReviewPanel', () => ({
  __esModule: true, default: ({ onLocateSourceBinding }: {
    onLocateSourceBinding: (binding: {workItemId: string; documentVersionId: string; originalSourceRefId: string}) => void;
  }) => createElement('button', { id: 'legacy-review-source', onClick: () => onLocateSourceBinding({
    workItemId: 'WI-current', documentVersionId: 'DV-current', originalSourceRefId: 'legacy-review-ref',
  }) }, '旧复核来源'),
}));
jest.mock('@client/src/features/review/InitialAnalysisProgress', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/review/InitialAnalysisContinueButton', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/workitem/OverallAssessmentHero', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/workitem/AuthorityStrip', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/workbench/EvidencePanel', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/navigation/NavigatorTree', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/document-parsing.css', () => ({}));
jest.mock('@client/src/pages/DocumentParsingPage/pdf-source-pane.css', () => ({}));
jest.mock('@client/src/features/workbench/workbench-shell.css', () => ({}));
jest.mock('@client/src/features/review/review-loop.css', () => ({}));
jest.mock('@client/src/features/workbench/evidence-panel.css', () => ({}));
jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));
jest.mock('@client/src/features/matter/saved-jobaid-reading.css', () => ({}));

const sourceRef = 'PRUN-synthetic-old:paragraph/full:1';
const parseRun = 'PRUN-synthetic-old';
const errorMessage = '这条保存依据的解析定位不完整或与来源不一致，暂不能打开原文。';
let dom: { window: Window & typeof globalThis };
let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
const globals = new Map<string, PropertyDescriptor | undefined>();

function evidence(overrides: Partial<DocumentAssessmentEvidence> = {}): DocumentAssessmentEvidence {
  return { kind: 'DOCUMENT_PASSAGE', evidenceRef: 'saved-original-evidence', title: '保存的旧解析依据',
    versionLabel: '旧修订', excerpt: '仅适用于构型A，执行状态未知。', workItemId: 'WI-current',
    documentVersionId: 'DV-source', sourceRefId: sourceRef, locator: JSON.stringify({ parseRunId: parseRun, sourceRefId: sourceRef }),
    ...overrides };
}
function page(workItemId: string) {
  return { status: 'FRESH_READ', workItem: { workItemId, revision: 1, phase: 'REGISTERED',
    source: { documentVersionId: 'DV-current', documentId: 'DOC-current', sourceByteLength: 100 },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' }, package: null, assessment: null, integratedAssessment: null, aeo: null },
    entry: { normalizedFamily: 'SB' }, libraryIndex: { nodes: [] }, timeline: [], initialAnalysis: null,
    readerProjection: { units: [], query: '', translation: { status: 'UNAVAILABLE' } } };
}
beforeAll(() => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://synthetic.invalid' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.requestAnimationFrame = () => 0;
});
afterAll(() => {
  dom.window.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
});
beforeEach(() => {
  jest.clearAllMocks(); mockWorking = jobAidReadingFixture();
  mockPageRead.mockImplementation(async (id: string) => page(id));
  mockOriginalRead.mockImplementation(() => { throw new Error('Unexpected original API call inside navigation test'); });
  mockStartParse.mockImplementation(() => { throw new Error('Unexpected parse start'); });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

async function mount(saved: DocumentAssessmentEvidence, query = '', panel = 'assessment') {
  const current = mockWorking.current!;
  current.workItemId = 'WI-current'; current.documentVersionId = 'DV-current';
  current.content.evidence = [saved];
  current.content.issues = [{ ...current.content.issues[0], issueKey: 'saved-issue', question: '保存的判断',
    body: `必须核对保存版本的条件。[[${saved.evidenceRef}]]`, riskScenarios: [], measures: [],
    otherClassifications: [], requirementHandling: [], openQuestions: [] }];
  router = createMemoryRouter([
    { path: '/work-items/:workItemId/analysis', element: createElement(DocumentParsingPage) },
    { path: '/document-versions/:documentVersionId', element: createElement(function ExactReadingDestination() {
      const location = useLocation(); return createElement('output', null, `${location.pathname}${location.search}`);
    }) },
  ], { initialEntries: [`/work-items/WI-current/analysis?panel=${panel}${query ? '&' + query : ''}`] });
  await act(async () => { root.render(createElement(RouterProvider, { router })); });
  expect(container.textContent).toContain('必须核对保存版本的条件。');
}
async function clickEvidence() {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent === '前往这份文档的原文');
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}

describe('actual WorkItem saved evidence button -> exact parsed original navigation', () => {
  it.each(['WI-current', 'WI-other', null])('uses saved parse/DVI/full source ref before the %s WorkItem branch', async workItemId => {
    const saved = evidence({ workItemId }); const original = structuredClone(saved);
    await mount(saved); await clickEvidence();
    expect(router.state.location.pathname).toBe('/document-versions/DV-source');
    const query = new URLSearchParams(router.state.location.search);
    expect(query.get('parseRunId')).toBe(parseRun); expect(query.get('sourceRef')).toBe(sourceRef);
    expect(query.get('returnWorkItemId')).toBe('WI-current');
    expect(readingReturnTarget(query, 'DV-source')).toEqual({ route: '/work-items/WI-current', label: '返回评估简报' });
    expect(saved).toEqual(original); expect(mockToast).not.toHaveBeenCalled();
    expect(mockOriginalRead).not.toHaveBeenCalled(); expect(mockStartParse).not.toHaveBeenCalled();
  });

  it.each([
    ['returnMatterId=MAT-test&returnMatterPanel=review&returnWorkItemId=WI-ignored', 'returnMatterId', 'MAT-test'],
    ['returnLibraryWorkItemId=WI-library&returnWorkItemId=WI-ignored', 'returnLibraryWorkItemId', 'WI-library'],
    ['returnWorkItemId=WI-origin', 'returnWorkItemId', 'WI-origin'],
  ])('retains only the existing safe return choice from %s', async (origin, key, value) => {
    await mount(evidence(), `${origin}&returnTo=https%3A%2F%2Fevil.invalid&parseRunId=LATEST&q=unrelated`);
    await clickEvidence();
    const query = new URLSearchParams(router.state.location.search);
    expect(query.get(key)).toBe(value); expect(query.get('parseRunId')).toBe(parseRun);
    expect(query.get('sourceRef')).toBe(sourceRef); expect(query.has('returnTo')).toBe(false); expect(query.has('q')).toBe(false);
    expect([...query.keys()].filter(item => ['returnWorkItemId', 'returnLibraryWorkItemId', 'returnMatterId'].includes(item))).toEqual([key]);
  });

  it.each([
    JSON.stringify({ parseRunId: parseRun, sourceRefId: 'another-full-ref' }),
    JSON.stringify({ parseRunId: parseRun }), JSON.stringify({ parseRunId: '' }),
    JSON.stringify({ parseRunId: null, sourceRefId: sourceRef }),
    JSON.stringify({ parseRunId: '   ', sourceRefId: sourceRef }),
    JSON.stringify({ parseRunId: 9, sourceRefId: sourceRef }), '{"parseRunId":',
  ])('rejects explicit invalid parsed locator without navigation or another read: %s', async locator => {
    await mount(evidence({ locator }));
    const location = router.state.location; const reads = mockPageRead.mock.calls.length;
    await clickEvidence();
    expect(router.state.location).toBe(location); expect(mockPageRead).toHaveBeenCalledTimes(reads);
    expect(mockToast).toHaveBeenCalledWith(errorMessage); expect(container.textContent).toContain('必须核对保存版本的条件。');
    expect(mockOriginalRead).not.toHaveBeenCalled(); expect(mockStartParse).not.toHaveBeenCalled();
  });

  it('rejects a parsed locator when the saved evidence has no exact source ref', async () => {
    await mount(evidence({ sourceRefId: '' }));
    const location = router.state.location; const reads = mockPageRead.mock.calls.length;
    await clickEvidence();
    expect(router.state.location).toBe(location); expect(mockPageRead).toHaveBeenCalledTimes(reads);
    expect(mockToast).toHaveBeenCalledWith(errorMessage);
    expect(mockOriginalRead).not.toHaveBeenCalled(); expect(mockStartParse).not.toHaveBeenCalled();
  });

  it.each(['第3页', '/legacy/page/3', JSON.stringify({ page: 3 })])('preserves the true legacy same-WorkItem route: %s', async locator => {
    await mount(evidence({ locator, documentVersionId: 'DV-current' })); await clickEvidence();
    expect(router.state.location.pathname).toBe('/work-items/WI-current/analysis');
    const query = new URLSearchParams(router.state.location.search);
    expect(query.get('panel')).toBe('reader'); expect(query.get('sourceRef')).toBe(sourceRef);
    expect(query.get('documentVersionId')).toBe('DV-current'); expect(query.has('parseRunId')).toBe(false);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('preserves the existing cross-WorkItem legacy return route', async () => {
    await mount(evidence({ workItemId: 'WI-other', documentVersionId: 'DV-current', locator: '第3页' })); await clickEvidence();
    expect(router.state.location.pathname).toBe('/work-items/WI-other/analysis');
    const query = new URLSearchParams(router.state.location.search);
    expect(query.get('returnWorkItemId')).toBe('WI-current'); expect(query.get('sourceRef')).toBe(sourceRef);
    expect(query.has('parseRunId')).toBe(false);
  });

  it('keeps the ReviewSourceBinding callback without locator compatible', async () => {
    await mount(evidence(), '', 'review');
    await act(async () => { container.querySelector<HTMLButtonElement>('#legacy-review-source')!.click(); });
    expect(router.state.location.pathname).toBe('/work-items/WI-current/analysis');
    const query = new URLSearchParams(router.state.location.search);
    expect(query.get('sourceRef')).toBe('legacy-review-ref'); expect(query.get('panel')).toBe('reader');
    expect(query.has('parseRunId')).toBe(false); expect(mockToast).not.toHaveBeenCalled();
  });
});
