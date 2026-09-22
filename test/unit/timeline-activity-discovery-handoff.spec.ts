import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type {
  DocumentActivityReadingRequest,
  DocumentActivityReadingResponse,
} from '@shared/document-activity.interface';

const mockParsingStatus = jest.fn();
const mockActivityReading = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  readDocumentParsingStatus: (...args: unknown[]) => mockParsingStatus(...args),
  readDocumentActivityReading: (...args: unknown[]) => mockActivityReading(...args),
  subscribeCanonicalHostClientSession: () => () => {},
  getCanonicalHostClientSessionGeneration: () => 1,
  getCanonicalLibraryDocuments: jest.fn(),
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatter: jest.fn(),
  getEngineeringMatterDirectory: jest.fn(),
}));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  __esModule: true,
  useCurrentUserSession: () => ({ sessionGeneration: 1, authenticationRequired: false }),
}));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({
  logger: { error: () => {}, warn: () => {}, info: () => {}, log: () => {} },
}));
jest.mock('lucide-react', () => ({ Clock: () => null, Compass: () => null, Network: () => null }));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }), { virtual: true });
jest.mock('@client/src/features/navigation/shell-utils', () => ({
  selectMatterTimelineSources: () => [],
}));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentActivityReadingView', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/trinity/DocumentActivityGraphView', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@client/src/features/trinity/DocumentActivityTimelineView', () => ({
  __esModule: true,
  default: (props: {
    reading: DocumentActivityReadingResponse | null;
    loading: boolean;
    error: string | null;
  }) => {
    const react = require('react');
    const body = props.reading?.candidate
      ? `RUN:${props.reading.candidate.runRef}@REV:${props.reading.candidate.candidateRevision}`
      : props.loading
        ? 'loading'
        : props.error ?? 'empty';
    return react.createElement('div', null, body);
  },
}));

import EngineeringTimelinePage from '../../client/src/pages/EngineeringTimelinePage/EngineeringTimelinePage';

function savedReading(documentVersionId: string, parseRunId: string, runRef: string): DocumentActivityReadingResponse {
  return {
    familyId: `family-${documentVersionId}`,
    binding: {
      documentVersionId,
      parseRunId,
      parseRevision: 1,
      sourceArtifactId: `artifact-${documentVersionId}`,
      sourceSha256: `sha-${documentVersionId}`,
      sourceByteLength: 10,
    },
    candidate: {
      schemaVersion: 'wiselink.document.activity-candidate.v1',
      candidateOnly: true,
      sourceBinding: {
        original: {
          documentVersionId,
          parseRunId,
          parseRevision: 1,
          sourceArtifactId: `artifact-${documentVersionId}`,
          sourceSha256: `sha-${documentVersionId}`,
          sourceByteLength: 10,
        },
        semanticRevision: 2,
      },
      readCoverage: {
        status: 'DELIVERED_RANGES_ONLY',
        selection: { sectionIds: [] },
        deliveredRanges: [],
        sourceCoverage: { knownPageCount: null, readPageIndexes: [], unresolvedRanges: [] },
      },
      sourceAnchors: [],
      runRef,
      candidateRevision: 4,
      statements: [],
      producer: { skillVersion: 'test', modelVersion: 'test' },
      savedAt: '2026-09-21T00:00:00.000Z',
    },
  };
}

let observedSearch = '';
function LocationProbe() {
  observedSearch = useLocation().search;
  return null;
}

let testNavigate: ((to: string) => void) | null = null;
function NavProbe() {
  testNavigate = useNavigate();
  return null;
}

function renderTimeline(root: ReturnType<typeof createRoot>, initialEntry: string) {
  return act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [initialEntry] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/timeline', element: createElement(EngineeringTimelinePage) }),
        ),
        createElement(LocationProbe),
      ),
    );
  });
}

