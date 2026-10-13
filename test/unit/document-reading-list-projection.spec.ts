import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import type {
  CanonicalLibraryDocumentSummary,
  CanonicalLibraryDocumentVersionSummary,
} from '@shared/api.interface';
import type { DocumentReadingPreview } from '@shared/document-reading.interface';
import { documentIdentityPresentation, projectLibraryDocumentReading } from '@client/src/pages/WorkspaceHomePage/library-document-presentation';
import LibraryDocumentRows from '@client/src/pages/WorkspaceHomePage/LibraryDocumentRows';
import { LibraryDocumentDetails } from '@client/src/pages/WorkspaceHomePage/LibraryDocumentDetails';
import { libraryMetadata } from './fixtures/canonical-library';

jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 1,
  subscribeCanonicalHostClientSession: () => () => undefined,
}));
jest.mock('@client/src/features/matter/reading-location', () => ({
  saveReadingLocation: jest.fn(),
}));
jest.mock('@client/src/features/matter/useReadingLocation', () => ({
  captureReadingLocation: () => null,
}));
jest.mock('@client/src/components/ui/button', () => ({
  Button: ({ children }: { children?: ReactNode }) =>
    createElement('span', null, children),
}));
jest.mock('@client/src/features/matter/LinkDocumentMatterMaterial', () => ({
  __esModule: true,
  default: () => createElement('div'),
}));

type PreviewReading = NonNullable<DocumentReadingPreview['reading']>;

