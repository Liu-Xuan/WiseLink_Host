import { assessmentDom } from './fixtures/document-assessment-dom';
import { act, createElement, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import DocumentVersionReadingPage from '../../client/src/pages/DocumentParsingPage/DocumentVersionReadingPage';
import { assessmentAssociationFixture, assessmentFixtureRead, assessmentOriginalFixture, assessmentPageFixture,
  assessmentRunningConversationFixture, assessmentStatusFixture, assessmentWorkingFixture, assessmentWikiFixture } from './fixtures/document-assessment-workspace';
import { documentAssessmentReturnTarget } from '../../client/src/pages/DocumentParsingPage/document-workbench-panel';
import { readingReturnTarget } from '../../client/src/features/matter/reading-return';
import { wikiGuideReturnRoute } from '../../client/src/lib/wiki-guide-route';
import { readReviewDraft } from '../../client/src/features/review/review-draft-store';

const mockApi = jest.fn();
jest.mock('@client/src/api/canonical-host', () => {
  let generation = 1, required = false; const sessions = new Set<() => void>();
  const methods = ['getDocumentParsingPage', 'readJobAidAssessmentWork', 'readDocumentParsingStatus', 'readParsedDocument',
    'getCanonicalLibraryDocuments', 'getCanonicalLibraryQuicklook', 'readEngineeringKnowledgeWork', 'getReviewOverallProjectionEligibility',
    'getReviewOverallProjectionStatus', 'requestReviewOverallProjection', 'getOverallRegenerationEligibility', 'getOverallRegenerationStatus',
    'requestOverallRegeneration', 'getApplicabilitySelection', 'getConfigurationEvidenceStatus', 'getApplicabilitySelectionReviewAvailability',
    'getRelatedContextPreview', 'reloadReviewConversation', 'getCanonicalTaskModelOptions', 'prepareDocumentTranslationContinuation',
    'readDocumentTranslationReading', 'recordEngineerReview', 'confirmIntegratedOverallForAeo', 'generateAeoCandidate',
    'startDocumentParsing', 'startReviewConversation', 'appendReviewTurn', 'confirmReviewActionDraft'];
  return Object.assign(Object.fromEntries(methods.map(name => [name, (...args: unknown[]) => mockApi(name, ...args)])), {
    getCanonicalHostClientSessionGeneration: () => generation,
    isCanonicalHostClientSessionAuthenticationRequired: () => required,
    subscribeCanonicalHostClientSession: (callback: () => void) => { sessions.add(callback); return () => sessions.delete(callback); },
    requireCanonicalHostClientAuthentication: () => { required = true; generation++; sessions.forEach(callback => callback()); },
    __reset: () => { required = false; generation++; sessions.forEach(callback => callback()); },
  });
});
jest.mock('@client/src/api', () => ({ canonicalHost: jest.requireMock('@client/src/api/canonical-host') }));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({ useCurrentUserSession: () => ({ sessionGeneration: 1, authenticationRequired: false }) }));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => ({ useEngineeringMatterQueryIdentity: () => ({
  identity: { appId: 'fixture', tenantId: 'fixture', actorId: 'fixture', sessionGeneration: 1 },
  identityQuery: { isFetching: false, error: null, refetch: async () => ({ error: null }) },
}) }));
jest.mock('@lark-apaas/aily-web-sdk', () => ({ initAgentChat: async () => ({ destroy: async () => undefined }) }));
jest.mock('@client/src/api/document-wiki', () => ({ readDocumentWiki: jest.fn() }));
jest.mock('@client/src/config/runtime-build', () => ({ runtimeBuildFingerprint: { sourceCommit: 'UNAVAILABLE', buildTime: 'synthetic', visualVersion: 'synthetic' } }));
jest.mock('@client/src/api/runtime-probe', () => ({ getHostedRuntimeFingerprint: async () => ({}) }));
jest.mock('@client/src/components/business-ui/api/files/service', () => ({ uploadFile: jest.fn() }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentOriginalCanvasPreview', () => ({ __esModule: true, default: () => createElement('div', { 'data-synthetic-pdf': true }) }));
jest.mock('@client/src/pages/DocumentParsingPage/SemanticBilingualReader', () => ({ SemanticBilingualReader: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/MineruMarkdownReader', () => ({ MineruMarkdownReader: () => null }));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentParsedImage', () => ({ DocumentParsedImage: () => null }));
jest.mock('@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({ DocumentOriginalPreview: ({ children }: { children: ReactNode }) => createElement('span', null, children) }));
jest.mock('@client/src/features/matter/ClaimEvidenceDialog', () => ({ __esModule: true, default: () => null }));

const { JSDOM } = require('jsdom');
const host = jest.requireMock('@client/src/api/canonical-host');
let dom: InstanceType<typeof JSDOM>, container: HTMLDivElement, root: Root;
let router: ReturnType<typeof createMemoryRouter>;
const globals = new Map<string, PropertyDescriptor | undefined>();
const writes = /^(record|confirm|generate|request|start|append|adopt|save)/u;
function calls(name: string) { return mockApi.mock.calls.filter(call => call[0] === name); }
function visible(node: HTMLElement): boolean { return !node.closest('[hidden]'); }
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => visible(node) && node.textContent?.trim() === text);
  if (!found) throw new Error(`Missing visible button: ${text}`); return found;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function panel(text: string) {
  const link = [...container.querySelectorAll<HTMLAnchorElement>('.document-reading-saved-links a')].find(node => node.textContent === text)!;
  await act(async () => link.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
}
async function input(node: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
function draft(): HTMLTextAreaElement { return container.querySelector<HTMLTextAreaElement>('.continuous-review textarea')!; }
async function mount(query = 'panel=assessment&assessmentTab=review&parseRunId=PR1') {
  router = createMemoryRouter([{ path: '/document-versions/:documentVersionId', element: createElement(DocumentVersionReadingPage) },
    { path: '/work-items/:workItemId/analysis', element: createElement('div', null, 'Legacy source route') }],
  { initialEntries: [`/document-versions/DV-FAM-1?${query}`], future: { v7_relativeSplatPath: true } });
  await act(async () => root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })));
}
beforeAll(() => {
  dom = assessmentDom;
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  dom.window.requestAnimationFrame = () => 0;
  dom.window.cancelAnimationFrame = () => undefined;
  dom.window.scrollTo = () => undefined;
});
afterAll(() => {
  dom.window.close(); for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
beforeEach(() => {
  host.__reset(); mockApi.mockReset();
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => assessmentFixtureRead(name, ...args));
  container = document.createElement('div'); document.body.appendChild(container);
  root = (require('react-dom/client') as typeof import('react-dom/client')).createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); jest.useRealTimers(); });

it('retains the real review draft, caret and independent tab scroll across original/Wiki/process, refresh and a new parse', async () => {
  await mount(); const editor = draft(); expect(editor).not.toBeNull();
  await input(editor, '合成复核草稿：构型待核实'); editor.setSelectionRange(3, 7);
  const reviewScroll = editor.closest<HTMLElement>('.document-assessment-content > .wl-retained-panel')!; reviewScroll.scrollTop = 248;
  const workspace = container.querySelector('.document-assessment-workspace');
  await click('调查问题'); await click('分析过程'); expect(container.textContent).toContain('本次评估可核验过程');
  await panel('Wiki'); await panel('原文'); await panel('评估'); await click('复核意见');
  expect(draft()).toBe(editor); expect(editor.value).toContain('构型待核实'); expect(editor.selectionStart).toBe(3); expect(reviewScroll.scrollTop).toBe(248);
  await click('刷新评估'); expect(draft()).toBe(editor); expect(editor.value).toContain('构型待核实');
  await act(async () => router.navigate('/document-versions/DV-FAM-1?panel=assessment&assessmentTab=review&parseRunId=PR-NEW'));
  expect(container.querySelector('.document-assessment-workspace')).toBe(workspace); expect(draft()).toBe(editor);
  await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
  expect(editor.value).toContain('构型待核实'); expect(mockApi.mock.calls.filter(call => writes.test(call[0]))).toEqual([]);
});

it('shows a verified work with no saved result and waits for independent page authorization before showing controls', async () => {
  let resolve!: (value: ReturnType<typeof assessmentPageFixture>) => void;
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => name === 'getCanonicalLibraryQuicklook' ? assessmentAssociationFixture(false)
    : name === 'getDocumentParsingPage' ? new Promise(finish => { resolve = finish; }) : assessmentFixtureRead(name, ...args));
  await mount(); expect(container.querySelector('.document-assessment-content')).toBeNull();
  expect(calls('getDocumentParsingPage')[0].slice(1)).toEqual(['WI-OLD', '', { freshness: 'mutation' }]);
  await act(async () => resolve(assessmentPageFixture())); expect(draft()).not.toBeNull();
  expect(mockApi.mock.calls.filter(call => writes.test(call[0]))).toEqual([]);
});

it('pauses the single working read and real review polling when their retained panels are hidden', async () => {
  jest.useFakeTimers();
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => {
    if (name === 'readJobAidAssessmentWork') return { ...assessmentWorkingFixture(), executionStatus: 'RUNNING' };
    if (name === 'reloadReviewConversation') return assessmentRunningConversationFixture();
    return assessmentFixtureRead(name, ...args);
  });
  await mount(); expect(calls('readJobAidAssessmentWork')).toHaveLength(1); expect(calls('reloadReviewConversation')).toHaveLength(1);
  await click('分析过程'); const reviewCount = calls('reloadReviewConversation').length;
  await act(async () => { jest.advanceTimersByTime(6500); });
  expect(calls('reloadReviewConversation')).toHaveLength(reviewCount); expect(calls('readJobAidAssessmentWork')).toHaveLength(2);
  await panel('Wiki'); const workCount = calls('readJobAidAssessmentWork').length;
  await act(async () => { jest.advanceTimersByTime(18000); });
  expect(calls('readJobAidAssessmentWork')).toHaveLength(workCount); expect(calls('reloadReviewConversation')).toHaveLength(reviewCount);
});

it.each([403, 404])('clears the actual draft and business content after fresh work authorization rejects %i', async statusCode => {
  await mount(); const editor = draft(); await input(editor, 'should clear');
  const scope = JSON.parse(container.querySelector('.document-assessment-workspace')!.getAttribute('data-assessment-scope')!);
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => { if (name === 'getDocumentParsingPage') throw Object.assign(new Error('当前工作不可访问'), { statusCode }); return assessmentFixtureRead(name, ...args); });
  await click('刷新评估'); expect(container.querySelector('.document-assessment-content')).toBeNull(); expect(container.contains(editor)).toBe(false);
  expect(readReviewDraft(`document-assessment:${scope[0]}:${scope[1]}:${scope[2]}`)).toBe('');
  expect(container.textContent).not.toContain('保留上次读回内容');
});

