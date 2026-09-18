import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Filter, Maximize2, Minus, Plus } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import type { SuiteMatterGraphRead, SuiteMatterGraphTarget, SuiteRelationDetail } from './suite-matter-graph';
import type { SuiteGraphMatter, SuiteGraphPresentation, SuiteGraphRelationMode } from './suite-graph-model';
import { buildSuiteGraphPresentation } from './suite-graph-presentation';
import SuiteGraphCanvas, { type SuiteGraphCanvasHandle } from './SuiteGraphCanvas';
import SuiteGraphTimeline from './SuiteGraphTimeline';
import SuiteGraphKnowledgePanel, { type SuiteGraphKnowledgeTab } from './SuiteGraphKnowledgePanel';
import type { SuiteGraphTimelineEvent, SuiteGraphTimelineSource } from './suite-graph-timeline';
import './suite-matter-graph-page.css';
import type { SuiteGraphReadingState } from './suite-graph-return';

export type SuiteMatterGraphPerspective = 'matter' | 'documents' | 'domain' | 'panorama';

export interface SuiteMatterGraphViewProps {
  read: SuiteMatterGraphRead;
  revision: EngineeringMatterWorkingRevisionReadModel | null;
  perspective?: SuiteMatterGraphPerspective;
  onPerspectiveChange?: (perspective: SuiteMatterGraphPerspective) => void;
  onLocateEvidence?: (evidence: DocumentAssessmentEvidence) => void;
  onOpenWiki?: () => void;
  onOpenProcess?: () => void;
  onOpenTarget?: (target: SuiteMatterGraphTarget) => void;
  timelineEvents?: SuiteGraphTimelineEvent[];
  timelineSources?: SuiteGraphTimelineSource[];
  timelineLoading?: boolean;
  onExpandTimelineSource?: (documentVersionId: string) => void;
  onOpenEventTimeline?: (event: SuiteGraphTimelineEvent) => void;
  onNodeSelect?: (target: SuiteMatterGraphTarget | null) => void;
  initialState?: SuiteGraphReadingState;
  onStateChange?: (state: SuiteGraphReadingState) => void;
  availablePerspectives?: SuiteMatterGraphPerspective[];
  perspectiveNotice?: string | null;
  perspectiveError?: boolean;
  onRetryPerspective?: () => void;
  nextDirectoryPage?: () => void;
  directoryLoading?: boolean;
}

const perspectives: Array<[SuiteMatterGraphPerspective, string]> = [
  ['matter', '事项图谱'],
  ['documents', '工程文档'],
  ['domain', '领域聚焦'],
  ['panorama', '全景目录'],
];

const PREMISE_ROLE_LABELS: Record<string, string> = {
  SUPPORTS: '支持',
  LIMITS: '限定',
  CONTEXT: '背景',
  CONFLICTS: '冲突',
};