function previewReading(
  headline: string,
  overrides: Partial<PreviewReading> = {},
): PreviewReading {
  return {
    readingRunRef: `RUN-${headline}`,
    readingRevision: 3,
    headline,
    brief: `简明解读 ${headline}`,
    criticalConditions: [`关键条件 ${headline}`],
    limitations: [`认识限制 ${headline}`],
    sourceLimitations: [`来源限制 ${headline}`],
    sourceBinding: {
      original: {
        documentVersionId: 'DV-X',
        parseRunId: 'parse-1',
        parseRevision: 1,
        sourceArtifactId: 'art-1',
        sourceSha256: 'c'.repeat(64),
        sourceByteLength: 200,
      },
      semanticRevision: 2,
    },
    coverageStatus: 'COMPLETE_DELIVERY',
    deliveredUnitCount: 5,
    totalUnitCount: 5,
    savedAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

function version(
  documentVersionId: string,
  overrides: Partial<CanonicalLibraryDocumentVersionSummary> = {},
): CanonicalLibraryDocumentVersionSummary {
  const preview = overrides.documentReading?.reading;
  if (preview?.sourceBinding.original.documentVersionId === 'DV-X') {
    overrides = { ...overrides, documentReading: { ...overrides.documentReading!, reading: { ...preview,
      sourceBinding: { ...preview.sourceBinding, original: { ...preview.sourceBinding.original, documentVersionId } } } } };
  }
  return {
    documentVersionId,
    businessRevision: 'R1',
    revisionDate: '2026-09-01',
    sourceGeneratedDate: '',
    originalFilename: `${documentVersionId}.pdf`,
    byteLength: 100,
    committedAt: '2026-09-05T09:00:00.000Z',
    selectedVersionIsCurrent: true,
    readerWorkItemId: `WI-${documentVersionId}`,
    workItemCount: 1,
    ...overrides,
  };
}

function family(
  versions: CanonicalLibraryDocumentVersionSummary[],
): CanonicalLibraryDocumentSummary {
  return {
    kind: 'DOCUMENT',
    familyId: 'FAM-1',
    documentId: 'DOC-1',
    documentCode: 'SB-TEST-1',
    normalizedFamily: 'SB',
    issuerAuthority: 'BOEING',
    workItemCount: 2,
    createdAt: '2026-09-05T09:00:00.000Z',
    updatedAt: '2026-09-06T09:00:00.000Z',
    versions,
  };
}

describe('projectLibraryDocumentReading', () => {
  it('keeps the registered document number and parsed title separate from the file name', () => {
    expect(documentIdentityPresentation({ documentCode: 'SB-TEST-1',
      extractedMetadata: libraryMetadata() })).toEqual({ documentNumber: 'SB-TEST-1',
      documentTitle: '测试原文标题', hasDocumentTitle: true });
    expect(documentIdentityPresentation({ documentCode: '' })).toEqual({
      documentNumber: '文档编号待核', documentTitle: '文档标题待核', hasDocumentTitle: false });
  });

  it('keeps source diagnostics separate from the main engineering conditions', () => {
    const projection = projectLibraryDocumentReading(
      version('DV-1', {
        extractedMetadata: libraryMetadata(),
        documentReading: { status: 'AVAILABLE', reading: previewReading('现行主题') },
      }),
    );
    expect(projection.status).toBe('AVAILABLE');
    expect(projection.headline).toBe('现行主题');
    expect(projection.brief).toBe('简明解读 现行主题');
    expect(projection.conditionLines).toEqual([
      '关键条件 现行主题',
      '认识限制 现行主题',
    ]);
    expect(projection.sourceLimitations).toEqual(['来源限制 现行主题']);
    expect(projection.fileTitle).toBe('测试原文标题');
    expect(projection.readingRunRef).toBe('RUN-现行主题');
    expect(projection.readingRevision).toBe(3);
    expect(projection.sourceBinding?.semanticRevision).toBe(2);
  });

  it('keeps actual coverage counts separate from engineering conditions for PARTIAL_DELIVERY', () => {
    const projection = projectLibraryDocumentReading(
      version('DV-1', {
        documentReading: {
          status: 'AVAILABLE',
          reading: previewReading('部分主题', {
            coverageStatus: 'PARTIAL_DELIVERY',
            deliveredUnitCount: 2,
            totalUnitCount: 5,
          }),
        },
      }),
    );
    expect(projection.coverageStatus).toBe('PARTIAL_DELIVERY');
    expect(projection.deliveredUnitCount).toBe(2);
    expect(projection.totalUnitCount).toBe(5);
    expect(projection.conditionLines).toHaveLength(2);
  });

  it('reports NOT_GENERATED without claiming an interpretation', () => {
    const projection = projectLibraryDocumentReading(
      version('DV-1', { documentReading: { status: 'NOT_GENERATED', reading: null } }),
    );
    expect(projection.status).toBe('NOT_GENERATED');
    expect(projection.headline).toBeNull();
    expect(projection.brief).toBeNull();
    expect(projection.note).toBe('');
  });

  it('never paints withdrawn text even if an upstream response accidentally includes it', () => {
    const projection = projectLibraryDocumentReading(
      version('DV-1', { documentReading: { status: 'RETRACTED', reading: previewReading('错误候选') } }),
    );
    expect(projection.status).toBe('RETRACTED');
    expect(projection.headline).toBeNull();
    expect(projection.brief).toBeNull();
    expect(projection.conditionLines).toEqual([]);
    expect(projection.note).toContain('已撤回');
  });

  it('treats AVAILABLE without reading content as not generated', () => {
    const projection = projectLibraryDocumentReading(
      version('DV-1', { documentReading: { status: 'AVAILABLE', reading: null } }),
    );
    expect(projection.status).toBe('NOT_GENERATED');
    expect(projection.brief).toBeNull();
  });

  it('shows saved reading after re-parsing the same version without rebinding provenance', () => {
    const projection = projectLibraryDocumentReading(
      version('DV-1', {
        documentReading: { status: 'SOURCE_CHANGED', reading: previewReading('过期主题') },
      }),
    );
    expect(projection.status).toBe('AVAILABLE');
    expect(projection.headline).toBe('过期主题');
    expect(projection.brief).toBe('简明解读 过期主题');
    expect(projection.conditionLines).toContain('关键条件 过期主题');
    expect(projection.note).toBe('');
    expect(projection.sourceBinding?.original.parseRunId).toBe('parse-1');
    expect(projection.readingRunRef).toBe('RUN-过期主题');
  });

  it('reports NOT_RETURNED when the interface omits the reading preview', () => {
    const projection = projectLibraryDocumentReading(version('DV-1'));
    expect(projection.status).toBe('NOT_RETURNED');
    expect(projection.note).toBe('');
    expect(projection.brief).toBeNull();
  });

  it('does not mix a saved reading from another document version even when the hash matches', () => {
    const reading = previewReading('另一版本');
    reading.sourceBinding.original.documentVersionId = 'DV-other';
    const projection = projectLibraryDocumentReading(version('DV-1', {
      documentReading: { status: 'SOURCE_CHANGED', reading },
    }));
    expect(projection.brief).toBeNull();
    expect(projection.sourceBinding).toBeNull();
  });

  it('keeps two versions of one family on their own saved readings', () => {
    const current = projectLibraryDocumentReading(
      version('DV-NEW', {
        documentReading: { status: 'AVAILABLE', reading: previewReading('新版主题') },
      }),
    );
    const historical = projectLibraryDocumentReading(
      version('DV-OLD', {
        selectedVersionIsCurrent: false,
        documentReading: { status: 'AVAILABLE', reading: previewReading('旧版主题') },
      }),
    );
    expect(current.headline).toBe('新版主题');
    expect(historical.headline).toBe('旧版主题');
    expect(historical.brief).not.toContain('新版主题');
  });

  it('falls back to the file name and never claims a file title is an interpretation', () => {
    const byName = projectLibraryDocumentReading(version('DV-1'));
    expect(byName.fileTitle).toBe('DV-1.pdf');
    const unnamed = projectLibraryDocumentReading(
      version('DV-2', { originalFilename: '' }),
    );
    expect(unnamed.fileTitle).toBe('文件标题待核');
  });
});

describe('library document rows and quicklook reading rendering', () => {
  const noop = () => undefined;

  function renderRows(documents: CanonicalLibraryDocumentSummary[], compact = false) {
    return renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/' },
        createElement(LibraryDocumentRows, {
          documents,
          selectedId: 'FAM-1',
          selectedDocumentVersionId: 'DV-NEW',
          expandedFamilyIds: ['FAM-1'],
          compact,
          sessionGeneration: 1,
          onSelect: noop,
          onSelectVersion: noop,
          onToggleFamily: noop,
        }),
      ),
    );
  }

  it('shows each row its own version reading and every condition line', () => {
    const documents = [
      family([
        version('DV-NEW', {
          documentReading: {
            status: 'AVAILABLE',
            reading: previewReading('新版主题', {
              coverageStatus: 'PARTIAL_DELIVERY',
              deliveredUnitCount: 2,
              totalUnitCount: 5,
            }),
          },
        }),
        version('DV-OLD', {
          selectedVersionIsCurrent: false,
          documentReading: { status: 'AVAILABLE', reading: previewReading('旧版主题') },
        }),
      ]),
    ];
    const markup = renderRows(documents);
    expect(markup).toContain('新版主题');
    expect(markup).toContain('简明解读 新版主题');
    expect(markup).toContain('旧版主题');
    expect(markup).toContain('已读取 2/5');
    expect(markup).toContain('关键条件 新版主题');
    expect(markup).toContain('认识限制 新版主题');
    expect(markup).not.toContain('来源限制 新版主题');
  });

  it('keeps every compact clamped brief expandable regardless of character count', () => {
    const brief = '仅限已核对的设备版本；未核对的设备不在本次适用范围。';
    const markup = renderRows([family([version('DV-NEW', {
      documentReading: { status: 'AVAILABLE', reading: previewReading('短条件', { brief }) },
    })])], true);
    expect(markup).toContain('is-folded');
    expect(markup).toContain(brief);
    expect(markup).toContain('aria-label="展开摘要"');
  });

  it('shows a concise saved-reading absence state', () => {
    const markup = renderRows([
      family([
        version('DV-NEW', {
          documentReading: { status: 'NOT_GENERATED', reading: null },
        }),
      ]),
    ]);
    expect(markup).toContain('暂无已保存解读');
  });

  it('quicklook shows the selected version ratio, limitations and source limitations', () => {
    const documents = family([
      version('DV-NEW', {
        documentReading: {
          status: 'AVAILABLE',
          reading: previewReading('快览主题', {
            coverageStatus: 'PARTIAL_DELIVERY',
            deliveredUnitCount: 3,
            totalUnitCount: 7,
          }),
        },
      }),
    ]);
    const markup = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/?selectedDocumentVersionId=DV-NEW' },
        createElement(LibraryDocumentDetails, {
          document: documents,
          assessmentQuicklook: { data: null, loading: false, error: null, accessDenied: false },
          onRefresh: noop,
          onViewTasks: noop,
        }),
      ),
    );
    expect(markup).toContain('快览主题');
    expect(markup).toContain('简明解读 快览主题');
    expect(markup).toContain('已保存阅读范围 3/7');
    expect(markup).toContain('认识限制 快览主题');
    expect(markup).toContain('来源限制 快览主题');
  });

  it('quicklook preserves same-version saved text after another parse', () => {
    const documents = family([
      version('DV-NEW', {
        documentReading: { status: 'SOURCE_CHANGED', reading: previewReading('过期主题') },
      }),
    ]);
    const markup = renderToStaticMarkup(
      createElement(
        StaticRouter,
        { location: '/?selectedDocumentVersionId=DV-NEW' },
        createElement(LibraryDocumentDetails, {
          document: documents,
          assessmentQuicklook: { data: null, loading: false, error: null, accessDenied: false },
          onRefresh: noop,
          onViewTasks: noop,
        }),
      ),
    );
    expect(markup).not.toContain('来源已变化');
    expect(markup).toContain('过期主题');
    expect(markup).toContain('简明解读 过期主题');
  });
});
