import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryMetadataObservations } from '../../client/src/pages/WorkspaceHomePage/LibraryMetadata';
import { LibraryClassificationControls } from '../../client/src/pages/WorkspaceHomePage/LibraryClassificationControls';
import { libraryMetadata } from './fixtures/canonical-library';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/api/canonical-host', () => ({
  enrichDocumentVersionMetadata: jest.fn(),
  getCanonicalHostClientSessionGeneration: () => 1,
}));

describe('version-scoped metadata and full catalog facets', () => {
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
    expect(html).toContain('待核');
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
          familyCounts: { SB: 100 },
          ataCounts: { __UNKNOWN__: 7, '34': 90 },
          aircraftModelCounts: { '737': 70 },
        },
      }),
    );
    expect(html).toContain('100');
    expect(html).toContain('已选：未分类');
    expect(html).toContain('筛选前');
    expect(html).toContain('不能相加');
    expect(html).toContain('不限');
  });
});
