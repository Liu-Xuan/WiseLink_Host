import { act, createElement, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import DocumentVersionReadingPage from '../../client/src/pages/DocumentParsingPage/DocumentVersionReadingPage';
import DocumentSavedEvidenceSource from '../../client/src/pages/DocumentParsingPage/DocumentSavedEvidenceSource';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { libraryDocuments, libraryQuicklook } from './fixtures/canonical-library';
import { summaryKnowledge } from './fixtures/derived-summary';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import { buildJobAidOverallProjection } from '../../server/modules/canonical-host/jobaid-overall-projection';
import { documentWorkbenchPanelRoute, readDocumentWorkbenchPanel } from '../../client/src/pages/DocumentParsingPage/document-workbench-panel';

const mockStatus = jest.fn(), mockReading = jest.fn(), mockCatalogue = jest.fn();
const mockQuicklook = jest.fn(), mockKnowledge = jest.fn(), mockLegacy = jest.fn();
const mockStart = jest.fn(), mockTranslation = jest.fn();
const mockPdfMount = jest.fn(), mockPdfUnmount = jest.fn();
jest.mock('@client/src/api/canonical-host', () => {
  let generation = 1;
  const sessions = new Set<() => void>();
  return {
    readDocumentParsingStatus: (...args: unknown[]) => mockStatus(...args),
    readParsedDocument: (...args: unknown[]) => mockReading(...args),
    getCanonicalLibraryDocuments: (...args: unknown[]) => mockCatalogue(...args),
    getCanonicalLibraryQuicklook: (...args: unknown[]) => mockQuicklook(...args),
    readEngineeringKnowledgeWork: (...args: unknown[]) => mockKnowledge(...args),
    getDocumentParsingPage: (...args: unknown[]) => mockLegacy(...args),
    startDocumentParsing: (...args: unknown[]) => mockStart(...args),
    readDocumentTranslationReading: (...args: unknown[]) => mockTranslation(...args),
    getCanonicalHostClientSessionGeneration: () => generation,
    subscribeCanonicalHostClientSession: (callback: () => void) => {
      sessions.add(callback); return () => sessions.delete(callback);
    },
    __advanceSession: () => { generation++; sessions.forEach(callback => callback()); },
    __resetSession: () => { generation = 1; },
  };
});
jest.mock('@client/src/pages/DocumentParsingPage/document-version-reading.css', () => ({}));
jest.mock('@client/src/features/matter/saved-jobaid-reading.css', () => ({}));
jest.mock('@client/src/pages/DocumentParsingPage/assessment-rule-workspace.css', () => ({}));
jest.mock('@client/src/features/matter/ClaimEvidenceDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => ({ sessionGeneration: 1, authenticationRequired: false }),
}));
jest.mock('@client/src/api/document-wiki', () => ({ readDocumentWiki: jest.fn() }));
jest.mock('@client/src/components/business-ui/api/files/service', () => ({ uploadFile: jest.fn() }));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children, asChild, ...props }: { children: ReactNode; asChild?: boolean }) =>
    asChild ? children : createElement('button', props, children),
}));
jest.mock('@client/src/components/ui/dialog', () => ({
  Dialog: () => null, DialogContent: () => null, DialogHeader: () => null, DialogTitle: () => null,
}));
jest.mock('@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({
  DocumentOriginalPreview: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentParsedImage', () => ({ DocumentParsedImage: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/MineruMarkdownReader', () => ({ MineruMarkdownReader: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/SemanticBilingualReader', () => ({ SemanticBilingualReader: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentOriginalCanvasPreview', () => ({
  __esModule: true,
  default: function Pdf() {
    useEffect(() => { mockPdfMount(); return () => mockPdfUnmount(); }, []);
    return createElement('div', { 'data-pdf-instance': 'original' });
  },
}));

const { JSDOM } = require('jsdom');
const host = jest.requireMock('@client/src/api/canonical-host');
let dom: InstanceType<typeof JSDOM>, container: HTMLElement, root: Root;
let router: ReturnType<typeof createMemoryRouter>;
const globals = new Map<string, PropertyDescriptor | undefined>();
let fullscreen: Element | null;
const libraryQuery = 'mode=document&familyId=FAM&selectedDocumentVersionId=DV-FAM-1&expandedFamilyIds=FAM&listY=428&quicklookY=317&ata2=34';
const baseQuery = new URLSearchParams({ parseRunId: 'PR1', returnDocumentVersionId: 'DV-FAM-1', returnLibraryQuery: libraryQuery }).toString();

function status(version = 'DV-FAM-1') {
  return { documentVersionId: version, familyId: 'FAM', documentCode: '777-FTD-31-21002',
    documentTitle: 'Saved work panel test', normalizedFamily: 'FTD', issuerAuthority: 'BOEING',
    businessRevision: 'R2', revisionDate: '', sourceGeneratedDate: '', selectedVersionIsCurrent: false,
    originalFilename: 'test.pdf', runtimeAvailable: true, runtime: { state: 'CALL_SUCCEEDED' },
    latestRun: null, publishedRun: { parseRunId: 'PR1', parseRevision: 7 } };
}
function reading(version = 'DV-FAM-1', run = 'PR1') {
  const original = originalFixture();
  original.binding = { ...original.binding, documentVersionId: version, parseRunId: run };
  return { documentVersionId: version, parseRunId: run, parseRevision: 7, original, markdown: 'saved original', assets: [],
    parser: { name: 'fixture', version: '1' }, titleEnhancement: { status: 'SUCCEEDED' }, projection: {} };
}
function knowledge(version = 'DV-FAM-1', workItemId = 'WI-OLD', workRef = 'JAWR-OLD') {
  const value = summaryKnowledge();
  value.entry = { ...value.entry, subjectId: workItemId, workRef, workRevision: 2, headline: `Full saved work ${version}` };
  if (!value.reading) throw new Error('Fixture reading missing');
  value.reading = { ...value.reading, resultRef: workRef, resultRevision: 2,
    scope: { kind: 'WORK_ITEM', workItemId, documentVersionId: version } };
  value.content.understanding = `Complete saved understanding ${version}; configuration remains unknown.`;
  return value;
}
function saved(version = 'DV-FAM-1', workItemId = 'WI-OLD', workRef = 'JAWR-OLD') {
  const value = libraryQuicklook(workItemId);
  value.document = { ...value.document, documentVersionId: version, familyId: 'FAM' };
  if (!value.result) throw new Error('Fixture result missing');
  value.result = { ...value.result, sourceResultId: workRef, revision: 2,
    jobAidRoundCompletion: 'COMPLETE', readingResult: knowledge(version, workItemId, workRef).reading };
  return value;
}
async function click(text: string): Promise<void> {
  const link = Array.from(container.querySelectorAll('.document-reading-saved-links a')).find(node => node.textContent === text);
  if (!link) throw new Error(`Missing workbench link ${text}`);
  await act(async () => link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
}
async function button(text: string): Promise<void> {
  const node = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === text);
  if (!node) throw new Error(`Missing button ${text}`);
  await act(async () => node.click());
}
async function mount(query = baseQuery): Promise<void> {
  router = createMemoryRouter([
    { path: '/document-versions/:documentVersionId', element: createElement(DocumentVersionReadingPage) },
    { path: '/library', element: createElement('p', null, 'Original library list') },
  ], { initialEntries: [`/document-versions/DV-FAM-1?${query}`], future: { v7_relativeSplatPath: true } });
  root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })));
}
beforeEach(() => {
  jest.clearAllMocks(); host.__resetSession(); fullscreen = null;
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.matchMedia = () => ({ matches: true });
  dom.window.requestAnimationFrame = (callback: () => void) => { callback(); return 1; };
  dom.window.cancelAnimationFrame = () => undefined;
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  dom.window.HTMLElement.prototype.scrollTo = () => undefined;
  dom.window.scrollTo = () => undefined;
  Object.defineProperty(dom.window.document, 'fullscreenElement', { get: () => fullscreen });
  dom.window.HTMLElement.prototype.requestFullscreen = async function () {
    fullscreen = this; dom.window.document.dispatchEvent(new dom.window.Event('fullscreenchange'));
  };
  dom.window.document.exitFullscreen = async () => {
    fullscreen = null; dom.window.document.dispatchEvent(new dom.window.Event('fullscreenchange'));
  };
  container = dom.window.document.getElementById('root');
  mockStatus.mockImplementation(async (version: string) => status(version));
  mockReading.mockImplementation(async (version: string, run: string) => reading(version, run));
  mockCatalogue.mockResolvedValue(libraryDocuments(['FAM']));
  mockQuicklook.mockImplementation(async (id: string) => id === 'WI-OLD' ? saved() : saved('DV-FAM-2', 'WI-NEW', 'JAWR-NEW'));
  mockKnowledge.mockImplementation(async (identity: { subjectId: string }) => identity.subjectId === 'WI-OLD'
    ? knowledge() : knowledge('DV-FAM-2', 'WI-NEW', 'JAWR-NEW'));
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  globals.clear();
});

