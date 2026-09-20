import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EngineeringMatterCatalogEntry } from '@shared/api.interface';
import { useSuiteGraphSources } from '../../client/src/pages/RelationGraphPage/useSuiteGraphSources';
import type {
  SuiteGraphTimelineEventPins,
} from '../../client/src/pages/RelationGraphPage/suite-graph-timeline';

const { JSDOM } = require('jsdom');

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  readDocumentParsingStatus: jest.fn(),
  readDocumentActivityReading: jest.fn(),
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

let current: ReturnType<typeof useSuiteGraphSources>;

function Probe({ restorePins }: { restorePins?: SuiteGraphTimelineEventPins }) {
  current = useSuiteGraphSources({
    catalog: [catalogEntry('dv-a'), catalogEntry('dv-b')],
    enabled: true,
    session: 1,
    denied: false,
    restorePins,
  });
  return null;
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
    mockReadStatus.mockReset();
    mockReadActivity.mockReset();
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => act(() => root.unmount()));

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
});
