import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryMetadataObservations } from '../../client/src/pages/WorkspaceHomePage/LibraryMetadata';
import { LibraryClassificationControls } from '../../client/src/pages/WorkspaceHomePage/LibraryClassificationControls';
import { MetadataRevisionActions } from '../../client/src/pages/WorkspaceHomePage/MetadataRevisionActions';
import { libraryMetadata } from './fixtures/canonical-library';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({
  enrichDocumentVersionMetadata: jest.fn(),
  getCanonicalHostClientSessionGeneration: () => 1,
}));

describe('version-scoped metadata and full catalog facets', () => {
  it('offers explicit reextraction and historical evidence without destructive recovery', () => {
    const html = renderToStaticMarkup(createElement(MetadataRevisionActions, {
      documentVersionId: 'DV-1', metadataRevision: 3, onRefresh: jest.fn(), renderMetadata: () => null,
    }));
    expect(html).toContain('重新提取元数据');
    expect(html).toContain('查看上一修订证据');
    expect(html).not.toContain('保留旧提取结果');
    expect(html).not.toContain('不新建文档版本或评估任务');
    expect(html).not.toContain('只读核对本次请求');
  });

  it('requires reading a revision before any reextraction when catalog revision is absent', () => {
    const html = renderToStaticMarkup(createElement(MetadataRevisionActions, {
      documentVersionId: 'DV-1', metadataRevision: null, onRefresh: jest.fn(), renderMetadata: () => null,
    }));
    expect(html).toContain('尚未读取');
    expect(html).toMatch(/disabled="">重新提取元数据/);
    expect(html).not.toContain('查看上一修订证据');
  });

  it('shows original page evidence and never turns mentioned aircraft into applicability', () => {
    const metadata = libraryMetadata();
    metadata.title.observations[0].evidence[0].text =
      '<script>not markup</script>';
    metadata.issuer = { status: 'NOT_FOUND', observations: [] };
    const html = renderToStaticMarkup(
      createElement(LibraryMetadataObservations, { metadata }),
    );
    expect(html).toContain('原文第 1 页');
    expect(html).toContain('本次文本未检出');
    expect(html).toContain('非适用性');
    expect(html).toContain('测试原文标题');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders search-wide facet counts even when the filtered page has no rows', () => {
    const html = renderToStaticMarkup(
      createElement(LibraryClassificationControls, {
        grouping: 'ata',
        onGroupingChange: jest.fn(),
        filters: { ata: '__UNKNOWN__' },
        onFilterChange: jest.fn(),
        disabled: false,
        counts: {
          familyCounts: { SB: 100, AD: 2, TFU: 1 },
          ataCounts: { __UNKNOWN__: 7, '34': 90 },
          aircraftModelCounts: { '737': 70 },
        },
      }),
    );
    expect(html).toContain('100');
    expect(html).toContain('TFU');
    expect(html).toContain('AD');
    expect(html).toContain('更多机型');
    expect(html).not.toContain('筛选前');
    expect(html).not.toContain('不能相加');
    expect(html).toContain('不限');
  });

  it('shows publication dates and supplier separately from the issuing authority', () => {
    const metadata = libraryMetadata();
    const observation = (value: string, page: number) => ({ status: 'PENDING_REVIEW' as const,
      observations: [{ value, status: 'PENDING_REVIEW' as const, evidence: [{ page, text: value }] }] });
    metadata.amendment = observation('39-12345', 1);
    metadata.issueDate = observation('2042-01-22', 1);
    metadata.effectiveDate = observation('2042-02-01', 2);
    metadata.firstIssueDate = observation('2040-05-14', 3);
    metadata.lastCheckDate = observation('2042-01-23', 3);
    metadata.supplier = observation('TEST SUPPLIER', 1);
    const html = renderToStaticMarkup(createElement(LibraryMetadataObservations, { metadata }));
    for (const value of ['39-12345', '2042-01-22', '2042-02-01', '2040-05-14', '2042-01-23', 'TEST SUPPLIER']) expect(html).toContain(value);
    expect(html).toContain('原文第 3 页');
    expect(html).toContain('非发布方');
  });
});