it('retains original, panel scroll, mode and fullscreen across tabs/history without new reads', async () => {
  await mount();
  const workspace = container.querySelector('.source-reader-workspace');
  const original = container.querySelector<HTMLElement>('.source-reader-pane-scroll')!;
  const outline = container.querySelector<HTMLElement>('.source-reader-toc')!;
  original.scrollTop = 248; outline.scrollTop = 83;
  await button('仅原文'); await button('全屏');
  expect(fullscreen).toBe(workspace);
  await click('评估');
  expect(router.state.location.pathname).toBe('/document-versions/DV-FAM-1');
  expect(new URLSearchParams(router.state.location.search).get('returnLibraryQuery')).toBe(libraryQuery);
  expect(container.querySelector('.source-reader-workspace')).toBe(workspace);
  expect(container.textContent).toContain('Complete saved understanding');
  const issue = knowledge().content.issues[0];
  expect(container.textContent).toContain(issue.question);
  expect(container.textContent).toContain(issue.openQuestions[0].question);
  const assessment = container.querySelector<HTMLElement>('.document-saved-work-scroll')!;
  assessment.scrollTop = 357;
  await click('Wiki');
  const wiki = container.querySelectorAll<HTMLElement>('.document-saved-work-scroll')[1]; wiki.scrollTop = 219;
  await act(async () => { await router.navigate(-1); });
  expect(readDocumentWorkbenchPanel(new URLSearchParams(router.state.location.search)).panel).toBe('assessment');
  expect(container.querySelector('.document-saved-work-scroll')).toBe(assessment);
  expect(assessment.scrollTop).toBe(357);
  await act(async () => { await router.navigate(-1); });
  expect(original.scrollTop).toBe(248); expect(outline.scrollTop).toBe(83);
  expect(container.querySelector('.source-reader-stage')?.className).toContain('mode-original');
  await act(async () => { await router.navigate(1); }); await click('Wiki');
  expect(wiki.scrollTop).toBe(219); expect(fullscreen).toBe(workspace);
  expect(mockReading).toHaveBeenCalledTimes(1); expect(mockStatus).toHaveBeenCalledTimes(1);
  expect(mockCatalogue).toHaveBeenCalledTimes(1); expect(mockQuicklook).toHaveBeenCalledTimes(1);
  expect(mockKnowledge).toHaveBeenCalledTimes(1); expect(mockPdfMount).toHaveBeenCalledTimes(1);
  expect(mockPdfUnmount).not.toHaveBeenCalled(); expect(mockStart).not.toHaveBeenCalled(); expect(mockTranslation).not.toHaveBeenCalled();
  await button('退出全屏'); await click('原文');
  const back = Array.from(container.querySelectorAll<HTMLAnchorElement>('a')).find(node =>
    node.getAttribute('href')?.startsWith('/library?'));
  expect(back?.getAttribute('href')).toContain('listY=428');
  const returned = new URLSearchParams(back?.getAttribute('href')?.split('?')[1]);
  expect(returned.get('expandedFamilyIds')).toBe('FAM');
  expect(returned.get('selectedDocumentVersionId')).toBe('DV-FAM-1');
  expect(returned.get('quicklookY')).toBe('317');
});

