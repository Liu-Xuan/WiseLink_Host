import { saveLibraryGraphReturn } from './library-graph-return-memory';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Filter, Maximize2, Minus, Plus, RefreshCw, Search } from 'lucide-react';
import type { CanonicalLibraryGraphRequest, LibraryGraphFilters } from '@shared/library-graph.interface';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import SuiteGraphCanvas, { type SuiteGraphCanvasHandle } from './SuiteGraphCanvas';
import { activateGraphLayoutSession, readGraphLayout, saveGraphLayout } from './suite-graph-layout-memory';
import { documentGraphReadingParams, type SuiteGraphReadingState } from './suite-graph-return';
import { LIBRARY_GRAPH_FILTER_KEYS, LIBRARY_GRAPH_ROUTE, libraryGraphFilters, libraryGraphReadingParams, libraryGraphState, readLibraryGraphEntry } from './library-graph-route';
import { buildLibraryGraphPresentation, libraryClusterLabel, libraryGraphItemId, libraryGraphItemLabel, type LibraryGraphItem } from './suite-library-graph';
import { useLibraryGraphPage } from './useLibraryGraphPage';
import './suite-library-graph-page.css';
export default function SuiteLibraryGraphPage() {
  const [params,setParams] = useSearchParams();
  const location = useLocation();
  const entry = readLibraryGraphEntry(params);
  const {sessionGeneration,authenticationRequired,currentUser} = useCurrentUserSession();
  const lifecycle = JSON.stringify([sessionGeneration,currentUser?.user_id ?? null]);
  const previousLifecycle = useRef(lifecycle);
  const changedSession = previousLifecycle.current !== lifecycle;
  const staleDisplay = params.has('displaySession') && params.get('displaySession') !== String(sessionGeneration);
  const discardDisplay = changedSession || staleDisplay || authenticationRequired;
  useLayoutEffect(() => {
    previousLifecycle.current = lifecycle;
    if (!discardDisplay || entry.kind !== 'library') return;
    const next = libraryGraphReadingParams(entry.request,{},sessionGeneration);
    if (next.toString() !== params.toString() || location.state) setParams(next,{replace:true,state:null});
  },[lifecycle,discardDisplay,params,location.state,setParams]);
  activateGraphLayoutSession(sessionGeneration,authenticationRequired || discardDisplay);
  if (entry.kind !== 'library') return <p role="alert">全库概览范围不明确。</p>;
  return <LibraryGraphContent key={JSON.stringify([entry.request,sessionGeneration,currentUser?.user_id ?? null])}
    request={entry.request} session={sessionGeneration} denied={authenticationRequired} discardDisplay={discardDisplay} />;
}
const FILTER_LABELS:Record<keyof LibraryGraphFilters,string> = {search:'文号、资料检索',normalizedFamily:'资料类别',ata:'ATA 标注',aircraftModel:'文档机型标注',fleetFamily:'机队系列',fleetModel:'机队机型'};
/** One metadata page at a time. Selected document detail is delegated to the exact existing neighborhood. */
function LibraryGraphContent({request,session,denied,discardDisplay}:{request:CanonicalLibraryGraphRequest;session:number;denied:boolean;discardDisplay:boolean}) {
  const [params,setParams] = useSearchParams();
  const location = useLocation(), navigate = useNavigate();
  const read = useLibraryGraphPage(request,session,denied);
  const [filtersOpen,setFiltersOpen] = useState(false);
  const [draft,setDraft] = useState<LibraryGraphFilters>(() => libraryGraphFilters(request));
  const stateRef = useRef<SuiteGraphReadingState>(discardDisplay ? {} : libraryGraphState(params));
  const [selectedId,setSelectedId] = useState(stateRef.current.selectedId);
  const canvasRef = useRef<SuiteGraphCanvasHandle|null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const queryRef = useRef(params.toString()); queryRef.current = params.toString();
  const lastWritten = useRef(params.toString());
  const geometryScope = JSON.stringify(['library',session,request]);
  const presentation = useMemo(() => read.page ? buildLibraryGraphPresentation(read.page) : null,[read.page]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); },[]);
  useEffect(() => {
    if (params.toString() === lastWritten.current) return;
    if (timer.current) clearTimeout(timer.current);
    stateRef.current = discardDisplay ? {} : libraryGraphState(params); setSelectedId(stateRef.current.selectedId);
    canvasRef.current?.setViewport(stateRef.current.viewport ?? null);
  },[params,discardDisplay]);
  useEffect(() => { if (read.error) activateGraphLayoutSession(session,true); },[read.error,session]);
  const persist = () => {
    if (timer.current) clearTimeout(timer.current);
    const next = libraryGraphReadingParams(request,stateRef.current,session);
    lastWritten.current = next.toString();
    if (next.toString() !== queryRef.current) setParams(next,{replace:true,state:location.state});
    return next;
  };
  const capture = () => {
    if (timer.current) clearTimeout(timer.current);
    const viewport = canvasRef.current?.getViewport();
    const layout = canvasRef.current?.getLayout();
    stateRef.current = {...stateRef.current,viewport:viewport ?? stateRef.current.viewport,
      layoutSnapshot:layout ? saveGraphLayout(geometryScope,layout,stateRef.current.layoutSnapshot) : stateRef.current.layoutSnapshot};
    return persist();
  };
  const parentState = (discardDisplay ? {} : location.state ?? {}) as {libraryRoot?:string;libraryParent?:string};
  const safeBackQuery = (raw:string|undefined) => raw && raw.length <= 24000 && readLibraryGraphEntry(new URLSearchParams(raw)).kind === 'library' ? raw : null;
  const rootQuery = safeBackQuery(parentState.libraryRoot);
  const parentQuery = safeBackQuery(parentState.libraryParent);
  const drill = (next:CanonicalLibraryGraphRequest) => {
    const current = capture().toString();
    navigate(`/graph?${libraryGraphReadingParams(next)}`,{state:{libraryParent:current,
      libraryRoot:request.level === 'clusters' ? current : rootQuery ?? LIBRARY_GRAPH_ROUTE.split('?')[1]}});
  };
  const resetPage = () => { capture(); navigate(`/graph?${libraryGraphReadingParams({...request,cursor:undefined})}`,{replace:true,state:location.state}); };
  const applyFilters = (event:FormEvent) => {
    event.preventDefault(); capture();
    const filters = Object.fromEntries(LIBRARY_GRAPH_FILTER_KEYS.filter(key => draft[key]?.trim()).map(key => [key,draft[key]!.trim()]));
    const groupBy = request.level === 'versions' ? 'ata' : request.groupBy;
    navigate(`/graph?${libraryGraphReadingParams({level:'clusters',groupBy,...filters})}`);
  };
  const select = (id:string) => { setSelectedId(id); stateRef.current = {...stateRef.current,selectedId:id}; persist(); };
  const selected = read.page?.items.find(item => libraryGraphItemId(item) === selectedId);
  const groupBy = read.page && read.page.level !== 'versions' ? read.page.groupBy : 'ata';
  const openSelected = (item:LibraryGraphItem) => {
    if (item.kind === 'CLASSIFICATION' && request.level !== 'versions') drill({level:'families',groupBy:request.groupBy,
      clusterValue:item.value,...libraryGraphFilters(request),limit:50});
    else if (item.kind === 'FAMILY') drill({level:'versions',familyId:item.familyId,limit:50});
    else if (item.kind === 'VERSION') { const macro = capture(); const query = documentGraphReadingParams(item.documentVersionId,undefined,{}); const token = saveLibraryGraphReturn({query:macro.toString(),parent:parentQuery ?? undefined,root:rootQuery ?? undefined},session); if (token) query.set('returnLibrarySnapshot',token); navigate(`/graph?${query}`); }
  };
  return <section className="suite-library-graph" aria-label="授权全库概览">
    <header className="suite-library-header"><div><span className="suite-library-eyebrow">关系图谱</span><h1>全库概览</h1></div>
      <form className="suite-library-search" onSubmit={applyFilters}><Search aria-hidden="true" /><input aria-label="检索全库资料" maxLength={200}
        value={draft.search ?? ''} onChange={event => setDraft(previous => ({...previous,search:event.target.value}))} placeholder="检索文号或资料" />
        <Button type="submit" variant="ghost" size="sm">检索</Button></form>
      <label className="suite-library-group">分组<select aria-label="概览分组方式" value={request.level === 'versions' ? '' : request.groupBy}
        disabled={request.level === 'versions'} onChange={event => { capture(); navigate(`/graph?${libraryGraphReadingParams({level:'clusters',groupBy:event.target.value as 'ata'|'normalizedFamily',...libraryGraphFilters(request),limit:50})}`); }}>
        {request.level === 'versions' ? <option value="">所选文档族</option> : null}<option value="ata">ATA 标注</option><option value="normalizedFamily">资料类别</option></select></label>
      <Button size="sm" variant="outline" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}><Filter aria-hidden="true" />筛选</Button>
      <Button size="sm" variant="ghost" aria-label="重新核对当前范围" onClick={() => { capture(); read.refresh(); }}><RefreshCw aria-hidden="true" /></Button>
    </header>
    <nav className="suite-library-breadcrumb" aria-label="图谱范围">
      <Button size="sm" variant="ghost" onClick={() => {capture(); navigate(`/graph?${rootQuery ?? libraryGraphReadingParams({level:'clusters',groupBy:request.level === 'versions' ? 'ata' : request.groupBy,...libraryGraphFilters(request),limit:50})}`);}}>全库概览</Button>
      {request.level !== 'clusters' ? <><ChevronRight aria-hidden="true" /><Button size="sm" variant="ghost" onClick={() => {capture(); navigate(parentQuery ? `/graph?${parentQuery}` : LIBRARY_GRAPH_ROUTE,{state:request.level === 'versions' && rootQuery ? {libraryRoot:rootQuery,libraryParent:rootQuery} : undefined});}}>{request.level === 'families' ? libraryClusterLabel(request.clusterValue,request.groupBy) : '返回分类簇'}</Button></> : null}
      {request.level === 'versions' ? <><ChevronRight aria-hidden="true" /><span>所选文档族的可读版本</span></> : null}
      {request.cursor ? <span>后续页 · 按稳定身份排序</span> : null}
    </nav>
    {filtersOpen ? <form className="suite-library-filters" aria-label="全库筛选" onSubmit={applyFilters}>
      {LIBRARY_GRAPH_FILTER_KEYS.filter(key => key !== 'search').map(key => <label key={key}>{FILTER_LABELS[key]}<input aria-label={FILTER_LABELS[key]} maxLength={96}
        value={draft[key] ?? ''} onChange={event => setDraft(previous => ({...previous,[key]:event.target.value}))} /></label>)}
      <p>机队筛选来自当前机队目录；不能同时填写文档机型标注与机队系列。分类与机型提及不表示正式适用。</p>
      <Button type="submit" size="sm" disabled={Boolean((draft.fleetModel && !draft.fleetFamily) || (draft.fleetFamily && draft.aircraftModel))}>应用并返回概览</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => {setDraft({});capture();navigate(`/graph?${libraryGraphReadingParams({level:'clusters',groupBy:request.level === 'versions' ? 'ata' : request.groupBy,limit:50})}`);}}>清除筛选</Button>
    </form> : null}
    {read.error ? <div className="suite-library-state" role="alert"><p>{read.error}</p>{!denied ? <Button onClick={read.cursorInvalid ? resetPage : read.refresh}>{read.cursorInvalid ? '重新读取同范围首页' : '重试同一范围'}</Button> : null}</div>
      : !read.page || !presentation ? <div className="suite-library-state" role="status">正在读取当前授权范围的有界概览…</div>
      : <>
        <div className="suite-library-scope" aria-live="polite"><strong>{read.page.counts.uniqueFamilyCount.toLocaleString()} 个唯一文档族 · {read.page.counts.readableVersionCountInMatchingFamilies.toLocaleString()} 个可读版本</strong>
          <span>{read.page.countScope === 'SELECTED_FAMILY_FRESH_READ' ? '所选文档族重新核权；先前宏观筛选不用于此页' : '筛选按文档族匹配；计数包括匹配族的所有可读版本'}</span>
          <span>本页 {read.page.items.length} {read.page.level === 'clusters' ? '个分类簇' : read.page.level === 'families' ? '个文档族' : '个准确版本'} · 每页最多 50 · {read.page.hasMore ? '仍有后续页' : '已到当前范围末页'}</span>
        </div>
        {read.page.level === 'clusters' && read.page.clusterCountsOverlap ? <p className="suite-library-notice">同一文档族可出现在多个 ATA 簇中，簇计数不能相加。</p> : null}
        {read.page.items.length ? <div className="suite-library-workspace"><div className="suite-library-stage">
          <SuiteGraphCanvas key={geometryScope} ref={canvasRef} presentation={presentation} presentationStyle="points" selectedId={selectedId}
            initialLayout={readGraphLayout(stateRef.current.layoutSnapshot,geometryScope)} initialViewport={stateRef.current.viewport}
            ariaLabel="分类簇与文档族概览画布" onSelect={(data,isEdge) => {if (!isEdge && typeof data.businessId === 'string') select(data.businessId);}}
            onViewport={viewport => {stateRef.current = {...stateRef.current,viewport}; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(persist,320);}} />
          <div className="suite-library-camera"><Button size="sm" variant="outline" aria-label="适应概览画布" onClick={() => canvasRef.current?.fit()}><Maximize2 /></Button>
            <Button size="sm" variant="outline" aria-label="放大概览" onClick={() => canvasRef.current?.zoomBy(1.25)}><Plus /></Button>
            <Button size="sm" variant="outline" aria-label="缩小概览" onClick={() => canvasRef.current?.zoomBy(.8)}><Minus /></Button></div>
          <small className="suite-library-legend"><i />分类或包含分组连接 · 没有据此生成引用或工程关系</small>
        </div><aside className="suite-library-inspector" aria-label="概览所选对象">
          {selected ? <><span className="suite-library-eyebrow">{selected.kind === 'CLASSIFICATION' ? '分类簇' : selected.kind === 'FAMILY' ? '文档族' : '准确文档版本'}</span><h2>{libraryGraphItemLabel(selected,groupBy)}</h2>
            {selected.kind === 'CLASSIFICATION' ? <p>{selected.uniqueFamilyCount} 个唯一文档族 · {selected.readableVersionCountInMatchingFamilies} 个可读版本</p>
              : selected.kind === 'FAMILY' ? <p>{selected.readableVersionCount} 个可读版本<br /><small>{selected.familyId}</small></p>
                : <><p>{selected.isCurrent ? 'Host 当前登记版本，正式现行性待来源核对' : '其他已登记版本，保留准确身份'}</p><small>{selected.documentVersionId}</small><p>登记时间 {selected.committedAt}</p></>}
            <Button onClick={() => openSelected(selected)}>{selected.kind === 'CLASSIFICATION' ? '展开此分类簇' : selected.kind === 'FAMILY' ? '查看族内版本' : '以此准确版本查看邻域'}</Button></>
            : <><h2>选择一个簇</h2><p>点选画布或下方清单，再展开下一层。每次只读取所选范围的一页。</p>{selectedId ? <p>先前选择未出现在本次授权页，未替换为其他对象。</p> : null}</>}
          <details className="suite-library-list"><summary>本页对象清单（{read.page.items.length}）</summary><ul>{read.page.items.map(item => <li key={libraryGraphItemId(item)}><button type="button" aria-pressed={libraryGraphItemId(item) === selectedId}
            onClick={() => select(libraryGraphItemId(item))}>{libraryGraphItemLabel(item,groupBy)}</button></li>)}</ul></details>
        </aside></div> : <div className="suite-library-state" role="status"><h2>当前范围没有可读对象</h2><p>可调整筛选或重新核对。空目录不代表不存在文档引用。</p></div>}
        <footer className="suite-library-footer"><p>文档引用：尚未建立全库索引（NOT_INDEXED） · 事项归属：此层未读取（NOT_LOADED）<br />当前授权目录实时读取；分页之间资料或权限可能变化。元数据是最新登记观察，不是历史工作快照。</p>
          <div>{request.cursor ? <Button size="sm" variant="ghost" onClick={resetPage}>返回当前范围首页</Button> : null}
            <Button size="sm" variant="outline" disabled={!read.page.hasMore} onClick={() => {if (read.page?.nextCursor) {capture();navigate(`/graph?${libraryGraphReadingParams({...request,cursor:read.page.nextCursor})}`,{state:location.state});}}}>下一页</Button></div>
        </footer>
      </>}
  </section>;
}
