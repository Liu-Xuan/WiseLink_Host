import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { DocumentParsingStatus } from '@shared/document-parsing.interface';
import {
  EMPTY_DOCUMENT_READING_LINKS,
  readDocumentReadingLinks,
} from '../../client/src/pages/DocumentParsingPage/document-reading-links';
import { useDocumentReadingLinks } from '../../client/src/pages/DocumentParsingPage/useDocumentReadingLinks';
import { libraryDocuments, libraryQuicklook } from './fixtures/canonical-library';
import { summaryKnowledge } from './fixtures/derived-summary';
import { CanonicalLibraryService } from '../../server/modules/canonical-host/canonical-library.service';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type { CanonicalLibraryDocumentsRequest } from '@shared/api.interface';
import { syntheticMiaodaActorFixture } from '../fixtures/synthetic-development-canonical-object-access.adapter';

const mockCatalogue = jest.fn();
const mockQuicklook = jest.fn();
const mockKnowledge = jest.fn();
let mockGeneration = 1;
let mockAuthenticationRequired = false;
const mockSessions: Array<() => void> = [];
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalLibraryDocuments: (...args: unknown[]) => mockCatalogue(...args),
  getCanonicalLibraryQuicklook: (...args: unknown[]) => mockQuicklook(...args),
  readEngineeringKnowledgeWork: (...args: unknown[]) => mockKnowledge(...args),
  getCanonicalHostClientSessionGeneration: () => mockGeneration,
  isCanonicalHostClientSessionAuthenticationRequired: () => mockAuthenticationRequired,
  requireCanonicalHostClientAuthentication: () => { mockAuthenticationRequired = true; mockGeneration++; mockSessions.forEach(callback => callback()); },
  subscribeCanonicalHostClientSession: (callback: () => void) => {
    mockSessions.push(callback);
    return () => undefined;
  },
}));

function status(documentVersionId = 'DV-FAM-1'): DocumentParsingStatus {
  return {
    documentVersionId, familyId: 'FAM', documentCode: '737-SL-34-258',
    documentTitle: 'Flight Management Computer – Update 14.1', normalizedFamily: 'SL',
    issuerAuthority: 'BOEING', businessRevision: 'R1', revisionDate: '2026-04-24',
    sourceGeneratedDate: '', selectedVersionIsCurrent: false, originalFilename: '737-SL-34-258.pdf',
    latestRun: null, publishedRun: null, runtimeAvailable: true,
    runtime: { state: 'CALL_SUCCEEDED', errorCode: null, lastCompletedAt: null },
  };
}

function wiki(workItemId = 'WI-OLD', workRef = 'JAWR-OLD', version = 'DV-FAM-1') {
  const reading = summaryKnowledge();
  if (!reading.reading) throw new Error('Fixture must contain saved reading');
  reading.entry = { ...reading.entry, subjectId: workItemId, workRef, workRevision: 2 };
  reading.reading = { ...reading.reading, resultRef: workRef, resultRevision: 2,
    scope: { kind: 'WORK_ITEM', workItemId, documentVersionId: version } };
  return reading;
}

function saved(workItemId = 'WI-OLD', workRef = 'JAWR-OLD', version = 'DV-FAM-1') {
  const value = libraryQuicklook(workItemId);
  value.document = { ...value.document, documentVersionId: version, familyId: 'FAM' };
  if (!value.result) throw new Error('Fixture must contain a saved result');
  value.result = { ...value.result, sourceResultId: workRef,
    jobAidRoundCompletion: 'COMPLETE', readingResult: wiki(workItemId, workRef, version).reading };
  return value;
}

beforeEach(() => {
  jest.resetAllMocks(); mockGeneration = 1; mockAuthenticationRequired = false; mockSessions.length = 0;
  mockCatalogue.mockResolvedValue(libraryDocuments(['FAM']));
  mockQuicklook.mockResolvedValue(saved());
  mockKnowledge.mockResolvedValue(wiki());
});

it('opens saved assessment and Wiki for the selected historical version, never the first/current version', async () => {
  const signal = new AbortController().signal;
  const links = await readDocumentReadingLinks(status(), signal);
  expect(mockCatalogue).toHaveBeenCalledWith({ search: '737-SL-34-258', normalizedFamily: 'SL', limit: 50, cursor: undefined }, signal);
  expect(mockQuicklook).toHaveBeenCalledWith('WI-OLD', signal);
  expect(mockKnowledge).toHaveBeenCalledWith({ subjectKind: 'WORK_ITEM', subjectId: 'WI-OLD', workRef: 'JAWR-OLD' }, signal);
  expect(links.assessmentRoute).toBe('/work-items/WI-OLD/analysis?panel=assessment&documentVersionId=DV-FAM-1');
  expect(links.wikiRoute).toBe('/knowledge?subjectKind=WORK_ITEM&subjectId=WI-OLD&workRef=JAWR-OLD&scope=ALL');
  expect(links.error).toBeNull();
  expect(links.assessment?.document.documentVersionId).toBe('DV-FAM-1');
  expect(links.knowledge?.content.issues).toEqual(wiki().content.issues);
});