function fiveIssueKnowledge(): ReturnType<typeof knowledge> {
  const read = knowledge();
  read.entry.headline = read.content.headline = 'Synthetic saved work headline';
  read.entry.listBrief = read.content.listBrief = '模拟问题需要核对构型；适用条件仍未知。';
  read.content.understanding = 'Synthetic source understanding, without an implementation decision.';
  read.content.roundCompletion = 'IN_PROGRESS';
  const issue = read.content.issues[0];
  read.content.issues = Array.from({ length: 5 }, (_value, index) => ({
    ...structuredClone(issue), issueKey: `ISSUE-${index}`, issueRef: `ISSUE-REF-${index}`,
    question: `Synthetic question ${index}?`,
    body: `Synthetic full problem ${index}; keep its complete saved reasoning. ${'Synthetic detailed reasoning. '.repeat(20)}Saved final condition ${index}. [[evidence-test]]`,
    riskScenarios: issue.riskScenarios.map(risk => ({ ...risk,
      conditions: [`Synthetic applicability ${index}`], limitations: [`Synthetic limitation ${index}`] })),
    openQuestions: [{ question: `Synthetic unknown ${index}`, affects: 'Applicability',
      reason: 'The saved source is conditional.', nextEvidence: `Synthetic required evidence ${index}` }],
  }));
  read.content.evidence = read.content.evidence.map(source => source.kind === 'DOCUMENT_PASSAGE' ? { ...source,
    workItemId: 'WI-OLD', documentVersionId: 'DV-FAM-1', sourceRefId: 'SR-TEST-P2',
    locator: JSON.stringify({ parseRunId: 'PR-SAVED-CITATION', sourceRefId: 'SR-TEST-P2' }) } : source);
  if (!read.reading) throw new Error('Saved reading fixture missing');
  read.reading.evidence = structuredClone(read.content.evidence);
  read.reading.content = { ...read.reading.content, headline: read.content.headline,
    listBrief: read.content.listBrief, lead: read.content.understanding,
    issueArticles: read.content.issues.map(({ issueKey, issueRef, question, body }) =>
      ({ issueKey, issueRef, question, body })) };
  return read;
}

