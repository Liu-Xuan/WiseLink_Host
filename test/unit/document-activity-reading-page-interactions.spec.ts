import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import DocumentActivityReadingPage from '@client/src/pages/DocumentParsingPage/DocumentActivityReadingPage';
import {
  activityReadingParams,
  activityReadingReturnParams,
  readingReturnTarget,
} from '../../client/src/features/matter/reading-return';
import {
  validateActivityEntry,
  planActivityEntry,
} from '../../client/src/pages/DocumentParsingPage/document-activity-entry';

const { JSDOM } = require('jsdom');

const mockStatus = jest.fn();
const mockActivity = jest.fn();
const mockSessionCallbacks: Array<() => void> = [];
jest.mock('@client/src/api/canonical-host', () => ({
  readDocumentParsingStatus: (...args: unknown[]) => mockStatus(...args),
  readDocumentActivityReading: (...args: unknown[]) => mockActivity(...args),
  subscribeCanonicalHostClientSession: (callback: () => void) => {
    mockSessionCallbacks.push(callback);
    return () => undefined;
  },
}));
jest.mock('@client/src/pages/DocumentParsingPage/DocumentActivityReadingView', () => ({
  __esModule: true,
  default: (props: {
    binding: { documentVersionId: string; parseRunId: string };
    candidate: { runRef: string; candidateRevision: number } | null;
    selectedStatementId: string | null;
    selectedAnchorId: string | null;
    returnParamsFor?: (
      binding: { documentVersionId: string; parseRunId: string },
      statementId?: string | null,
      anchorId?: string | null,
    ) => string | null;
  }) =>
    createElement(
      'div',
      {
        'data-candidate': props.candidate ? 'yes' : 'no',
        'data-run': props.candidate ? props.candidate.runRef : '',
        'data-statement': props.selectedStatementId ?? '',
        'data-anchor': props.selectedAnchorId ?? '',
        'data-return-st2': props.returnParamsFor
          ? props.returnParamsFor(props.binding, 'ST2', 'A2') ?? ''
          : '',
        'data-return-none': props.returnParamsFor
          ? props.returnParamsFor(props.binding, null, null) ?? ''
          : '',
      },
      props.candidate ? `candidate-${props.candidate.runRef}` : 'no-candidate',
    ),
}));
jest.mock('@client/src/components/ui/badge', () => ({ Badge: 'span' }));
jest.mock('@client/src/components/ui/card', () => ({
  Card: 'section',
  CardContent: 'div',
  CardHeader: 'header',
  CardTitle: 'h2',
}));

function makeSavedCandidate(runRef = 'run-1') {
  return {
    schemaVersion: 'wiselink.document.activity-candidate.v1',
    runRef,
    candidateRevision: 4,
    candidateOnly: true,
    sourceBinding: {
      original: {
        documentVersionId: 'DV1',
        parseRunId: 'PR1',
        parseRevision: 3,
        sourceArtifactId: 'ART1',
        sourceSha256: 'sha',
        sourceByteLength: 10,
      },
      semanticRevision: 3,
    },
    producer: { skillVersion: 'skill-1', modelVersion: 'model-1' },
    savedAt: '2026-09-15T00:00:00.000Z',
    readCoverage: {
      status: 'DELIVERED_RANGES_ONLY',
      selection: { sectionIds: ['S1'] },
      deliveredRanges: [],
      sourceCoverage: { knownPageCount: 1, readPageIndexes: [], unresolvedRanges: [] },
    },
    statements: [
      {
        statementId: 'ST1',
        statementKey: 'K1',
        label: 'L',
        time: null,
        statusRaw: null,
        quotes: [],
        limitations: [],
      },
    ],
    sourceAnchors: [],
  };
}

let root: Root;
let router: ReturnType<typeof createMemoryRouter>;
let dom: InstanceType<typeof JSDOM>;
let container: HTMLElement;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mount(query = '') {
  router = createMemoryRouter(
    [{ path: '/document-versions/:documentVersionId/activities', element: createElement(DocumentActivityReadingPage) }],
    { initialEntries: [`/document-versions/DV1/activities${query ? `?${query}` : ''}`], future: { v7_relativeSplatPath: true } },
  );
  root = createRoot(container);
  await act(async () => root.render(createElement(RouterProvider, { router, future: { v7_startTransition: true } })));
}

