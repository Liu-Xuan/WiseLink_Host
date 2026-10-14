import { Button } from '@client/src/components/ui/button';
import { LibraryFleetControls } from './LibraryFleetControls';
import type { LibraryFleetRead } from './useLibraryFleetCatalog';
import { LIBRARY_UNCLASSIFIED, type LibraryGrouping, type LibraryCatalogFilters } from './library-classification';

export interface LibraryFacetCounts {
  familyCounts?: Record<string, number>;
  ataCounts?: Record<string, number>;
  aircraftModelCounts?: Record<string, number>;
}

export function LibraryClassificationControls({ filters, onFilterChange, counts, disabled, fleet, showFleet = true }: {
  grouping: LibraryGrouping;
  onGroupingChange: (value: LibraryGrouping) => void;
  filters: LibraryCatalogFilters;
  onFilterChange: (value: LibraryCatalogFilters) => void;
  counts: LibraryFacetCounts;
  disabled: boolean;
  fleet?: LibraryFleetRead;
  showGrouping?: boolean;
  showFleet?: boolean;
}) {
  return <section className="library-classification-controls" aria-label="资料筛选">
    {showFleet ? <LibraryFleetControls fleet={fleet} counts={counts.aircraftModelCounts} filters={filters}
      onFilterChange={onFilterChange} disabled={disabled} /> : null}
    <div className="library-facet-row" role="group" aria-label="文档类别">
      <strong>文档类别</strong><div className="library-grouping-controls">
        <Button type="button" size="sm" variant="outline" className="library-facet-choice" disabled={disabled}
          aria-pressed={!filters.normalizedFamily} onClick={() => onFilterChange({ ...filters, normalizedFamily: '' })}>不限</Button>
        {Object.entries(counts.familyCounts ?? {}).sort(([a], [b]) => a.localeCompare(b, 'zh-CN', { numeric: true }))
          .map(([rawValue, count]) => {
            const value = rawValue || LIBRARY_UNCLASSIFIED;
            return <Button type="button" key={value} size="sm" variant="outline" className="library-facet-choice" disabled={disabled}
              aria-pressed={filters.normalizedFamily === value} onClick={() => onFilterChange({ ...filters, normalizedFamily: value })}>
              {value === LIBRARY_UNCLASSIFIED ? '未分类' : value}<span className="library-facet-count">{count}</span></Button>;
          })}
      </div>
    </div>
    {Object.values(filters).some(Boolean) ? <Button type="button" variant="ghost" size="sm" className="library-clear-facets"
      disabled={disabled} onClick={() => onFilterChange({})}>清除筛选</Button> : null}
  </section>;
}
