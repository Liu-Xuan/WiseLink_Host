import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import { useSuiteGraphSources } from '../../client/src/pages/RelationGraphPage/useSuiteGraphSources';
import type {
  SuiteGraphTimelineEventPins,
} from '../../client/src/pages/RelationGraphPage/suite-graph-timeline';

const { JSDOM } = require('jsdom');

let mockSession = 1;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  readDocumentParsingStatus: jest.fn(),
  readDocumentActivityReading: jest.fn(),
}));

let mockIdentity = { appId: 'app', tenantId: 'tenant', actorId: 'actor', sessionGeneration: 1 };
jest.mock('../../client/src/features/matter/useEngineeringMatter', () => ({
  ENGINEERING_MATTER_QUERY_ROOT: ['canonical-host', 'engineering-matter'],
  useEngineeringMatterQueryIdentity: () => ({ identity: mockIdentity, identityQuery: { error: null } }),
}));

const canonicalHostMock = jest.requireMock('@client/src/api/canonical-host');
const mockReadStatus = canonicalHostMock.readDocumentParsingStatus as jest.Mock;
const mockReadActivity = canonicalHostMock.readDocumentActivityReading as jest.Mock;

const pins: SuiteGraphTimelineEventPins = {
  documentVersionId: 'dv-b',
  familyId: 'family-b',
  parseRunId: 'parse-b',
  candidateRevision: 7,
  runRef: 'run-b',
  statementId: 'statement-b',
  anchorId: 'anchor-b',
};

function catalogEntry(documentVersionId: string): EngineeringMatterCatalogEntry {
  return {
    workItemId: `work-${documentVersionId}`,
    relationRole: 'PRIMARY',
    linkedAtWorkItemRevision: 1,
    currentWorkItemRevision: 1,
    workItemChangedSinceLink: false,
    workItemStatus: 'ACTIVE',
    document: {
      documentId: `document-${documentVersionId}`,
      documentVersionId,
      documentCode: documentVersionId.toUpperCase(),
      businessRevision: 'R01',
      normalizedFamily: documentVersionId.toUpperCase(),
    },
    documentCurrentness: {
      familyId: `family-${documentVersionId}`,
      currentDocumentVersionId: documentVersionId,
      currentGeneration: 1,
      selectedVersionIsCurrent: true,
    },
    sourceNavigation: {
      status: 'AVAILABLE',
      sourceRefCount: 1,
      structuredContentPath: `/document-versions/${documentVersionId}`,
    },
  };
}

let queryClient: QueryClient;
let current: ReturnType<typeof useSuiteGraphSources>;

function SourceProbe({ restorePins }: { restorePins?: SuiteGraphTimelineEventPins }) {
  current = useSuiteGraphSources({
    catalog: [catalogEntry('dv-a'), catalogEntry('dv-b')],
    enabled: true,
    session: mockSession,
    denied: false,
    restorePins,
  });
  return null;
}

function Probe(props: { restorePins?: SuiteGraphTimelineEventPins }) {
  return createElement(QueryClientProvider, { client: queryClient }, createElement(SourceProbe, props));
}