async function navigate(next: string) {
  await act(async () => {
    await router.navigate(next);
  });
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = dom.window.document.getElementById('root');
  jest.clearAllMocks();
  mockSessionCallbacks.length = 0;
  mockStatus.mockReset().mockResolvedValue({ publishedRun: { parseRunId: 'PR1' } });
  mockActivity
    .mockReset()
    .mockResolvedValue({ familyId: 'FAM1', binding: makeSavedCandidate().sourceBinding.original, candidate: makeSavedCandidate() });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  router?.dispose();
  dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});

describe('entry gate renders without any request', () => {
  test.each([
    'runRef=run-1',
    'statementId=ST1',
    'candidateRevision=abc',
    'parseRunId=A&parseRunId=B',
    'parseRunId=PR1&candidateRevision=4',
    'parseRunId=PR1&runRef=run-1',
  ])('query "%s" never reaches the network',
    async (query) => {
      await mount(query);
      expect(container.querySelector('[data-candidate]')).toBeNull();
      expect(mockStatus).not.toHaveBeenCalled();
      expect(mockActivity).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain('正在读取');
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    },
  );
});

describe('discovery then pin', () => {
  it('discovers the published run once, writes the complete pins back with replace and reloads pinned', async () => {
    await mount('');
    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(mockActivity).toHaveBeenCalledTimes(2);
    expect(mockActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ documentVersionId: 'DV1', parseRunId: 'PR1', candidateRevision: 4 }),
      expect.anything(),
    );
    expect(router.state.location.search).toContain('parseRunId=PR1');
    expect(router.state.location.search).toContain('candidateRevision=4');
    expect(router.state.location.search).toContain('runRef=run-1');
    expect(container.querySelector('[data-candidate="yes"][data-run="run-1"]')).not.toBeNull();
  });

  it('without a published run explains the block and never reads activity', async () => {
    mockStatus.mockResolvedValue({ publishedRun: null });
    await mount('');
    expect(mockActivity).not.toHaveBeenCalled();
    expect(container.textContent).toContain('没有已发布的解析版本');
    expect(container.querySelector('[data-candidate]')).toBeNull();
  });

  it('a null saved candidate pins only the discovered parse run and keeps the no-candidate state', async () => {
    mockActivity.mockResolvedValue({ familyId: 'FAM1', binding: makeSavedCandidate().sourceBinding.original, candidate: null });
    await mount('');
    expect(router.state.location.search).toContain('parseRunId=PR1');
    expect(router.state.location.search).not.toContain('runRef=');
    expect(container.querySelector('[data-candidate="no"]')).not.toBeNull();
  });
});

describe('explicit pins never fall back', () => {
  it('a pinned runRef mismatching the saved candidate errors without re-pointing', async () => {
    await mount('parseRunId=PR1&candidateRevision=4&runRef=run-other');
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('运行标识与已保存候选不一致');
    expect(container.querySelector('[data-candidate]')).toBeNull();
  });

  it('an explicit candidate pair without a saved candidate errors and writes no pins', async () => {
    mockActivity.mockResolvedValue({ familyId: 'FAM1', binding: makeSavedCandidate().sourceBinding.original, candidate: null });
    await mount('parseRunId=PR1&candidateRevision=9&runRef=run-x');
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('run-x');
    expect(container.textContent).toContain('没有已保存的活动候选');
    expect(container.querySelector('[data-candidate]')).toBeNull();
  });

  it('an explicit parse run with a null candidate shows the saved-empty state without pin writes', async () => {
    mockActivity.mockResolvedValue({ familyId: 'FAM1', binding: makeSavedCandidate().sourceBinding.original, candidate: null });
    await mount('parseRunId=PR1');
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-candidate="no"]')).not.toBeNull();
    expect(router.state.location.search).toBe('?parseRunId=PR1');
  });

  it('a pinned runRef with a null candidate errors instead of showing empty', async () => {
    mockActivity.mockResolvedValue({ familyId: 'FAM1', binding: makeSavedCandidate().sourceBinding.original, candidate: null });
    await mount('parseRunId=PR1&candidateRevision=4&runRef=run-1');
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('没有已保存的活动候选');
    expect(container.querySelector('[data-candidate]')).toBeNull();
  });
});