describe('engineering timeline discovery handoff', () => {
  function withDom(run: (container: HTMLElement) => Promise<void>): Promise<void> {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<div id="root"></div>');
    const prior = new Map<string, PropertyDescriptor | undefined>();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const container: HTMLElement = dom.window.document.getElementById('root')!;
    return run(container).finally(async () => {
      dom.window.close();
      for (const [key, value] of prior) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
      }
    });
  }

  beforeEach(() => {
    mockParsingStatus.mockReset();
    mockActivityReading.mockReset();
    observedSearch = '';
    testNavigate = null;
  });

  test('discovery registers the normalized identity and never re-reads the same candidate', async () => {
    await withDom(async (container) => {
      mockParsingStatus.mockResolvedValue({ publishedRun: { parseRunId: 'PR1' } });
      mockActivityReading.mockResolvedValue(savedReading('DV1', 'PR1', 'RUN4'));
      const root = createRoot(container);
      try {
        await renderTimeline(root, '/timeline?documentVersionId=DV1');
        await act(async () => {});
        const params = new URLSearchParams(observedSearch);
        expect(params.get('documentVersionId')).toBe('DV1');
        expect(params.get('parseRunId')).toBe('PR1');
        expect(params.get('candidateRevision')).toBe('4');
        expect(params.get('runRef')).toBe('RUN4');
        expect(mockParsingStatus).toHaveBeenCalledTimes(1);
        expect(mockActivityReading).toHaveBeenCalledTimes(1);
        const request: DocumentActivityReadingRequest = mockActivityReading.mock.calls[0][0];
        expect(request).toEqual({ documentVersionId: 'DV1', parseRunId: 'PR1' });
        expect(request.candidateRevision).toBeUndefined();
        expect(container.textContent).toContain('RUN:RUN4@REV:4');
      } finally {
        await act(async () => root.unmount());
      }
    });
  });

  test('exact historical pins read once with the pinned candidate revision', async () => {
    await withDom(async (container) => {
      mockActivityReading.mockResolvedValue(savedReading('DV1', 'PR1', 'RUN4'));
      const root = createRoot(container);
      try {
        await renderTimeline(
          root,
          '/timeline?documentVersionId=DV1&parseRunId=PR1&candidateRevision=4&runRef=RUN4',
        );
        await act(async () => {});
        expect(mockParsingStatus).not.toHaveBeenCalled();
        expect(mockActivityReading).toHaveBeenCalledTimes(1);
        expect(mockActivityReading.mock.calls[0][0]).toEqual({
          documentVersionId: 'DV1',
          parseRunId: 'PR1',
          candidateRevision: 4,
        });
        expect(container.textContent).toContain('RUN:RUN4@REV:4');
      } finally {
        await act(async () => root.unmount());
      }
    });
  });

  test('returning to a successful document after another document fails does not strand loading', async () => {
    await withDom(async (container) => {
      mockParsingStatus.mockImplementation((documentVersionId: string) =>
        Promise.resolve({ publishedRun: { parseRunId: `PR-${documentVersionId}` } }),
      );
      mockActivityReading.mockImplementation((request: DocumentActivityReadingRequest) => {
        if (request.documentVersionId === 'DV2') {
          return Promise.reject(new Error('DV2 reading blocked'));
        }
        return Promise.resolve(savedReading('DV1', 'PR-DV1', 'RUN4'));
      });
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            createElement(
              MemoryRouter,
              { initialEntries: ['/timeline?documentVersionId=DV1'] },
              createElement(
                Routes,
                null,
                createElement(Route, { path: '/timeline', element: createElement(EngineeringTimelinePage) }),
              ),
              createElement(NavProbe),
              createElement(LocationProbe),
            ),
          );
        });
        await act(async () => {});
        expect(container.textContent).toContain('RUN:RUN4@REV:4');
        await act(async () => { testNavigate!('/timeline?documentVersionId=DV2'); });
        await act(async () => {});
        expect(container.textContent).toContain('DV2 reading blocked');
        await act(async () => {
          testNavigate!('/timeline?documentVersionId=DV1&parseRunId=PR-DV1&candidateRevision=4&runRef=RUN4');
        });
        await act(async () => {});
        expect(container.textContent).toContain('RUN:RUN4@REV:4');
        expect(container.textContent).not.toContain('DV2 reading blocked');
        expect(container.textContent).not.toContain('loading');
        const dv1Calls = mockActivityReading.mock.calls.filter(
          (call: unknown[]) => (call[0] as DocumentActivityReadingRequest).documentVersionId === 'DV1',
        );
        expect(dv1Calls.length).toBeGreaterThanOrEqual(2);
      } finally {
        await act(async () => root.unmount());
      }
    });
  });

  test('switching documents during discovery discards the late response of the old document', async () => {
    await withDom(async (container) => {
      const pendingA: Array<(value: DocumentActivityReadingResponse) => void> = [];
      mockParsingStatus.mockImplementation((documentVersionId: string) =>
        Promise.resolve({ publishedRun: { parseRunId: `PR-${documentVersionId}` } }),
      );
      mockActivityReading.mockImplementation((request: DocumentActivityReadingRequest) => {
        if (request.documentVersionId === 'DV1') {
          return new Promise((resolve) => pendingA.push(resolve));
        }
        return Promise.resolve(savedReading('DV2', 'PR-DV2', 'RUN9'));
      });
      const root = createRoot(container);
      try {
        await act(async () => {
          root.render(
            createElement(
              MemoryRouter,
              { initialEntries: ['/timeline?documentVersionId=DV1'] },
              createElement(
                Routes,
                null,
                createElement(Route, { path: '/timeline', element: createElement(EngineeringTimelinePage) }),
              ),
              createElement(NavProbe),
              createElement(LocationProbe),
            ),
          );
        });
        await act(async () => {});
        expect(pendingA.length).toBe(1);
        // act drains React work, not host timers. Explicitly commit the new
        // selection before releasing A; a zero-delay timer made this assertion
        // depend on machine timing and the preceding suite's duration.
        await act(async () => {
          testNavigate!('/timeline?documentVersionId=DV2');
        });
        expect(new URLSearchParams(observedSearch).get('documentVersionId')).toBe('DV2');
        expect(container.textContent).toContain('RUN:RUN9@REV:4');
        await act(async () => {
          pendingA[0](savedReading('DV1', 'PR-DV1', 'RUN-STALE'));
        });
        await act(async () => {});
        expect(container.textContent).toContain('RUN:RUN9@REV:4');
        expect(container.textContent).not.toContain('RUN-STALE');
        const dv2Calls = mockActivityReading.mock.calls.filter(
          (call: unknown[]) => (call[0] as DocumentActivityReadingRequest).documentVersionId === 'DV2',
        );
        expect(dv2Calls).toHaveLength(1);
      } finally {
        await act(async () => root.unmount());
      }
    });
  });
});
