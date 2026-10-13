import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import {
  initialAtlasLocation,
  type AtlasLocation,
} from '@client/src/features/atlas/atlas-model';
import {
  atlasHostAtaValues,
  atlasHostMacroRequest,
  readAtlasHostMacro,
} from '@client/src/features/atlas/atlas-host-macro';
import {
  atlasReadKey,
  useAtlasHost,
  type AtlasHostRead,
} from '@client/src/features/atlas/useAtlasHost';
import {
  macroMatterId,
  macroVersionId,
} from '@client/src/pages/RelationGraphPage/library-macro-graph';
import { LIBRARY_MACRO_BUDGET } from '@client/src/pages/RelationGraphPage/library-macro-read';
import {
  getCanonicalLibraryDocuments,
  getCanonicalLibraryQuicklook,
  getRelatedContextPreview,
} from '@client/src/api/canonical-host';
import {
  getEngineeringMatterDirectory,
  getEngineeringMatter,
  getEngineeringMatterWorkspace,
} from '@client/src/api/engineering-matter';
import {
  libraryDocuments,
  libraryMetadata,
  libraryQuicklook,
} from './fixtures/canonical-library';
import {
  libraryMatterFixture,
  libraryMatterRows,
} from './fixtures/library-matter';

let mockGeneration = 1;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalLibraryDocuments: jest.fn(),
  getCanonicalLibraryQuicklook: jest.fn(),
  getRelatedContextPreview: jest.fn(),
  getCanonicalLibraryGraph: jest.fn(),
  getCanonicalHostClientSessionGeneration: () => mockGeneration,
  summarizeCanonicalDocumentReadFailure: (reason: {
    statusCode?: number;
    code?: string;
  }) => ({ statusCode: reason?.statusCode, code: reason?.code }),
  isCanonicalObjectNotFound: () => false,
}));
jest.mock('@client/src/api/engineering-matter', () => ({
  getEngineeringMatterDirectory: jest.fn(),
  getEngineeringMatter: jest.fn(),
  getEngineeringMatterWorkspace: jest.fn(),
}));
const docs = jest.mocked(getCanonicalLibraryDocuments),
  directory = jest.mocked(getEngineeringMatterDirectory);
const matter = jest.mocked(getEngineeringMatter),
  quicklook = jest.mocked(getCanonicalLibraryQuicklook),
  preview = jest.mocked(getRelatedContextPreview);
const panorama: AtlasLocation = { ...initialAtlasLocation, view: 'panorama' };
const catalog = () => {
  const data = libraryDocuments(['family-a']);
  data.items[0].versions[0].extractedMetadata = libraryMetadata('3461');
  data.items[0].versions[1].extractedMetadata = libraryMetadata('3141');
  return data;
};
beforeEach(() => {
  jest.resetAllMocks();
  mockGeneration = 1;
  docs.mockResolvedValue(catalog());
  directory.mockResolvedValue({
    items: [],
    nextCursor: null,
    fileReadPerformed: false,
  });
});