describe('late URL / session switches are discarded', () => {
  it('ignores a late response after the selection changed', async () => {
    const pending = deferred<unknown>();
    mockActivity.mockImplementationOnce(() => pending.promise);
    await mount('parseRunId=PR1&statementId=ST1');
    await navigate('/document-versions/DV1/activities?parseRunId=PR1&statementId=ST2');
    expect(container.querySelector('[data-statement="ST2"][data-run="run-1"]')).not.toBeNull();
    await act(async () => {
      pending.resolve({ familyId: 'FAM1', binding: makeSavedCandidate().sourceBinding.original, candidate: makeSavedCandidate('late') });
    });
    expect(container.querySelector('[data-run="late"]')).toBeNull();
    expect(container.querySelector('[data-run="run-1"]')).not.toBeNull();
  });

  it('a session change resets state and reloads under the same identity', async () => {
    await mount('parseRunId=PR1&candidateRevision=4&runRef=run-1');
    expect(mockActivity).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-candidate="yes"]')).not.toBeNull();
    await act(async () => {
      mockSessionCallbacks.forEach((callback) => callback());
    });
    expect(mockActivity).toHaveBeenCalledTimes(2);
    expect(router.state.location.search).toBe('?parseRunId=PR1&candidateRevision=4&runRef=run-1');
    expect(container.querySelector('[data-candidate="yes"]')).not.toBeNull();
  });
});

describe('zero-request planning (pure gate)', () => {
  test('blocked entries never plan a read', () => {
    for (const query of [
      'runRef=run-1',
      'candidateRevision=0',
      'anchor=',
      'parseRunId=PR1&candidateRevision=4',
      'parseRunId=PR1&runRef=run-1',
    ]) {
      const entry = validateActivityEntry(new URLSearchParams(query));
      expect(planActivityEntry('DV1', entry).mode).toBe('blocked');
    }
  });
});

describe('reader return identity comes from the loaded candidate and the click context', () => {
  function returnQueryOf(attr: string | null): URLSearchParams {
    return new URLSearchParams(new URLSearchParams(attr ?? '').get('returnActivityQuery') ?? '');
  }

  it('after a discovery with no selection, a real source click returns the same candidate and the clicked selection', async () => {
    await mount('');
    const view = container.querySelector('[data-candidate="yes"]');
    expect(view).not.toBeNull();
    const none = returnQueryOf(view?.getAttribute('data-return-none') ?? null);
    expect(none.get('parseRunId')).toBe('PR1');
    expect(none.get('candidateRevision')).toBe('4');
    expect(none.get('runRef')).toBe('run-1');
    expect(none.get('statementId')).toBeNull();
    expect(none.get('anchor')).toBeNull();
    const clicked = returnQueryOf(view?.getAttribute('data-return-st2') ?? null);
    expect(clicked.get('parseRunId')).toBe('PR1');
    expect(clicked.get('candidateRevision')).toBe('4');
    expect(clicked.get('runRef')).toBe('run-1');
    expect(clicked.get('statementId')).toBe('ST2');
    expect(clicked.get('anchor')).toBe('A2');
  });

  it('clicking ST2 while the URL pins ST1 returns ST2, never the stale URL selection', async () => {
    await mount('parseRunId=PR1&candidateRevision=4&runRef=run-1&statementId=ST1');
    const view = container.querySelector('[data-candidate="yes"][data-statement="ST1"]');
    expect(view).not.toBeNull();
    const clicked = returnQueryOf(view?.getAttribute('data-return-st2') ?? null);
    expect(clicked.get('statementId')).toBe('ST2');
    expect(clicked.get('anchor')).toBe('A2');
    expect(clicked.get('candidateRevision')).toBe('4');
    const none = returnQueryOf(view?.getAttribute('data-return-none') ?? null);
    expect(none.get('statementId')).toBeNull();
    expect(none.get('anchor')).toBeNull();
    expect(none.get('runRef')).toBe('run-1');
  });

  it('returns through the reader selection and then the original timeline selection', async () => {
    const parent = new URLSearchParams({
      documentVersionId: 'DV1',
      parseRunId: 'PR1',
      candidateRevision: '4',
      runRef: 'run-1',
      statementId: 'ST1',
      anchor: 'A1',
      window: 'current-year',
    });
    const entry = new URLSearchParams({
      parseRunId: 'PR1',
      candidateRevision: '4',
      runRef: 'run-1',
      statementId: 'ST-reader',
      returnActivityQuery: parent.toString(),
      returnActivityView: 'timeline',
    });
    await mount(entry.toString());
    const view = container.querySelector('[data-candidate="yes"]');
    const originalParams = new URLSearchParams(
      view?.getAttribute('data-return-st2') ?? '',
    );
    const readerTarget = readingReturnTarget(originalParams, 'DV1', 'PR1');
    expect(readerTarget?.route).toContain('/activities?');
    const readerQuery = new URL(readerTarget!.route, 'https://example.test').searchParams;
    expect(readerQuery.get('statementId')).toBe('ST2');
    expect(readerQuery.get('anchor')).toBe('A2');
    const timelineTarget = readingReturnTarget(readerQuery, 'DV1', 'PR1');
    expect(timelineTarget?.route).toContain('/timeline?');
    const timelineQuery = new URL(timelineTarget!.route, 'https://example.test').searchParams;
    expect(timelineQuery.get('statementId')).toBe('ST1');
    expect(timelineQuery.get('anchor')).toBe('A1');
    expect(timelineQuery.get('window')).toBe('current-year');
  });
});