function assertSingleSavedProblems(panel: Element, read: ReturnType<typeof fiveIssueKnowledge>): void {
  const text = panel.textContent ?? '';
  expect(text.split(read.entry.headline).length - 1).toBe(1);
  expect(text.split(read.content.understanding.split(' [[')[0]).length - 1).toBe(1);
  expect(panel.querySelector('article')?.getAttribute('data-work-ref')).toBe(read.entry.workRef);
  expect(panel.querySelector('article')?.getAttribute('data-work-revision')).toBe('2');
  expect(text).toContain('保存修订 2');
  for (const [index, issue] of read.content.issues.entries()) {
    expect(text.split(issue.question).length - 1).toBe(1);
    expect(text.split(issue.body.split(' [[')[0]).length - 1).toBe(1);
    expect(text).toContain(`Synthetic applicability ${index}`);
    expect(text).toContain(`Synthetic limitation ${index}`);
    expect(text).toContain(`Synthetic unknown ${index}`);
    expect(text).toContain(`Synthetic required evidence ${index}`);
  }
  expect(text).toContain('原文适用条件');
  expect(text).toContain('仅适用于构型 A。');
  expect(text).toContain('修订 1');
  expect(panel.querySelectorAll('.document-saved-issue')).toHaveLength(5);
}

it('shows the saved brief and each complete question once in assessment and Wiki while the work is in progress', async () => {
  const read = fiveIssueKnowledge();
  mockKnowledge.mockResolvedValue(read);
  await mount(`${baseQuery}&panel=assessment`);
  const assessment = container.querySelector('[aria-label="同版本已保存评估"]')!;
  assertSingleSavedProblems(assessment, read);
  expect(assessment.textContent).toContain(read.entry.listBrief);
  expect(assessment.querySelector('[aria-label="已保存综合意见"]')).toBeNull();
  await click('Wiki');
  const wiki = container.querySelector('[aria-label="同版本已保存Wiki"]')!;
  assertSingleSavedProblems(wiki, read);
  expect(mockReading).toHaveBeenCalledTimes(1);
  const citation = Array.from(wiki.querySelectorAll<HTMLButtonElement>('button'))
    .find(node => node.textContent === '前往这份文档的原文')!;
  await act(async () => citation.click());
  expect(mockReading).toHaveBeenLastCalledWith('DV-FAM-1', 'PR-SAVED-CITATION', expect.anything());
  expect(wiki.querySelector('[aria-label="保存依据的原文"]')).not.toBeNull();
  await button('返回保存内容');
  assertSingleSavedProblems(wiki, read);
  expect(mockKnowledge).toHaveBeenCalledTimes(1);
  expect(mockStart).not.toHaveBeenCalled();
});