it.each([true, false])('rechecks work independently after Wiki403; fresh work authorized=%s', async allowed => {
  await mount(); await input(draft(), 'keep only while independently authorized');
  let resolve!: (value: ReturnType<typeof assessmentPageFixture>) => void, reject!: (reason: unknown) => void;
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => {
    if (name === 'readEngineeringKnowledgeWork') throw Object.assign(new Error('Wiki-only forbidden'), { statusCode: 403 });
    if (name === 'getDocumentParsingPage') return new Promise((done, fail) => { resolve = done; reject = fail; });
    return assessmentFixtureRead(name, ...args);
  });
  await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
  const fieldset = container.querySelector<HTMLFieldSetElement>('.document-assessment-content')!;
  expect(fieldset.disabled).toBe(true); expect(calls('getDocumentParsingPage').length).toBeGreaterThan(1);
  if (allowed) { await act(async () => resolve(assessmentPageFixture())); expect(fieldset.disabled).toBe(false); expect(draft().value).toContain('independently'); }
  else { await act(async () => reject(Object.assign(new Error('WI also forbidden'), { statusCode: 403 }))); expect(container.querySelector('.document-assessment-content')).toBeNull(); }
});

it('clears on Wiki401 session change and ignores a late successful full-page response', async () => {
  await mount(); const editor = draft(); await input(editor, 'old actor draft');
  let finish!: (value: ReturnType<typeof assessmentPageFixture>) => void;
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => name === 'getDocumentParsingPage'
    ? new Promise(done => { finish = done; }) : name === 'readEngineeringKnowledgeWork'
      ? Promise.reject(Object.assign(new Error('identity expired'), { statusCode: 401 })) : assessmentFixtureRead(name, ...args));
  await click('刷新评估'); await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
  expect(host.isCanonicalHostClientSessionAuthenticationRequired()).toBe(true);
  await act(async () => finish(assessmentPageFixture())); expect(container.querySelector('.document-assessment-content')).toBeNull();
  expect(container.contains(editor)).toBe(false);
});

