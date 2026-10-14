import { Button } from '@client/src/components/ui/button';
import { libraryAircraftModelsQuery, libraryAircraftModelUnion } from '@shared/library-aircraft-mentions';
import type { LibraryCatalogFilters } from './library-classification';
import type { LibraryFleetRead } from './useLibraryFleetCatalog';
import { libraryAircraftBusinessGroups, LIBRARY_PRIMARY_AIRCRAFT_GROUPS, type LibraryAircraftBusinessGroup } from './library-fleet-classification';

export function LibraryFleetControls({ fleet, counts, filters, disabled, onFilterChange }: {
  fleet?: LibraryFleetRead;
  counts?: Record<string, number>;
  filters: LibraryCatalogFilters;
  disabled: boolean;
  onFilterChange: (filters: LibraryCatalogFilters) => void;
}) {
  const values: string[] = [...Object.keys(counts ?? {}), ...(fleet?.catalog?.families.flatMap(family => family.models) ?? [])];
  const groups = libraryAircraftBusinessGroups(values);
  const reachable = (group: LibraryAircraftBusinessGroup): boolean => {
    try { return Boolean(libraryAircraftModelUnion(group.models)?.length); } catch { return false; }
  };
  const oversized = groups.filter(group => group.models.length && !reachable(group));
  const choose = (models?: string[]): void => onFilterChange({ ...filters, aircraftModel: '',
    aircraftModels: models ? JSON.stringify(models) : '', fleetFamily: '', fleetModel: '' });
  let selectedModels: string[] = [];
  let selectionError = '';
  try { selectedModels = libraryAircraftModelsQuery(filters.aircraftModels || undefined) ?? []; }
  catch { selectionError = '机型筛选参数无效，请重新选择。'; }
  const option = (group: LibraryAircraftBusinessGroup) => <Button type="button" key={group.key}
    variant="outline" size="sm" className="library-facet-choice"
    disabled={disabled || !reachable(group)}
    aria-pressed={Boolean(group.models.length) && group.models.length === selectedModels.length && group.models.every(model => selectedModels.includes(model))}
    onClick={() => choose(group.models)}>{group.label}</Button>;
  const extra = groups.filter(group => !LIBRARY_PRIMARY_AIRCRAFT_GROUPS.includes(group.key));
  return <div className="library-fleet-filter" role="group" aria-label="机型筛选">
    <strong>机型</strong>
    <Button type="button" variant="outline" size="sm" className="library-facet-choice" disabled={disabled}
      aria-pressed={!filters.aircraftModels && !filters.aircraftModel && !filters.fleetFamily && !filters.fleetModel}
      onClick={() => choose()}>全部</Button>
    {groups.filter(group => LIBRARY_PRIMARY_AIRCRAFT_GROUPS.includes(group.key)).map(option)}
    {extra.length ? <details className="library-fleet-more"><summary>更多机型</summary>
      <div className="library-grouping-controls">{extra.map(option)}</div></details> : null}
    {fleet?.error || selectionError || fleet?.catalog?.unclassifiedAssetCount || oversized.length ?
      <details className="library-fleet-status"><summary>目录读取状态</summary>
        {fleet?.error ? <p role="alert">机队目录读取失败：{fleet.error}</p> : null}
        {selectionError ? <p role="alert">{selectionError}</p> : null}
        {fleet?.catalog?.unclassifiedAssetCount ? <p>{fleet.catalog.unclassifiedAssetCount} 架资产机型字段不完整。</p> : null}
        {oversized.map(group => <div key={group.key}>
          <p role="alert">{group.label} 超出单次请求上限，请选择原始型号。</p>
          <div className="library-grouping-controls">{group.models.map(model => <Button key={model} type="button" variant="outline" size="sm"
            disabled={disabled} onClick={() => choose([model])}>{model}</Button>)}</div>
        </div>)}
      </details> : null}
    {fleet?.loading && counts === undefined ? <span role="status">读取机型…</span> : null}
  </div>;
}
