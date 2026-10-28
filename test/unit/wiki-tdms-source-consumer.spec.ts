import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import type { TdmsDocumentSourceReadResponse } from '@shared/tdms-source-reading.interface';
import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import type { TdmsHistoryResponse } from '@shared/tdms-source.interface';
import { libraryDocuments } from './fixtures/canonical-library';
import { sourceRead } from './tdms-p1-frontend/fixtures';
import { withFeedbackPage } from './tdms-p1-frontend/engineering-feedback.fixture';
import { relations } from './tdms-frontend-recovery/reader-fixtures';

const mockDirectory = jest.fn(), mockIdentity = jest.fn(), mockSourcePage = jest.fn();
const mockHistory = jest.fn(), mockRecord = jest.fn(), mockRelations = jest.fn();
const mockLegacyCatalogue = jest.fn(), mockSavedReading = jest.fn();
const mockParsingStatus = jest.fn(), mockParsedDocument = jest.fn(), mockTranslation = jest.fn(), mockStart = jest.fn();
let mockSession = 1, mockAuthenticationRequired = false, mockActor = 'wiki-actor';
const mockSessionListeners: Set<() => void> = new Set();

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalLibraryDocuments: (...args: unknown[]) => mockDirectory(...args),
  getCanonicalHostIdentityContext: (...args: unknown[]) => mockIdentity(...args),
  getCanonicalHostClientSessionGeneration: () => mockSession,
  isCanonicalHostClientSessionAuthenticationRequired: () => mockAuthenticationRequired,
  subscribeCanonicalHostClientSession: (listener: () => void) => {
    mockSessionListeners.add(listener);
    return () => mockSessionListeners.delete(listener);
  },
  readTdmsDocumentSource: (...args: unknown[]) => mockSourcePage(...args),
  readTdmsSourceHistory: (...args: unknown[]) => mockHistory(...args),
  readTdmsSourceRecord: (...args: unknown[]) => mockRecord(...args),
  readTdmsSourceRelations: (...args: unknown[]) => mockRelations(...args),
  readTdmsSourceCatalogue: (...args: unknown[]) => mockLegacyCatalogue(...args),
  readSavedDocumentReading: (...args: unknown[]) => mockSavedReading(...args),
  readDocumentParsingStatus: (...args: unknown[]) => mockParsingStatus(...args),
  readParsedDocument: (...args: unknown[]) => mockParsedDocument(...args),
  readDocumentTranslationReading: (...args: unknown[]) => mockTranslation(...args),
  startDocumentParsing: (...args: unknown[]) => mockStart(...args),
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterDirectory: async () => ({ items: [], nextCursor: null }),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => {
    require('react').useSyncExternalStore((listener: () => void) => {
      mockSessionListeners.add(listener);
      return () => mockSessionListeners.delete(listener);
    }, () => mockSession, () => mockSession);
    return { currentUser: { user_id: mockActor }, sessionGeneration: mockSession,
      authenticationRequired: mockAuthenticationRequired };
  },
}));
jest.mock('@client/src/features/review/review-draft-store', () => ({ writeReviewDraft: jest.fn() }));
jest.mock('@client/src/features/checklist/ChecklistPanel', () => ({ SavedChecklist: () => null }));
jest.mock('@client/src/features/matter/EngineeringIssueBody', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/JobAidIssueArticle', () => ({ JobAidIssueArticle: () => null }));
jest.mock('@client/src/features/matter/SavedJobAidReadingContext', () => ({
  SavedJobAidMethodNotice: () => null, JobAidEvidenceDetails: () => null,
}));
jest.mock('@client/src/features/matter/MatterDocumentSourceDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/SavedAssessmentReading', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/OverviewCorrectionNotices', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/ReferenceWorkNotices', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/matter/OverviewSourceWork', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/KnowledgeLookupPage/SavedWorkIssueDirectory', () => ({
  SavedWorkIssueDirectory: () => null, savedWorkIssueRows: () => [],
}));
jest.mock('@client/src/pages/KnowledgeLookupPage/KnowledgeAtaDirectory', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/components/ui/button', () => ({ Button: ({ children, asChild, ...props }: {
  children: ReactNode; asChild?: boolean;
}) => asChild ? children : createElement('button', props, children) }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentTranslationContinuation', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/runtime-monitor/DocumentTranslationRuntimeDiagnostic', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/LocalMineruImport', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/SemanticBilingualReader', () => ({ SemanticBilingualReader: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/MineruMarkdownReader', () => ({ MineruMarkdownReader: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentParsedImage', () => ({ DocumentParsedImage: () => null }));
jest.mock('@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({ DocumentOriginalPreview: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentWikiReading', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentSourceReadingWorkspace', () => ({ DocumentSourceReadingWorkspace: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentSavedWorkPanels', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/features/workbench/RetainedWorkbenchPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentAssessmentWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/document-version-reading.css', () => ({}));
jest.mock('@client/src/features/tdms-source/tdms-source-reading.css', () => ({}));
jest.mock('@client/src/pages/KnowledgeLookupPage/knowledge-lookup.css', () => ({}));
jest.mock('@client/src/pages/KnowledgeLookupPage/knowledge-suite.css', () => ({}));

import KnowledgeLookupPage from '@client/src/pages/KnowledgeLookupPage/KnowledgeLookupPage';
import { TdmsDocumentSourceReading } from '@client/src/features/tdms-source/TdmsDocumentSourceReading';
import DocumentVersionReadingPage from '@client/src/pages/DocumentParsingPage/DocumentVersionReadingPage';

const OLD_VERSION = 'DV-FAM-1-1', CURRENT_VERSION = 'DV-FAM-1-2';
const WIKI_QUERY = `kind=sources&documentVersionId=${OLD_VERSION}&ata=2315&fleetFamily=787&fleetModel=787-9`;
function page(version: string, ...records: TdmsFileServiceRecordReadResponse[]): TdmsDocumentSourceReadResponse {
  return { documentVersionId: version, sourceStatus: records.length ? 'AVAILABLE' : 'NO_BOUND_RECORDS',
    records, hasMore: false, nextAfter: null };
}
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise: Promise<T> = new Promise<T>((done: (value: T) => void) => { resolve = done; });
  return { promise, resolve };
}
function engineeringRead(versionId = OLD_VERSION): TdmsFileServiceRecordReadResponse {
  const read: TdmsFileServiceRecordReadResponse = sourceRead('aeo-current', versionId);
  read.record.recordKind = 'ENGINEERING_FILE';
  read.record.fileType = { rawCode: 'AEO', rawName: 'AEO' };
  read.record.content = {};
  read.record.capturedAt = '2026-10-15T00:00:00.000Z';
  read.receipt.readAt = '2026-10-22T00:00:00.000Z';
  read.bodyReadPolicy!.kind = 'NON_OPINION_SOURCE';
  read.record.artifacts = [{ memberId: 'engineering-pdf', sourceArtifactId: 'immutable-pdf',
    acquisitionId: 'pdf-acquisition', fileName: 'AEO-R00.pdf', mediaType: 'application/pdf',
    sha256: 'a'.repeat(64), byteLength: 100, immutableReadbackVerified: true,
    documentVersionId: 'DV-EXECUTION-R00', registrationGap: null }];
  read.engineeringExecution = { sourceRevisionRef: read.record.sourceRevisionRef,
    sourceRecordId: read.record.sourceRecordId, sourceVersion: read.record.sourceVersion,
    businessVersion: read.record.businessVersion ?? null, windows: [],
    requirementCoverage: 'NOT_CAPTURED', targetAircraftCoverage: 'UNKNOWN', executionVerified: false };
  withFeedbackPage(read);
  read.engineeringExecution.windows = [{ tableId: 'status-window', tableTitle: 'Related Status',
    sourceLocator: '#status', observedAt: '2026-10-13T00:00:00.000Z', enumerationState: 'VALUE',
    stopReason: null, reportedRowCount: 1, observedAircraftCount: 1, sourceViewEvidence: null,
    rows: [{ sourceRecordId: 'status-1', number: 'Status 1', stateRaw: 'Completed',
      sourceModifiedRaw: '2026-10-12 09:00', executionStatus: {
        engineeringDocumentRef: read.record.sourceRecordId, engineeringDocumentNumber: 'AEO-R00',
        assetRef: 'aircraft-1', assetNumber: 'SYNTHETIC-AIRCRAFT', feedbackRef: 'feedback-1',
        feedbackNumber: 'Feedback 1', executedDateRaw: 'TBD', expiredDateRaw: null,
        stateComments: 'Feedback received 2026-10-12; planned 2026-11-01', operatorBase: null,
      } }],
  }];
  return read;
}

describe('document Wiki consumes exact-version TDMS sources', () => {
  let dom: JSDOM, root: Root, container: HTMLElement, queryClient: QueryClient;
  let router: ReturnType<typeof createMemoryRouter>;
  const originals: Map<string, PropertyDescriptor | undefined> = new Map();
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/knowledge' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    notifyManager.setScheduler(queueMicrotask);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    mockSession = 1; mockActor = 'wiki-actor'; mockAuthenticationRequired = false;
    jest.resetAllMocks();
    mockDirectory.mockResolvedValue(libraryDocuments(['FAM-1']));
    mockIdentity.mockImplementation(async () => ({ userId: mockActor, tenantId: 'wiki-tenant' }));
    mockSourcePage.mockImplementation(async (input: { documentVersionId: string }) => page(input.documentVersionId));
    mockParsingStatus.mockReturnValue(new Promise(() => undefined));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    router?.dispose(); queryClient.clear(); mockSessionListeners.clear();
    notifyManager.setScheduler((callback: () => void) => setTimeout(callback, 0));
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear(); jest.useRealTimers();
  });
  async function settleDirectory(duration = 1): Promise<void> {
    await act(async () => { await jest.advanceTimersByTimeAsync(duration); });
  }
  async function mount(query = WIKI_QUERY): Promise<void> {
    router = createMemoryRouter([
      { path: '/knowledge', element: createElement(KnowledgeLookupPage) },
      { path: '/document-versions/:documentVersionId', element: createElement(DocumentVersionReadingPage) },
    ], { initialEntries: ['/knowledge?' + query] });
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient },
      createElement(RouterProvider, { router }))));
    await settleDirectory();
  }
  async function navigate(query: string): Promise<void> {
    await act(async () => { await router.navigate('/knowledge?' + query); });
    await settleDirectory();
  }
  async function expand(summary: string): Promise<void> {
    const details: HTMLDetailsElement | undefined = [...container.querySelectorAll('details')]
      .find((item: HTMLDetailsElement) => item.querySelector('summary')?.textContent === summary);
    expect(details).toBeDefined();
    await act(async () => { details!.open = true; details!.dispatchEvent(new dom.window.Event('toggle')); });
  }
  function expectLegacyClosed(): void {
    expect(mockLegacyCatalogue).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('TDMS 来源目录');
  }
  async function returnToWiki(originVersionId: string): Promise<URLSearchParams> {
    const back: HTMLAnchorElement | undefined = [...container.querySelectorAll('a')]
      .find((item: HTMLAnchorElement) => item.textContent === '返回工程知识');
    expect(back).toBeDefined();
    await act(async () => back!.dispatchEvent(new dom.window.MouseEvent('click',
      { bubbles: true, cancelable: true, button: 0 })));
    await settleDirectory();
    expect(router.state.location.pathname).toBe('/knowledge');
    expect(container.textContent).not.toContain('指定版本不在当前可读目录结果');
    const state: URLSearchParams = new URLSearchParams(router.state.location.search);
    expect(state.get('documentVersionId')).toBe(originVersionId);
    return state;
  }
  async function openSourceDocument(label: string, versionId: string): Promise<void> {
    const button: HTMLButtonElement | undefined = [...container.querySelectorAll('button')]
      .find((item: HTMLButtonElement) => item.textContent === label);
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(router.state.location.pathname).toBe(`/document-versions/${versionId}`);
    const params: URLSearchParams = new URLSearchParams(router.state.location.search);
    expect(params.get('returnDocumentVersionId')).toBe(versionId);
    expect(params.get('returnKnowledgeOriginDocumentVersionId')).toBe(OLD_VERSION);
    expect(Object.fromEntries(new URLSearchParams(params.get('returnKnowledgeQuery')!)))
      .toMatchObject({ kind: 'sources', documentVersionId: OLD_VERSION,
        ata: '2315', fleetFamily: '787', fleetModel: '787-9' });
    await returnToWiki(OLD_VERSION);
  }

  it('shows approved opinions, unapproved metadata and literal AEO windows without waiting for analysis', async () => {
    const approved: TdmsFileServiceRecordReadResponse = sourceRead('approved-profession', OLD_VERSION);
    const unapproved: TdmsFileServiceRecordReadResponse = sourceRead('unapproved-profession', OLD_VERSION, 'Estimating');
    unapproved.record.content.opinions![0].text = 'UNAPPROVED_BODY_MUST_STAY_HIDDEN';
    mockSourcePage.mockResolvedValue(page(OLD_VERSION, approved, unapproved, engineeringRead()));
    await mount();
    expect(mockSourcePage).toHaveBeenCalledTimes(1);
    expect(mockSourcePage.mock.calls[0][0]).toEqual({ documentVersionId: OLD_VERSION, limit: 12 });
    expect(container.textContent).toContain('Private excerpt approved-profession');
    expect(container.textContent).toContain('source-unapproved-profession');
    expect(container.textContent).not.toContain('UNAPPROVED_BODY_MUST_STAY_HIDDEN');
    for (const literal of ['暂无已保存解读', 'SYNTHETIC-AIRCRAFT', 'Completed', 'Not completed',
      'SYNTHETIC PRIOR EXECUTION', 'PRIOR-AEO-R16', 'feedback-1', 'TBD',
      'Feedback received 2026-10-12; planned 2026-11-01', '2026-10-13T00:00:00.000Z',
      '2026-10-15T00:00:00.000Z', '2026-10-22T00:00:00.000Z']) expect(container.textContent).toContain(literal);
    expect(container.textContent).toContain('不计算整份完成率');
    expect(mockSavedReading).not.toHaveBeenCalled();
    expect(mockHistory).not.toHaveBeenCalled(); expect(mockRelations).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled(); expectLegacyClosed();
    await openSourceDocument('阅读准确文件版本 DV-EXECUTION-R00', 'DV-EXECUTION-R00');
  });

  it('keeps exact document and Wiki return context when opening a source relation', async () => {
    mockSourcePage.mockResolvedValue(page(OLD_VERSION, sourceRead('linked-record', OLD_VERSION)));
    const reading: ReturnType<typeof relations> = relations('linked-record');
    reading.relations[0]!.to = { kind: 'DOCUMENT_VERSION', documentVersionId: 'DV-RELATED-R01' };
    mockRelations.mockResolvedValue(reading);
    await mount();
    await expand('处理单、专业评估单与附件的来源关系');
    await openSourceDocument('阅读准确文档 DV-RELATED-R01', 'DV-RELATED-R01');
    expect(mockRelations.mock.calls[0][1]).toEqual({ documentVersionId: OLD_VERSION });
  });
  it('keeps exact document and Wiki return context when opening a historical source attachment', async () => {
    const current: TdmsFileServiceRecordReadResponse = sourceRead('current-source', OLD_VERSION);
    const historical: TdmsFileServiceRecordReadResponse = sourceRead('historical-source', OLD_VERSION);
    historical.record.recordRef = current.record.recordRef;
    historical.record.sourceRecordId = current.record.sourceRecordId;
    historical.record.selectedHead = false;
    historical.bodyReadPolicy!.sourceRecordId = current.record.sourceRecordId;
    historical.record.artifacts = engineeringRead().record.artifacts.map(artifact => ({ ...artifact,
      documentVersionId: 'DV-HISTORICAL-R00' }));
    mockSourcePage.mockResolvedValue(page(OLD_VERSION, current));
    mockHistory.mockResolvedValue({ recordRef: current.record.recordRef, versions: [historical.record],
      readPerformed: false, hasMore: false, nextAfter: null, limitations: [] });
    mockRecord.mockResolvedValue(historical);
    await mount(); await expand('该来源记录的修订历史');
    const readHistory: HTMLButtonElement | undefined = [...container.querySelectorAll('button')]
      .find((item: HTMLButtonElement) => item.textContent === '阅读历史源修订');
    expect(readHistory).toBeDefined();
    await act(async () => readHistory!.click());
    expect(mockRecord.mock.calls[0][1]).toEqual({ documentVersionId: OLD_VERSION });
    await openSourceDocument('阅读准确文件版本 DV-HISTORICAL-R00', 'DV-HISTORICAL-R00');
  });
  it('keeps the default exact-document link for readers without a navigation callback', async () => {
    mockSourcePage.mockResolvedValue(page(OLD_VERSION, engineeringRead()));
    router = createMemoryRouter([{ path: '/library', element: createElement(TdmsDocumentSourceReading,
      { documentVersionId: OLD_VERSION }) }], { initialEntries: ['/library'] });
    await act(async () => root.render(createElement(RouterProvider, { router })));
    expect(container.querySelector('a[href="/document-versions/DV-EXECUTION-R00"]')?.textContent)
      .toContain('DV-EXECUTION-R00');
  });

  it('completes a round trip from an SB Wiki to an AEO attachment with the original Wiki selection', async () => {
    const origin = `${WIKI_QUERY}&normalizedFamily=SB&query=FAM-1&after=sb-page-2`;
    mockSourcePage.mockResolvedValue(page(OLD_VERSION, engineeringRead()));
    await mount(origin); await settleDirectory(251);
    container.querySelector<HTMLElement>('[aria-label="工程文档目录"]')!.scrollTop = 120;
    container.querySelector<HTMLElement>('[aria-label="文档 Wiki"]')!.scrollTop = 45;
    const open = [...container.querySelectorAll('button')].find(item =>
      item.textContent === '阅读准确文件版本 DV-EXECUTION-R00');
    expect(open).toBeDefined();
    await act(async () => open!.click());
    expect(router.state.location.pathname).toBe('/document-versions/DV-EXECUTION-R00');
    expect(mockParsingStatus.mock.calls[0][0]).toBe('DV-EXECUTION-R00');
    expect(mockParsedDocument).not.toHaveBeenCalled();
    expect(mockTranslation).not.toHaveBeenCalled(); expect(mockStart).not.toHaveBeenCalled();
    const state: URLSearchParams = await returnToWiki(OLD_VERSION);
    await settleDirectory(251);
    expect(Object.fromEntries(state))
      .toMatchObject({ kind: 'sources', documentVersionId: OLD_VERSION, normalizedFamily: 'SB',
        query: 'FAM-1', after: 'sb-page-2', ata: '2315', fleetFamily: '787', fleetModel: '787-9',
        listY: '120', articleY: '45' });
    expect(container.querySelector('[aria-label="TDMS 原始意见与关联记录"]')).not.toBeNull();
  });

  it('returns to the selected current Wiki version when entered without a kind or version pin', async () => {
    mockSourcePage.mockResolvedValue(page(CURRENT_VERSION, engineeringRead(CURRENT_VERSION)));
    await mount('');
    const open: HTMLButtonElement | undefined = [...container.querySelectorAll('button')]
      .find((item: HTMLButtonElement) => item.textContent === '阅读准确文件版本 DV-EXECUTION-R00');
    expect(open).toBeDefined();
    await act(async () => open!.click());
    const state: URLSearchParams = await returnToWiki(CURRENT_VERSION);
    expect(state.get('kind')).toBe('sources');
    expect(container.querySelector('[aria-label="TDMS 原始意见与关联记录"]')).not.toBeNull();
  });

  it('uses the existing automatic current-version selection when no version is pinned', async () => {
    await mount('kind=sources');
    expect(mockSourcePage.mock.calls[0][0]).toEqual({ documentVersionId: CURRENT_VERSION, limit: 12 });
  });
  it.each(['documentVersionId=unknown-version',
    `documentVersionId=${OLD_VERSION}&documentVersionId=${OLD_VERSION}`])(
    'does not read a missing or duplicate version pin: %s', async pin => {
      await mount('kind=sources&' + pin);
      expect(mockSourcePage).not.toHaveBeenCalled(); expectLegacyClosed();
    });
  it('does not read sources when the authorized catalogue has no selected version', async () => {
    mockDirectory.mockResolvedValue(libraryDocuments([]));
    await mount('kind=sources');
    expect(mockSourcePage).not.toHaveBeenCalled(); expectLegacyClosed();
  });
  it.each(['login-required', 'identity-denied'])('does not read sources while %s', async state => {
    if (state === 'login-required') mockAuthenticationRequired = true;
    else mockIdentity.mockRejectedValue(Object.assign(new Error('identity denied'), { statusCode: 403 }));
    await mount();
    expect(mockDirectory).not.toHaveBeenCalled(); expect(mockSourcePage).not.toHaveBeenCalled();
  });

  it('aborts an old version page and ignores its late result after selecting another exact version', async () => {
    const old: ReturnType<typeof deferred<TdmsDocumentSourceReadResponse>> = deferred();
    mockSourcePage.mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page(CURRENT_VERSION, sourceRead('new-version', CURRENT_VERSION)));
    await mount();
    const oldSignal: AbortSignal = mockSourcePage.mock.calls[0][1];
    await navigate(`kind=sources&documentVersionId=${CURRENT_VERSION}`);
    expect(oldSignal.aborted).toBe(true);
    expect(container.textContent).toContain('Private excerpt new-version');
    await act(async () => old.resolve(page(OLD_VERSION, sourceRead('late-old-version', OLD_VERSION))));
    expect(container.textContent).not.toContain('Private excerpt late-old-version');
    expect(mockSourcePage.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      { documentVersionId: OLD_VERSION, limit: 12 }, { documentVersionId: CURRENT_VERSION, limit: 12 },
    ]);
  });
  it('clears visible old content before the new version finishes reading', async () => {
    const next: ReturnType<typeof deferred<TdmsDocumentSourceReadResponse>> = deferred();
    mockSourcePage.mockResolvedValueOnce(page(OLD_VERSION, sourceRead('visible-old', OLD_VERSION)))
      .mockReturnValueOnce(next.promise);
    await mount(); expect(container.textContent).toContain('Private excerpt visible-old');
    await navigate(`kind=sources&documentVersionId=${CURRENT_VERSION}`);
    expect(container.textContent).not.toContain('Private excerpt visible-old');
    expect(container.textContent).toContain('正在读取所选版本');
    await act(async () => next.resolve(page(CURRENT_VERSION)));
  });
  it('rebinds actor and session before reading sources and masks a late prior-identity page', async () => {
    const prior: ReturnType<typeof deferred<TdmsDocumentSourceReadResponse>> = deferred();
    mockSourcePage.mockReturnValueOnce(prior.promise)
      .mockResolvedValueOnce(page(OLD_VERSION, sourceRead('new-actor', OLD_VERSION)));
    await mount();
    const priorSignal: AbortSignal = mockSourcePage.mock.calls[0][1];
    mockActor = 'new-wiki-actor'; mockSession++;
    await act(async () => { for (const listener of mockSessionListeners) listener(); });
    await navigate(`kind=sources&documentVersionId=${OLD_VERSION}&identity=changed`);
    expect(priorSignal.aborted).toBe(true);
    expect(container.textContent).toContain('Private excerpt new-actor');
    await act(async () => prior.resolve(page(OLD_VERSION, sourceRead('late-prior-actor', OLD_VERSION))));
    expect(container.textContent).not.toContain('Private excerpt late-prior-actor');
    expect(mockIdentity).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404])('clears opinions and pending child reads after source denial %s', async status => {
    const history: ReturnType<typeof deferred<TdmsHistoryResponse>> = deferred();
    mockSourcePage.mockResolvedValue(page(OLD_VERSION, sourceRead('revoked-body', OLD_VERSION)));
    mockHistory.mockReturnValue(history.promise);
    mockRelations.mockRejectedValue({ statusCode: status, message: 'PRIVATE_SERVER_ERROR_BODY' });
    await mount();
    await expand('该来源记录的修订历史');
    const pendingSignal: AbortSignal = mockHistory.mock.calls[0][3];
    await expand('处理单、专业评估单与附件的来源关系');
    expect(container.textContent).not.toContain('Private excerpt revoked-body');
    expect(container.textContent).toContain('当前账户不能读取此版本的 TDMS 来源');
    expect(container.textContent).not.toContain('PRIVATE_SERVER_ERROR_BODY');
    expect(pendingSignal.aborted).toBe(true);
    await act(async () => history.resolve({ recordRef: 'record-revoked-body', versions: [],
      hasMore: false, nextAfter: null, readPerformed: false, limitations: [] }));
    expect(container.textContent).not.toContain('Private excerpt revoked-body');
    expect(mockSourcePage).toHaveBeenCalledTimes(1);
  });
  it('shows an unconfigured source service failure without substituting another version', async () => {
    mockSourcePage.mockRejectedValue({ statusCode: 503, code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' });
    await mount();
    expect(container.textContent).toContain('尚未配置 TDMS 来源读取授权');
    expect(container.textContent).not.toContain('所选版本尚无明确绑定');
    expect(mockSourcePage).toHaveBeenCalledTimes(1); expectLegacyClosed();
  });
});