it('uses the real rule impact preview, sends one revision-bound review and preserves text on CAS conflict', async () => {
  await mount(); const editor = container.querySelector<HTMLTextAreaElement>('.document-assessment-review-comment textarea')!;
  await input(editor, '合成工程师修订'); await click('预览影响并保存工程师意见');
  expect(calls('recordEngineerReview')).toHaveLength(0);
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => { if (name === 'recordEngineerReview') throw Object.assign(new Error('REVISION_CONFLICT'), { statusCode: 409 }); return assessmentFixtureRead(name, ...args); });
  await click('记录复核意见'); expect(calls('recordEngineerReview')).toEqual([['recordEngineerReview', 'WI-OLD', { expectedRevision: 7, criterionId: 'RULE-SYNTHETIC', decision: 'deferred', comment: '合成工程师修订' }]]);
  expect(editor.value).toBe('合成工程师修订'); expect(container.textContent).toContain('REVISION_CONFLICT');
});

it('keeps AEO generation behind the existing SB/Overall gate and exact explicit confirmation', async () => {
  await mount('panel=assessment&assessmentTab=aeo&parseRunId=PR1');
  expect(calls('confirmIntegratedOverallForAeo')).toHaveLength(0); expect(calls('generateAeoCandidate')).toHaveLength(0);
  await click('确认当前整体综合用于 AEO 候选');
  expect(calls('confirmIntegratedOverallForAeo')).toEqual([['confirmIntegratedOverallForAeo', 'WI-OLD', { expectedRevision: 7, expectedOverallRevision: 2, expectedOverallArtifactRef: 'artifact:synthetic-overall' }]]);
  expect(calls('generateAeoCandidate')).toHaveLength(0);
});

