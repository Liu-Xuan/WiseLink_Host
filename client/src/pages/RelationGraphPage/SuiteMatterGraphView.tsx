import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Filter, Maximize2, Minus, Plus } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import type { SuiteMatterGraphRead, SuiteMatterGraphTarget, SuiteRelationDetail } from './suite-matter-graph';
import type { SuiteGraphMatter, SuiteGraphPresentation, SuiteGraphRelationMode } from './suite-graph-model';
import { buildSuiteGraphPresentation } from './suite-graph-presentation';
import SuiteGraphCanvas, { type SuiteGraphCanvasHandle } from './SuiteGraphCanvas';
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
  onOpenTarget?: (target: SuiteMatterGraphTarget) => void;
  onNodeSelect?: (target: SuiteMatterGraphTarget | null) => void;
  initialState?: SuiteGraphReadingState;
  onStateChange?: (state: SuiteGraphReadingState) => void;
  availablePerspectives?: SuiteMatterGraphPerspective[];
}

const perspectives: Array<[SuiteMatterGraphPerspective, string]> = [
  ['matter', '事项图谱'],
  ['documents', '工程文档'],
  ['domain', '领域聚焦'],
  ['panorama', '全景目录'],
];

const OVERVIEW_STATUS_LABELS: Record<string, string> = {
  CURRENT: '当前综合与所选工作范围一致',
  STALE: '综合可能滞后于新材料，需核对',
  NOT_AVAILABLE: '当前范围没有可展示综合',
};

function targetLabel(target: SuiteMatterGraphTarget): string {
  if (target.kind === 'question') return target.item.text;
  if (target.kind === 'claim') return target.claim.text;
  if (target.kind === 'evidence') return target.evidence.title;
  if (target.kind === 'document') return target.documentVersionId;
  if (target.kind === 'input') return target.binding.documentVersionId;
  return target.material.kind === 'EXPECTED' ? target.material.expected.description : target.material.materialId;
}

function targetSubtitle(target: SuiteMatterGraphTarget): string {
  if (target.kind === 'question') return target.item.when ? '已保存复看条件' : '已保存未决问题';
  if (target.kind === 'claim') return target.workRef;
  if (target.kind === 'evidence') return target.workRef;
  if (target.kind === 'document') return '确切文档版本';
  if (target.kind === 'input') return `工作输入 · ${target.workRef}`;
  return target.material.contribution || '事项资料关系';
}