it.each(['CANDIDATE_ONLY', 'STALE'] as const)('preserves a distinct %s overall with its saved claims and keeps full questions once', async status => {
  const read = fiveIssueKnowledge();
  if (!read.reading) throw new Error('Saved reading fixture missing');
  read.overall = { status, readingResult: { ...read.reading, resultRef: 'OVERALL-EXACT', resultRevision: 7,
    content: { schemaVersion: 'wiselink.3_1.assessment_reading.v1', headline: 'Synthetic actual overall headline',
      listBrief: 'Synthetic actual overall brief.', lead: 'Synthetic actual overall reasoning and limits.',
      decisiveClaimIds: ['OVERALL-CLAIM'], claims: [{ claimId: 'OVERALL-CLAIM',
        text: 'Synthetic actual overall conditional claim.', basis: 'CONDITIONAL_INFERENCE',
        premises: [{ evidenceRef: 'evidence-test', role: 'LIMITS', explanation: 'Synthetic source limit.',
          limitation: 'Synthetic applicability is unconfirmed.' }] }] } } };
  mockKnowledge.mockResolvedValue(read);
  await mount(`${baseQuery}&panel=assessment`);
  const panel = container.querySelector('[aria-label="同版本已保存评估"]')!;
  const overall = panel.querySelector('[aria-label="已保存综合意见"]')!;
  expect(overall.textContent).toContain(read.overall.readingResult.content.headline);
  expect(overall.textContent).toContain(read.overall.readingResult.content.lead);
  expect(overall.textContent).toContain(read.overall.readingResult.content.claims[0].text);
  expect(overall.querySelector('[data-result-ref]')?.getAttribute('data-result-ref')).toBe('OVERALL-EXACT');
  expect(overall.querySelector('[data-result-revision]')?.getAttribute('data-result-revision')).toBe('7');
  expect(panel.textContent?.indexOf(read.overall.readingResult.content.lead)).toBeLessThan(
    panel.textContent?.indexOf(read.content.issues[0].question) ?? -1);
  assertSingleSavedProblems(panel, read);
  expect(mockStart).not.toHaveBeenCalled();
});

it.each(['CANDIDATE_ONLY', 'STALE', 'DISTINCT_EVIDENCE'] as const)('preserves full context for an actual JA producer %s overall', async variant => {
  const status = variant === 'STALE' ? 'STALE' : 'CANDIDATE_ONLY';
  const read = fiveIssueKnowledge();
  const savedRevision = jobAidReadingFixture().current;
  if (!savedRevision || read.reading?.scope.kind !== 'WORK_ITEM') throw new Error('Saved work fixture missing');
  read.content.understanding += ' [[evidence-test]]';
  if (variant === 'DISTINCT_EVIDENCE') {
    read.content.evidence.push({ ...read.content.evidence[0], evidenceRef: 'body-only-evidence',
      title: 'Saved work body source', excerpt: 'Saved work body source condition.' });
    read.content.issues[0].body += ' [[body-only-evidence]]';
  }
  const projection = buildJobAidOverallProjection({
    workItem: { integratedAssessment: { baseRules: { revision: 1,
      artifact: { sha256: 'a'.repeat(64) } } } } as never,
    revision: { ...savedRevision, workItemId: read.entry.subjectId,
      documentVersionId: read.reading.scope.documentVersionId, workRevisionRef: read.entry.workRef,
      workRevision: read.entry.workRevision, content: read.content },
    artifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'artifact://synthetic-overall',
      sha256: 'b'.repeat(64), byteLength: 1, mediaType: 'application/json' },
    actionAttemptId: 'synthetic-overall-attempt', sourceResultId: 'synthetic-overall-result',
    applicabilityStatus: 'UNKNOWN',
  });
  if (!projection.readingResult) throw new Error('Actual overall producer reading missing');
  read.overall = { status, readingResult: projection.readingResult };
  if (variant === 'DISTINCT_EVIDENCE') {
    const evidence = projection.readingResult.evidence.find(source => source.evidenceRef === 'body-only-evidence');
    if (!evidence) throw new Error('Body-only evidence fixture missing');
    evidence.title = 'Distinct overall body source';
    evidence.excerpt = 'Distinct overall exact body-only evidence condition.';
  }
  mockKnowledge.mockResolvedValue(read);
  await mount(`${baseQuery}&panel=assessment`);
  const panel = container.querySelector('[aria-label="同版本已保存评估"]')!;
  const overall = panel.querySelector('[aria-label="已保存综合意见"]')!;
  expect(overall.textContent).toContain('Synthetic source understanding, without an implementation decision.');
  expect(overall.textContent).toContain('原文适用条件');
  expect(overall.querySelector('[data-result-ref]')?.getAttribute('data-result-ref')).toBe(read.entry.workRef);
  expect(overall.querySelector('[data-result-revision]')?.getAttribute('data-result-revision')).toBe('2');
  if (variant === 'DISTINCT_EVIDENCE') {
    expect(overall.textContent).toContain('Distinct overall exact body-only evidence condition.');
    expect(overall.textContent).toContain(read.content.issues[0].question);
    expect(panel.querySelector('.document-saved-issue')?.textContent).toContain('Saved work body source condition.');
    expect(mockStart).not.toHaveBeenCalled();
    return;
  }
  assertSingleSavedProblems(panel, read);
  expect(overall.textContent).not.toContain(read.content.issues[0].question);
  await click('Wiki');
  assertSingleSavedProblems(container.querySelector('[aria-label="同版本已保存Wiki"]')!, read);
  expect(mockKnowledge).toHaveBeenCalledTimes(1);
  expect(mockStart).not.toHaveBeenCalled();
});