describe('global Host Atlas shares the real library macro read', () => {
  it('uses the same authorized versions and registered material links without a newer-version substitution or a preview write', async () => {
    const workspace = libraryMatterFixture();
    workspace.matter.materials = [
      {
        materialId: 'old-material',
        kind: 'MEMBER',
        familyId: 'family-a',
        documentVersionId: 'DV-family-a-1',
        disposition: 'INCLUDED',
        scope: '',
        contribution: '',
        basis: [],
        origin: 'ENGINEER',
      },
    ];
    directory.mockResolvedValue({
      items: libraryMatterRows(),
      nextCursor: null,
      fileReadPerformed: false,
    });
    matter.mockResolvedValue(workspace.matter);
    const read = await readAtlasHostMacro(
      panorama,
      new AbortController().signal,
    );
    expect(read.counts).toMatchObject({
      classifications: 4,
      families: 1,
      versions: 2,
      matters: 1,
      materials: 1,
    });
    expect(
      read.graph.edges.find((edge) => edge.kind === 'MATTER_MATERIAL'),
    ).toMatchObject({
      source: macroMatterId(workspace.matter.matterId),
      target: macroVersionId('DV-family-a-1'),
    });
    expect(read.targets.get(macroVersionId('DV-family-a-1'))).toMatchObject({
      documentVersionId: 'DV-family-a-1',
      readerWorkItemId: 'WI-OLD',
      current: false,
    });
    expect(read.read.coverage.references).toBe('NOT_INDEXED');
    expect(read.graph.edges.some((edge) => edge.kind === 'REFERS_TO')).toBe(
      false,
    );
    expect(preview).not.toHaveBeenCalled();
    expect(quicklook).not.toHaveBeenCalled();
    expect(getEngineeringMatterWorkspace).not.toHaveBeenCalled();
  });
  it('keeps the example fmc slug separate from raw Host ATA and carries exact raw filters to the existing endpoint', async () => {
    const domain = {
      ...panorama,
      view: 'domain' as const,
      domain: 'fmc',
      hostAta: '4600-00',
      search: ' SB ',
    };
    expect(atlasHostMacroRequest({ ...domain, hostAta: undefined })).toEqual({
      level: 'clusters',
      groupBy: 'ata',
      search: 'SB',
    });
    await readAtlasHostMacro(domain, new AbortController().signal);
    expect(docs.mock.calls[0][0]).toMatchObject({
      ata: '4600-00',
      search: 'SB',
      limit: 50,
    });
    const projection = await readAtlasHostMacro(
      panorama,
      new AbortController().signal,
    );
    expect(atlasHostAtaValues(projection)).toEqual(['3461', '3141']);
    expect(atlasReadKey(domain, 1)).not.toBe(
      atlasReadKey({ ...domain, hostAta: '3461' }, 1),
    );
  });
  it('preserves the existing pagination budget, partial counts and missing global citation index', async () => {
    for (let page = 0; page < LIBRARY_MACRO_BUDGET.documentPages; page++)
      docs.mockResolvedValueOnce(
        libraryDocuments([`page-${page}`], `cursor-${page}`),
      );
    const read = await readAtlasHostMacro(
      panorama,
      new AbortController().signal,
    );
    expect(docs).toHaveBeenCalledTimes(4);
    expect(read.read.coverage.documents).toBe('PARTIAL');
    expect(read.counts.families).toBe(4);
    expect(read.graph.notices.join(' ')).toContain('当前画布对象数');
    expect(read.graph.notices.join(' ')).toContain('引用尚未建立全库索引');
  });
  it.each([403, 503])(
    'keeps an unreadable matter catalog (%s) distinct from a real empty catalog',
    async (statusCode) => {
      directory.mockRejectedValue(
        Object.assign(new Error('matter failure'), { statusCode }),
      );
      const read = await readAtlasHostMacro(
        panorama,
        new AbortController().signal,
      );
      expect(read.graph.nodes.some((node) => node.kind === 'document')).toBe(
        true,
      );
      expect(read.read.coverage.matters).toBe(
        statusCode === 403 ? 'NOT_AUTHORIZED' : 'READ_FAILED',
      );
      expect(read.graph.notices.join(' ')).toContain('事项目录未能读回');
    },
  );
  it('returns an actual authorized empty scope without creating example objects', async () => {
    docs.mockResolvedValue(libraryDocuments([]));
    const read = await readAtlasHostMacro(
      panorama,
      new AbortController().signal,
    );
    expect(read.graph.nodes).toEqual([]);
    expect(read.graph.edges).toEqual([]);
    expect(read.read.coverage).toEqual({
      documents: 'COMPLETE',
      matters: 'COMPLETE',
      references: 'NOT_INDEXED',
    });
    expect(read.graph.notices.join(' ')).not.toContain('示例');
  });
});