it.each(['exact-null-wi', 'broken-locator', 'legacy-null-wi', 'cross-document'] as const)(
  'routes the actual saved evidence button with %s and preserves bounded return state', async variant => {
    const work = assessmentWorkingFixture(); const evidence = work.current!.content.evidence[0];
    if (evidence.kind !== 'DOCUMENT_PASSAGE') throw new Error('Document fixture required');
    if (variant === 'exact-null-wi' || variant === 'legacy-null-wi') evidence.workItemId = null;
    if (variant === 'legacy-null-wi') evidence.locator = '';
    if (variant === 'broken-locator') evidence.locator = JSON.stringify({ parseRunId: 'PR-HISTORIC', sourceRefId: 'DIFFERENT' });
    if (variant === 'cross-document') evidence.documentVersionId = 'DV-FAM-2';
    mockApi.mockImplementation(async (name: string, ...args: unknown[]) => {
      if (name === 'readJobAidAssessmentWork') return work;
      if (name === 'readDocumentParsingStatus') return { ...assessmentStatusFixture(), documentVersionId: String(args[0]) };
      if (name === 'readParsedDocument') { const read = assessmentOriginalFixture(String(args[1])); read.documentVersionId = String(args[0]); read.original.binding.documentVersionId = String(args[0]); return read; }
      return assessmentFixtureRead(name, ...args);
    });
    await mount('panel=assessment&assessmentTab=investigation&assessmentIssue=issue-test&parseRunId=PR1');
    const current = router.state.location.pathname + router.state.location.search;
    await click('前往这份文档的原文');
    if (variant === 'broken-locator' || variant === 'legacy-null-wi') {
      expect(router.state.location.pathname + router.state.location.search).toBe(current);
      expect(container.textContent).toContain(variant === 'broken-locator' ? '解析定位不完整或与来源不一致' : '未登记解析位置');
      expect(container.querySelector('a[href*="/work-items/null"]')).toBeNull();
      if (variant === 'legacy-null-wi') expect(container.querySelector('a[href="/document-versions/DV-FAM-1"]')).not.toBeNull();
    } else {
      expect(router.state.location.pathname).toBe(`/document-versions/${variant === 'cross-document' ? 'DV-FAM-2' : 'DV-FAM-1'}`);
      const params = new URLSearchParams(router.state.location.search);
      expect(params.get('parseRunId')).toBe('PR-HISTORIC'); expect(params.get('sourceRef')).toBe('source-ref-test');
      expect(container.textContent).not.toContain('此解析版本中未找到指定来源');
      expect(calls('readParsedDocument').at(-1)!.slice(1, 3)).toEqual([variant === 'cross-document' ? 'DV-FAM-2' : 'DV-FAM-1', 'PR-HISTORIC']);
      const back = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(node => node.textContent?.trim() === '返回文档评估')!;
      expect(back).toBeDefined();
      await act(async () => back.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
      expect(router.state.location.pathname).toBe('/document-versions/DV-FAM-1');
      expect(new URLSearchParams(router.state.location.search).get('assessmentIssue')).toBe('issue-test');
      expect(new URLSearchParams(router.state.location.search).get('assessmentTab')).toBe('investigation');
    }
    expect(mockApi.mock.calls.filter(call => writes.test(call[0]))).toEqual([]);
  });

it('updates Overall from a saved assessment using the existing exact projection action once', async () => {
  const binding = { expectedRevision: 7, reviewConversationId: 'fixture-conversation', reviewTurnId: 'fixture-turn',
    workRevisionRef: 'work-current-test', expectedWorkRevision: 3, sourceIdentity: { documentVersionId: 'DV-FAM-1',
      sourceArtifactId: 'fixture-source', sourceFileSha256: 'fixture-source', packageId: 'fixture-package', packageArtifactSha256: 'fixture-package' } };
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => name === 'getReviewOverallProjectionEligibility'
    ? { eligible: true, binding } : name === 'requestReviewOverallProjection' ? { status: 'SUCCEEDED', modelRequests: 0 }
      : assessmentFixtureRead(name, ...args));
  await mount('panel=assessment&parseRunId=PR1'); expect(calls('requestReviewOverallProjection')).toHaveLength(0);
  await click('从已保存评估更新综合'); expect(calls('requestReviewOverallProjection')).toHaveLength(1);
  expect(calls('requestReviewOverallProjection')[0]).toEqual(['requestReviewOverallProjection', 'WI-OLD', { ...binding, requestId: expect.any(String) }]);
  expect(container.textContent).toContain('已从已保存评估更新候选综合');
});