it('pins the installed current parse without rereading or resetting the actual reader before panel/history navigation', async () => {
  mockReading.mockImplementation(async (version: string, run: string) => {
    const value = reading(version, run);
    value.original.source.units[1].kind = 'heading';
    value.original.source.units[1].payload = { text: 'Final Action' };
    return value;
  });
  await mount(new URLSearchParams({ returnDocumentVersionId: 'DV-FAM-1', returnLibraryQuery: libraryQuery }).toString());
  const workspace = container.querySelector('.source-reader-workspace');
  const original = container.querySelector<HTMLElement>('.source-reader-pane-scroll')!;
  const outline = container.querySelector<HTMLElement>('.source-reader-toc')!;
  const pdf = container.querySelector('[data-pdf-instance]');
  await button('仅原文');
  original.scrollTop = 248; outline.scrollTop = 83;
  const heading = [...container.querySelectorAll<HTMLButtonElement>('.source-reader-toc button')]
    .find(node => node.textContent?.includes('Final Action'))!;
  await act(async () => heading.click());
  const snapshot = {
    requestedRun: new URLSearchParams(router.state.location.search).get('parseRunId'),
    sourceRef: new URLSearchParams(router.state.location.search).get('sourceRef'),
    sameWorkspace: container.querySelector('.source-reader-workspace') === workspace,
    sameOriginal: container.querySelector('.source-reader-pane-scroll') === original,
    samePdf: container.querySelector('[data-pdf-instance]') === pdf,
    mode: container.querySelector('.source-reader-stage')?.className,
    statusReads: mockStatus.mock.calls.length, bodyReads: mockReading.mock.calls.length,
    pdfMounts: mockPdfMount.mock.calls.length, pdfUnmounts: mockPdfUnmount.mock.calls.length,
  };
  expect(snapshot).toMatchObject({ requestedRun: 'PR1', sourceRef: 'SR-TEST-P2', sameWorkspace: true,
    sameOriginal: true, samePdf: true, mode: expect.stringContaining('mode-original'),
    statusReads: 1, bodyReads: 1, pdfMounts: 1, pdfUnmounts: 0 });
  await click('评估'); await click('Wiki');
  await act(async () => { await router.navigate(-1); await router.navigate(-1); });
  expect(container.querySelector('.source-reader-workspace')).toBe(workspace);
  expect(container.querySelector('.source-reader-stage')?.className).toContain('mode-original');
  expect(container.querySelector('.source-reader-toc .is-selected')?.textContent).toContain('Final Action');
  expect(original.scrollTop).toBe(248); expect(outline.scrollTop).toBe(83);
  expect(mockCatalogue).toHaveBeenCalledTimes(1); expect(mockQuicklook).toHaveBeenCalledTimes(1);
  expect(mockKnowledge).toHaveBeenCalledTimes(1); expect(mockStart).not.toHaveBeenCalled();
});

it('revalidates a promoted pin on refresh and session change and resets for a different run', async () => {
  await mount(''); await button('仅原文');
  await act(async () => { await router.navigate('/document-versions/DV-FAM-1?parseRunId=PR1'); });
  expect(mockReading).toHaveBeenCalledTimes(1);
  await button('刷新');
  expect(mockReading).toHaveBeenCalledTimes(2); expect(mockStatus).toHaveBeenCalledTimes(2);
  await act(async () => { host.__advanceSession(); });
  expect(mockReading).toHaveBeenCalledTimes(3); expect(mockStatus).toHaveBeenCalledTimes(3);
  const before = container.querySelector('.source-reader-workspace');
  await act(async () => { await router.navigate('/document-versions/DV-FAM-1?parseRunId=PR2'); });
  expect(mockReading).toHaveBeenCalledTimes(4);
  expect(mockReading).toHaveBeenLastCalledWith('DV-FAM-1', 'PR2', expect.anything());
  expect(container.querySelector('.source-reader-workspace')).not.toBe(before);
  expect(container.querySelector('.source-reader-stage')?.className).toContain('mode-dual');
});