describe('Host Atlas loading and saved exact-version reading', () => {
  let dom: JSDOM, root: Root, container: HTMLElement, latest: AtlasHostRead;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  beforeAll(() => {
    dom = new JSDOM('<!doctype html><body></body>', {
      url: 'https://example.test/',
    });
    for (const [key, value] of Object.entries({
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
  });
  afterAll(() => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  function Harness({
    location,
    session = 1,
    denied = false,
  }: {
    location: AtlasLocation;
    session?: number;
    denied?: boolean;
  }) {
    latest = useAtlasHost(location, session, denied, 0);
    return createElement(
      'output',
      null,
      JSON.stringify({
        loading: latest.loading,
        error: latest.error,
        graph: latest.graph,
      }),
    );
  }
  const mount = async (location = panorama, session = 1, denied = false) => {
    await act(async () =>
      root.render(createElement(Harness, { location, session, denied })),
    );
  };
  it('shows a real loading state until the existing catalog read resolves', async () => {
    let resolve!: (value: ReturnType<typeof catalog>) => void;
    docs.mockReturnValueOnce(
      new Promise((value) => {
        resolve = value;
      }),
    );
    await mount();
    expect(latest.loading).toBe(true);
    expect(latest.macro).toBeUndefined();
    await act(async () => {
      resolve(catalog());
    });
    expect(latest.loading).toBe(false);
    expect(latest.macro?.counts.versions).toBe(2);
  });
  it('surfaces a failed read rather than returning a successful zero-object panorama', async () => {
    docs.mockRejectedValue(
      Object.assign(new Error('network'), { code: 'ERR_NETWORK' }),
    );
    await mount();
    expect(latest.loading).toBe(false);
    expect(latest.error).toContain('连接');
    expect(latest.macro).toBeUndefined();
    expect(directory).not.toHaveBeenCalled();
  });
  it('does not issue reads without authentication and does not replace Host with example data', async () => {
    await mount(panorama, 1, true);
    expect(latest.error).toContain('登录');
    expect(latest.loading).toBe(false);
    expect(docs).not.toHaveBeenCalled();
    expect(latest.graph.nodes).toEqual([]);
  });
  it('discards an old account completion and aborts the previous request when session changes', async () => {
    let resolve!: (value: ReturnType<typeof catalog>) => void;
    docs.mockReturnValueOnce(
      new Promise((value) => {
        resolve = value;
      }),
    );
    await mount();
    const signal = docs.mock.calls[0][1]!;
    mockGeneration = 2;
    docs.mockResolvedValue(libraryDocuments([]));
    await mount(panorama, 2);
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(catalog());
    });
    expect(latest.graph.nodes).toEqual([]);
    expect(latest.macro?.read.documents).toEqual([]);
  });
  it('keeps the saved reading and SourceRefs on the selected old version rather than the current catalog version', async () => {
    const q = libraryQuicklook('WI-OLD');
    q.document.documentVersionId = 'DV-family-a-1';
    q.result!.readingResult = {
      resultRef: q.result!.sourceResultId,
      resultRevision: q.result!.revision,
      scope: {
        kind: 'WORK_ITEM',
        workItemId: 'WI-OLD',
        documentVersionId: 'DV-family-a-1',
      },
      candidateOnly: true,
      evidence: [
        {
          evidenceRef: 'source-old',
          kind: 'DOCUMENT_PASSAGE',
          workItemId: 'WI-OLD',
          documentVersionId: 'DV-family-a-1',
          sourceRefId: 'SR-old',
          locator: 'Page 1',
          title: '旧版原文',
          versionLabel: 'R1',
          excerpt: '旧版完整条件',
        },
      ],
      content: {
        schemaVersion: 'wiselink.3_1.assessment_reading.v1',
        headline: '旧版已保存意见',
        listBrief: '旧版条件',
        lead: '旧版完整原文条件',
        claims: [],
        decisiveClaimIds: [],
      },
    };
    quicklook.mockResolvedValue(q);
    preview.mockRejectedValue(new Error('preview unavailable'));
    await mount({
      ...initialAtlasLocation,
      focus: 'WI-OLD',
      documentVersionId: 'DV-family-a-1',
    });
    expect(quicklook).toHaveBeenCalledWith('WI-OLD', expect.any(AbortSignal));
    expect(latest.reading).toBe(q.result!.readingResult);
    expect(latest.reading!.evidence[0]).toMatchObject({
      documentVersionId: 'DV-family-a-1',
      sourceRefId: 'SR-old',
    });
    expect(latest.graph.nodes[0].documentVersionId).toBe('DV-family-a-1');
    expect(latest.error).toContain('显式引用读取失败');
  });
  it('rejects a changed exact-version reader before preview and keeps an actual missing result missing', async () => {
    const q = libraryQuicklook('WI-OLD');
    q.document.documentVersionId = 'DV-family-a-2';
    quicklook.mockResolvedValue(q);
    await mount({
      ...initialAtlasLocation,
      focus: 'WI-OLD',
      documentVersionId: 'DV-family-a-1',
    });
    expect(latest.error).toContain('准确文档版本');
    expect(latest.reading).toBeUndefined();
    expect(preview).not.toHaveBeenCalled();
    q.document.documentVersionId = 'DV-family-a-1';
    q.result = null;
    preview.mockRejectedValue(new Error('preview unavailable'));
    await mount({
      ...initialAtlasLocation,
      view: 'source',
      focus: 'WI-OLD',
      documentVersionId: 'DV-family-a-1',
    });
    expect(latest.quicklook?.result).toBeNull();
    expect(latest.reading).toBeUndefined();
  });
});
