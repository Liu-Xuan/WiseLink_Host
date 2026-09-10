import { Button } from '@client/src/components/ui/button';
import type { LibraryCatalogFilters } from './library-classification';
import type { LibraryFleetRead } from './useLibraryFleetCatalog';

export function LibraryFleetControls({
  fleet,
  filters,
  disabled,
  onFilterChange,
}: {
  fleet?: LibraryFleetRead;
  filters: LibraryCatalogFilters;
  disabled: boolean;
  onFilterChange: (filters: LibraryCatalogFilters) => void;
}) {
  const catalog = fleet?.catalog;
  const choose = (fleetFamily = '', fleetModel = '') =>
    onFilterChange({ ...filters, aircraftModel: '', fleetFamily, fleetModel });
  return (
    <div
      className="library-facet-row"
      role="group"
      aria-label="本司机队机型分类"
    >
      <strong>本司机队 · 父机型 / 子机型</strong>
      <p className="library-classification-note">
        仅按当前有效机队关系组织正文提及机型，不代表适用性结论。父机型包含其有效子机型提及；子机型仅匹配自身。
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-pressed={
          !filters.fleetFamily && !filters.fleetModel && !filters.aircraftModel
        }
        onClick={() => choose()}
      >
        全部资料（含未归入机队资料）
      </Button>
      {fleet?.loading ? (
        <p role="status">正在读取本司机队目录…</p>
      ) : fleet?.error ? (
        <p role="alert">
          机队目录读取失败：{fleet.error}。可刷新重试；全部资料仍可访问。
        </p>
      ) : catalog?.status === 'MISSING' ? (
        <p role="status">
          尚无当前有效机队快照，未启用机型分类。全部资料仍可访问。
        </p>
      ) : catalog?.status === 'AVAILABLE' ? (
        <>
          {catalog.families.length ? (
            catalog.families.map((family) => (
              <div
                key={family.fleetFamily}
                className="library-grouping-controls"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  aria-pressed={
                    filters.fleetFamily === family.fleetFamily &&
                    !filters.fleetModel
                  }
                  onClick={() => choose(family.fleetFamily)}
                >
                  {family.fleetFamily} · 全部子机型
                </Button>
                {family.models.map((model) => (
                  <Button
                    key={model}
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    aria-pressed={
                      filters.fleetFamily === family.fleetFamily &&
                      filters.fleetModel === model
                    }
                    onClick={() => choose(family.fleetFamily, model)}
                  >
                    {model}
                  </Button>
                ))}
              </div>
            ))
          ) : (
            <p role="status">当前有效快照中无可分类的在役机型。</p>
          )}
          <p className="library-classification-note">
            来源版本：{catalog.source?.sourceRevisionKey ?? '未提供'}
            ；机队时点：{catalog.source?.sourceAsOf ?? catalog.asOf}。
            {catalog.unclassifiedAssetCount
              ? `${catalog.unclassifiedAssetCount} 架有效资产缺少完整父子机型字段，未推断归类。`
              : ''}
          </p>
        </>
      ) : (
        <p role="status">机队目录尚未取得，未启用机型分类。</p>
      )}
      {filters.fleetFamily || filters.fleetModel || filters.aircraftModel ? (
        <p className="library-classification-note">
          当前机型筛选：
          {filters.aircraftModel
            ? `历史链接原文机型 ${filters.aircraftModel}`
            : [filters.fleetFamily, filters.fleetModel]
                .filter(Boolean)
                .join(' / ')}
          。可选择全部资料清除。
        </p>
      ) : null}
    </div>
  );
}