describe('activity -> reader -> activity round trip', () => {
  const fullPins =
    'parseRunId=PR1&candidateRevision=4&runRef=run-1&statementId=ST1&anchor=A1' +
    '&returnLibraryQuery=mode%3Ddocument%26familyId%3DF1%26documentVersionId%3DDV1';

  it('the reader return params carry the complete four pins plus selection and library context', () => {
    const returnQuery = activityReadingReturnParams(fullPins, 'DV1');
    expect(returnQuery.get('returnDocumentVersionId')).toBe('DV1');
    const returnActivity = new URLSearchParams(returnQuery.get('returnActivityQuery') ?? '');
    expect(returnActivity.get('parseRunId')).toBe('PR1');
    expect(returnActivity.get('candidateRevision')).toBe('4');
    expect(returnActivity.get('runRef')).toBe('run-1');
    expect(returnActivity.get('statementId')).toBe('ST1');
    expect(returnActivity.get('anchor')).toBe('A1');
    expect(returnActivity.get('returnLibraryQuery')).toContain('familyId=F1');
  });

  it('readingReturnTarget routes back to the exact activity identity', () => {
    const readerParams = activityReadingReturnParams(fullPins, 'DV1');
    const target = readingReturnTarget(readerParams, 'DV1', 'PR1');
    expect(target?.label).toBe('返回活动阅读');
    expect(target?.route).toContain('/document-versions/DV1/activities?');
    const targetQuery = new URLSearchParams(target?.route.split('?')[1] ?? '');
    expect(targetQuery.get('parseRunId')).toBe('PR1');
    expect(targetQuery.get('candidateRevision')).toBe('4');
    expect(targetQuery.get('runRef')).toBe('run-1');
    expect(targetQuery.get('statementId')).toBe('ST1');
    expect(targetQuery.get('anchor')).toBe('A1');
    expect(targetQuery.get('returnLibraryQuery')).toContain('familyId=F1');
  });

  it('missing pins, run mismatch or document mismatch refuse the return', () => {
    expect(
      readingReturnTarget(activityReadingReturnParams('parseRunId=PR1&runRef=run-1', 'DV1'), 'DV1', 'PR1'),
    ).toBeNull();
    expect(
      readingReturnTarget(
        activityReadingReturnParams('parseRunId=PR1&candidateRevision=4&runRef=run-1&statementId=ST1', 'DV1'),
        'DV1',
        'PR2',
      ),
    ).toBeNull();
    expect(readingReturnTarget(activityReadingReturnParams(fullPins, 'DV1'), 'DV2', 'PR1')).toBeNull();
  });

  it('an activity return nesting another activity return is rejected', () => {
    const inner = activityReadingParams(new URLSearchParams(fullPins));
    inner.set('returnActivityQuery', 'parseRunId%3DPR1');
    const nested = activityReadingReturnParams(inner.toString(), 'DV1');
    expect(readingReturnTarget(nested, 'DV1', 'PR1')).toBeNull();
  });
});
