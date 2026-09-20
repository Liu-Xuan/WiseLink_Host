import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Filter,
  Minus,
  Network,
  Plus,
  RotateCcw,
} from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';

import type {
  SuiteMatterGraphRead,
  SuiteMatterGraphTarget,
  SuiteRelationDetail,
} from './suite-matter-graph';
import type {
  SuiteGraphMatter,
  SuiteGraphPresentation,
  SuiteGraphRelation,
  SuiteGraphRelationMode,
} from './suite-graph-model';
import { buildSuiteGraphPresentation } from './suite-graph-presentation';
import type { SuiteGraphReadingState } from './suite-graph-return';
import type {
  SuiteGraphTimelineEvent,
  SuiteGraphTimelineSource,
} from './suite-graph-timeline';
import SuiteGraphCanvas, { type SuiteGraphCanvasHandle } from './SuiteGraphCanvas';
import SuiteGraphKnowledgePanel, {
  type SuiteGraphKnowledgeTab,
} from './SuiteGraphKnowledgePanel';
import SuiteGraphTimeline from './SuiteGraphTimeline';
import './suite-matter-graph-page.css';

export type SuiteMatterGraphPerspective =
  | 'matter'
  | 'documents'
  | 'domain'
  | 'panorama';

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

const PERSPECTIVES: Array<[SuiteMatterGraphPerspective, string]> = [
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

const VIEWPORT_DEFAULT = { zoom: 1, pan: { x: 0, y: 0 } };

function findPrimaryCatalogDocument(
  targets: ReadonlyMap<string, SuiteMatterGraphTarget>,
): SuiteMatterGraphTarget | null {
  for (const target of targets.values()) {
    if (
      target.kind === 'catalog-document'
      && target.entry.relationRole === 'PRIMARY'
    ) {
      return target;
    }
  }
  return null;
}

function relationDetailText(detail: SuiteRelationDetail): string {
  if ('kind' in detail) {
    if (detail.kind === 'FULFILLED_BY') {
      return `取得范围：${detail.target.scope || '未注明'}；资料版本：${detail.target.documentVersionId}；材料身份：${detail.material.materialId}`;
    }
    if (detail.kind === 'CATALOG') {
      const role = detail.entry.relationRole === 'PRIMARY' ? '主要资料' : '关联资料';
      return `目录登记：${detail.entry.document.documentCode} · ${detail.entry.document.businessRevision}（${role}）；版本身份：${detail.entry.document.documentVersionId}`;
    }
    if (detail.kind === 'STATEMENT') {
      const time = detail.statement.time?.raw ?? '未提取';
      return `资料声明：${detail.statement.label}；时间表述：${time}；保存身份：${detail.parseRunId} · 候选修订 ${detail.candidateRevision}`;
    }
    if (detail.kind === 'ATA_CLASSIFICATION') {
      return `ATA 标注（资料标注 · 待核）：${detail.value}；元数据状态：${detail.status}。标注不构成正式适用或系统归属。`;
    }
    if (detail.kind === 'DIRECTORY_MEMBERSHIP') {
      return `授权目录登记事项：${detail.matterId}`;
    }
    const kind = detail.kind === 'EXPECTED'
      ? '预计资料'
      : detail.kind === 'MEMBER' ? '事项资料' : '参考资料';
    const basis = detail.basis
      .map((item) => `${item.documentVersionId}/${item.sourceRefId}`)
      .join('、') || '未返回';
    return `${kind}：范围 ${detail.scope || '未注明'}；贡献 ${detail.contribution || '未注明'}；依据 ${basis}`;
  }
  if ('role' in detail) {
    const limitation = detail.limitation ? `；限制：${detail.limitation}` : '';
    return `前提${PREMISE_ROLE_LABELS[detail.role] ?? detail.role}：${detail.explanation}${limitation}；依据：${detail.evidenceRef}`;
  }
  return '关系已保存，但当前授权范围未返回可读明细。';
}

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
  perspectiveNotice,
  perspectiveError,
  onRetryPerspective,
  nextDirectoryPage,
  directoryLoading,
}: SuiteMatterGraphViewProps) {
  const [localPerspective, setLocalPerspective] =
    useState<SuiteMatterGraphPerspective>(
      () => initialState?.perspective ?? 'matter',
    );
  const perspective = controlledPerspective ?? localPerspective;
  const [hiddenGroups, setHiddenGroups] = useState<string[]>(
    () => initialState?.hiddenGroups ?? [],
  );
  const [relationMode, setRelationMode] = useState<SuiteGraphRelationMode>(
    () => initialState?.relationMode ?? 'aggregated',
  );
  const [density, setDensity] = useState<number>(
    () => initialState?.density ?? 4,
  );
  const [page, setPage] = useState<number>(() => initialState?.page ?? 0);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => initialState?.selectedId ?? null,
  );
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    () => initialState?.eventId ?? null,
  );
  const [wikiTab, setWikiTab] = useState<SuiteGraphKnowledgeTab>(
    () => initialState?.wikiTab ?? 'knowledge',
  );
  const [viewport, setViewport] = useState(initialState?.viewport);
  const [mobilePanel, setMobilePanel] =
    useState<'graph' | 'timeline' | 'wiki'>('graph');
  const [focusedGroupKey, setFocusedGroupKey] = useState<string | null>(null);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [relationshipIds, setRelationshipIds] = useState<string[]>([]);
  const [relationshipDialogOpen, setRelationshipDialogOpen] =
    useState<boolean>(false);
  const [filterOpen, setFilterOpen] = useState<boolean>(false);
  const canvasRef = useRef<SuiteGraphCanvasHandle | null>(null);
  const relationshipReturnFocusRef = useRef<HTMLElement | null>(null);
  const viewportByPerspective = useRef(
    new Map<string, { zoom: number; pan: { x: number; y: number } }>(
      initialState?.viewport ? [[perspective, initialState.viewport]] : [],
    ),
  );

  const graph: SuiteGraphMatter = useMemo(() => read.graph, [read.graph]);
  const effectiveHiddenGroups = useMemo(
    () => focusedGroupKey
      ? graph.groups
        .map((group) => group.key)
        .filter((key) => key !== focusedGroupKey)
      : hiddenGroups,
    [focusedGroupKey, graph, hiddenGroups],
  );
  const presentation: SuiteGraphPresentation = useMemo(
    () => buildSuiteGraphPresentation(graph, {
      hiddenGroups: effectiveHiddenGroups,
      relationMode,
      density,
      page,
      maxGroups: 6,
    }),
    [density, effectiveHiddenGroups, graph, page, relationMode],
  );
  const selectedTarget = selectedId ? read.targets.get(selectedId) ?? null : null;
  const selectedEvent = useMemo(
    () => selectedEventId
      ? timelineEvents.find((event) => event.id === selectedEventId) ?? null
      : null,
    [selectedEventId, timelineEvents],
  );
  const selectedEventHidden = Boolean(
    selectedEvent?.nodeId
    && !presentation.visibleItemIds.includes(selectedEvent.nodeId),
  );
  const primaryDocumentTarget = useMemo(
    () => findPrimaryCatalogDocument(read.targets),
    [read.targets],
  );
  const selectedRelations: SuiteGraphRelation[] = relationshipIds
    .map((id) => graph.relations.find((relation) => relation.id === id))
    .filter((relation): relation is SuiteGraphRelation => Boolean(relation));
  const connected = availablePerspectives.includes(perspective);
  const title = perspective === 'panorama' ? '工程资料全景' : graph.title;
  const overviewLabel = read.overviewStatus === 'CURRENT'
    ? '当前综合已覆盖'
    : read.overviewStatus === 'STALE'
      ? '综合待覆盖变化'
      : read.overviewStatus === 'NOT_AVAILABLE' ? '尚无当前综合' : null;

  useEffect(() => {
    setViewport(viewportByPerspective.current.get(perspective));
  }, [perspective]);

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
      eventPins: selectedEvent?.pins
        ?? (selectedEventId === initialState?.eventId
          ? initialState.eventPins
          : undefined),
      wikiTab,
    });
  }, [
    density,
    effectiveHiddenGroups,
    onStateChange,
    page,
    perspective,
    relationMode,
    selectedEventId,
    selectedEvent,
    selectedId,
    viewport,
    wikiTab,
  ]);

  const setPerspective = (next: SuiteMatterGraphPerspective) => {
    setPage(0);
    setSelectedId(null);
    setSelectedEventId(null);
    setHiddenGroups([]);
    setRelationshipIds([]);
    setFocusedGroupKey(null);
    setExpandedGroupKey(null);
    setViewport(viewportByPerspective.current.get(next));
    if (onPerspectiveChange) onPerspectiveChange(next);
    else setLocalPerspective(next);
  };

  const handleViewport = (
    next: { zoom: number; pan: { x: number; y: number } },
  ) => {
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
    onNodeSelect?.(
      event.nodeId ? read.targets.get(event.nodeId) ?? null : null,
    );
  };

  const clearSelection = () => {
    setSelectedId(null);
    setSelectedEventId(null);
    onNodeSelect?.(null);
  };

  const revealSelectedEventGroup = () => {
    setFocusedGroupKey(null);
    setHiddenGroups([]);
    setPage(0);
  };

  const toggleGroup = (groupKey: string, visible: boolean) => {
    setFocusedGroupKey(null);
    setPage(0);
    setHiddenGroups((current) => {
      if (visible) return current.filter((key) => key !== groupKey);
      return current.includes(groupKey) ? current : [...current, groupKey];
    });
  };

  const nodeTitle = (id: string): string => {
    if (id === graph.id) return graph.title;
    for (const group of graph.groups) {
      const item = group.items.find((candidate) => candidate.id === id);
      if (item) return item.title;
    }
    return id;
  };

  const openRelationships = (ids: string[]) => {
    relationshipReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setRelationshipIds(ids);
    setRelationshipDialogOpen(true);
  };

  return (
    <main className="suite-matter-graph-page">
      <div className="suite-graph-viewbar">
        <div className="suite-graph-perspectives" role="tablist" aria-label="图谱视角">
          {PERSPECTIVES.map(([id, label]) => (
            <Button
              key={id}
              variant="outline"
              size="sm"
              aria-pressed={perspective === id}
              className={perspective === id ? 'is-active' : ''}
              onClick={() => setPerspective(id)}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => setFilterOpen(true)}>
          <Filter aria-hidden="true" /> 筛选
        </Button>
      </div>

      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent className="suite-graph-filter-dialog">
          <DialogHeader className="suite-graph-filter-dialog-heading">
            <DialogTitle>图谱显示设置</DialogTitle>
            <DialogDescription>只改变当前画布显示，不更改工程资料、关系或保存工作。</DialogDescription>
          </DialogHeader>
          <section>
            <h3>显示分组</h3>
            <div className="suite-graph-filter-options">
              {graph.groups.map((group) => {
                const visible = !effectiveHiddenGroups.includes(group.key);
                return (
                  <label key={group.key}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={visible}
                      className="suite-graph-filter-checkbox"
                      onClick={() => toggleGroup(group.key, !visible)}
                    >
                      {visible ? '✓' : ''}
                    </button>
                    <span>{group.title}</span>
                    <small>{group.items.length}</small>
                  </label>
                );
              })}
            </div>
          </section>
          <section className="suite-graph-filter-density">
            <div>
              <h3>每组卡片</h3>
              <p>当前最多显示 {density} 项，超出内容仍可完整展开。</p>
            </div>
            <div>
              <Button
                size="icon"
                variant="outline"
                aria-label="减少每组卡片"
                onClick={() => setDensity((value) => Math.max(1, value - 1))}
              >
                <Minus />
              </Button>
              <strong>{density}</strong>
              <Button
                size="icon"
                variant="outline"
                aria-label="增加每组卡片"
                onClick={() => setDensity((value) => Math.min(6, value + 1))}
              >
                <Plus />
              </Button>
            </div>
          </section>
          <Button
            variant="outline"
            onClick={() => {
              setHiddenGroups([]);
              setFocusedGroupKey(null);
              setPage(0);
            }}
          >
            恢复全部分组
          </Button>
        </DialogContent>
      </Dialog>

      <div className="suite-graph-mobile-switch" role="tablist" aria-label="活动面板">
        <Button size="sm" variant={mobilePanel === 'graph' ? 'default' : 'outline'} aria-pressed={mobilePanel === 'graph'} onClick={() => setMobilePanel('graph')}>图谱</Button>
        <Button size="sm" variant={mobilePanel === 'timeline' ? 'default' : 'outline'} aria-pressed={mobilePanel === 'timeline'} onClick={() => setMobilePanel('timeline')}>时间线</Button>
        <Button size="sm" variant={mobilePanel === 'wiki' ? 'default' : 'outline'} aria-pressed={mobilePanel === 'wiki'} onClick={() => setMobilePanel('wiki')}>知识</Button>
      </div>

      <div className="suite-graph-layout" data-mobile-panel={mobilePanel}>
        <aside className="suite-graph-work-panel" aria-label="工程时间线">
          <div className="suite-graph-panel-head">
            <h2>工程时间线</h2><span>{timelineEvents.length}</span>
          </div>
          <div className="suite-graph-panel-scroll">
            <SuiteGraphTimeline
              events={timelineEvents}
              sources={timelineSources}
              selectedEventId={selectedEventId}
              loading={timelineLoading}
              onSelectEvent={selectEvent}
              onOpenFullTimeline={(event) => onOpenEventTimeline?.(event)}
              onExpandSource={(documentVersionId) => {
                onExpandTimelineSource?.(documentVersionId);
              }}
            />
            {revision ? (
              <details className="suite-graph-work-details">
                <summary>当前保存工作</summary>
                <p className="suite-graph-date">{revision.createdAt}</p>
                <p className="suite-graph-change">{revision.changeSummary}</p>
                {read.notices.map((notice) => (
                  <p className="suite-graph-notice" key={notice}>{notice}</p>
                ))}
                <div className="suite-graph-work-facts">
                  <span>工作修订</span><b>{revision.workingRevision}</b>
                  <span>已保存输入</span><b>{revision.state.substantiveInputs.length}</b>
                  <span>未决/复看</span>
                  <b>{revision.state.openQuestions.length + revision.state.reviewConditions.length}</b>
                </div>
              </details>
            ) : null}
          </div>
          <div className="suite-graph-panel-bottom">
            <Button
              variant="outline"
              disabled={!selectedEvent || (selectedEvent.kind === 'source' ? !selectedEvent.pins || !onOpenEventTimeline : !onOpenWiki)}
              onClick={() => {
                if (!selectedEvent) return;
                if (selectedEvent.pins) onOpenEventTimeline?.(selectedEvent);
                else onOpenWiki?.();
              }}
            >
              {!selectedEvent ? '选择时间节点' : selectedEvent.pins ? '展开完整历程' : '查看保存工作'} <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </aside>

        <section className="suite-graph-center-panel" aria-label="关系图谱">
          <header className="suite-graph-center-head">
            <h1>{title}</h1>
            <div>
              {graph.code ? <span>{graph.code}</span> : null}
              {revision ? <span>工作修订 {revision.workingRevision}</span> : null}
              {overviewLabel ? <span>{overviewLabel}</span> : null}
            </div>
          </header>

          {perspectiveNotice ? (
            <div
              role={perspectiveError ? 'alert' : 'status'}
              className="suite-graph-notice suite-graph-perspective-notice"
            >
              {perspectiveNotice}
              {perspectiveError ? <Button onClick={onRetryPerspective}>重试该视角</Button> : null}
            </div>
          ) : null}
          {nextDirectoryPage ? (
            <Button disabled={directoryLoading} onClick={nextDirectoryPage}>
              {directoryLoading ? '正在读取下一批…' : '加载更多授权目录'}
            </Button>
          ) : null}

          {!connected ? (
            <div className="suite-graph-unconnected">
              <strong>{PERSPECTIVES.find(([id]) => id === perspective)?.[1]}尚未接通</strong>
              <p>当前读取未提供该视角的真实数据；不以当前事项图替代。</p>
            </div>
          ) : (
            <div className="suite-graph-stage">
              <SuiteGraphCanvas
                key={perspective}
                ref={canvasRef}
                presentation={presentation}
                initialViewport={viewportByPerspective.current.get(perspective)}
                selectedId={selectedId ?? undefined}
                focusGroupKey={focusedGroupKey}
                onSelect={selectData}
                onGroup={(key) => {
                  setExpandedGroupKey(key);
                  setRelationshipIds([]);
                  setRelationshipDialogOpen(false);
                }}
                onOverflow={(key) => setExpandedGroupKey(key)}
                onInspectRelationships={(ids) => {
                  openRelationships(ids);
                }}
                onViewport={handleViewport}
                ariaLabel="工程事项关系图谱"
              />
              <div className="suite-graph-canvas-tools" aria-label="图谱画布控制">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={relationMode === 'individual'}
                  onClick={() => setRelationMode((mode) => (
                    mode === 'aggregated' ? 'individual' : 'aggregated'
                  ))}
                >
                  {relationMode === 'aggregated' ? '聚合' : '逐条'}
                </Button>
                <Button size="icon" variant="ghost" aria-label="缩小" onClick={() => canvasRef.current?.zoomBy(.88)}><Minus /></Button>
                <Button size="sm" variant="ghost" aria-label="适应画布" onClick={() => canvasRef.current?.fit()}>{Math.round((viewport ?? VIEWPORT_DEFAULT).zoom * 100)}%</Button>
                <Button size="icon" variant="ghost" aria-label="放大" onClick={() => canvasRef.current?.zoomBy(1.14)}><Plus /></Button>
                <Button size="icon" variant="ghost" aria-label="重置图谱布局" onClick={() => canvasRef.current?.reset()}><RotateCcw /></Button>
              </div>
              <div className="suite-graph-canvas-status">
                {presentation.counts.shown.items} 个可见对象 · {presentation.counts.represented.relationships} 条已表达关系
              </div>

              {selectedEventHidden ? (
                <div className="suite-graph-selection-hidden" role="status">
                  <span>所选声明的节点当前被分组过滤隐藏，未映射到其他节点。</span>
                  <Button size="sm" variant="outline" onClick={revealSelectedEventGroup}>显示全部关系</Button>
                </div>
              ) : null}

              {expandedGroupKey ? (
                <section className="suite-graph-overflow-list" aria-label="分组全部对象">
                  <div>
                    <strong>{graph.groups.find((group) => group.key === expandedGroupKey)?.title ?? expandedGroupKey} · 全部对象</strong>
                    <Button size="sm" variant="ghost" onClick={() => setExpandedGroupKey(null)}>收起</Button>
                  </div>
                  {graph.groups.find((group) => group.key === expandedGroupKey)?.items.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        setSelectedId(item.id);
                        setSelectedEventId(null);
                        onNodeSelect?.(read.targets.get(item.id) ?? null);
                        setExpandedGroupKey(null);
                      }}
                    >
                      <b>{item.title}</b>
                      <small>{item.subtitle || '已登记对象'}</small>
                    </button>
                  ))}
                </section>
              ) : null}

            </div>
          )}

          {connected ? (
            <div className="suite-graph-reading-thread" aria-label="当前阅读线索">
              <div className="suite-graph-reading-title">
                <Network aria-hidden="true" />
                <strong>{selectedEvent ? '所选时间节点' : '当前阅读线索'}</strong>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    openRelationships(graph.relations.map((relation) => relation.id));
                  }}
                >
                  核对全部关系
                </Button>
              </div>
              <div className="suite-graph-reading-path">
                {onOpenWiki ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onOpenWiki}
                    aria-label={`打开事项 Wiki：${graph.title}`}
                  >
                    {graph.title}
                  </Button>
                ) : <b>{graph.title}</b>}
                {selectedEvent ? (
                  <><ChevronRight size={12} /><b>{selectedEvent.statement?.label ?? selectedEvent.title}</b></>
                ) : null}
                {onOpenTarget && primaryDocumentTarget ? (
                  <>
                    <ChevronRight size={12} />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onOpenTarget(primaryDocumentTarget)}
                    >
                      确切原文
                    </Button>
                  </>
                ) : null}
                {onOpenProcess ? (
                  <><ChevronRight size={12} /><Button size="sm" variant="ghost" onClick={onOpenProcess}>完整问题分析</Button></>
                ) : null}
              </div>
            </div>
          ) : null}

          {presentation.counts.page.pageCount > 1 ? (
            <footer className="suite-graph-canvas-footer">
              <span>{presentation.overflow.hasMore ? `还可展开 ${presentation.overflow.omittedGroupKeys.length} 个分组` : '已显示当前授权范围分组'}</span>
              <div>
                <Button size="sm" variant="ghost" disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft />上一页</Button>
                <span>{presentation.counts.page.index + 1} / {presentation.counts.page.pageCount}</span>
                <Button size="sm" variant="ghost" disabled={!presentation.overflow.hasMore} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight /></Button>
              </div>
            </footer>
          ) : null}
        </section>

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
            onClearSelection={clearSelection}
          />
        </aside>
      </div>

      <Dialog
        open={relationshipDialogOpen}
        onOpenChange={(open) => {
          setRelationshipDialogOpen(open);
          if (!open) setRelationshipIds([]);
        }}
      >
        <DialogContent
          className="suite-graph-relation-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            relationshipReturnFocusRef.current?.focus();
            relationshipReturnFocusRef.current = null;
          }}
        >
          <DialogHeader>
            <DialogTitle>当前实际登记关系</DialogTitle>
            <DialogDescription>
              仅列出当前已读取范围中的登记关系和可读依据，不依据图上距离推断归属或因果。
            </DialogDescription>
          </DialogHeader>
          <div className="suite-graph-relation-details" aria-label="关系明细">
            {selectedRelations.map((relation) => {
              const detail = read.relationDetails.get(relation.id);
              return (
                <p key={relation.id}>
                  <b>{relation.label || relation.type}</b>
                  <span>{nodeTitle(relation.source)} → {nodeTitle(relation.target)}</span>
                  <small>{detail ? relationDetailText(detail) : '当前读取保留该登记关系，但未返回额外依据明细。'}</small>
                </p>
              );
            })}
            {selectedRelations.length === 0 ? <p>当前读取范围没有可列出的登记关系。</p> : null}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
