import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams, type NavigateOptions } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { LcmMatrixQuery, LcmMatrixWindowRequest } from '@shared/lcm-matrix.interface';
import type { LcmSnapshotSummary } from '@shared/lcm-source-reading.interface';
import { lcmQueryModels } from '@shared/lcm-matrix-core';
import { readLcmSourceSnapshots, readLcmPersonalLibrary } from '@client/src/api/canonical-host';
import { lcmNativeWindow } from '@shared/lcm-native-matrix-core';
import { useLcmNativeMatrix } from './useLcmNativeMatrix';
import { lcmNativeViewport } from './lcm-native-viewport';
import { LcmExcelImport } from './LcmExcelImport';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import { LcmMatrixGrid, type LcmMatrixSelection } from './LcmMatrixGrid';
import { LcmMatrixToolbar } from './LcmMatrixToolbar';
import { LcmMatrixScopeDialog } from './LcmMatrixScopeDialog';
import { LcmAircraftTable } from './LcmAircraftTable';
import { LcmEvidenceDrawer } from './LcmEvidenceDrawer';
import { LCM_INITIAL_WINDOW, type LcmGridWindow } from './lcm-matrix-layout';
import { lcmMatrixAccessLost, lcmQueryFromRoute, readLcmExpansion, writeLcmExpansion } from './lcm-matrix-route';
import { LCM_MATRIX_QUERY_ROOT, useLcmMatrixResource } from './useLcmMatrixResource';
import { lcmModelNames, lcmSnapshotStateDate } from './lcm-source-presentation';
import { lcmNativeSelectionIsBlank } from './lcm-matrix-presentation';
import { lcmDiagnosticScopeKey } from './adapt-lcm-native-read';
import { LcmRuntimeDiagnostic } from './LcmRuntimeDiagnostic';
import './lcm-matrix.css';

