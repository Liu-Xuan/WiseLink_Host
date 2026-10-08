import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, FileText, Maximize2, Minus, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import SuiteGraphCanvas, { type SuiteGraphCanvasHandle } from './SuiteGraphCanvas';
import SuiteGraphTimeline from './SuiteGraphTimeline';
import { readGraphLayout, saveGraphLayout } from './suite-graph-layout-memory';
import { buildSuiteGraphPresentation } from './suite-graph-presentation';
import type { SuiteGraphGroup, SuiteGraphItem, SuiteGraphMatter, SuiteGraphPresentation } from './suite-graph-model';
import type { SuiteGraphReadingState } from './suite-graph-return';
import type { SuiteGraphTimelineEvent, SuiteGraphTimelineSource } from './suite-graph-timeline';
import './suite-matter-graph-page.css';
import './suite-document-graph-page.css';

export interface SuiteDocumentGraphViewProps {
  graph: SuiteGraphMatter;
  selectedId?: string;
  detail: ReactNode;
  notices: string[];
  initialState?: SuiteGraphReadingState;
  layoutScope: string;
  onStateChange: (state: SuiteGraphReadingState, beforeNavigation?: boolean) => void;
  onSelect: (id: string, relationshipIds?: string[]) => void;
  timelineEvents: SuiteGraphTimelineEvent[];
  timelineSources: SuiteGraphTimelineSource[];
  timelineLoading: boolean;
  onSelectEvent: (event: SuiteGraphTimelineEvent) => void;
  onExpandTimelineSource: (documentVersionId: string) => void;
  onOpenEventTimeline: (event: SuiteGraphTimelineEvent) => void;
  onRefresh: () => void;
  onOpenSource: () => void;
  onBack?: () => void;
}

const OVERFLOW_PAGE_SIZE = 6;
const TIMELINE_PAGE_SIZE = 8;
const boundedInteger = (value: number | undefined, fallback: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value!))) : fallback;

function PageControls({ label, page, count, onChange }: {
  label: string; page: number; count: number; onChange: (page: number) => void;
}) {
  return (
    <div className="suite-document-graph-pager" aria-label={label}>
      <Button size="sm" variant="ghost" aria-label={`${label}上一页`} disabled={page <= 0}
        onClick={() => onChange(page - 1)}><ChevronLeft aria-hidden="true" /></Button>
      <span aria-live="polite">{page + 1} / {count}</span>
      <Button size="sm" variant="ghost" aria-label={`${label}下一页`} disabled={page + 1 >= count}
        onClick={() => onChange(page + 1)}><ChevronRight aria-hidden="true" /></Button>
    </div>
  );
}