it('uses a page size admitted by the existing real catalogue service contract', async () => {
  const identity = syntheticMiaodaActorFixture('reader-a', 'tenant-a');
  identity.env = 'preview'; identity.subjectDecision.version = 'miaoda-hosted-native-sso.v1';
  const actor: CanonicalHostActor = { userId: 'reader-a', tenantId: 'tenant-a',
    appId: 'app_17bzc551rsg', env: 'preview', roles: [], objectAccessActor: identity };
  const catalogue = libraryDocuments(['FAM']);
  const repository = { listDocuments: jest.fn().mockResolvedValue([{
    totalCount: 1, familyCounts: { SL: 1 }, ataCounts: {}, aircraftModelCounts: {},
    rows: catalogue.items.map((document) => ({ ...document, numberRank: 0 as const,
      createdAt: new Date(document.createdAt), updatedAt: new Date(document.updatedAt) })),
  }]) };
  const service = new CanonicalLibraryService(repository as never,
    { authorize: jest.fn() } as never, { freshRead: jest.fn() } as never);
  mockCatalogue.mockImplementation((input: CanonicalLibraryDocumentsRequest) => service.list(input, actor));
  expect((await readDocumentReadingLinks(status(), new AbortController().signal)).wikiRoute).toContain('JAWR-OLD');
  expect(repository.listDocuments.mock.calls[0][0].limit).toBe(50);
  await expect(service.list({ limit: 51 }, actor)).rejects.toThrow('LIBRARY_LIMIT_INVALID');
});

it('bounds catalogue pagination and reports incomplete association rather than borrowing another family', async () => {
  mockCatalogue.mockImplementation((_input: CanonicalLibraryDocumentsRequest) =>
    Promise.resolve(libraryDocuments(['OTHER'], `next-page-${mockCatalogue.mock.calls.length}`)));
  await expect(readDocumentReadingLinks(status(), new AbortController().signal)).rejects.toThrow('同文号资料较多');
  expect(mockCatalogue).toHaveBeenCalledTimes(4);
  expect(mockQuicklook).not.toHaveBeenCalled(); expect(mockKnowledge).not.toHaveBeenCalled();
});

it('follows existing catalogue pagination to the exact family', async () => {
  mockCatalogue.mockResolvedValueOnce(libraryDocuments(['OTHER'], 'next-exact-page'));
  await readDocumentReadingLinks(status(), new AbortController().signal);
  expect(mockCatalogue.mock.calls[1][0].cursor).toBe('next-exact-page');
  expect(mockQuicklook.mock.calls[0][0]).toBe('WI-OLD');
});

it('does not substitute another family or version when the selected version is absent', async () => {
  mockCatalogue.mockResolvedValue(libraryDocuments(['OTHER']));
  await expect(readDocumentReadingLinks(status(), new AbortController().signal)).rejects.toThrow('未返回此文档版本');
  expect(mockQuicklook).not.toHaveBeenCalled();
  mockCatalogue.mockResolvedValue(libraryDocuments(['FAM']));
  await expect(readDocumentReadingLinks(status('missing-version'), new AbortController().signal)).rejects.toThrow('未返回此文档版本');
  expect(mockQuicklook).not.toHaveBeenCalled();
});

it.each(['workItemId', 'documentVersionId', 'familyId'] as const)('rejects mismatched saved assessment %s', async (field) => {
  const response = saved(); response.document[field] = 'unrelated';
  mockQuicklook.mockResolvedValue(response);
  await expect(readDocumentReadingLinks(status(), new AbortController().signal)).rejects.toThrow('与当前文档版本不一致');
  expect(mockKnowledge).not.toHaveBeenCalled();
});

it('rejects a saved assessment body whose exact work revision differs from its association', async () => {
  const response = saved();
  if (!response.result?.readingResult) throw new Error('Missing fixture reading');
  response.result.readingResult.resultRef = 'OTHER-WORK';
  mockQuicklook.mockResolvedValue(response);
  await expect(readDocumentReadingLinks(status(), new AbortController().signal)).rejects.toThrow('评估正文与当前文档版本不一致');
  expect(mockKnowledge).not.toHaveBeenCalled();
});

it('disables a missing work association but retains a legitimate work before its first result', async () => {
  const catalogue = libraryDocuments(['FAM']); catalogue.items[0].versions[1].readerWorkItemId = '';
  mockCatalogue.mockResolvedValueOnce(catalogue);
  expect(await readDocumentReadingLinks(status(), new AbortController().signal)).toEqual(EMPTY_DOCUMENT_READING_LINKS);
  expect(mockQuicklook).not.toHaveBeenCalled();
  mockQuicklook.mockResolvedValue({ ...saved(), result: null });
  expect((await readDocumentReadingLinks(status(), new AbortController().signal)).assessment?.document.workItemId).toBe('WI-OLD');
  expect(mockKnowledge).not.toHaveBeenCalled();
});

