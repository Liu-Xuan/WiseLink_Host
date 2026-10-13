import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Filter, List, Maximize2, Minus, Plus, RefreshCw, Search, X, Info } from 'lucide-react';
import type { Core } from 'cytoscape';
import type { CanonicalLibraryGraphRequest, LibraryGraphFilters } from '@shared/library-graph.interface';
import { useCurrentUserSession } from '@client/src/app/providers/CurrentUserSessionProvider';
import { Button } from '@client/src/components/ui/button';
import AtlasGraph from '@client/src/features/atlas/AtlasGraph';
import { initialAtlasLocation, type AtlasLocation } from '@client/src/features/atlas/atlas-model';
import { activateGraphLayoutSession, readGraphLayout, saveGraphLayout } from './suite-graph-layout-memory';
import { documentGraphReadingParams, withGraphReturn, type SuiteGraphReadingState } from './suite-graph-return';
import { LIBRARY_GRAPH_FILTER_KEYS, LIBRARY_GRAPH_ROUTE, libraryGraphFilters, libraryGraphReadingParams, libraryGraphState, readLibraryGraphEntry } from './library-graph-route';
import { saveLibraryGraphReturn } from './library-graph-return-memory';
import { buildLibraryMacroGraph, LIBRARY_MACRO_NODE_LIMIT, type MacroTarget } from './library-macro-graph';
import { useLibraryMacro } from './useLibraryMacro';
import './suite-library-graph-page.css';

export default function SuiteLibraryGraphPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation(), entry = readLibraryGraphEntry(params);
  const { sessionGeneration, authenticationRequired, currentUser } = useCurrentUserSession();
  const lifecycle = JSON.stringify([sessionGeneration, currentUser?.user_id ?? null]);
  const previousLifecycle = useRef(lifecycle);
  const discardDisplay = previousLifecycle.current !== lifecycle || authenticationRequired ||
    (params.has('displaySession') && params.get('displaySession') !== String(sessionGeneration));
  useLayoutEffect(() => {
    previousLifecycle.current = lifecycle;
    if (!discardDisplay || entry.kind !== 'library') return;
    const next = libraryGraphReadingParams(entry.request, {}, sessionGeneration);
    if (next.toString() !== params.toString() || location.state) setParams(next, { replace: true, state: null });
  }, [lifecycle, discardDisplay, params, location.state, setParams]);
  activateGraphLayoutSession(sessionGeneration, authenticationRequired || discardDisplay);
  if (entry.kind !== 'library') return <p role="alert">全库概览范围不明确。</p>;
  return <LibraryMacroContent key={JSON.stringify([entry.request, sessionGeneration, currentUser?.user_id ?? null])}
    request={entry.request} session={sessionGeneration} denied={authenticationRequired} discardDisplay={discardDisplay} />;
}
const FILTER_LABELS: Record<keyof LibraryGraphFilters, string> = { search: '文号、资料检索', normalizedFamily: '资料类别', ata: 'ATA 原始标注', aircraftModel: '文档机型标注', fleetFamily: '机队系列', fleetModel: '机队机型' };
const KINDS: Record<string, string> = { classification: '分类', family: '文档族', document: '准确版本', matter: '工程事项' };
const COVERAGE: Record<string, string> = { COMPLETE: '已读取', PARTIAL: '部分读取', READ_FAILED: '读取失败', NOT_AUTHORIZED: '无权限或不可访问', NOT_LOADED: '未读取', NOT_INDEXED: '未建立全库索引' };
type Panel = 'detail' | 'objects' | 'filter' | 'status' | null;