/** Read-only presentation. Business identities and navigation stay with the page. */
export default function SuiteDocumentGraphView({
  graph, selectedId, detail, notices, initialState, layoutScope, onStateChange, onSelect,
  timelineEvents, timelineSources, timelineLoading, onSelectEvent, onExpandTimelineSource,
  onOpenEventTimeline, onRefresh, onOpenSource, onBack,
}: SuiteDocumentGraphViewProps) {
  const [state, setState] = useState<SuiteGraphReadingState>(() => ({
    ...initialState,
    selectedId: selectedId ?? initialState?.selectedId ?? graph.id,
    hiddenGroups: initialState?.hiddenGroups ?? [],
    density: boundedInteger(initialState?.density, 4, 1, 6),
    page: boundedInteger(initialState?.page, 0, 0, 99999),
    relationMode: initialState?.relationMode ?? 'aggregated',
    layoutMode: initialState?.layoutMode ?? 'force',
    perspective: 'documents',
  }));
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelinePage, setTimelinePage] = useState(0);
  const [overflow, setOverflow] = useState<{ key: string; page: number } | null>(null);
  const canvasRef = useRef<SuiteGraphCanvasHandle | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const overflowRef = useRef<HTMLDivElement | null>(null);
  const overflowReturnFocus = useRef<HTMLElement | null>(null);
  const timelineId: string = useId();
  const presentation: SuiteGraphPresentation = useMemo(() => buildSuiteGraphPresentation(graph, {
    hiddenGroups: state.hiddenGroups, density: state.density, page: state.page,
    relationMode: state.relationMode, layoutMode: state.layoutMode, maxGroups: 6,
  }), [graph, state.hiddenGroups, state.density, state.page, state.relationMode, state.layoutMode]);
  const geometryScope: string = JSON.stringify([layoutScope, 'documents', state.layoutMode,
    state.density, presentation.counts.page.index, [...(state.hiddenGroups ?? [])].sort(), state.relationMode]);
  const savedLayout = readGraphLayout(state.layoutSnapshot, geometryScope);
  const readingState: SuiteGraphReadingState = {
    ...state, selectedId: selectedId ?? state.selectedId, page: presentation.counts.page.index,
    layoutSnapshot: savedLayout ? state.layoutSnapshot : undefined,
  };
  const readingRef = useRef<SuiteGraphReadingState>(readingState);
  readingRef.current = readingState;
  const reportedState = useRef<string>(JSON.stringify(readingState));
  const overflowGroup: SuiteGraphGroup | undefined = overflow
    ? graph.groups.find((group: SuiteGraphGroup) => group.key === overflow.key) : undefined;
  const overflowPageCount: number = Math.max(1, Math.ceil((overflowGroup?.items.length ?? 0) / OVERFLOW_PAGE_SIZE));
  const overflowPage: number = Math.min(overflow?.page ?? 0, overflowPageCount - 1);
  const overflowItems: SuiteGraphItem[] = overflowGroup?.items.slice(
    overflowPage * OVERFLOW_PAGE_SIZE, (overflowPage + 1) * OVERFLOW_PAGE_SIZE,
  ) ?? [];
  const timelinePageCount: number = Math.max(1, Math.ceil(timelineEvents.length / TIMELINE_PAGE_SIZE));
  const eventPage: number = Math.min(timelinePage, timelinePageCount - 1);
  const selectionOffCanvas: boolean = Boolean(readingState.selectedId
    && !presentation.visibleIds.includes(readingState.selectedId)
    && !graph.relations.some((relation) => relation.id === readingState.selectedId));

  useEffect(() => {
    const serialized: string = JSON.stringify(readingRef.current);
    if (serialized === reportedState.current) return;
    reportedState.current = serialized;
    onStateChange(readingRef.current);
  }, [state, selectedId, onStateChange, presentation]);
  useEffect(() => { if (overflow) overflowRef.current?.focus(); }, [overflow?.key]);

  const updateState = (patch: Partial<SuiteGraphReadingState>) => {
    readingRef.current = { ...readingRef.current, ...patch };
    setState(readingRef.current);
  };
  const beforeNavigation = () => {
    const viewport = canvasRef.current?.getViewport();
    const layout = canvasRef.current?.getLayout();
    const snapshot: string | undefined = layout
      ? saveGraphLayout(geometryScope, layout, readingRef.current.layoutSnapshot)
      : readingRef.current.layoutSnapshot;
    readingRef.current = {
      ...readingRef.current, layoutSnapshot: snapshot,
      viewport: viewport ?? readingRef.current.viewport,
    };
    // Flush live core values synchronously, including a pending animation-frame camera.
    onStateChange(readingRef.current, true);
  };
  const selectItem = (id: string) => {
    updateState({ selectedId: id, eventId: undefined, eventPins: undefined });
    onSelect(id);
  };
  const inspectRelationships = (ids: string[]) => {
    const knownIds: Set<string> = new Set(graph.relations.map((relation) => relation.id));
    const exactIds: string[] = [...new Set(ids)].filter((id: string) => knownIds.has(id));
    if (!exactIds.length) return;
    updateState({ selectedId: exactIds[0], eventId: undefined, eventPins: undefined });
    onSelect(exactIds[0], exactIds);
  };
  const selectData = (data: Record<string, unknown>, isEdge: boolean) => {
    if (isEdge) {
      const ids: string[] = Array.isArray(data.relationshipIds)
        ? data.relationshipIds.filter((id: unknown): id is string => typeof id === 'string')
        : typeof data.businessId === 'string' ? [data.businessId] : [];
      inspectRelationships(ids);
      return;
    }
    if (typeof data.businessId === 'string') selectItem(data.businessId);
  };
  const selectEvent = (event: SuiteGraphTimelineEvent) => {
    updateState({ selectedId: event.nodeId ?? undefined, eventId: event.id, eventPins: event.pins ?? undefined });
    onSelectEvent(event);
  };
  const openOverflow = (key: string) => {
    if (!graph.groups.some((group: SuiteGraphGroup) => group.key === key)) return;
    overflowReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOverflow({ key, page: 0 });
  };
  const closeOverflow = () => {
    setOverflow(null);
    overflowReturnFocus.current?.focus();
  };
  const changePage = (page: number) => {
    setOverflow(null);
    updateState({ page, layoutSnapshot: undefined });
  };

  return (
    <main className="suite-matter-graph-page suite-document-graph-page">
      <header className="suite-document-graph-heading">
        <div className="suite-document-graph-title">
          {onBack ? <Button size="sm" variant="ghost" aria-label="返回" onClick={() => {
            beforeNavigation(); onBack();
          }}><ArrowLeft aria-hidden="true" /></Button> : null}
          <div><span>工程文档 · 关系邻域</span><h1>{graph.title}</h1>{graph.code ? <small>{graph.code}</small> : null}</div>
        </div>
        <div className="suite-document-graph-actions">
          <Button size="sm" variant="ghost" onClick={() => { beforeNavigation(); onRefresh(); }}><RefreshCw aria-hidden="true" />刷新</Button>
          <Button size="sm" variant="outline" onClick={() => { beforeNavigation(); onOpenSource(); }}>
            <FileText aria-hidden="true" />确切原文
          </Button>
        </div>
      </header>
      {notices.length ? <div className="suite-document-graph-notices" role="status">
        {notices.map((notice: string, index: number) => <p key={`${index}:${notice}`}>{notice}</p>)}
      </div> : null}
      <div className="suite-document-graph-workspace">
        <section className="suite-document-graph-center" aria-label="文档关系邻域">
          <div className="suite-document-graph-toolbar">
            <div className="suite-document-graph-actions" aria-label="图谱显示">
              <Button size="sm" variant="ghost" aria-pressed={state.relationMode === 'individual'}
                onClick={() => updateState({ relationMode: state.relationMode === 'individual' ? 'aggregated' : 'individual', layoutSnapshot: undefined })}>
                {state.relationMode === 'individual' ? '逐条关系' : '聚合关系'}
              </Button>
              <Button size="sm" variant="ghost" aria-label="减少每组卡片" disabled={state.density === 1}
                onClick={() => updateState({ density: Math.max(1, state.density! - 1), layoutSnapshot: undefined })}>
                <Minus aria-hidden="true" />
              </Button>
              <span>每组 {state.density} 项</span>
              <Button size="sm" variant="ghost" aria-label="增加每组卡片" disabled={state.density === 6}
                onClick={() => updateState({ density: Math.min(6, state.density! + 1), layoutSnapshot: undefined })}>
                <Plus aria-hidden="true" />
              </Button>
              {state.hiddenGroups?.length ? <Button size="sm" variant="ghost"
                onClick={() => updateState({ hiddenGroups: [], page: 0, layoutSnapshot: undefined })}>全部分组</Button> : null}
            </div>
            <Button size="sm" variant="ghost" onClick={() => inspectorRef.current?.focus()}>查看所选详情</Button>
          </div>
          <div className="suite-document-graph-stage">
            <SuiteGraphCanvas ref={canvasRef} presentation={presentation} selectedId={readingState.selectedId}
              initialViewport={state.viewport} initialLayout={savedLayout} ariaLabel="文档关系邻域画布"
              onSelect={selectData} onInspectRelationships={inspectRelationships} onOverflow={openOverflow}
              onGroup={(key: string) => {
                setOverflow(null);
                updateState({ hiddenGroups: graph.groups.map((group: SuiteGraphGroup) => group.key)
                  .filter((groupKey: string) => groupKey !== key), page: 0, layoutSnapshot: undefined });
              }}
              onViewport={(viewport) => updateState({ viewport })} />
            <div className="suite-document-graph-camera" aria-label="画布控制">
              <Button size="sm" variant="outline" aria-label="缩小图谱" onClick={() => canvasRef.current?.zoomBy(0.8)}><Minus aria-hidden="true" /></Button>
              <Button size="sm" variant="outline" aria-label="放大图谱" onClick={() => canvasRef.current?.zoomBy(1.25)}><Plus aria-hidden="true" /></Button>
              <Button size="sm" variant="outline" aria-label="适应画布" onClick={() => canvasRef.current?.fit()}><Maximize2 aria-hidden="true" /></Button>
            </div>
            {graph.groups.every((group: SuiteGraphGroup) => !group.items.length)
              ? <p className="suite-document-graph-empty">当前授权范围尚无可显示的文档邻域。</p> : null}
          </div>
          <footer className="suite-document-graph-footer">
            <span>显示 {presentation.counts.shown.items} / {presentation.counts.loaded.items} 项 · {presentation.counts.represented.relationships} 条关系</span>
            {presentation.counts.page.pageCount > 1 ? <PageControls label="分组" page={presentation.counts.page.index}
              count={presentation.counts.page.pageCount} onChange={changePage} /> : null}
          </footer>
          {overflowGroup ? <div className="suite-document-graph-overflow" ref={overflowRef} tabIndex={-1}
            aria-label={`${overflowGroup.title}分页浏览`} onKeyDown={(event) => { if (event.key === 'Escape') closeOverflow(); }}>
            <div className="suite-document-graph-footer"><strong>{overflowGroup.title} · {overflowGroup.items.length} 项</strong>
              <Button size="sm" variant="ghost" onClick={closeOverflow}>收起分组</Button></div>
            <div className="suite-document-graph-overflow-items">
              {overflowItems.map((item: SuiteGraphItem) => <Button key={item.id} size="sm" variant="ghost"
                aria-pressed={readingState.selectedId === item.id} onClick={() => selectItem(item.id)}>
                <b>{item.title}</b>{item.subtitle ? <small>{item.subtitle}</small> : null}
              </Button>)}
            </div>
            <PageControls label="组内资料" page={overflowPage} count={overflowPageCount}
              onChange={(page: number) => setOverflow({ key: overflowGroup.key, page })} />
          </div> : null}
        </section>
        <aside className="suite-document-graph-inspector" aria-label="当前选择详情" ref={inspectorRef} tabIndex={-1}>
          <div className="suite-document-graph-inspector-head"><h2>资料详情</h2>
            <Button size="sm" variant="ghost" onClick={() => selectItem(graph.id)}>中心文档</Button>
          </div>
          <div className="suite-document-graph-inspector-body" onClickCapture={(event) => {
            // Supplied detail actions can navigate without going through our toolbar.
            // Capture also covers native keyboard activation and clicks on button icons.
            const target: Element = event.target as Element;
            if (target.closest?.('button, a[href], [role="button"]')) beforeNavigation();
          }}>
            {selectionOffCanvas ? <p className="suite-document-graph-selection-note" role="status">所选资料不在当前画布页，仍保留准确选择。</p> : null}
            {detail}
          </div>
        </aside>
      </div>
      <section className="suite-document-graph-timeline-section" aria-label="文档时间声明">
        <Button size="sm" variant="ghost" aria-expanded={timelineOpen} aria-controls={timelineId}
          className="suite-document-graph-timeline-toggle" onClick={() => {
            if (!timelineOpen) setTimelinePage(Math.floor(Math.max(0, timelineEvents
              .findIndex((event: SuiteGraphTimelineEvent) => event.id === state.eventId)) / TIMELINE_PAGE_SIZE));
            setTimelineOpen(!timelineOpen);
          }}>
          <ChevronDown aria-hidden="true" />文档时间声明 · {timelineEvents.length}{timelineLoading ? ' · 读取中' : ''}
        </Button>
        {timelineOpen ? <div id={timelineId} className="suite-document-graph-timeline-body">
          <SuiteGraphTimeline events={timelineEvents.slice(eventPage * TIMELINE_PAGE_SIZE, (eventPage + 1) * TIMELINE_PAGE_SIZE)}
            sources={timelineSources} selectedEventId={state.eventId ?? null} loading={timelineLoading}
            onSelectEvent={selectEvent} onExpandSource={onExpandTimelineSource}
            onOpenFullTimeline={(event: SuiteGraphTimelineEvent) => { beforeNavigation(); onOpenEventTimeline(event); }} />
          {timelinePageCount > 1 ? <PageControls label="时间声明" page={eventPage} count={timelinePageCount} onChange={setTimelinePage} /> : null}
        </div> : null}
      </section>
    </main>
  );
}