it.each([403, 404])('revokes the workspace when the actual shared working read rejects %i', async statusCode => {
  await mount(); const editor = draft(); await input(editor, 'clear after working read revocation');
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => { if (name === 'readJobAidAssessmentWork') throw Object.assign(new Error('working read rejected'), { statusCode }); return assessmentFixtureRead(name, ...args); });
  await click('刷新评估'); expect(container.querySelector('.document-assessment-content')).toBeNull(); expect(container.contains(editor)).toBe(false);
  expect(container.textContent).toContain('working read rejected');
});

it.each(['FTD', 'STALE'] as const)('does not expose the AEO operation when original gate %s fails', async gate => {
  const page = assessmentPageFixture();
  if (gate === 'FTD') page.workItem.classification.normalizedFamily = 'FTD';
  else page.workItem.integratedAssessment!.overallSynthesis!.status = 'STALE';
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => name === 'getDocumentParsingPage' ? page : assessmentFixtureRead(name, ...args));
  await mount('panel=assessment&assessmentTab=aeo');
  expect([...container.querySelectorAll('button')].some(node => node.textContent?.trim() === '确认当前整体综合用于 AEO 候选')).toBe(false);
  expect(calls('confirmIntegratedOverallForAeo')).toHaveLength(0); expect(calls('generateAeoCandidate')).toHaveLength(0);
});