it.each(['new published run', 'access denial'] as const)('keeps the current pin isolated from an in-flight latest poll: %s', async outcome => {
  jest.useFakeTimers();
  try {
    let resolvePoll!: (value: unknown) => void, rejectPoll!: (reason: unknown) => void;
    mockStatus.mockResolvedValueOnce({ ...status(), latestRun: {
      parseRunId: 'PR2', status: 'RUNNING', deadlineAt: '2030-01-01T00:00:00Z',
    } }).mockImplementationOnce(() => new Promise((resolve, reject) => { resolvePoll = resolve; rejectPoll = reject; }));
    await mount(''); await button('仅原文');
    const workspace = container.querySelector('.source-reader-workspace');
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(mockStatus).toHaveBeenCalledTimes(2);
    await act(async () => { await router.navigate('/document-versions/DV-FAM-1?parseRunId=PR1'); });
    expect(container.querySelector('.source-reader-workspace')).toBe(workspace);
    await act(async () => {
      if (outcome === 'access denial') rejectPoll(Object.assign(new Error('原文读取权限已撤回'), { statusCode: 403 }));
      else resolvePoll({ ...status(), publishedRun: { parseRunId: 'PR2', parseRevision: 8 }, latestRun: null });
    });
    if (outcome === 'access denial') {
      expect(container.querySelector('.source-reader-workspace')).toBeNull();
      expect(container.textContent).toContain('原文读取权限已撤回');
    } else {
      expect(container.querySelector('.source-reader-workspace')).toBe(workspace);
      expect(container.querySelector('.source-reader-stage')?.className).toContain('mode-original');
    }
    await act(async () => { jest.advanceTimersByTime(10000); });
    expect(mockReading).toHaveBeenCalledTimes(1); expect(mockStatus).toHaveBeenCalledTimes(2);
    expect(mockStart).not.toHaveBeenCalled();
  } finally { jest.useRealTimers(); }
});

it('reads exact saved work without a published parse and keeps the original empty state in the reader', async () => {
  mockStatus.mockResolvedValue({ ...status(), publishedRun: null, latestRun: null });
  await mount('panel=assessment');
  expect(container.querySelector('[aria-label="同版本已保存评估"]')?.textContent).toContain('Complete saved understanding DV-FAM-1');
  expect(container.textContent).not.toContain('尚无已发布的解析内容。');
  await click('Wiki');
  expect(container.querySelector('[aria-label="同版本已保存Wiki"]')?.textContent).toContain('Complete saved understanding DV-FAM-1');
  expect(container.textContent).not.toContain('尚无已发布的解析内容。');
  expect(mockKnowledge).toHaveBeenCalledTimes(1);
  expect(mockReading).not.toHaveBeenCalled(); expect(mockStart).not.toHaveBeenCalled();
  await click('原文');
  expect(container.textContent).toContain('尚无已发布的解析内容。');
});

it('opens an unavailable or rejected result in the same panel without generating work', async () => {
  mockQuicklook.mockResolvedValue({ ...saved(), result: null });
  await mount(); await click('评估');
  expect(container.querySelector('[aria-label="同版本已保存评估"]')?.textContent).toContain('暂无同版本已保存评估');
  expect(router.state.location.pathname).toBe('/document-versions/DV-FAM-1');
  mockQuicklook.mockResolvedValue(saved()); mockKnowledge.mockRejectedValue(Object.assign(new Error('保存工作拒读'), { statusCode: 403 }));
  await button('重新读取');
  expect(container.querySelector('[aria-label="同版本已保存评估"]')?.textContent).toContain('保存工作拒读');
  expect(container.querySelector('[data-work-ref]')).toBeNull(); expect(mockStart).not.toHaveBeenCalled();
});

it('clears all saved panels at a session boundary and rejects old late results', async () => {
  await mount(`${baseQuery}&panel=wiki`); expect(container.textContent).toContain('Full saved work');
  let finish!: (value: ReturnType<typeof knowledge>) => void;
  mockKnowledge.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { host.__advanceSession(); });
  expect(container.querySelector('[data-work-ref]')).toBeNull();
  await act(async () => { await router.navigate('/document-versions/DV-FAM-2?parseRunId=PR2&panel=wiki'); });
  mockKnowledge.mockResolvedValue(knowledge('DV-FAM-2', 'WI-NEW', 'JAWR-NEW'));
  await act(async () => finish(knowledge()));
  expect(container.textContent).not.toContain('Full saved work DV-FAM-1');
});

it('keeps same-DVI saved work readable after a reparse and supports a Wiki direct link', async () => {
  await mount(`${baseQuery}&panel=wiki`);
  expect(container.querySelector('[data-work-ref="JAWR-OLD"]')).not.toBeNull();
  await act(async () => { await router.navigate('/document-versions/DV-FAM-1?parseRunId=PR2&panel=wiki'); });
  expect(container.querySelector('[data-work-ref="JAWR-OLD"]')).not.toBeNull();
  expect(container.textContent).toContain('configuration remains unknown');
  expect(mockKnowledge).toHaveBeenCalledTimes(2); expect(mockStart).not.toHaveBeenCalled();
});