describe('useSuiteGraphSources exact event restoration', () => {
  let dom: { window: Window & typeof globalThis };
  let root: Root;
  let container: HTMLDivElement;

  beforeAll(() => {
    dom = new JSDOM('<!doctype html><body></body>');
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
  });

  afterAll(() => dom.window.close());

  beforeEach(() => {
    mockSession = 1;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockIdentity = { appId: 'app', tenantId: 'tenant', actorId: 'actor', sessionGeneration: 1 };
    mockReadStatus.mockReset();
    mockReadActivity.mockReset();
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => { act(() => root.unmount()); queryClient.clear(); jest.restoreAllMocks(); });

  it('loads a returned non-default source by exact saved candidate pins', async () => {
    mockReadActivity.mockResolvedValue({
      familyId: 'family-b',
      binding: { documentVersionId: 'dv-b', parseRunId: 'parse-b' },
      candidate: {
        candidateRevision: 7,
        runRef: 'run-b',
        statements: [{ statementId: 'statement-b' }],
      },
    });
    await act(async () => root.render(createElement(Probe, { restorePins: pins })));
    expect(mockReadActivity).toHaveBeenCalledWith({
      documentVersionId: 'dv-b',
      parseRunId: 'parse-b',
      candidateRevision: 7,
    }, expect.any(AbortSignal));
    expect(mockReadStatus).not.toHaveBeenCalled();
    expect(current.activeSourceId).toBe('dv-b');
    expect(current.activities.has('dv-b')).toBe(true);
  });

  it('marks a missing historical candidate unavailable without reading current status', async () => {
    mockReadActivity.mockResolvedValue({
      familyId: 'family-b',
      binding: { documentVersionId: 'dv-b', parseRunId: 'parse-b' },
      candidate: null,
    });
    await act(async () => root.render(createElement(Probe, { restorePins: pins })));
    expect(mockReadStatus).not.toHaveBeenCalled();
    expect(current.activities.has('dv-b')).toBe(false);
    expect(current.sources.find((source) => source.documentVersionId === 'dv-b'))
      .toMatchObject({
        status: 'unavailable',
        notice: '原时间节点的保存候选已不可读；未改用当前候选。',
      });
  });
  async function remount() {
    await act(async () => root.render(null));
    await act(async () => root.render(createElement(Probe)));
  }

  it('reuses a fresh same-identity source status after actual unmount and remount', async () => {
    mockReadStatus.mockResolvedValue({ publishedRun: null });
    await act(async () => root.render(createElement(Probe)));
    await remount();
    expect(mockReadStatus).toHaveBeenCalledTimes(1);
    expect(current.sources[0].status).toBe('unparsed');
    expect(mockReadActivity).not.toHaveBeenCalled();
  });

  it('explicit refresh rechecks a fresh source', async () => {
    mockReadStatus.mockResolvedValue({ publishedRun: null });
    await act(async () => root.render(createElement(Probe)));
    await act(async () => current.expandSource('dv-a'));
    expect(mockReadStatus).toHaveBeenCalledTimes(2);
  });

  it('expired remount hides the old candidate while a fresh read is pending', async () => {
    mockReadStatus.mockResolvedValue({ publishedRun: { parseRunId: 'parse-a' } });
    mockReadActivity.mockResolvedValue({ familyId: 'family-a', binding: { documentVersionId: 'dv-a', parseRunId: 'parse-a' }, candidate: { runRef: 'run-a', statements: [] } });
    await act(async () => root.render(createElement(Probe)));
    expect(current.activities.has('dv-a')).toBe(true);
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 31_000);
    let resolve!: (value: unknown) => void;
    mockReadStatus.mockImplementation(() => new Promise((r) => { resolve = r; }));
    await remount();
    expect(mockReadStatus).toHaveBeenCalledTimes(2);
    expect(current.activities.size).toBe(0);
    expect(current.sources[0].status).toBe('loading');
    await act(async () => resolve({ publishedRun: null }));
    expect(current.sources[0].status).toBe('unparsed');
  });

  it('fresh denial replaces saved content, survives remount, and explicit retry recovers', async () => {
    mockReadStatus.mockResolvedValue({ publishedRun: null });
    await act(async () => root.render(createElement(Probe)));
    mockReadStatus.mockRejectedValue(Object.assign(new Error('access denied'), { statusCode: 403 }));
    await act(async () => current.expandSource('dv-a'));
    await remount();
    expect(mockReadStatus).toHaveBeenCalledTimes(2);
    expect(current.sources[0]).toMatchObject({ status: 'unavailable', notice: '该来源当前不可读，相关声明已从列表清除。' });
    expect(current.activities.size).toBe(0);
    mockReadStatus.mockResolvedValue({ publishedRun: null });
    await act(async () => current.expandSource('dv-a'));
    expect(mockReadStatus).toHaveBeenCalledTimes(3);
    expect(current.sources[0].status).toBe('unparsed');
  });

  it.each(['actorId', 'tenantId', 'appId'] as const)('does not share source state after %s changes', async (field) => {
    mockReadStatus.mockResolvedValue({ publishedRun: null });
    await act(async () => root.render(createElement(Probe)));
    mockIdentity = { ...mockIdentity, [field]: 'different' };
    await remount();
    expect(mockReadStatus).toHaveBeenCalledTimes(2);
  });

  it('drops a late session result before starting its dependent activity read', async () => {
    let resolve!: (value: unknown) => void;
    mockReadStatus.mockImplementation(() => new Promise((r) => { resolve = r; }));
    await act(async () => root.render(createElement(Probe)));
    await act(async () => root.render(null));
    mockSession = 2;
    await act(async () => resolve({ publishedRun: { parseRunId: 'old' } }));
    expect(mockReadActivity).not.toHaveBeenCalled();
    mockReadStatus.mockResolvedValue({ publishedRun: null });
    mockIdentity = { ...mockIdentity, sessionGeneration: 2 };
    await act(async () => root.render(createElement(Probe)));
    expect(mockReadStatus).toHaveBeenCalledTimes(2);
    expect(current.sources[0].status).toBe('unparsed');
  });

  it('keeps exact saved candidate revisions separate and rejects a mismatched response', async () => {
    mockReadActivity.mockResolvedValue({ familyId: 'family-b', binding: { documentVersionId: 'dv-b', parseRunId: 'parse-b' }, candidate: { candidateRevision: 7, runRef: 'run-b', statements: [{ statementId: 'statement-b' }] } });
    await act(async () => root.render(createElement(Probe, { restorePins: pins })));
    await act(async () => root.render(null));
    await act(async () => root.render(createElement(Probe, { restorePins: { ...pins, candidateRevision: 8 } })));
    expect(mockReadActivity).toHaveBeenCalledTimes(2);
    expect(mockReadStatus).not.toHaveBeenCalled();
    expect(current.activities.size).toBe(0);
    expect(current.sources.find((source) => source.documentVersionId === 'dv-b')?.status).toBe('unavailable');
  });

  it('existing session-root clearing removes source resources before a later remount', async () => {
    mockReadStatus.mockResolvedValue({ publishedRun: null });
    await act(async () => root.render(createElement(Probe)));
    await act(async () => root.render(null));
    await queryClient.cancelQueries({ queryKey: ['canonical-host', 'engineering-matter'] });
    queryClient.removeQueries({ queryKey: ['canonical-host', 'engineering-matter'], type: 'inactive' });
    await act(async () => root.render(createElement(Probe)));
    expect(mockReadStatus).toHaveBeenCalledTimes(2);
  });

  it('shares the same in-flight read across remount without publishing into the old subscriber', async () => {
    let resolve!: (value: unknown) => void;
    mockReadStatus.mockImplementation(() => new Promise((r) => { resolve = r; }));
    await act(async () => root.render(createElement(Probe)));
    await remount();
    expect(mockReadStatus).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ publishedRun: null }));
    expect(current.sources[0].status).toBe('unparsed');
  });

});