it('requires a successful explicit confirmation readback before the real AEO generation handler is available', async () => {
  const page = assessmentPageFixture(); let confirmed = false;
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => {
    if (name === 'confirmIntegratedOverallForAeo') {
      confirmed = true; page.workItem.integratedAssessment!.overallForAeoConfirmation = { status: 'HUMAN_CONFIRMED', authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ', workItemRevision: 7,
        overallRevision: 2, overallArtifactRef: 'artifact:synthetic-overall', overallArtifactSha256: 'fixture-only', actionAttemptId: 'fixture-confirm', confirmingActorUserId: 'fixture-user', confirmedAt: '2026-10-23T00:00:00Z' };
      return { status: 'HUMAN_CONFIRMED' };
    }
    if (name === 'generateAeoCandidate') return { status: 'SUCCEEDED' };
    if (name === 'getDocumentParsingPage' && confirmed) return page;
    return assessmentFixtureRead(name, ...args);
  });
  await mount('panel=assessment&assessmentTab=aeo'); expect(calls('generateAeoCandidate')).toHaveLength(0);
  await click('确认当前整体综合用于 AEO 候选'); expect(calls('generateAeoCandidate')).toHaveLength(0);
  await click('生成 AEO 候选'); expect(calls('generateAeoCandidate')).toEqual([['generateAeoCandidate', 'WI-OLD']]);
});


it.each(['STALE', 'STALE_REASON'] as const)('keeps Overall historical when its own %s disagrees with matching CURRENT working read', async stale => {
  const page = assessmentPageFixture(); const overall = page.workItem.integratedAssessment!.overallSynthesis!;
  if (stale === 'STALE') overall.status = 'STALE'; else overall.staleReason = 'ENGINEER_REVIEW_CHANGED';
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => name === 'getDocumentParsingPage' ? page : assessmentFixtureRead(name, ...args));
  await mount('panel=assessment&parseRunId=PR1');
  expect(calls('readJobAidAssessmentWork')).toHaveLength(1);
  const opinion = container.querySelector('[aria-label="综合评估意见"]')!;
  expect(opinion.textContent).toContain('此前保存的综合意见 · 当前基础版本尚未匹配');
  expect(opinion.textContent).not.toContain('与本工作版本一致的综合意见');
  expect(opinion.textContent).toContain(overall.readingResult!.content.headline);
});

it('keeps the actual review instance and draft when a pending original body becomes ready', async () => {
  let finish!: (value: ReturnType<typeof assessmentOriginalFixture>) => void;
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => name === 'readParsedDocument'
    ? new Promise(resolve => { finish = resolve; }) : assessmentFixtureRead(name, ...args));
  await mount();
  const workspace = container.querySelector('.document-assessment-workspace'); const editor = draft();
  expect(workspace).not.toBeNull(); expect(container.querySelector('.source-reader-workspace')).toBeNull();
  await input(editor, '原文晚到仍保留的合成复核草稿'); editor.setSelectionRange(2, 6);
  const scroller = editor.closest<HTMLElement>('.document-assessment-content > .wl-retained-panel')!; scroller.scrollTop = 213;
  await act(async () => finish(assessmentOriginalFixture()));
  expect(container.querySelector('.source-reader-workspace')).not.toBeNull();
  expect(container.querySelector('.document-assessment-workspace')).toBe(workspace);
  expect(draft()).toBe(editor); expect(editor.value).toBe('原文晚到仍保留的合成复核草稿');
  expect(editor.selectionStart).toBe(2); expect(editor.selectionEnd).toBe(6); expect(scroller.scrollTop).toBe(213);
  expect(mockApi.mock.calls.filter(call => writes.test(call[0]))).toEqual([]);
});

