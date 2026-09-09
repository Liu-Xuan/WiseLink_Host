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
    <>
      <div
        className="library-grouping-controls"
        role="group"
        aria-label="资料分组方式"
      >
        {LIBRARY_GROUPINGS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={grouping === option.value ? 'default' : 'outline'}
            aria-pressed={grouping === option.value}
            onClick={() => onGroupingChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <details className="library-facet-controls" open>
        <summary>资料分类筛选（含历史版本）</summary>
        <p className="library-classification-note">
          数量为当前搜索下、分类筛选前的全量文档族数；多值文档可属于多个分组，不能相加作为总数。三项筛选共同生效。
        </p>
        {facets.map((facet) => (
          <div key={facet.key} role="group" aria-label={facet.label}>
            <strong>{facet.label}</strong>
            <div className="library-grouping-controls">
              <Button
                size="sm"
                variant={!filters[facet.key] ? 'default' : 'outline'}
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
                      variant={
                        filters[facet.key] === value ? 'default' : 'outline'
                      }
                      aria-pressed={filters[facet.key] === value}
                      onClick={() =>
                        onFilterChange({ ...filters, [facet.key]: value })
                      }
                    >
                      {value === LIBRARY_UNCLASSIFIED ? '未分类' : value} ·{' '}
                      {count}
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
      </details>
    </>
  );
}