export default function SuiteMatterGraphView({
  read,
  revision,
  perspective: controlledPerspective,
  onPerspectiveChange,
  onLocateEvidence,
  onOpenWiki,
  onOpenTarget,
  onNodeSelect,
  initialState,
  onStateChange,
  availablePerspectives = ['matter'],
}: SuiteMatterGraphViewProps) {
  const [localPerspective, setLocalPerspective] = useState<SuiteMatterGraphPerspective>(() => initialState?.perspective ?? 'matter');
  const perspective = controlledPerspective ?? localPerspective;
  const [hiddenGroups, setHiddenGroups] = useState<string[]>(() => initialState?.hiddenGroups ?? []);
  const [relationMode, setRelationMode] = useState<SuiteGraphRelationMode>(() => initialState?.relationMode ?? 'aggregated');
  const [density, setDensity] = useState(() => initialState?.density ?? 4);
  const [page, setPage] = useState(() => initialState?.page ?? 0);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialState?.selectedId ?? null);
  const [viewport, setViewport] = useState(initialState?.viewport);
  const [mobilePanel, setMobilePanel] = useState<'graph' | 'timeline' | 'wiki'>('graph');
  const [focusedGroupKey, setFocusedGroupKey] = useState<string | null>(null);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const [relationshipIds, setRelationshipIds] = useState<string[]>([]);
  const canvasRef = useRef<SuiteGraphCanvasHandle | null>(null);
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
  const setPerspective = (next: SuiteMatterGraphPerspective) => {
    setPage(0); setSelectedId(null); setHiddenGroups([]);
    if (onPerspectiveChange) onPerspectiveChange(next); else setLocalPerspective(next);
  };
  const selectData = (data: Record<string, unknown>, isEdge: boolean) => {
    if (isEdge) return;
    const id = typeof data.businessId === 'string' ? data.businessId : null;
    const target = id ? read.targets.get(id) ?? null : null;
    setSelectedId(id);
    onNodeSelect?.(target);
  };
  const openTarget = () => {
    if (!selectedTarget) return;
    if (selectedTarget.kind === 'evidence' && selectedTarget.evidence.kind === 'DOCUMENT_PASSAGE') onLocateEvidence?.(selectedTarget.evidence);
    else onOpenTarget?.(selectedTarget);
  };
  const selectedRelationDetails = relationshipIds.map((id) => read.relationDetails.get(id)).filter((detail): detail is NonNullable<typeof detail> => Boolean(detail));
  useEffect(() => {
    onStateChange?.({ selectedId: selectedId ?? undefined, hiddenGroups: effectiveHiddenGroups, page, density, relationMode, perspective, viewport });
  }, [density, effectiveHiddenGroups, onStateChange, page, perspective, relationMode, selectedId, viewport]);
  const relationDetailText = (detail: SuiteRelationDetail): string => {
    if ('kind' in detail && detail.kind === 'FULFILLED_BY') return `取得范围：${detail.target.scope || '未注明'}；资料版本：${detail.target.documentVersionId}；材料身份：${detail.material.materialId}`;
    if ('role' in detail) return `前提${detail.role === 'SUPPORTS' ? '支持' : detail.role === 'LIMITS' ? '限定' : detail.role === 'CONTEXT' ? '背景' : '冲突'}：${detail.explanation}${detail.limitation ? `；限制：${detail.limitation}` : ''}；依据：${detail.evidenceRef}`;
    if ('kind' in detail) return `${detail.kind === 'EXPECTED' ? '预计资料' : detail.kind === 'MEMBER' ? '事项资料' : '参考资料'}：范围 ${detail.scope || '未注明'}；贡献 ${detail.contribution || '未注明'}；依据 ${detail.basis.map((item) => `${item.documentVersionId}/${item.sourceRefId}`).join('、') || '未返回'}`;
    return '关系已保存，但当前授权范围未返回可读明细。';
  };
  const targetCanOpenSource = selectedTarget?.kind === 'document' || (selectedTarget?.kind === 'evidence' && selectedTarget.evidence.kind === 'DOCUMENT_PASSAGE');
  const targetDetailText = (target: SuiteMatterGraphTarget): string => {
    if (target.kind === 'material') return target.material.kind === 'EXPECTED' ? `预计资料：${target.material.expected.description || target.material.expected.documentNumber || '未命名'}；预期贡献：${target.material.expected.expectedContribution || '未注明'}；来源时点：${target.material.expected.sourceAsOf}。` : `材料范围：${target.material.scope || '未注明'}；贡献：${target.material.contribution || '未单独保存'}；版本身份：${target.material.documentVersionId || '未返回'}；依据：${target.material.basis.map((item) => `${item.documentVersionId}/${item.sourceRefId}`).join('、') || '未返回'}。`;
    if (target.kind === 'evidence') return target.evidence.excerpt || target.evidence.title;
    if (target.kind === 'input') return `保存输入绑定：${target.binding.documentVersionId}；工作版本：${target.workRef}。`;
    return '';
  };
  const groupKeys = graph.groups.map((group) => group.key);
  return (
    <main className="suite-matter-graph-page">
      <header className="suite-graph-page-heading">
        <div><span className="suite-graph-eyebrow">RELATION GRAPH</span><h1>{perspective === 'panorama' ? '工程资料全景' : graph.title}</h1><p>图谱边只表达已登记对象关系，分组与距离不推断归属、风险或因果。</p></div>
        <div className="suite-graph-perspectives" role="tablist" aria-label="图谱视角">{perspectives.map(([id, label]) => <Button key={id} variant={perspective === id ? 'default' : 'outline'} size="sm" onClick={() => setPerspective(id)}>{label}</Button>)}</div>
      </header>
      <div className="suite-graph-toolbar"><div><span>关系显示</span><Button size="sm" variant={relationMode === 'aggregated' ? 'default' : 'outline'} onClick={() => setRelationMode('aggregated')}>聚合</Button><Button size="sm" variant={relationMode === 'individual' ? 'default' : 'outline'} onClick={() => setRelationMode('individual')}>逐条</Button></div><div><span>卡片密度</span><Button size="sm" variant="outline" onClick={() => setDensity((value) => Math.max(1, value - 1))}><Minus /></Button><strong>{density}</strong><Button size="sm" variant="outline" onClick={() => setDensity((value) => Math.min(6, value + 1))}><Plus /></Button></div><div className="suite-graph-group-filters"><span>分组</span><Button size="sm" variant={!focusedGroupKey ? 'default' : 'outline'} onClick={() => { setFocusedGroupKey(null); setPage(0); }}>全部</Button>{graph.groups.map((group) => <Button key={group.key} size="sm" variant={focusedGroupKey === group.key ? 'default' : 'outline'} onClick={() => { setFocusedGroupKey(group.key); setExpandedGroupKey(null); setPage(0); }}>{group.title}</Button>)}</div><Button size="sm" variant="outline" onClick={() => { setHiddenGroups(hiddenGroups.length ? [] : groupKeys); setFocusedGroupKey(null); }}><Filter /> {hiddenGroups.length ? '显示全部分组' : '隐藏分组'}</Button></div>
      <div className="suite-graph-mobile-switch" role="tablist" aria-label="手机活动面板"><Button size="sm" variant={mobilePanel === 'graph' ? 'default' : 'outline'} aria-pressed={mobilePanel === 'graph'} onClick={() => setMobilePanel('graph')}>图谱</Button><Button size="sm" variant={mobilePanel === 'timeline' ? 'default' : 'outline'} aria-pressed={mobilePanel === 'timeline'} onClick={() => setMobilePanel('timeline')}>时间线</Button><Button size="sm" variant={mobilePanel === 'wiki' ? 'default' : 'outline'} aria-pressed={mobilePanel === 'wiki'} onClick={() => setMobilePanel('wiki')}>Wiki</Button></div>
      <div className="suite-graph-layout" data-mobile-panel={mobilePanel}>
        <aside className="suite-graph-work-panel" aria-label="保存工作记录"><div className="suite-graph-panel-head"><h2>保存工作</h2><span>{revision ? `修订 ${revision.workingRevision}` : '未提供'}</span></div>{revision ? <><p className="suite-graph-date">{revision.createdAt}</p><p className="suite-graph-change">{revision.changeSummary}</p>{read.notices.map((notice) => <p className="suite-graph-notice" key={notice}>{notice}</p>)}<div className="suite-graph-work-facts"><span>工作身份</span><b>{revision.matterWorkRevisionId}</b><span>已保存输入</span><b>{revision.state.substantiveInputs.length}</b><span>未决/复看</span><b>{revision.state.openQuestions.length + revision.state.reviewConditions.length}</b></div></> : <p>当前范围没有可展示的保存工作记录。</p>}<Button variant="outline" onClick={() => onOpenWiki?.()}>阅读事项 Wiki <ArrowRight /></Button></aside>
        <section className="suite-graph-center-panel" aria-label="关系图谱"><div className="suite-graph-canvas-head"><span>{availablePerspectives.includes(perspective) ? `${presentation.counts.shown.groups} 个分组 · ${presentation.counts.shown.items} 个可见对象 · ${presentation.counts.represented.relationships} 条已表达关系` : '该视角尚未接入真实读取'}</span><div>{availablePerspectives.includes(perspective) ? <><Button size="icon" variant="ghost" aria-label="缩小" onClick={() => canvasRef.current?.zoomBy(.85)}><Minus /></Button><Button size="icon" variant="ghost" aria-label="放大" onClick={() => canvasRef.current?.zoomBy(1.18)}><Plus /></Button><Button size="icon" variant="ghost" aria-label="适应画布" onClick={() => canvasRef.current?.fit()}><Maximize2 /></Button></> : null}</div></div>{!availablePerspectives.includes(perspective) ? <div className="suite-graph-unconnected"><strong>{perspectives.find(([id]) => id === perspective)?.[1]}尚未接通</strong><p>当前读取只提供事项图谱，未提供该视角的真实数据；不以当前事项图替代。</p></div> : <><SuiteGraphCanvas ref={canvasRef} presentation={presentation} initialViewport={initialState?.viewport} selectedId={selectedId ?? undefined} focusGroupKey={focusedGroupKey} onSelect={selectData} onGroup={(key) => { setFocusedGroupKey(key); setExpandedGroupKey(null); setPage(0); }} onOverflow={(key) => setExpandedGroupKey(key)} onInspectRelationships={setRelationshipIds} onViewport={setViewport} ariaLabel="工程事项关系图谱" />{expandedGroupKey ? <section className="suite-graph-overflow-list" aria-label="分组全部对象"><div><strong>{graph.groups.find((group) => group.key === expandedGroupKey)?.title ?? expandedGroupKey} · 全部对象</strong><Button size="sm" variant="ghost" onClick={() => setExpandedGroupKey(null)}>收起</Button></div>{graph.groups.find((group) => group.key === expandedGroupKey)?.items.map((item) => <button type="button" key={item.id} onClick={() => { setSelectedId(item.id); onNodeSelect?.(read.targets.get(item.id) ?? null); }}><b>{item.title}</b><small>{item.subtitle || '已登记对象'}</small></button>)}</section> : null}{relationshipIds.length ? <section className="suite-graph-relation-details" aria-label="关系明细"><div><strong>关系依据</strong><Button size="sm" variant="ghost" onClick={() => setRelationshipIds([])}>关闭</Button></div>{selectedRelationDetails.length ? selectedRelationDetails.map((detail, index) => <p key={index}>{relationDetailText(detail)}</p>) : <p>已选关系的明细未在当前授权范围返回。</p>}</section> : null}</>}{availablePerspectives.includes(perspective) ? <div className="suite-graph-reading-thread" aria-label="当前阅读线索"><span>当前阅读线索</span><div><b>{graph.title}</b>{selectedTarget && targetCanOpenSource ? <><ChevronRight size={12} /><b>确切原文</b></> : null}<ChevronRight size={12} /><Button size="sm" variant="ghost" onClick={() => onOpenWiki?.()}>完整问题分析</Button></div><Button size="sm" variant="outline" onClick={() => { setHiddenGroups([]); setFocusedGroupKey(null); }}>核对全部关系</Button></div> : null}<footer className="suite-graph-canvas-footer"><span>{availablePerspectives.includes(perspective) ? (presentation.overflow.hasMore ? `还可展开 ${presentation.overflow.omittedGroupKeys.length} 个分组` : '已显示当前授权范围分组') : '无可见数据'}</span><div><Button size="sm" variant="ghost" disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronLeft />上一页</Button><span>{presentation.counts.page.index + 1} / {presentation.counts.page.pageCount}</span><Button size="sm" variant="ghost" disabled={!presentation.overflow.hasMore} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight /></Button></div></footer></section>
        <aside className="suite-graph-knowledge-panel" aria-label="已保存知识"><div className="suite-graph-panel-head"><h2>已保存知识</h2><span>{selectedTarget ? '已选对象' : '事项摘要'}</span></div>{selectedTarget ? <><span className="suite-graph-target-kind">{selectedTarget.kind}</span><h2>{targetLabel(selectedTarget)}</h2><p className="suite-graph-target-subtitle">{targetSubtitle(selectedTarget)}</p>{selectedTarget.kind === 'claim' ? <><p>{selectedTarget.claim.text}</p>{selectedTarget.claim.premises.map((premise) => <p className="suite-graph-muted" key={premise.evidenceRef}>{premise.role}：{premise.explanation}{premise.limitation ? `；限制：${premise.limitation}` : ''}（依据：{premise.evidenceRef}）</p>)}</> : <><p>{selectedTarget.kind === 'question' ? selectedTarget.item.text : targetDetailText(selectedTarget) || '该对象的完整来源和身份保留在当前授权读取结果中。'}</p>{targetCanOpenSource ? <Button variant="outline" onClick={openTarget}>打开确切原文 <ArrowRight /></Button> : (selectedTarget.kind === 'input' || selectedTarget.kind === 'question') ? <Button variant="outline" onClick={openTarget}>查看保存正文 <ArrowRight /></Button> : null}</>}</> : <><h2>{graph.title}</h2>{revision?.state.substantiveResult ? <SavedAssessmentReading result={revision.state.substantiveResult} onLocateDocument={(evidence) => evidence.kind === 'DOCUMENT_PASSAGE' ? onLocateEvidence?.(evidence) : undefined} /> : <p>选择图中对象查看其保存身份、来源关系和可进入的正文。</p>}{read.overviewStatus ? <p className="suite-graph-status">当前综合状态：{OVERVIEW_STATUS_LABELS[read.overviewStatus] ?? read.overviewStatus}</p> : null}{read.notices.map((notice) => <p className="suite-graph-notice" key={notice}>{notice}</p>)}<p className="suite-graph-muted">{read.missingEvidenceRefs.length ? `${read.missingEvidenceRefs.length} 条依据尚未在当前授权范围返回。` : '当前没有额外缺失依据提示。'}</p></>}</aside>
      </div>
    </main>
  );
}