it('keeps the actual review instance and draft when a fresh saved result revision replaces Quicklook and Wiki', async () => {
  await mount(); const workspace = container.querySelector('.document-assessment-workspace'); const editor = draft();
  await input(editor, '成果更新仍保留的合成复核草稿'); editor.setSelectionRange(1, 5);
  const scroller = editor.closest<HTMLElement>('.document-assessment-content > .wl-retained-panel')!; scroller.scrollTop = 287;
  const next = assessmentAssociationFixture(); const wiki = assessmentWikiFixture();
  next.result = { ...next.result!, sourceResultId: 'work-next-test', revision: 4,
    readingResult: { ...next.result!.readingResult!, resultRef: 'work-next-test', resultRevision: 4 } };
  wiki.entry = { ...wiki.entry, workRef: 'work-next-test', workRevision: 4 };
  wiki.reading = { ...wiki.reading!, resultRef: 'work-next-test', resultRevision: 4 };
  mockApi.mockImplementation(async (name: string, ...args: unknown[]) => name === 'getCanonicalLibraryQuicklook' ? next
    : name === 'readEngineeringKnowledgeWork' ? wiki : assessmentFixtureRead(name, ...args));
  await act(async () => window.dispatchEvent(new dom.window.Event('focus')));
  expect(calls('getCanonicalLibraryQuicklook')).toHaveLength(2);
  await panel('Wiki'); expect(container.querySelector('[data-work-ref="work-next-test"][data-work-revision="4"]')).not.toBeNull();
  await panel('评估'); await click('复核意见');
  expect(container.querySelector('.document-assessment-workspace')).toBe(workspace); expect(draft()).toBe(editor);
  expect(editor.value).toBe('成果更新仍保留的合成复核草稿'); expect(editor.selectionStart).toBe(1); expect(editor.selectionEnd).toBe(5);
  expect(scroller.scrollTop).toBe(287); expect(mockApi.mock.calls.filter(call => writes.test(call[0]))).toEqual([]);
});

it('preserves a legitimate Wiki guide return through assessment and the actual exact-source button', async () => {
  const guide = new URLSearchParams({ wikiQuery: 'synthetic configuration', wikiY: '248' }).toString();
  const origin = new URLSearchParams({ panel: 'assessment', assessmentTab: 'investigation', assessmentIssue: 'issue-test',
    parseRunId: 'PR1', returnDocumentVersionId: 'DV-FAM-1', returnWikiGuideQuery: guide });
  // The existing reader admits this precise object/path; the new return wrapper must agree.
  expect(readingReturnTarget(origin, 'DV-FAM-1', 'PR1')).toBeNull();
  expect(readingReturnTarget(origin, 'DV-FAM-1', 'PR1', undefined, undefined, '/document-versions/DV-FAM-1')?.route).toBe(wikiGuideReturnRoute(guide));
  await mount(origin.toString()); await click('前往这份文档的原文');
  const params = new URLSearchParams(router.state.location.search);
  expect(params.get('parseRunId')).toBe('PR-HISTORIC'); expect(params.get('sourceRef')).toBe('source-ref-test');
  const target = documentAssessmentReturnTarget(params, 'DV-FAM-1'); expect(target).not.toBeNull();
  expect(documentAssessmentReturnTarget(params, 'OTHER-DVI')).toBeNull();
  const back = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(node => node.textContent?.trim() === '返回文档评估')!;
  expect(back.getAttribute('href')).toBe(target!.route);
  await act(async () => back.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
  const restored = new URLSearchParams(router.state.location.search);
  expect(restored.get('returnWikiGuideQuery')).toBe(guide); expect(restored.get('assessmentIssue')).toBe('issue-test');
  expect(restored.get('assessmentTab')).toBe('investigation'); expect(restored.get('parseRunId')).toBe('PR1');
  expect([...container.querySelectorAll<HTMLAnchorElement>('a')].find(node => node.textContent?.trim() === '返回 Wiki 导览')?.getAttribute('href')).toBe(wikiGuideReturnRoute(guide));
  expect(mockApi.mock.calls.filter(call => writes.test(call[0]))).toEqual([]);
});