it('rejects an old DVI response even when the transport completes after the new DVI', async () => {
  let finishOld!: (value: ReturnType<typeof knowledge>) => void;
  mockKnowledge.mockImplementation((identity: { subjectId: string }) => identity.subjectId === 'WI-OLD'
    ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(knowledge('DV-FAM-2', 'WI-NEW', 'JAWR-NEW')));
  await mount(`${baseQuery}&panel=wiki`);
  await act(async () => { await router.navigate('/document-versions/DV-FAM-2?parseRunId=PR2&panel=wiki'); });
  expect(container.textContent).toContain('Full saved work DV-FAM-2');
  await act(async () => finishOld(knowledge()));
  expect(container.textContent).toContain('Full saved work DV-FAM-2');
  expect(container.textContent).not.toContain('Full saved work DV-FAM-1');
});

it('reads the saved citation parse rather than the currently published parse', async () => {
  root = createRoot(container);
  await act(async () => root.render(createElement(DocumentSavedEvidenceSource, {
    evidence: { kind: 'DOCUMENT_PASSAGE', evidenceRef: 'SAVED-SOURCE', title: 'Saved exact source', versionLabel: 'R2',
      excerpt: 'Stored evidence excerpt', workItemId: 'WI-OLD',
      documentVersionId: 'DV-FAM-1', sourceRefId: 'SAVED-REF',
      locator: JSON.stringify({ parseRunId: 'PR-SAVED-OLD', sourceRefId: 'SAVED-REF' }) },
    onClose: jest.fn(), onRejected: jest.fn(),
  })));
  expect(mockReading.mock.calls[0].slice(0, 2)).toEqual(['DV-FAM-1', 'PR-SAVED-OLD']);
  expect(mockStart).not.toHaveBeenCalled();
});

it('loads the existing full legacy assessment once, including rules, basis and unknown conditions', async () => {
  const response = saved();
  if (!response.result?.readingResult) throw new Error('Saved reading fixture missing');
  delete response.result.jobAidRoundCompletion;
  response.result.sourceResultId = 'LEGACY-SAVED'; response.result.readingResult.resultRef = 'LEGACY-SAVED';
  response.result.readingResult.content.lead = 'Complete legacy overall, including its exact saved assumptions.';
  mockQuicklook.mockResolvedValue(response);
  mockLegacy.mockResolvedValue({ workItem: { workItemId: 'WI-OLD', source: { documentVersionId: 'DV-FAM-1' },
    integratedAssessment: { overallSynthesis: { sourceResultId: 'LEGACY-SAVED', revision: 2,
      readingResult: response.result.readingResult, missingInputs: ['Installed configuration remains unknown.'] } } },
    engineerReviewContext: { items: [{ criterionId: 'RULE-1', criterionName: 'Saved complete rule',
      evaluationQuestion: 'What is the installed configuration?', decisionRule: 'Verify the exact source requirement.',
      appliesWhen: 'Only if the stored applicability condition is verified.', dynamicResult: 'UNDETERMINED',
      candidateConclusion: 'UNKNOWN', humanReviewRequired: true, latestReview: null,
      factsConsidered: ['An exact source fact'], analysisSummary: 'Saved full rule analysis',
      missingInputs: ['Current configuration unknown'], sourceRefs: ['SAVED-REF'] }] } });
  await mount(); await click('评估');
  expect(container.textContent).toContain('Complete legacy overall');
  expect(container.textContent).toContain('Saved complete rule');
  expect(container.textContent).toContain('Only if the stored applicability condition is verified.');
  expect(container.textContent).toContain('Installed configuration remains unknown.');
  await click('Wiki'); await click('评估');
  expect(mockLegacy).toHaveBeenCalledTimes(1); expect(mockStart).not.toHaveBeenCalled();
});

it('preserves return and source pins in panel links and rejects duplicate panel parameters', () => {
  const params = new URLSearchParams(baseQuery); params.set('sourceRef', 'exact-source');
  const switched = new URLSearchParams(documentWorkbenchPanelRoute(params, 'wiki').slice(1));
  expect(switched.get('returnLibraryQuery')).toBe(libraryQuery);
  expect(switched.get('parseRunId')).toBe('PR1'); expect(switched.get('sourceRef')).toBe('exact-source');
  expect(readDocumentWorkbenchPanel(new URLSearchParams('panel=wiki&panel=reader')).error).toBeTruthy();
});
