import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { Button } from '@client/src/components/ui/button';
import {
  documentLabel,
  libraryVersionLabel,
} from './library-document-presentation';
import {
  buildLibraryHierarchy,
  libraryGroupingOrder,
  LIBRARY_GROUPINGS,
  LIBRARY_GROUPING_FACETS,
  type LibraryHierarchyGroup,
  type LibraryCatalogFilters,
  type LibraryGrouping,
} from './library-classification';
import { DocumentVersionLink } from './DocumentVersionLink';
import { metadataValues } from './library-classification';

interface LibraryHierarchyProps {
  documents: CanonicalLibraryDocumentSummary[];
  selectedId: string;
  hasMore: boolean;
  onSelect: (familyId: string) => void;
  grouping?: LibraryGrouping;
  totalCount?: number;
  filters?: LibraryCatalogFilters;
  onFilterChange?: (filters: LibraryCatalogFilters) => void;
  disabled?: boolean;
}

export function LibraryHierarchy({
  documents,
  selectedId,
  hasMore,
  onSelect,
  grouping = 'category',
  totalCount,
  filters = {},
  onFilterChange,
  disabled = false,
}: LibraryHierarchyProps) {
  const groups = buildLibraryHierarchy(documents, grouping, filters);
  const labelFor = (dimension: LibraryGrouping) => LIBRARY_GROUPINGS.find((option) => option.value === dimension)?.label;

  function documentRows(items: CanonicalLibraryDocumentSummary[]) {
    return (
      <ul className="library-family-tree">
        {items.map((document) => (
          <li key={document.familyId}>
            <details
              className={document.familyId === selectedId ? 'is-selected' : ''}
            >
              <summary>
                <span>{documentLabel(document)}</span>
                <small>{document.versions.length} 个可见版本</small>
              </summary>
              <div className="library-family-actions">
                <span>
                  {document.issuerAuthority} · {document.workItemCount}{' '}
                  个评估任务
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSelect(document.familyId)}
                  aria-pressed={document.familyId === selectedId}
                >
                  查看文档快览
                </Button>
              </div>
              <ul
                className="library-version-tree"
                aria-label={`${documentLabel(document)} 版本`}
              >
                {document.versions.map((version) => (
                  <li key={version.documentVersionId}>
                    <DocumentVersionLink version={version}>
                      <strong>{libraryVersionLabel(version)}</strong>
                      <span>
                        {version.selectedVersionIsCurrent
                          ? '当前版本'
                          : '历史版本'}
                      </span>
                      <small>{version.originalFilename}</small>
                      {version.extractedMetadata ? (
                        <small>
                          {metadataValues(version.extractedMetadata.title).join(
                            ' / ',
                          ) || '标题本次未检出'}
                          {' · 元数据待核'}
                        </small>
                      ) : (
                        <small>元数据未提取</small>
                      )}
                    </DocumentVersionLink>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
    );
  }

  function categoryRows(items: LibraryHierarchyGroup[], depth = 0) {
    return <div className="library-category-tree" data-depth={depth}>
      {items.map((group) => {
        const facet = LIBRARY_GROUPING_FACETS[group.dimension];
        const pathLabel = Object.entries(group.pathFilters)
          .map(([key, value]) => `${key === 'normalizedFamily' ? '类别' : key === 'ata' ? 'ATA' : '机型'} ${value === '__UNKNOWN__' ? '未分类' : value}`).join(' / ');
        return <details key={`${group.dimension}:${group.key}`} open={depth === 0 || Boolean(filters[facet])}
          data-facet={facet} data-facet-value={group.key}>
          <summary>
            <span className="library-branch-label"><small>{labelFor(group.dimension)}</small><strong>{group.label}</strong></span>
            <span className="library-branch-count">已加载 {group.documents.length} 份</span>
          </summary>
          {onFilterChange ? <div className="library-branch-actions">
            <Button variant="ghost" size="sm" disabled={disabled} aria-label={`筛选路径 ${pathLabel}`}
              onClick={() => onFilterChange({ ...filters, ...group.pathFilters })}>筛选此路径</Button>
          </div> : null}
          {group.children.length ? categoryRows(group.children, depth + 1) : documentRows(group.documents)}
        </details>;
      })}
    </div>;
  }

  return (
    <section className="library-hierarchy" aria-label="文档分类目录">
      <h3>资料分类（含历史版本）</h3>
      <p className="library-hierarchy-order" aria-label="当前目录层级">
        {libraryGroupingOrder(grouping).map((dimension) => labelFor(dimension)).join(' → ')} → 文档 → 版本
      </p>
      <p className="library-classification-note">
        {totalCount === undefined
          ? '全量统计尚未取得。'
          : `当前搜索与筛选共 ${totalCount} 份文档。`}
        {`已加载 ${documents.length} 份；下方树节点数量仅覆盖已加载的搜索结果。`}
        {hasMore ? '可在下方加载更多。' : ''} 展开文档查看版本，或打开文档快览。
      </p>
      <p className="library-classification-note">
        三项筛选共同生效，切换首层只改变目录层级。ATA 与正文提及机型（非适用性）按文档族各获权版本的原文观察值归类，全部待核；可能来自历史版本或不同版本，不代表同版关联。
        未分类表示尚未提取或本次文本未检出；可在文档快览查看依据或补提取。
      </p>
      <div key={grouping}>{categoryRows(groups)}</div>
    </section>
  );
}