export default function SuiteMatterGraphView({
  read,
  revision,
  perspective: controlledPerspective,
  onPerspectiveChange,
  onLocateEvidence,
  onOpenWiki,
  onOpenProcess,
  onOpenTarget,
  timelineEvents = [],
  timelineSources = [],
  timelineLoading = false,
  onExpandTimelineSource,
  onOpenEventTimeline,
  onNodeSelect,
  initialState,
  onStateChange,
  availablePerspectives = ['matter'],
  perspectiveNotice, perspectiveError, onRetryPerspective, nextDirectoryPage, directoryLoading,
}: SuiteMatterGraphViewProps) {
  const [localPerspective, setLocalPerspective] = useState<SuiteMatterGraphPerspective>(() => initialState?.perspective ?? 'matter');
  const perspective = controlledPerspective ?? localPerspective;
  const [hiddenGroups, setHiddenGroups] = useState<string[]>(() => initialState?.hiddenGroups ?? []);
  const [relationMode, setRelationMode] = useState<SuiteGraphRelationMode>(() => initialState?.relationMode ?? 'aggregated');
  const [density, setDensity] = useState(() => initialState?.density ?? 4);
  const [page, setPage] = useState(() => initialState?.page ?? 0);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialState?.selectedId ?? null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(() => initialState?.eventId ?? null);
  const [wikiTab, setWikiTab] = useState<SuiteGraphKnowledgeTab>(() => initialState?.wikiTab ?? 'knowledge');
  const [viewport, setViewport] = useState(initialState?.viewport);
  const [mobilePanel, setMobilePanel] = useState<'graph' | 'timeline' | 'wiki'>('graph');
  const [focusedGroupKey, setFocusedGroupKey] = useState<string | null>(null);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [relationshipIds, setRelationshipIds] = useState<string[]>([]);
  const canvasRef = useRef<SuiteGraphCanvasHandle | null>(null);
  const viewportByPerspective = useRef(new Map<string, { zoom: number; pan: { x: number; y: number } }>(initialState?.viewport ? [[perspective, initialState.viewport]] : []));
  const graph: SuiteGraphMatter = useMemo(() => read.graph, [read.graph]);
  const effectiveHiddenGroups = useMemo(() => focusedGroupKey
    ? graph.groups.map((group) => group.key).filter((key) => key !== focusedGroupKey)
    : hiddenGroups, [focusedGroupKey, graph, hiddenGroups]);
  const presentation: SuiteGraphPresentation = useMemo(() => buildSuiteGraphPresentation(graph, {
    hiddenGroups: effectiveHiddenGroups,
    relationMode,
    density,
    page,
    maxGroups: 6,
  }), [density, effectiveHiddenGroups, graph, page, relationMode]);
  const selectedTarget = selectedId ? read.targets.get(selectedId) ?? null : null;
  const selectedEvent = useMemo(
    () => (selectedEventId ? timelineEvents.find((event) => event.id === selectedEventId) ?? null : null),
    [selectedEventId, timelineEvents],
  );
  const selectedEventHidden = Boolean(
    selectedEvent?.nodeId && !presentation.visibleItemIds.includes(selectedEvent.nodeId),
  );
  const setPerspective = (next: SuiteMatterGraphPerspective) => {
    setPage(0); setSelectedId(null); setSelectedEventId(null); setHiddenGroups([]); setRelationshipIds([]); setFocusedGroupKey(null); setExpandedGroupKey(null); setViewport(viewportByPerspective.current.get(next));
    if (onPerspectiveChange) onPerspectiveChange(next); else setLocalPerspective(next);
  };
  useEffect(() => {
    setViewport(viewportByPerspective.current.get(perspective));
  }, [perspective]);
  const handleViewport = (next: { zoom: number; pan: { x: number; y: number } }) => {
    viewportByPerspective.current.set(perspective, next);
    setViewport(next);
  };
  const selectData = (data: Record<string, unknown>, isEdge: boolean) => {
    if (isEdge) return;
    const id = typeof data.businessId === 'string' ? data.businessId : null;
    const target = id ? read.targets.get(id) ?? null : null;
    setSelectedId(id);
    setSelectedEventId(null);
    onNodeSelect?.(target);
  };
  const selectEvent = (event: SuiteGraphTimelineEvent) => {
    setSelectedEventId(event.id);
    setSelectedId(event.nodeId);
    onNodeSelect?.(event.nodeId ? read.targets.get(event.nodeId) ?? null : null);
  };
  const revealSelectedEventGroup = () => {
    setFocusedGroupKey(null);
    setHiddenGroups([]);
    setPage(0);
  };
  const selectedRelationDetails = relationshipIds.map((id) => read.relationDetails.get(id)).filter((detail): detail is NonNullable<typeof detail> => Boolean(detail));
  useEffect(() => {
    onStateChange?.({
      selectedId: selectedId ?? undefined,
      hiddenGroups: effectiveHiddenGroups,
      page,
      density,
      relationMode,
      perspective,
      viewport: viewportByPerspective.current.get(perspective),
      eventId: selectedEventId ?? undefined,
      wikiTab,
    });
  }, [density, effectiveHiddenGroups, onStateChange, page, perspective, relationMode, selectedId, selectedEventId, viewport, wikiTab]);
  const relationDetailText = (detail: SuiteRelationDetail): string => {
    if ('kind' in detail) {
      if (detail.kind === 'FULFILLED_BY') return `取得范围：${detail.target.scope || '未注明'}；资料版本：${detail.target.documentVersionId}；材料身份：${detail.material.materialId}`;
      if (detail.kind === 'CATALOG') return `目录登记：${detail.entry.document.documentCode} · ${detail.entry.document.businessRevision}（${detail.entry.relationRole === 'PRIMARY' ? '主要资料' : '关联资料'}）；版本身份：${detail.entry.document.documentVersionId}`;
      if (detail.kind === 'STATEMENT') return `资料声明：${detail.statement.label}；时间表述：${detail.statement.time?.raw ?? '未提取'}；保存身份：${detail.parseRunId} · 候选修订 ${detail.candidateRevision}`;
      if (detail.kind === 'ATA_CLASSIFICATION') return `ATA 标注（资料标注 · 待核）：${detail.value}；元数据状态：${detail.status}。标注不构成正式适用或系统归属。`;
      if (detail.kind === 'DIRECTORY_MEMBERSHIP') return `授权目录登记事项：${detail.matterId}`;
      return `${detail.kind === 'EXPECTED' ? '预计资料' : detail.kind === 'MEMBER' ? '事项资料' : '参考资料'}：范围 ${detail.scope || '未注明'}；贡献 ${detail.contribution || '未注明'}；依据 ${detail.basis.map((item) => `${item.documentVersionId}/${item.sourceRefId}`).join('、') || '未返回'}`;
    }
    if ('role' in detail) return `前提${PREMISE_ROLE_LABELS[detail.role] ?? detail.role}：${detail.explanation}${detail.limitation ? `；限制：${detail.limitation}` : ''}；依据：${detail.evidenceRef}`;
    return '关系已保存，但当前授权范围未返回可读明细。';
  };
  const groupKeys = graph.groups.map((group) => group.key);
  const connected = availablePerspectives.includes(perspective);
  return (
    <main className="suite-matter-graph-page">
      <header className="suite-graph-page-heading">
        <div><span className="suite-graph-eyebrow">RELATION GRAPH</span><h1>{perspective === 'panorama' ? '工程资料全景' : graph.title}</h1><p>图谱边只表达已登记对象关系，分组与距离不推断归属、风险或因果。</p></div>
        <div className="suite-graph-perspectives" role="tablist" aria-label="图谱视角">{perspectives.map(([id, label]) => <Button key={id} variant={perspective === id ? 'default' : 'outline'} size="sm" onClick={() => setPerspective(id)}>{label}</Button>)}</div>
      </header>
      <div className="suite-graph-toolbar"><div><span>关系显示</span><Button size="sm" variant={relationMode === 'aggregated' ? 'default' : 'outline'} onClick={() => setRelationMode('aggregated')}>聚合</Button><Button size="sm" variant={relationMode === 'individual' ? 'default' : 'outline'} onClick={() => setRelationMode('individual')}>逐条</Button></div><div><span>卡片密度</span><Button size="sm" variant="outline" onClick={() => setDensity((value) => Math.max(1, value - 1))}><Minus /></Button><strong>{density}</strong><Button size="sm" variant="outline" onClick={() => setDensity((value) => Math.min(6, value + 1))}><Plus /></Button></div><div className="suite-graph-group-filters"><span>分组</span><Button size="sm" variant={!focusedGroupKey ? 'default' : 'outline'} onClick={() => { setFocusedGroupKey(null); setPage(0); }}>全部</Button>{graph.groups.map((group) => <Button key={group.key} size="sm" variant={focusedGroupKey === group.key ? 'default' : 'outline'} onClick={() => { setFocusedGroupKey(group.key); setExpandedGroupKey(null); setPage(0); }}>{group.title}</Button>)}</div><Button size="sm" variant="outline" onClick={() => { setHiddenGroups(hiddenGroups.length ? [] : groupKeys); setFocusedGroupKey(null); }}><Filter /> {hiddenGroups.length ? '显示全部分组' : '隐藏分组'}</Button></div>
      <div className="suite-graph-mobile-switch" role="tablist" aria-label="手机活动面板"><Button size="sm" variant={mobilePanel === 'graph' ? 'default' : 'outline'} aria-pressed={mobilePanel === 'graph'} onClick={() => setMobilePanel('graph')}>图谱</Button><Button size="sm" variant={mobilePanel === 'timeline' ? 'default' : 'outline'} aria-pressed={mobilePanel === 'timeline'} onClick={() => setMobilePanel('timeline')}>时间线</Button><Button size="sm" variant={mobilePanel === 'wiki' ? 'default' : 'outline'} aria-pressed={mobilePanel === 'wiki'} onClick={() => setMobilePanel('wiki')}>知识</Button></div>
      <div className="suite-graph-layout" data-mobile-panel={mobilePanel}>
        <aside className="suite-graph-work-panel" aria-label="工程时间线">
          <div className="suite-graph-panel-head"><h2>工程时间线</h2><span>{timelineEvents.length} 条事件</span></div>
          <p className="suite-graph-muted">已保存来源声明与保存工作按各自身份列出，不合并推断为统一工程事件。</p>
          <SuiteGraphTimeline
            events={timelineEvents}
            sources={timelineSources}
            selectedEventId={selectedEventId}
            loading={timelineLoading}
            onSelectEvent={selectEvent}
            onOpenFullTimeline={(event) => onOpenEventTimeline?.(event)}
            onExpandSource={(documentVersionId) => onExpandTimelineSource?.(documentVersionId)}
          />
          {revision ? <details className="suite-graph-work-details"><summary>当前保存工作</summary><p className="suite-graph-date">{revision.createdAt}</p><p className="suite-graph-change">{revision.changeSummary}</p>{read.notices.map((notice) => <p className="suite-graph-notice" key={notice}>{notice}</p>)}<div className="suite-graph-work-facts"><span>工作修订</span><b>{revision.workingRevision}</b><span>已保存输入</span><b>{revision.state.substantiveInputs.length}</b><span>未决/复看</span><b>{revision.state.openQuestions.length + revision.state.reviewConditions.length}</b></div></details> : null}
          <Button variant="outline" onClick={() => onOpenWiki?.()}>阅读事项 Wiki <ArrowRight /></Button>
        </aside>
        <section className="suite-graph-center-panel" aria-label="关系图谱">{perspectiveNotice ? <div role={perspectiveError ? 'alert' : 'status'} className="suite-graph-notice">{perspectiveNotice}{perspectiveError ? <Button onClick={onRetryPerspective}>重试该视角</Button> : null}</div> : null}{nextDirectoryPage ? <Button disabled={directoryLoading} onClick={nextDirectoryPage}>{directoryLoading ? '正在读取下一批…' : '加载更多授权目录'}</Button> : null}<div className="suite-graph-canvas-head"><span>{connected ? `${presentation.counts.shown.groups} 个分组 · ${presentation.counts.shown.items} 个可见对象 · ${presentation.counts.represented.relationships} 条已表达关系` : '该视角尚未接入真实读取'}</span><div>{connected ? <><Button size="icon" variant="ghost" aria-label="缩小" onClick={() => canvasRef.current?.zoomBy(.85)}><Minus /></Button><Button size="icon" variant="ghost" aria-label="放大" onClick={() => canvasRef.current?.zoomBy(1.18)}><Plus /></Button><Button size="icon" variant="ghost" aria-label="适应画布" onClick={() => canvasRef.current?.fit()}><Maximize2 /></Button></> : null}</div></div>{!connected ? <div className="suite-graph-unconnected"><strong>{perspectives.find(([id]) => id === perspective)?.[1]}尚未接通</strong><p>当前读取只提供事项图谱，未提供该视角的真实数据；不以当前事项图替代。</p></div> : <><SuiteGraphCanvas key={perspective} ref={canvasRef} presentation={presentation} initialViewport={viewportByPerspective.current.get(perspective)} selectedId={selectedId ?? undefined} focusGroupKey={focusedGroupKey} onSelect={selectData} onGroup={(key) => { setFocusedGroupKey(key); setExpandedGroupKey(null); setPage(0); }} onOverflow={(key) => setExpandedGroupKey(key)} onInspectRelationships={setRelationshipIds} onViewport={handleViewport} ariaLabel="工程事项关系图谱" />{selectedEventHidden ? <div className="suite-graph-selection-hidden" role="status"><span>所选声明的节点当前被分组过滤隐藏，未映射到其他节点。</span><Button size="sm" variant="outline" onClick={revealSelectedEventGroup}>显示全部关系</Button></div> : null}{expandedGroupKey ? <section className="suite-graph-overflow-list" aria-label="分组全部对象"><div><strong>{graph.groups.find((group) => group.key === expandedGroupKey)?.title ?? expandedGroupKey} · 全部对象</strong><Button size="sm" variant="ghost" onClick={() => setExpandedGroupKey(null)}>收起</Button></div>{graph.groups.find((group) => group.key === expandedGroupKey)?.items.map((item) => <button type="button" key={item.id} onClick={() => { setSelectedId(item.id); setSelectedEventId(null); onNodeSelect?.(read.targets.get(item.id) ?? null); }}><b>{item.title}</b><small>{item.subtitle || '已登记对象'}</small></button>)}</section> : null}{relationshipIds.length ? <section className="suite-graph-relation-details" aria-label="关系明细"><div><strong>关系依据</strong><Button size="sm" variant="ghost" onClick={() => setRelationshipIds([])}>关闭</Button></div>{selectedRelationDetails.length ? selectedRelationDetails.map((detail, index) => <p key={index}>{relationDetailText(detail)}</p>) : <p>已选关系的明细未在当前授权范围返回。</p>}</section> : null}</>}{connected ? <div className="suite-graph-reading-thread" aria-label="当前阅读线索"><span>当前阅读线索</span><div><b>{graph.title}</b>{selectedEvent ? <><ChevronRight size={12} /><b>{selectedEvent.statement?.label ?? selectedEvent.title}</b></> : null}<ChevronRight size={12} /><Button size="sm" variant="ghost" onClick={() => onOpenProcess?.()}>完整问题分析</Button></div><Button size="sm" variant="outline" onClick={() => { setHiddenGroups([]); setFocusedGroupKey(null); }}>核对全部关系</Button></div> : null}<footer className="suite-graph-canvas-footer"><span>{perspectiveNotice ? '该视角数据尚未就绪' : connected ? (presentation.overflow.hasMore ? `还可展开 ${presentation.overflow.omittedGroupKeys.length} 个分组` : '已显示当前授权范围分组') : '无可见数据'}</span><div><Button size="sm" variant="ghost" disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft />上一页</Button><span>{presentation.counts.page.index + 1} / {presentation.counts.page.pageCount}</span><Button size="sm" variant="ghost" disabled={!presentation.overflow.hasMore} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight /></Button></div></footer></section>
        <aside className="suite-graph-knowledge-panel" aria-label="已保存知识">
          <SuiteGraphKnowledgePanel
            read={read}
            revision={revision}
            selectedTarget={selectedTarget}
            selectedEvent={selectedEvent}
            tab={wikiTab}
            onTabChange={setWikiTab}
            onLocateEvidence={onLocateEvidence}
            onOpenTarget={onOpenTarget}
            onOpenWiki={onOpenWiki}
          />
        </aside>
      </div>
    </main>
  );
}
