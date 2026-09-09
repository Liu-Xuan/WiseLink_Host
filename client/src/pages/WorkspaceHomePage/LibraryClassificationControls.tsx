import { Button } from '@client/src/components/ui/button';
import {
  LIBRARY_GROUPINGS,
  LIBRARY_UNCLASSIFIED,
  type LibraryGrouping,
  type LibraryCatalogFilters,
  type LibraryFacetKey,
} from './library-classification';

export interface LibraryFacetCounts {
  familyCounts?: Record<string, number>;
  ataCounts?: Record<string, number>;
  aircraftModelCounts?: Record<string, number>;
}

export function LibraryClassificationControls({
  grouping,
  onGroupingChange,
  filters,
  onFilterChange,
  counts,
  disabled,
}: {
  grouping: LibraryGrouping;
  onGroupingChange: (value: LibraryGrouping) => void;
  filters: LibraryCatalogFilters;
  onFilterChange: (value: LibraryCatalogFilters) => void;
  counts: LibraryFacetCounts;
  disabled: boolean;
}) {
  const facets: {
    key: LibraryFacetKey;
    label: string;
    counts?: Record<string, number>;
  }[] = [
    { key: 'normalizedFamily', label: '文档类别', counts: counts.familyCounts },
    { key: 'ata', label: 'ATA（待核）', counts: counts.ataCounts },
    {
      key: 'aircraftModel',
      label: '正文提及机型（非适用性）',
      counts: counts.aircraftModelCounts,
    },
  ];
  return (
    <section className="library-classification-controls" aria-label="目录层级与联合筛选">
      <div className="library-grouping-heading">
        <strong>目录首层</strong>
        <span>三项共同分类，只调整层级顺序</span>
      </div>
      <div
        className="library-grouping-controls library-order-controls"
        role="group"
        aria-label="选择目录首层"
      >
        {LIBRARY_GROUPINGS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant="outline"
            className="library-facet-choice"
            disabled={disabled}
            aria-pressed={grouping === option.value}
            onClick={() => onGroupingChange(option.value)}
          >
            {option.label}优先
          </Button>
        ))}
      </div>
      <details className="library-facet-controls" open>
        <summary>联合筛选（含历史版本）</summary>
        <p className="library-classification-note">
          数量为当前搜索下、分类筛选前的全量文档族数；多值文档可属于多个分组，不能相加作为总数。三项筛选共同生效。
        </p>
        {facets.map((facet) => (
          <div className="library-facet-row" key={facet.key} role="group" aria-label={facet.label}>
            <strong>{facet.label}</strong>
            <div className="library-grouping-controls">
              <Button
                size="sm"
                variant="outline"
                className="library-facet-choice"
                disabled={disabled}
                aria-pressed={!filters[facet.key]}
                onClick={() => onFilterChange({ ...filters, [facet.key]: '' })}
              >
                不限
              </Button>
              {Object.entries(facet.counts ?? {})
                .sort(([a], [b]) =>
                  a.localeCompare(b, 'zh-CN', { numeric: true }),
                )
                .map(([rawValue, count]) => {
                  const value = rawValue || LIBRARY_UNCLASSIFIED;
                  return (
                    <Button
                      key={value}
                      size="sm"
                      disabled={disabled}
                      variant="outline"
                      className="library-facet-choice"
                      aria-pressed={filters[facet.key] === value}
                      onClick={() =>
                        onFilterChange({ ...filters, [facet.key]: value })
                      }
                    >
                      {value === LIBRARY_UNCLASSIFIED ? '未分类' : value}
                      <span className="library-facet-count">{count}</span>
                    </Button>
                  );
                })}
              {facet.counts === undefined ? (
                <span role="status">分类统计尚未取得</span>
              ) : null}
            </div>
            {filters[facet.key] ? (
              <p className="library-classification-note">
                已选：
                {filters[facet.key] === LIBRARY_UNCLASSIFIED
                  ? '未分类'
                  : filters[facet.key]}
              </p>
            ) : null}
          </div>
        ))}
        {Object.values(filters).some(Boolean) ? <Button variant="ghost" size="sm" className="library-clear-facets"
          disabled={disabled} onClick={() => onFilterChange({})}>清除三项筛选（保留搜索）</Button> : null}
      </details>
    </section>
  );
}