/** The existing /library LCM entry, AppShell, identity and QueryClient remain mounted. */
export function LcmConfigurationLibrary() {
  const { sessionGeneration, authenticationRequired } = useCurrentUserSession();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const location = useLocation(), navigate = useNavigate();
  const parsed = lcmQueryFromRoute(params);
  const queryKey = JSON.stringify(parsed);
  const query: LcmMatrixQuery = useMemo(() => parsed, [queryKey]);
  const [refresh, setRefresh] = useState(0);
  const scope = JSON.stringify([sessionGeneration, query.snapshotIds, refresh]);
  const stateDate = params.get('lcmStateDate');
  const viewScope = JSON.stringify([scope, query, stateDate]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const [deniedScope, setDeniedScope] = useState<string | null>(null);
  const [readFailure, setReadFailure] = useState<{ scope: string; message: string } | null>(null);
  const enabled = !authenticationRequired && deniedScope !== scope;
  const [windowState, setWindowState] = useState<{ scope: string; value: LcmGridWindow } | null>(null);
  const gridWindow = windowState?.scope === viewScope ? windowState.value : LCM_INITIAL_WINDOW;
  const [selectedRecord, setSelection] = useState<{ scope: string; value: LcmMatrixSelection } | null>(null);
  const selection = selectedRecord?.scope === viewScope ? selectedRecord.value : null;
  const [scopeDialog, setScopeDialog] = useState<'aircraft' | 'snapshots' | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [search, setSearch] = useState(query.search ?? '');
  const [catalogueAfter, setCatalogueAfter] = useState<string | undefined>();
  const catalogueScope = JSON.stringify([sessionGeneration, refresh]);
  const [catalogueHistory, setCatalogueHistory] = useState<{ scope: string; snapshots: LcmSnapshotSummary[] } | null>(null);
  const scroll = useRef({ x: Number(params.get('mxX')) || 0, y: Number(params.get('mxY')) || 0 });
  const routeRef = useRef(params); routeRef.current = params;
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readingSurface = useRef<HTMLDivElement | null>(null);

  const onLost = useCallback((error?: unknown): void => {
    setDeniedScope(scopeRef.current); setSelection(null);
    setCatalogueHistory(null); setCatalogueAfter(undefined);
    setReadFailure({ scope: scopeRef.current, message: error === undefined || lcmMatrixAccessLost(error)
      ? '所选来源暂不可读，请重新读取。' : 'LCM 读取失败，请重试。' });
    void queryClient.cancelQueries({ queryKey: LCM_MATRIX_QUERY_ROOT });
    queryClient.removeQueries({ queryKey: LCM_MATRIX_QUERY_ROOT });
  }, [queryClient]);
  const catalogueLoad = useCallback((signal: AbortSignal) => readLcmSourceSnapshots({
    ...(catalogueAfter ? { after: catalogueAfter } : {}), limit: 50,
  }, signal), [catalogueAfter]);
  const personalLoad = useCallback((signal: AbortSignal) => readLcmPersonalLibrary(signal), []);
  const personal = useLcmMatrixResource(JSON.stringify(['personal', sessionGeneration, refresh]),
    enabled, personalLoad, onLost);
  const catalogue = useLcmMatrixResource(JSON.stringify([sessionGeneration, refresh, catalogueAfter]),
    enabled && personal.value?.hasSource === true, catalogueLoad, onLost);
  useEffect(() => {
    if (!catalogue.value) return;
    setCatalogueHistory(prior => ({ scope: catalogueScope, snapshots: [...new Map([
      ...(prior?.scope === catalogueScope ? prior.snapshots : []), ...catalogue.value!.snapshots,
    ].map(snapshot => [snapshot.snapshotId, snapshot])).values()] }));
  }, [catalogue.value, catalogueScope]);
  const validPins = query.snapshotIds.length > 0 && query.snapshotIds.length <= 20 &&
    new Set(query.snapshotIds).size === query.snapshotIds.length && query.snapshotIds.every(id => /^[a-f0-9]{64}$/u.test(id));
  const native = useLcmNativeMatrix(query.snapshotIds, sessionGeneration, refresh,
    enabled && validPins, onLost);
  const index = useMemo(() => native.index ? lcmNativeWindow(native.index,
    { query, rowLimit: 0, columnLimit: 0 }) : null, [native.index, query]);
  const expandedKey = JSON.stringify([params.getAll('lcmExpanded'), params.get('lcmExpandedBits'),
    params.get('lcmExpansionScope')]);
  const expanded = useMemo(() => readLcmExpansion(params, index), [expandedKey, index]);
  const requestKey = JSON.stringify([viewScope, gridWindow, [...expanded]]);
  const request: LcmMatrixWindowRequest = useMemo(() => ({ query, ...gridWindow,
    expandedSoftwareRefs: [...expanded] }), [requestKey]);
  const windowData = useMemo(() => native.index && index
    ? lcmNativeViewport(native.index, index, request) : null, [native.index, index, request]);

  useLayoutEffect(() => {
    setSelection(null);
    return () => {
      void queryClient.cancelQueries({ queryKey: LCM_MATRIX_QUERY_ROOT });
      queryClient.removeQueries({ queryKey: LCM_MATRIX_QUERY_ROOT });
    };
  }, [sessionGeneration, queryClient]);
  useEffect(() => {
    if (!index?.anchorCleared) return;
    const next = new URLSearchParams(routeRef.current);
    next.delete('lcmAnchor'); setParams(next, { replace: true });
  }, [index, setParams]);
  useEffect(() => {
    if (stateDate || query.snapshotIds.length || !personal.value?.latestSnapshotIds.length) return;
    const next = new URLSearchParams(routeRef.current);
    for (const id of personal.value.latestSnapshotIds.slice(0, 20)) next.append('lcmSnapshotId', id);
    setParams(next, { replace: true });
  }, [personal.value, query.snapshotIds.length, stateDate, setParams]);
  useEffect(() => { setSearch(query.search ?? ''); }, [query.search]);
  useEffect(() => {
    if (search === (query.search ?? '')) return;
    const timer = setTimeout(() => field('search', search.trim() || null, true), 160);
    return () => clearTimeout(timer);
  }, [search, query.search]);
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) setFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);
  const onWindow = useCallback((value: LcmGridWindow): void => {
    setWindowState(prior => prior?.scope === viewScope && JSON.stringify(prior.value) === JSON.stringify(value)
      ? prior : { scope: viewScope, value });
  }, [viewScope]);
  const onScrollPosition = useCallback((x: number, y: number): void => {
    scroll.current = { x, y };
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const next = new URLSearchParams(routeRef.current);
      next.set('mxX', String(Math.round(scroll.current.x))); next.set('mxY', String(Math.round(scroll.current.y)));
      setParams(next, { replace: true });
    }, 180);
  }, [setParams]);

  function field(key: string, value: string | null, replace = false): void {
    if ((value === null && !routeRef.current.has(key)) || routeRef.current.get(key) === value) return;
    const next = new URLSearchParams(routeRef.current);
    if (value === null) next.delete(key); else next.set(key, value);
    if (['aircraftModel', 'search', 'ata', 'differencesOnly'].includes(key)) {
      next.delete('mxX'); next.delete('mxY'); scroll.current = { x: 0, y: 0 };
      clearSelection(next);
    }
    if (key === 'aircraftModel') { next.delete('aircraftRef'); setCatalogueAfter(undefined); }
    if (key === 'lcmAnchor') {
      next.delete('mxX'); scroll.current.x = 0;
    }
    updateRoute(next, { replace });
  }
  function refreshReadSet(): void {
    setCatalogueAfter(undefined); setRefresh(value => value + 1);
  }
  function updateRoute(next: URLSearchParams, options?: NavigateOptions): void {
    // Compose rapid repeated clicks from the latest requested route, before React's transition commits.
    routeRef.current = next; setParams(next, options);
  }
  function clearSelection(next: URLSearchParams): void {
    setSelection(null);
    for (const key of ['lcmSelectedSoftware', 'lcmSelectedAircraft', 'lcmSelectedPart', 'lcmSelectedPartMissing']) next.delete(key);
  }
  function toggleModel(model: string | null): void {
    const next = new URLSearchParams(routeRef.current);
    const models = new Set(lcmQueryModels(lcmQueryFromRoute(next)));
    if (model === null) models.clear(); else if (models.has(model)) models.delete(model); else models.add(model);
    next.delete('aircraftModel'); [...models].sort().forEach(value => next.append('aircraftModel', value));
    for (const key of ['aircraftRef', 'emptyAircraftScope', 'lcmView', 'lcmAircraftRef', 'mxX', 'mxY']) next.delete(key);
    scroll.current = { x: 0, y: 0 }; clearSelection(next); updateRoute(next);
  }
  function toggleExpanded(ref: string): void {
    if (!index) return;
    const refs = readLcmExpansion(routeRef.current, index);
    if (refs.has(ref)) refs.delete(ref); else refs.add(ref);
    updateRoute(writeLcmExpansion(routeRef.current, index, refs), { replace: true });
  }
  function expandAll(all: boolean): void {
    if (!index) return;
    const refs = new Set(all ? index.softwareIndex.map(software => software.softwareRef) : []);
    updateRoute(writeLcmExpansion(routeRef.current, index, refs), { replace: true });
  }
  function openAircraft(ref: string): void {
    if (routeRef.current.get('lcmView') === 'aircraft' && routeRef.current.get('lcmAircraftRef') === ref) return;
    const next = new URLSearchParams(routeRef.current);
    next.set('lcmView', 'aircraft'); next.set('lcmAircraftRef', ref);
    next.set('mxX', String(scroll.current.x)); next.set('mxY', String(scroll.current.y));
    setSelection(null); updateRoute(next, { state: { lcmMatrixReturnQuery: queryKey } });
  }
  function selectRecord(value: LcmMatrixSelection): void {
    setSelection({ scope: viewScope, value });
    const next = new URLSearchParams(routeRef.current);
    next.set('lcmSelectedSoftware', value.softwareRef);
    if (value.aircraftRef) next.set('lcmSelectedAircraft', value.aircraftRef); else next.delete('lcmSelectedAircraft');
    next.delete('lcmSelectedPart'); next.delete('lcmSelectedPartMissing');
    if (value.partNumber === null) next.set('lcmSelectedPartMissing', '1');
    else if (value.partNumber !== undefined) next.set('lcmSelectedPart', value.partNumber);
    updateRoute(next, { replace: true });
  }
  function backToMatrix(): void {
    const navigationState: unknown = location.state;
    if (params.get('lcmView') === 'aircraft' && navigationState && typeof navigationState === 'object' &&
      'lcmMatrixReturnQuery' in navigationState && navigationState.lcmMatrixReturnQuery === queryKey) {
      navigate(-1); return;
    }
    const next = new URLSearchParams(routeRef.current); next.delete('lcmView'); next.delete('lcmAircraftRef');
    updateRoute(next, { replace: true });
  }
  function applyScope(values: string[], date?: string): void {
    const next = new URLSearchParams(routeRef.current), key = scopeDialog === 'aircraft' ? 'aircraftRef' : 'lcmSnapshotId';
    next.delete(key); values.forEach(value => next.append(key, value));
    // An explicitly empty aircraft scope is represented independently of an unspecified scope.
    if (key === 'aircraftRef' && !values.length) next.set('emptyAircraftScope', '1');
    else next.delete('emptyAircraftScope');
    if (key === 'lcmSnapshotId') {
      if (date) next.set('lcmStateDate', date); else next.delete('lcmStateDate');
      for (const pin of ['aircraftRef', 'lcmAnchor', 'lcmView', 'lcmAircraftRef']) next.delete(pin);
    }
    next.delete('mxX'); next.delete('mxY'); scroll.current = { x: 0, y: 0 };
    setScopeDialog(null); clearSelection(next); updateRoute(next);
  }

  const aircraftRef = params.get('lcmAircraftRef');
  const isAircraft = params.get('lcmView') === 'aircraft';
  const savedSelection: LcmMatrixSelection | null = params.get('lcmSelectedSoftware') ? {
    softwareRef: params.get('lcmSelectedSoftware')!,
    ...(params.get('lcmSelectedAircraft') ? { aircraftRef: params.get('lcmSelectedAircraft')! } : {}),
    ...(params.has('lcmSelectedPartMissing') ? { partNumber: null }
      : params.has('lcmSelectedPart') ? { partNumber: params.get('lcmSelectedPart')! } : {}),
  } : null;
  const notice = authenticationRequired ? '请先登录，再读取构型快照。'
    : deniedScope === scope ? readFailure?.message ?? 'LCM 读取失败，请重试。'
      : query.snapshotIds.length && !validPins ? '读取集参数无效，请明确选择准确快照。'
        : personal.error ?? native.error ?? catalogue.error;
  const snapshots = enabled ? [...new Map([
    ...(catalogueHistory?.scope === catalogueScope ? catalogueHistory.snapshots : []),
    ...(catalogue.value?.snapshots ?? []), ...(index?.snapshots ?? []),
  ].map(snapshot => [snapshot.snapshotId, snapshot])).values()] : [];
  const diagnosticScope = native.index ? lcmDiagnosticScopeKey(viewScope, native.index.data.binding,
    isAircraft ? aircraftRef : null) : null;
  return <main className={'library-home library-atlas-home library-lcm-home mx-root' + (fullscreen ? ' mx-fullscreen' : '')}
    aria-busy={native.loading || catalogue.loading}>
    <div className="atlas-library-content">
      <header className="library-home-header"><div><p className="library-home-eyebrow">AIRCRAFT SOFTWARE CONFIGURATION</p>
        <h1>机载软件构型</h1></div>
        <div className="mx-view-tabs"><Button variant={isAircraft ? 'ghost' : 'secondary'} onClick={backToMatrix}>构型矩阵</Button>
          <Button variant={isAircraft ? 'secondary' : 'ghost'} disabled={!index?.aircraftOrder.length}
            onClick={() => { if (index) openAircraft(aircraftRef ?? index.aircraftOrder[0]); }}>单机构型</Button>
          <Button variant="outline" size="sm" disabled={authenticationRequired}
            onClick={refreshReadSet}>重新读取</Button></div>
      </header>
      <LcmExcelImport sessionGeneration={sessionGeneration} disabled={authenticationRequired}
        onImported={() => {
          setDeniedScope(null); setSelection(null);
          const next = new URLSearchParams(routeRef.current);
          next.delete('lcmSnapshotId'); next.delete('lcmStateDate'); next.delete('lcmAnchor'); next.delete('mxX'); next.delete('mxY');
          clearSelection(next);
          setCatalogueAfter(undefined);
          // Re-read the persistent source ordering, including models not in this import batch.
          updateRoute(next); setRefresh(value => value + 1);
        }} />
      <LcmMatrixToolbar query={query} snapshots={snapshots} matrix={index} search={search} fullscreen={fullscreen}
        stateDate={stateDate} loading={native.loading} readSetSnapshots={native.index?.data.snapshots ?? []}
        onSearch={setSearch} onModel={toggleModel} onField={field} onExpand={expandAll} onAircraftScope={() => setScopeDialog('aircraft')}
        onReadSet={() => setScopeDialog('snapshots')} onFullscreen={() => setFullscreen(value => !value)} />
      {enabled && !notice && native.index && index && native.observedAt && diagnosticScope ?
        <LcmRuntimeDiagnostic key={diagnosticScope} read={native.index.data} matrix={index} scopeKey={diagnosticScope}
          aircraftRef={isAircraft ? aircraftRef : null} observedAt={native.observedAt} onRefresh={refreshReadSet}
          onOpenReading={() => {
            readingSurface.current?.scrollIntoView({ block: 'start' });
            readingSurface.current?.focus({ preventScroll: true });
          }} /> : null}
      {notice ? <p className="library-source-notice" role="alert">{notice}</p> : null}
      {enabled && !notice && personal.value?.hasSource === false
        ? <p role="status">导入 LCM Excel 后即可查看构型。</p> : null}
      {enabled && !notice && catalogue.loading && !validPins ? <p role="status">正在读取已接收快照…</p> : null}
      {enabled && !notice && catalogue.value && !catalogue.value.snapshots.length && !validPins
        ? <p role="status">当前没有已接收的 LCM 快照。</p> : null}
      {enabled && !notice && native.loading && !index ? <p role="status">正在读取固定范围的构型矩阵…</p> : null}
      {enabled && !notice && stateDate && !query.snapshotIds.length
        ? <p role="status">所选状态日 {stateDate}：0 个已读取快照。</p> : null}
      <div ref={readingSurface} tabIndex={-1} aria-label={isAircraft && aircraftRef ? '当前单机构型阅读' : '当前构型矩阵阅读'}>
      {index && !notice ? index.softwareIndex.length === 0
        ? <p role="status">当前筛选没有匹配记录。</p>
        : isAircraft && aircraftRef ? <LcmAircraftTable query={query} matrix={index} aircraftRef={aircraftRef}
          nativeIndex={native.index!} onBack={backToMatrix} onSelect={selectRecord} />
          : <LcmMatrixGrid key={viewScope} index={index} windowData={windowData} expanded={expanded} initialScroll={scroll.current}
            onWindow={onWindow} onScrollPosition={onScrollPosition} onExpand={toggleExpanded}
            savedSelection={savedSelection} isSourceBlank={selection => Boolean(native.index && selection.aircraftRef &&
              lcmNativeSelectionIsBlank(native.index, query, selection.softwareRef, selection.aircraftRef, selection.partNumber))}
            onSort={ref => field('lcmAnchor', ref)} onSelect={selectRecord} onAircraft={openAircraft} /> : null}
      </div>
      {index && selection && !notice ? <LcmEvidenceDrawer query={query} matrix={index} selection={selection}
        onClose={() => setSelection(null)} onLost={onLost} onSort={ref => field('lcmAnchor', ref)} /> : null}
      <LcmMatrixScopeDialog kind={scopeDialog}
        options={scopeDialog === 'aircraft' ? (index?.aircraftIndex ?? []).map(plane => ({
          value: plane.aircraftRef, label: plane.tailNumber, hint: lcmModelNames(plane.models),
        })) : snapshots.map(snapshot => ({ value: snapshot.snapshotId, label: snapshot.originalFileName,
          date: lcmSnapshotStateDate(snapshot), hint: '状态日 ' + (lcmSnapshotStateDate(snapshot) ?? '未识别') }))}
        selected={scopeDialog === 'aircraft' ? index?.aircraftOrder ?? [] : query.snapshotIds}
        selectedDate={stateDate}
        onClose={() => setScopeDialog(null)} onApply={applyScope} />
      {query.aircraftRefs || params.has('emptyAircraftScope') ? <Button variant="ghost" size="sm" onClick={() => {
        const next = new URLSearchParams(routeRef.current); next.delete('aircraftRef'); next.delete('emptyAircraftScope');
        setParams(next);
      }}>恢复完整授权飞机范围</Button> : null}
      {catalogue.value?.hasMore && catalogue.value.nextAfter ? <Button variant="ghost" size="sm"
        onClick={() => setCatalogueAfter(catalogue.value!.nextAfter!)}>读取下一批历史快照</Button> : null}
    </div>
  </main>;
}
