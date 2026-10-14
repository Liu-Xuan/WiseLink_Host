import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LcmSnapshotBrowseRequest } from '@shared/lcm-source-reading.interface';
import { readLcmSourceSnapshotRows, readLcmSourceSnapshots } from '@client/src/api/canonical-host';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { useTdmsReadResource } from '@client/src/features/tdms-source/useTdmsReadResource';
import { LibrarySourceNavigation } from './LibrarySourceNavigation';
import { LcmSnapshotFacts, LcmSnapshotRecords } from './LcmSnapshotRecords';

type LcmFilterField = 'aircraftModel' | 'tailNumber' | 'system' | 'ata' | 'softwareName' | 'partNumber' | 'position';
type LcmFilterValues = Record<LcmFilterField, string>;
interface LcmPagination { scope: string; cursors: Array<string | undefined> }

const FILTER_FIELDS: Array<{ field: LcmFilterField; label: string }> = [
  { field: 'aircraftModel', label: '机型' }, { field: 'tailNumber', label: '飞机号' },
  { field: 'system', label: '系统' }, { field: 'ata', label: 'ATA' },
  { field: 'softwareName', label: '软件名称' }, { field: 'partNumber', label: '软件件号' },
  { field: 'position', label: '位置（FIN）' },
];

function filterValues(params: URLSearchParams): LcmFilterValues {
  return { aircraftModel: params.get('aircraftModel')?.trim() ?? '',
    tailNumber: params.get('tailNumber')?.trim() ?? '', system: params.get('system')?.trim() ?? '',
    ata: params.get('ata')?.trim() ?? '', softwareName: params.get('softwareName')?.trim() ?? '',
    partNumber: params.get('partNumber')?.trim() ?? '', position: params.get('position')?.trim() ?? '' };
}