it('keeps an existing legacy assessment without fabricating a Wiki work reference', async () => {
  const response = saved();
  if (!response.result) throw new Error('Missing fixture result');
  delete response.result.jobAidRoundCompletion;
  mockQuicklook.mockResolvedValue(response);
  const links = await readDocumentReadingLinks(status(), new AbortController().signal);
  expect(links.assessmentRoute).toContain('WI-OLD'); expect(links.wikiRoute).toBeNull();
  expect(mockKnowledge).not.toHaveBeenCalled();
});

it('rejects a Wiki body bound to another document even when its entry identity matches', async () => {
  mockKnowledge.mockResolvedValue(wiki('WI-OLD', 'JAWR-OLD', 'DV-FAM-2'));
  const links = await readDocumentReadingLinks(status(), new AbortController().signal);
  expect(links.wikiRoute).toBeNull(); expect(links.wikiError).toContain('与当前文档版本不一致');
});

it.each([403, 404])('retains the association after independent Wiki rejection %i', async (statusCode) => {
  mockKnowledge.mockRejectedValue(Object.assign(new Error('Wiki不可访问'), { statusCode }));
  const links = await readDocumentReadingLinks(status(), new AbortController().signal);
  expect(links.assessment?.document.workItemId).toBe('WI-OLD'); expect(links.wikiRoute).toBeNull();
  expect(links.wikiError).toBe('Wiki不可访问'); expect(links.error).toBeNull();
});
it('propagates Wiki401 for global session cleanup', async () => {
  mockKnowledge.mockRejectedValue(Object.assign(new Error('身份失效'), { statusCode: 401 }));
  await expect(readDocumentReadingLinks(status(), new AbortController().signal)).rejects.toThrow('身份失效');
});
it('publishes the verified association before a pending Wiki read', async () => {
  const association = jest.fn(); let finish!: (value: ReturnType<typeof wiki>) => void;
  mockKnowledge.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const pending = readDocumentReadingLinks(status(), new AbortController().signal, association);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(association).toHaveBeenCalledWith(expect.objectContaining({ assessment: expect.any(Object), wikiLoading: true }));
  finish(wiki()); await pending;
});

it('does not hide an independent assessment when only the Wiki read transiently fails', async () => {
  mockKnowledge.mockRejectedValue(new Error('工程知识读取超时'));
  const links = await readDocumentReadingLinks(status(), new AbortController().signal);
  expect(links.assessmentRoute).toContain('WI-OLD'); expect(links.wikiRoute).toBeNull();
  expect(links.wikiError).toBe('工程知识读取超时');
});

async function withHook(test: (container: HTMLElement, render: (value: DocumentParsingStatus) => Promise<void>) => Promise<void>) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container: HTMLElement = dom.window.document.getElementById('root');
  const root = createRoot(container);
  function ReadingLinks({ value }: { value: DocumentParsingStatus }) {
    const links = useDocumentReadingLinks(value, 0);
    return createElement('div', { 'data-assessment': links.assessmentRoute, 'data-wiki': links.wikiRoute });
  }
  try {
    await test(container, async (value) => {
      await act(async () => root.render(createElement(ReadingLinks, { value })));
    });
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

it('discards a late saved response after the document version changes', async () => {
  let finishOld!: (value: ReturnType<typeof saved>) => void;
  mockQuicklook.mockImplementation((id: string) => id === 'WI-OLD'
    ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve(saved('WI-NEW', 'JAWR-NEW', 'DV-FAM-2')));
  mockKnowledge.mockImplementation((identity: { subjectId: string; workRef: string }) =>
    Promise.resolve(wiki(identity.subjectId, identity.workRef, 'DV-FAM-2')));
  await withHook(async (container, render) => {
    await render(status()); await render(status('DV-FAM-2'));
    expect(container.innerHTML).toContain('JAWR-NEW');
    await act(async () => finishOld(saved()));
    expect(container.innerHTML).toContain('JAWR-NEW'); expect(container.innerHTML).not.toContain('JAWR-OLD');
  });
});

it('hides prior related links while a new browser session is being checked', async () => {
  await withHook(async (container, render) => {
    await render(status()); expect(container.innerHTML).toContain('JAWR-OLD');
    mockCatalogue.mockReturnValue(new Promise(() => undefined));
    await act(async () => { mockGeneration++; mockSessions.forEach((callback) => callback()); });
    expect(container.querySelector('[data-assessment]')).toBeNull();
    expect(container.querySelector('[data-wiki]')).toBeNull();
  });
});