function LibraryMacroContent({ request, session, denied, discardDisplay }: {
  request: CanonicalLibraryGraphRequest; session: number; denied: boolean; discardDisplay: boolean;
}) {
  const [params, setParams] = useSearchParams(), navigate = useNavigate();
  const read = useLibraryMacro(request, session, denied);
  const [panel, setPanel] = useState<Panel>(null), [draft, setDraft] = useState<LibraryGraphFilters>(() => libraryGraphFilters(request));
  const state = useRef<SuiteGraphReadingState>(discardDisplay ? {} : libraryGraphState(params));
  const [selectedId, setSelectedId] = useState(state.current.selectedId ?? '');
  const [allLabels, setAllLabels] = useState(false);
  const migratedCamera = useRef(params.get('macroView') !== 'network' && (params.has('viewport') || params.has('layoutSnapshot')));
  const cy = useRef<Core | null>(null), readyCore = useRef<Core | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryRef = useRef(params.toString()); queryRef.current = params.toString();
  const lastWritten = useRef(params.toString());
  const geometryScope = JSON.stringify(['library-macro', session, request]);
  const groupBy = request.level === 'versions' ? 'ata' : request.groupBy;
  const filtered = request.level !== 'clusters' || LIBRARY_GRAPH_FILTER_KEYS.some(key => Boolean(libraryGraphFilters(request)[key]));
  const display = useMemo<{ projection: ReturnType<typeof buildLibraryMacroGraph> | null; error: string | null }>(() => {
    if (!read.read) return { projection: null, error: null };
    try { return { projection: buildLibraryMacroGraph(read.read, groupBy, filtered), error: null }; }
    catch (reason) { return { projection: null, error: reason instanceof Error ? reason.message : '图谱无法构造，请重新读取。' }; }
  }, [read.read, groupBy, filtered]);
  const projection = display.projection;
  const graphLocation: AtlasLocation = { ...initialAtlasLocation, view: 'network', selected: selectedId, allLabels };
  const persist = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const next = libraryGraphReadingParams(request, state.current, session);
    lastWritten.current = next.toString();
    if (next.toString() !== queryRef.current) setParams(next, { replace: true });
    return next;
  }, [request, session, setParams]);
  const capture = () => {
    const core = cy.current;
    if (core) {
      state.current.viewport = { pan: { ...core.pan() }, zoom: core.zoom() };
      state.current.layoutSnapshot = saveGraphLayout(geometryScope, { nodes: core.nodes().map(node => ({
        id: node.id(), base: { x: 0, y: 0 }, position: { ...node.position() }, w: 0, h: 0, baseW: 0, baseH: 0,
      })) }, state.current.layoutSnapshot, LIBRARY_MACRO_NODE_LIMIT);
    }
    return persist();
  };
  const onReady = useCallback((ready: boolean) => {
    if (!ready || !cy.current || readyCore.current === cy.current) return;
    const core = cy.current; readyCore.current = core;
    const saved = readGraphLayout(state.current.layoutSnapshot, geometryScope);
    if (saved) core.batch(() => saved.nodes.forEach(node => {
      const target = core.getElementById(node.id);
      if (target.isNode()) target.position(node.position);
    }));
    if (state.current.viewport) core.viewport(state.current.viewport);
  }, [geometryScope]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (params.toString() === lastWritten.current) return;
    if (timer.current) clearTimeout(timer.current);
    state.current = discardDisplay ? {} : libraryGraphState(params);
    setSelectedId(state.current.selectedId ?? '');
    if (state.current.viewport) cy.current?.viewport(state.current.viewport);
    else cy.current?.fit(undefined, 45);
  }, [params, discardDisplay]);
  useEffect(() => { if (read.error) activateGraphLayoutSession(session, true); }, [read.error, session]);
  const select = (id: string) => {
    if (!projection?.targets.has(id)) return;
    setSelectedId(id); state.current.selectedId = id; setPanel('detail'); persist();
  };
  const selected = projection?.targets.get(selectedId);
  const openDetail = (target: MacroTarget) => {
    if (target.kind !== 'version' && target.kind !== 'matter') return;
    const token = saveLibraryGraphReturn({ query: capture().toString() }, session);
    const query = target.kind === 'version' ? documentGraphReadingParams(target.documentVersionId, target.readerWorkItemId, {}) : new URLSearchParams({ matterId: target.matterId });
    if (token) query.set('returnLibrarySnapshot', token);
    navigate(`/graph?${query}`);
  };
  const openSource = (documentVersionId: string) => {
    navigate(withGraphReturn(`/document-versions/${encodeURIComponent(documentVersionId)}`, capture()));
  };
  const applyFilters = (event: FormEvent) => {
    event.preventDefault(); capture();
    const filters = Object.fromEntries(LIBRARY_GRAPH_FILTER_KEYS.filter(key => draft[key]?.trim()).map(key => [key, draft[key]!.trim()]));
    navigate(`/graph?${libraryGraphReadingParams({ level: 'clusters', groupBy, ...filters })}`);
    setPanel(null);
  };
  const toggle = (next: Panel) => setPanel(current => current === next ? null : next);
  const partial = read.read && (read.read.coverage.documents !== 'COMPLETE' || read.read.coverage.matters !== 'COMPLETE');
  const neighbors: string[] = projection?.graph.edges.flatMap<string>(edge => edge.source === selectedId ? [edge.target] : edge.target === selectedId ? [edge.source] : []) ?? [];
  return <section className="suite-library-graph" aria-label="授权宏观关系图谱">
    <header className="suite-library-header">
      <h1>全库图谱</h1>
      {projection ? <small className="suite-library-counts" aria-label="当前画布已读取对象计数" aria-live="polite">{projection.counts.families} 份 · {projection.counts.versions} 版 · {projection.counts.matters || read.read?.coverage.matters === 'COMPLETE' ? `${projection.counts.matters} 事项` : '事项未读'}</small> : null}
      <form className="suite-library-search" onSubmit={applyFilters}><Search aria-hidden="true" /><input aria-label="检索全库资料" maxLength={200}
        value={draft.search ?? ''} onChange={event => setDraft(previous => ({ ...previous, search: event.target.value }))} placeholder="文号、标题…" />
        <Button type="submit" variant="ghost" size="sm">检索</Button></form>
      <Button size="sm" variant="ghost" aria-expanded={panel === 'filter'} onClick={() => toggle('filter')}><Filter aria-hidden="true" />筛选</Button>
      <Button size="sm" variant="ghost" aria-label="图谱对象清单" aria-expanded={panel === 'objects'} onClick={() => toggle('objects')}><List /></Button>
      <Button size="sm" variant="ghost" aria-label="图谱读取状态" aria-expanded={panel === 'status'} onClick={() => toggle('status')}><Info />{partial ? '部分读取' : '状态'}</Button>
      <Button size="sm" variant="ghost" aria-label="重新核对当前范围" onClick={() => { capture(); read.refresh(); }}><RefreshCw /></Button>
    </header>
    <div className="suite-library-stage">
      {read.error || display.error ? <div className="suite-library-state" role="alert"><p>{read.error ?? display.error}</p>{!denied ? <Button onClick={read.refresh}>重试同一范围</Button> : null}</div>
        : !projection ? <div className="suite-library-state" role="status">正在读取授权图谱…</div>
        : projection.graph.nodes.length ? <AtlasGraph graph={projection.graph} location={graphLocation} variant="macro" api={cy}
          ariaLabel="全库宏观图谱；分类、文档族、准确版本与事项同时显示；对象清单提供等价点选"
          onSelect={select} onReady={onReady} onCamera={(pan, zoom) => {
            state.current.viewport = { pan, zoom }; if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(persist, 320);
          }} /> : <div className="suite-library-state" role="status">当前范围没有可读对象</div>}
      {projection ? <>
        <div className="suite-library-camera"><Button size="sm" variant="outline" aria-label="适应概览画布" onClick={() => cy.current?.fit(undefined, 45)}><Maximize2 /></Button>
          <Button size="sm" variant="outline" aria-label="放大概览" onClick={() => { const core = cy.current; if (core) core.zoom({ level: core.zoom() * 1.25, renderedPosition: { x: core.width() / 2, y: core.height() / 2 } }); }}><Plus /></Button>
          <Button size="sm" variant="outline" aria-label="缩小概览" onClick={() => { const core = cy.current; if (core) core.zoom({ level: core.zoom() * .8, renderedPosition: { x: core.width() / 2, y: core.height() / 2 } }); }}><Minus /></Button>
          <Button size="sm" variant="outline" aria-pressed={allLabels} onClick={() => setAllLabels(value => !value)}>名称</Button>
          {selectedId ? <Button size="sm" variant="outline" onClick={() => { setSelectedId(''); state.current.selectedId = undefined; persist(); }}>取消选择</Button> : null}
        </div>
        <div className="suite-library-legend" aria-label="图谱图例"><span data-kind="classification">分类</span><span data-kind="family">文档族</span><span data-kind="document">版本</span><span data-kind="matter">事项</span><span className="macro-classification-line">分类 / 包含</span><span className="macro-material-line">登记资料</span></div>
      </> : null}
      {panel ? <aside className="suite-library-panel" aria-label={panel === 'filter' ? '全库筛选' : panel === 'status' ? '图谱状态详情' : panel === 'objects' ? '图谱对象清单' : '概览所选对象'}>
        <header><strong>{panel === 'filter' ? '筛选' : panel === 'status' ? '读取状态' : panel === 'objects' ? '图谱对象' : '所选对象'}</strong><Button size="sm" variant="ghost" aria-label="关闭图谱侧栏" onClick={() => setPanel(null)}><X /></Button></header>
        {panel === 'filter' ? <form className="suite-library-filters" onSubmit={applyFilters}>
          <label>分类维度<select aria-label="概览分组方式" value={groupBy} onChange={event => { capture(); navigate(`/graph?${libraryGraphReadingParams({ level: 'clusters', groupBy: event.target.value as 'ata' | 'normalizedFamily', ...libraryGraphFilters(request) })}`); }}><option value="ata">ATA</option><option value="normalizedFamily">资料类别</option></select></label>
          {LIBRARY_GRAPH_FILTER_KEYS.filter(key => key !== 'search').map(key => <label key={key}>{FILTER_LABELS[key]}<input aria-label={FILTER_LABELS[key]} maxLength={96}
            value={draft[key] ?? ''} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}
          <p>文档机型标注与机队系列可选一种筛选。</p>
          <Button type="submit" size="sm" disabled={Boolean((draft.fleetModel && !draft.fleetFamily) || (draft.fleetFamily && draft.aircraftModel))}>应用筛选</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft({}); capture(); navigate(LIBRARY_GRAPH_ROUTE); setPanel(null); }}>清除筛选</Button>
        </form> : panel === 'status' ? <>
          {read.read ? <dl>{Object.entries(read.read.coverage).map(([key, value]) => <div key={key}><dt>{key === 'documents' ? '资料目录' : key === 'matters' ? '事项及材料' : '文档引用'}</dt><dd>{COVERAGE[value]} <small>{value}</small></dd></div>)}</dl> : null}
          {read.read?.issues.map(issue => <p key={issue}>{issue}</p>)}
          {migratedCamera.current ? <p>旧概览坐标已适配为网络视图；筛选和准确对象身份保留。</p> : null}
          <p>筛选按文档族匹配，画布保留匹配族的全部获权版本。</p>
          {projection?.outsideLinks ? <p>{projection.outsideLinks} 项登记资料在当前文档范围之外。</p> : null}
          <p>分类连接取自原始标注；事项连接来自 Host 已登记的实存资料或旧工作关联。预期资料及排除材料保留在事项细节图谱中。</p>
          {read.read?.coverage.matters === 'COMPLETE' && !projection?.counts.materials ? <p>已读回的事项在当前文档范围内没有登记资料连接。</p> : null}
          <nav><Link to="/graph">事项关系图谱</Link><Link to="/library">资料库</Link></nav>
        </> : panel === 'objects' ? <ul className="suite-library-object-list">{projection?.graph.nodes.map(node => <li key={node.id}><button type="button" aria-pressed={node.id === selectedId} onClick={() => select(node.id)}><small>{KINDS[node.kind]}</small>{node.kind === 'document' ? `${node.code} · ${node.version ?? ''}` : node.title}</button></li>)}</ul>
          : selected ? <>
            <h2>{selected.title}</h2>
            {selected.kind === 'version' ? <><dl><div><dt>版本</dt><dd>{selected.version} · {selected.current ? '库内当前' : '库内历史'}</dd></div><div><dt>原始 ATA</dt><dd>{selected.ata.length ? selected.ata.map(value => value || '空值').join('、') : '未读回'}</dd></div></dl><small>{selected.documentVersionId}</small>
              <Button onClick={() => openDetail(selected)}>打开文档图谱</Button><Button variant="ghost" onClick={() => openSource(selected.documentVersionId)}>阅读准确来源</Button></>
              : selected.kind === 'matter' ? <><p>事项修订 {selected.revision}</p><small>{selected.matterId}</small><Button onClick={() => openDetail(selected)}>打开事项图谱</Button></>
                : selected.kind === 'classification' ? <p>原始标注：{selected.raw.map(value => value || '空值').join('、')}</p>
                  : selected.kind === 'family' ? <small>{selected.familyId}</small>
                    : <><p>{selected.explanation}</p><button onClick={() => select(selected.source)}>定位起点</button><button onClick={() => select(selected.target)}>定位终点</button></>}
            {neighbors.length ? <><h3>直接连接（{new Set(neighbors).size}）</h3><ul className="suite-library-object-list">{[...new Set(neighbors)].map(id => <li key={id}><button onClick={() => select(id)}>{projection?.graph.nodes.find(node => node.id === id)?.title}</button></li>)}</ul></> : null}
          </> : <p>先前选择未出现在本次读取范围。</p>}
      </aside> : null}
    </div>
  </section>;
}