/** This branch reuses /library and does not mount document/task/model consumers. */
export function LcmConfigurationLibrary() {
  const { authenticationRequired, sessionGeneration } = useCurrentUserSession();
  const [params, setParams] = useSearchParams();
  const filters: LcmFilterValues = useMemo(() => filterValues(params), [params]);
  const [draft, setDraft] = useState<LcmFilterValues>(filters);
  const [refresh, setRefresh] = useState<number>(0);
  const catalogueScope: string = JSON.stringify([sessionGeneration, filters, refresh]);
  const [cataloguePages, setCataloguePages] = useState<LcmPagination>({ scope: '', cursors: [undefined] });
  const catalogueCursors: Array<string | undefined> = cataloguePages.scope === catalogueScope
    ? cataloguePages.cursors : [undefined];
  const catalogueAfter: string | undefined = catalogueCursors[catalogueCursors.length - 1];
  const pins: string[] = params.getAll('lcmSnapshotId');
  const invalidPin: boolean = pins.length > 1 || (pins.length === 1 && (!pins[0].trim() || pins[0] !== pins[0].trim()));
  const accessScope: string = JSON.stringify([catalogueScope, pins]);
  const [deniedScope, setDeniedScope] = useState<string | null>(null);
  const onDenied = useCallback((): void => setDeniedScope(accessScope), [accessScope]);
  const enabled: boolean = !authenticationRequired && deniedScope !== accessScope;
  const catalogueLoad = useCallback((signal: AbortSignal) => readLcmSourceSnapshots({
    ...filters, ...(catalogueAfter ? { after: catalogueAfter } : {}), limit: 12,
  }, signal), [filters, catalogueAfter]);
  const catalogue = useTdmsReadResource(`${catalogueScope}:${catalogueAfter ?? ''}`,
    enabled, catalogueLoad, onDenied);
  const snapshotId: string = invalidPin ? '' : pins[0] ?? catalogue.value?.snapshots[0]?.snapshotId ?? '';
  const rowsScope: string = JSON.stringify([catalogueScope, snapshotId]);
  const [rowPages, setRowPages] = useState<LcmPagination>({ scope: '', cursors: [undefined] });
  const rowCursors: Array<string | undefined> = rowPages.scope === rowsScope ? rowPages.cursors : [undefined];
  const rowAfter: string | undefined = rowCursors[rowCursors.length - 1];
  const rowsLoad = useCallback((signal: AbortSignal) => readLcmSourceSnapshotRows({
    snapshotId, ...filters, ...(rowAfter ? { after: rowAfter } : {}), limit: 24,
  }, signal), [snapshotId, filters, rowAfter]);
  const rows = useTdmsReadResource(`${rowsScope}:${rowAfter ?? ''}`, enabled && Boolean(snapshotId), rowsLoad, onDenied);

  useEffect(() => setDraft(filters), [filters]);

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next: URLSearchParams = new URLSearchParams({ mode: 'lcm' });
    FILTER_FIELDS.forEach(({ field }: { field: LcmFilterField; label: string }) => {
      if (draft[field].trim()) next.set(field, draft[field].trim());
    });
    setParams(next);
  }

  function selectSnapshot(selected: string): void {
    const next: URLSearchParams = new URLSearchParams(params);
    next.set('lcmSnapshotId', selected);
    setParams(next);
  }

  return <main className="library-home library-atlas-home library-lcm-home" aria-busy={catalogue.loading || rows.loading}>
    <div className="atlas-library-content">
      <header className="library-home-header">
        <div><p className="library-home-eyebrow">ENGINEERING LIBRARY</p><h1>软件构型</h1>
          <LibrarySourceNavigation current="lcm" /></div>
        <Button type="button" variant="outline" disabled={authenticationRequired || catalogue.loading || rows.loading}
          onClick={() => setRefresh((value: number) => value + 1)}>重新读取已接收快照</Button>
      </header>
      <p className="library-source-notice library-lcm-boundary">LCM 为独立来源；此处读取已接收的本地候选快照。
        最新接收时间不代表实时构型或实际生效时间。筛选在 Host 分页前执行；位置目前仅支持 FIN。</p>
      <form className="library-lcm-filters" onSubmit={applyFilters}>
        {FILTER_FIELDS.map(({ field, label }) => <label key={field}>
          <span>{label}</span><Input value={draft[field]} maxLength={200} aria-label={`LCM ${label}`}
            onChange={event => setDraft((prior: LcmFilterValues) => ({ ...prior, [field]: event.target.value }))} />
        </label>)}
        <Button type="submit" variant="outline" disabled={authenticationRequired}>筛选快照与记录</Button>
      </form>
      {authenticationRequired ? <p className="library-source-notice" role="alert">请先登录，再读取构型快照。</p>
        : deniedScope === accessScope ? <p className="library-source-notice" role="alert">当前账户无法读取所选 LCM 快照，原记录已清除。</p>
          : <div className="library-lcm-layout">
            <aside className="suite-library-folder library-lcm-snapshots" aria-label="已接收及历史 LCM 快照">
              <div className="suite-folder-head"><strong>已接收快照 / 历史</strong></div>
              {catalogue.loading ? <p role="status">正在读取已接收快照…</p> : null}
              {catalogue.error ? <p role="alert">{catalogue.error}</p> : null}
              {catalogue.value?.snapshots.length === 0 ? <p role="status">当前筛选没有已接收快照，未查询外部实时源。</p> : null}
              {catalogue.value?.snapshots.map(snapshot => <button type="button" key={snapshot.snapshotId}
                className={`suite-folder-row${snapshotId === snapshot.snapshotId ? ' active' : ''}`}
                aria-pressed={snapshotId === snapshot.snapshotId} onClick={() => selectSnapshot(snapshot.snapshotId)}>
                <span>{snapshot.originalFileName}<small>截止 {snapshot.sourceDataCutoffDate ?? '未取得'}</small>
                  <small>接收 {snapshot.importedAt}</small><small>{snapshot.coveredAircraftModels.join(' / ') || '机型未知'} · {snapshot.coveredAircraftCount} 架</small></span>
              </button>)}
              <div className="library-source-pagination">
                {catalogueCursors.length > 1 ? <Button type="button" variant="outline" size="sm"
                  onClick={() => setCataloguePages({ scope: catalogueScope, cursors: catalogueCursors.slice(0, -1) })}>上一页快照</Button> : null}
                {catalogue.value?.hasMore && catalogue.value.nextAfter ? <Button type="button" variant="outline" size="sm"
                  onClick={() => setCataloguePages({ scope: catalogueScope, cursors: [...catalogueCursors, catalogue.value!.nextAfter!] })}>下一页快照</Button> : null}
              </div>
            </aside>
            <section className="library-lcm-detail" aria-label="所选快照软件构型">
              {invalidPin ? <p role="alert">快照选择无效，请明确选择一个快照；未替换为其他快照。</p> : null}
              {rows.loading ? <p role="status">正在读取所选快照记录…</p> : null}
              {rows.error ? <p role="alert">{rows.error} 未替换为其他快照。</p> : null}
              {rows.value ? <>
                <LcmSnapshotFacts snapshot={rows.value.snapshot} />
                <LcmSnapshotRecords records={rows.value.records} />
                <div className="library-source-pagination">
                  {rowCursors.length > 1 ? <Button type="button" variant="outline" size="sm"
                    onClick={() => setRowPages({ scope: rowsScope, cursors: rowCursors.slice(0, -1) })}>上一页构型</Button> : null}
                  {rows.value.hasMore && rows.value.nextAfter ? <Button type="button" variant="outline" size="sm"
                    onClick={() => setRowPages({ scope: rowsScope, cursors: [...rowCursors, rows.value!.nextAfter!] })}>下一页构型</Button> : null}
                </div>
              </> : null}
            </section>
          </div>}
    </div>
  </main>;
}
