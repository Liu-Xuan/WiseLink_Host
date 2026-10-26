import { act, createElement, type AnchorHTMLAttributes } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type { CanonicalLibraryQuicklookResponse } from '@shared/api.interface';
import { jobAidReadingResult } from '@shared/jobaid-problem-assessment.interface';
import { LibraryDocumentDetails } from '../../client/src/pages/WorkspaceHomePage/LibraryDocumentDetails';
import { libraryDocument, libraryFamily, libraryMetadata, libraryQuicklook } from './fixtures/canonical-library';
import { jobAidReadingFixture } from './semantic-reading-ui.fixtures';
import { libraryReadingParams, readingReturnTarget } from '@client/src/features/matter/reading-return';

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  subscribeCanonicalHostClientSession: () => () => undefined,
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
// This Node suite installs JSDOM per case; Radix otherwise caches a no-op before document exists.
jest.mock('@radix-ui/react-use-layout-effect', () => ({ useLayoutEffect: jest.requireActual('react').useLayoutEffect }));
jest.mock('@lark-apaas/client-toolkit/components/UniversalLink', () => ({
  UniversalLink: ({ to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) =>
    createElement('a', { ...props, href: to }),
}));
jest.mock('@client/src/features/matter/LinkDocumentMatterMaterial', () => ({
  __esModule: true, default: () => null,
}));
jest.mock('@client/src/pages/WorkspaceHomePage/DocumentOriginalPreview', () => ({
  DocumentOriginalInlinePreview: ({ documentVersionId }: { documentVersionId: string }) =>
    createElement('div', { 'data-original-version': documentVersionId }),
}));
jest.mock('@client/src/features/tdms-source/TdmsDocumentSourceReading', () => ({
  TdmsDocumentSourceReading: ({ documentVersionId }: { documentVersionId: string }) =>
    createElement('div', { 'data-opinion-version': documentVersionId }),
}));

function renderQuicklook(response: CanonicalLibraryQuicklookResponse) {
  const document = libraryFamily('787');
  document.versions[0]!.documentReading = { status: 'NOT_GENERATED', reading: null };
  return renderToStaticMarkup(createElement(StaticRouter, { location: '/library?familyId=787' },
    createElement(LibraryDocumentDetails, {
      document,
      assessmentQuicklook: { data: response, loading: false, error: null, accessDenied: false },
      onRefresh: jest.fn(), onViewTasks: jest.fn(),
    })));
}

describe('document library associated assessment', () => {
  it('shows a saved assessment only for the exact selected document version', () => {
    const response: CanonicalLibraryQuicklookResponse = {
      document: { ...libraryDocument('WI-NEW'), documentVersionId: 'DV-787-2' },
      result: { status: 'CANDIDATE_ONLY', revision: 2, sourceResultId: 'work-2',
        engineeringSummary: null, overallCandidate: null, missingInputs: [], gap: null,
        staleReason: null, sourceCount: 3, overallStatus: 'CURRENT',
        readingResult: jobAidReadingResult(jobAidReadingFixture().current!),
      },
      fileReadPerformed: false,
    };
    const correct = renderQuicklook(response);
    expect(correct).toContain('工程评估');
    expect(correct).toContain(response.result!.readingResult!.content.listBrief);
    const saved = new JSDOM(correct).window.document.querySelector('.library-assessment-provenance a')!;
    const destination = new URL(saved.getAttribute('href')!, 'https://example.test');
    expect(destination.pathname).toBe('/document-versions/DV-787-2');
    expect(destination.searchParams.get('workItemId')).toBe('WI-NEW');
    expect(destination.searchParams.get('panel')).toBe('assessment');
    expect(correct).toContain('文档摘要');
    expect(correct).toContain('暂无已保存解读');
    expect(correct).not.toContain('关联评估单独显示');

    const wrongVersion = renderQuicklook({ ...response, document: {
      ...response.document, documentVersionId: 'DV-787-1',
    } });
    expect(wrongVersion).not.toContain(response.result!.readingResult!.content.listBrief);
    expect(new JSDOM(wrongVersion).window.document.querySelector('.library-assessment-provenance a')).toBeNull();
  });
});

it('opens the exact selected historical document neighborhood rather than the family current version or a default matter', () => {
  const family=libraryFamily('787');
  const old=family.versions[1];
  const state = new URLSearchParams({ mode: 'document', selectedDocumentVersionId: old.documentVersionId,
    familyId: family.familyId, listY: '735', quicklookY: '81', expandedFamilyIds: '787,737',
    search: '787-SL', normalizedFamily: 'SL', ata2: '34', ata4: '3462',
    aircraftModels: JSON.stringify(['787-9', '787-8']), density: 'compact' });
  const html=renderToStaticMarkup(createElement(StaticRouter,{location:`/library?${state}`},
    createElement(LibraryDocumentDetails,{document:family,assessmentQuicklook:{data:null,loading:false,error:null,accessDenied:false},onRefresh:jest.fn(),onViewTasks:jest.fn()})));
  expect(html).toContain('文档关系图谱与时间');
  const dom = new JSDOM(html);
  const graph = new URL(dom.window.document.querySelector('a[href^="/graph?"]')!.getAttribute('href')!, 'https://example.test');
  expect(graph.searchParams.get('scope')).toBe('document');
  expect(graph.searchParams.get('documentVersionId')).toBe(old.documentVersionId);
  expect(graph.searchParams.get('readerWorkItemId')).toBe(old.readerWorkItemId);
  expect(graph.searchParams.get('returnDocumentVersionId')).toBe(old.documentVersionId);
  expect(graph.searchParams.get('returnLibraryQuery')).toBe(libraryReadingParams(state).toString());
  expect(readingReturnTarget(graph.searchParams, old.documentVersionId)?.route)
    .toBe(`/library?${libraryReadingParams(state)}`);
  dom.window.close();
});

function savedDetail() {
  const document = libraryFamily('787');
  const version = document.versions[0];
  version.extractedMetadata = libraryMetadata('3462', '787-9');
  version.documentReading = { status: 'AVAILABLE', reading: {
    readingRunRef: 'saved-document-reading', readingRevision: 3,
    headline: '文档解读标题', brief: '独立文档摘要，保持原文来源与版本。',
    criticalConditions: ['原文关键条件'], limitations: [], sourceLimitations: [],
    sourceBinding: { original: { documentVersionId: version.documentVersionId, parseRunId: 'saved-parse',
      parseRevision: 1, sourceArtifactId: 'synthetic-source', sourceSha256: 'a'.repeat(64),
      sourceByteLength: version.byteLength }, semanticRevision: 1 },
    coverageStatus: 'COMPLETE_DELIVERY', deliveredUnitCount: 1, totalUnitCount: 1,
    savedAt: '2026-10-14T00:00:00Z',
  } };
  const assessment = libraryQuicklook(version.readerWorkItemId);
  assessment.document.documentVersionId = version.documentVersionId;
  assessment.result!.engineeringSummary!.conclusion.text = '保存的综合结论，保留本版本依据。';
  assessment.result!.overallCandidate = '兼容的整体候选文本';
  assessment.result!.readingResult = jobAidReadingResult(jobAidReadingFixture().current!);
  assessment.result!.readingResult!.content.listBrief = '已保存的问题工作摘要，独立于整体综合。';
  return { document, assessment };
}

it('shows original fields, the independent saved document brief and genuine Overall separately with one top action group', () => {
  const { document, assessment } = savedDetail();
  const dom = new JSDOM(renderToStaticMarkup(createElement(StaticRouter, { location: '/library?familyId=787' },
    createElement(LibraryDocumentDetails, { document,
      assessmentQuicklook: { data: assessment, loading: false, error: null, accessDenied: false },
      onRefresh: jest.fn(), onViewTasks: jest.fn() }))));
  const body = dom.window.document.querySelector('.library-quicklook-scroll')!;
  const actions = dom.window.document.querySelector('[aria-label="文档操作"]')!;
  expect(actions.parentElement).toBe(body.parentElement);
  expect([...actions.querySelectorAll('button,a')].map(element => element.textContent)).toEqual(['阅读', '精读', '评估', '图谱', '更多']);
  expect([...actions.querySelectorAll('button,a')].every(element => Boolean(element.getAttribute('title')))).toBe(true);
  const reader = actions.querySelector('a[title^="进入精读"]')!;
  expect(reader.getAttribute('href')).toContain('/document-versions/DV-787-2?');
  expect(actions.querySelector('a[href^="/graph?"]')?.getAttribute('href')).toContain('documentVersionId=DV-787-2');
  expect(body.querySelector('.library-quicklook-history')).toBeNull();
  expect(body.querySelector('.library-quicklook-actions')).toBeNull();
  expect(body.querySelector('[aria-label="原文信息"]')?.textContent).toContain('R2 · 当前');
  expect(body.textContent!.indexOf('测试原文标题')).toBeLessThan(body.textContent!.indexOf('文档摘要'));
  expect(body.textContent!.indexOf('文档摘要')).toBeLessThan(body.textContent!.indexOf('综合判断'));
  const own = body.querySelector('.library-document-summary')!;
  expect(own.textContent).toContain(document.versions[0].documentReading!.reading!.brief);
  expect(own.textContent).not.toContain(assessment.result!.engineeringSummary!.conclusion.text);
  const overall = body.querySelector('.library-quicklook-assessment')!;
  expect(overall.querySelector('h4')?.textContent).toBe('综合判断');
  expect(overall.querySelector('.suite-library-summary > p')?.textContent).toBe(assessment.result!.engineeringSummary!.conclusion.text);
  expect(overall.getAttribute('data-assessment-result-id')).toBe(assessment.result!.sourceResultId);
  expect(overall.getAttribute('data-assessment-revision')).toBe(String(assessment.result!.revision));
  expect(overall.querySelector('.library-assessment-saved-work')?.textContent).toContain(assessment.result!.readingResult!.content.listBrief);
  dom.window.close();
});

it('uses the saved overallCandidate fallback and excludes wrong-version or wrong-workItem judgements', () => {
  const { document, assessment } = savedDetail();
  const render = () => new JSDOM(renderToStaticMarkup(createElement(StaticRouter, null,
    createElement(LibraryDocumentDetails, { document,
      assessmentQuicklook: { data: assessment, loading: false, error: null, accessDenied: false },
      onRefresh: jest.fn(), onViewTasks: jest.fn() }))));
  assessment.result!.engineeringSummary = null;
  const fallback = render();
  expect(fallback.window.document.querySelector('.library-quicklook-assessment .suite-library-summary > p')?.textContent)
    .toBe(assessment.result!.overallCandidate);
  fallback.window.close();
  for (const conflict of ['version', 'workItem']) {
    assessment.document.documentVersionId = conflict === 'version' ? 'OTHER-VERSION' : document.versions[0].documentVersionId;
    assessment.document.workItemId = conflict === 'workItem' ? 'OTHER-WORK' : document.versions[0].readerWorkItemId;
    const dom = render();
    const overall = dom.window.document.querySelector('.library-quicklook-assessment')!;
    expect(overall.textContent).not.toContain(assessment.result!.overallCandidate!);
    expect(overall.textContent).not.toContain(assessment.result!.readingResult!.content.listBrief);
    expect(overall.getAttribute('data-assessment-result-id')).toBeNull();
    expect(overall.querySelector('a')).toBeNull();
    dom.window.close();
  }
});

it.each(['legacy-result', 'jobaid-overall'] as const)('shows the real %s stale state before any in-progress caption', kind => {
  const { document, assessment } = savedDetail();
  assessment.result!.jobAidRoundCompletion = 'IN_PROGRESS';
  if (kind === 'legacy-result') {
    assessment.result!.status = 'STALE';
    delete assessment.result!.overallStatus;
  } else assessment.result!.overallStatus = 'STALE';
  const dom = new JSDOM(renderToStaticMarkup(createElement(StaticRouter, null,
    createElement(LibraryDocumentDetails, { document,
      assessmentQuicklook: { data: assessment, loading: false, error: null, accessDenied: false },
      onRefresh: jest.fn(), onViewTasks: jest.fn() }))));
  expect(dom.window.document.querySelector('.library-quicklook-assessment-status')?.textContent).toBe('已保存 · 历史结果');
  expect(dom.window.document.querySelector('.library-quicklook-assessment .suite-library-summary > p')?.textContent)
    .toBe(assessment.result!.engineeringSummary!.conclusion.text);
  dom.window.close();
});

it('keeps source reading, task navigation and historical links available through the compact actions and More dialog', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/library', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    Event: dom.window.Event, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const original = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const { document, assessment } = savedDetail();
  const onViewTasks = jest.fn();
  const router = createMemoryRouter([{ path: '/library', element: createElement(LibraryDocumentDetails, {
    document, assessmentQuicklook: { data: assessment, loading: false, error: null, accessDenied: false },
    onRefresh: jest.fn(), onViewTasks }) }], { initialEntries: ['/library?familyId=787'] });
  const root = createRoot(dom.window.document.querySelector('#root')!);
  try {
    await act(async () => root.render(createElement(RouterProvider, { router })));
    const assessmentLink = dom.window.document.querySelector<HTMLAnchorElement>('[aria-label="文档操作"] a[title="查看所选版本完整评估与来源"]')!;
    const assessmentUrl = new URL(assessmentLink.getAttribute('href')!, 'https://example.test');
    expect(assessmentUrl.pathname).toBe('/document-versions/DV-787-2');
    expect(assessmentUrl.searchParams.get('workItemId')).toBe(document.versions[0].readerWorkItemId);
    expect(assessmentUrl.searchParams.get('panel')).toBe('assessment');
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-label="直接阅读所选版本 PDF 与 TDMS 来源意见"]')!.click());
    expect(dom.window.document.querySelector('[data-original-version]')?.getAttribute('data-original-version')).toBe('DV-787-2');
    expect(dom.window.document.querySelector('[data-opinion-version]')?.getAttribute('data-opinion-version')).toBe('DV-787-2');
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click());
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[aria-label="版本历史、改版比较与更多操作"]')!.click());
    const dialog = dom.window.document.querySelector('[role="dialog"]')!;
    const tasks = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find(node => node.textContent?.startsWith('查看本文档评估任务'))!;
    await act(async () => tasks.click()); expect(onViewTasks).toHaveBeenCalledWith('787');
    expect(dialog.textContent).toContain('改版比较与全部版本（2）');
    const historical = [...dialog.querySelectorAll('a')].find(link => link.getAttribute('href')?.includes('/document-versions/DV-787-1?'))!;
    expect(historical).toBeDefined();
    expect(new URL(historical.getAttribute('href')!, 'https://example.test').searchParams.get('returnLibraryQuery')).toContain('selectedDocumentVersionId=DV-787-1');
    expect(dialog.querySelector('.library-version-list')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    // Radix restores focus on a zero-delay timer; keep this case's DOM Event constructor until it finishes.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    router.dispose(); dom.window.close();
    for (const key of Object.keys(values)) { const prior = original.get(key);
      if (prior) Object.defineProperty(globalThis, key, prior); else Reflect.deleteProperty(globalThis, key); }
  }
});
