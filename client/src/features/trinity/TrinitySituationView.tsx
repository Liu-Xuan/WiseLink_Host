import { useMemo } from 'react';
import {
  ArrowRight,
  BookOpen,
  Clock,
  Compass,
  Network,
} from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  formatAsof,
  readableCoverage,
  completeCoverage,
  completeLifecycleCoverage,
  completeMatterTotal,
  recentEvents,
  recentKnowledge,
  scopeMatters,
  situationMetrics,
  stageLabel,
  toggleSelection,
  TRINITY_FLEET_OPTIONS,
  TRINITY_KNOWLEDGE_STAGE_META,
  TRINITY_STAGE_META,
} from './trinity-model';
import TrinityRings from './TrinityRings';
import TrinityStagePanel from './TrinityStagePanel';
import type {
  TrinityEventItem,
  TrinityKnowledgeItem,
  TrinityLevel,
  TrinityMatter,
  TrinityNavigationTarget,
  TrinitySituationData,
  TrinitySituationMetrics,
} from './trinity-types';
import './trinity.css';

export interface TrinitySituationViewProps {
  data?: TrinitySituationData | null;
  fleetOptions?: ReadonlyArray<{ value: string; label: string }>;
  level?: TrinityLevel;
  fleet?: string;
  focusMatterId?: string;
  selectedStageId?: string;
  selectedKnowledgeId?: string;
  onLevelChange?: (level: TrinityLevel) => void;
  onFleetChange?: (fleet: string) => void;
  onFocusMatterChange?: (matterId: string) => void;
  onSelectStage?: (stageId: string) => void;
  onSelectKnowledge?: (knowledgeStageId: string) => void;
  onNavigate?: (target: TrinityNavigationTarget) => void;
}

function metricText(value: number | null): string {
  return value === null ? '—' : String(value);
}

export default function TrinitySituationView({
  data = null,
  fleetOptions = TRINITY_FLEET_OPTIONS,
  level = 'macro',
  fleet = 'all',
  focusMatterId = 'm1',
  selectedStageId = '',
  selectedKnowledgeId = '',
  onLevelChange,
  onFleetChange,
  onFocusMatterChange,
  onSelectStage,
  onSelectKnowledge,
  onNavigate,
}: TrinitySituationViewProps) {
  const frameworkData: TrinitySituationData = data ?? {
    meta: { name: '当前授权资料', asOf: '', origin: 'AUTHORIZED_SCOPE', currentHostVerified: false },
    stages: TRINITY_STAGE_META,
    knowledgeStages: TRINITY_KNOWLEDGE_STAGE_META,
    matters: [], events: [], knowledge: [], availability: 'loading',
  };
  const scope = useMemo(
    () => (data && readableCoverage(data, 'matters')
      ? scopeMatters(data, level, fleet, focusMatterId) : null),
    [data, level, fleet, focusMatterId],
  );
  const metrics: TrinitySituationMetrics = situationMetrics(data, scope);
  const focusMatter = useMemo(
    () => scope?.find((m: TrinityMatter) => m.id === focusMatterId) ?? null,
    [scope, focusMatterId],
  );
  const events = data && scope ? recentEvents(data, scope, data.meta.asOf) : [];
  const knowledge = data && scope ? recentKnowledge(data, scope) : [];

  const emitNavigate = (target: TrinityNavigationTarget): void => {
    onNavigate?.(target);
  };

  const handleSelectStage = (stageId: string): void => {
    onSelectStage?.(toggleSelection(selectedStageId, stageId));
    if (selectedKnowledgeId !== '') onSelectKnowledge?.('');
  };

  const handleSelectKnowledge = (knowledgeId: string): void => {
    onSelectKnowledge?.(toggleSelection(selectedKnowledgeId, knowledgeId));
    if (selectedStageId !== '') onSelectStage?.('');
  };

  const handleLevelChange = (next: TrinityLevel): void => {
    onLevelChange?.(next);
    if (selectedStageId !== '') onSelectStage?.('');
    if (selectedKnowledgeId !== '') onSelectKnowledge?.('');
  };

  const stageLabelFor = (stageId: string): string =>
    stageLabel(
      scope, level, stageId,
      focusMatter?.activeStages.includes(stageId) ?? false,
      completeLifecycleCoverage(data),
    );

  return (
    <div className="trinity-situation" data-geometry="trinity-situation">
      <div className="page-head">
        <div>
          <h1>工程态势</h1>
          <p className="subtitle">
            业务全生命周期与知识循环，在同一工作空间衔接。
          </p>
        </div>
        <div className="view-nav" role="group" aria-label="三视图入口">
          <Button variant="ghost" className="active" data-view="situation">
            <Compass size={15} />态势
          </Button>
          <Button variant="ghost" data-view="timeline"
            onClick={(): void => emitNavigate({ type: 'view', view: 'timeline' })}>
            <Clock size={15} />时间轴
          </Button>
          <Button variant="ghost" data-view="graph"
            onClick={(): void => emitNavigate({ type: 'view', view: 'graph' })}>
            <Network size={15} />图谱
          </Button>
        </div>
      </div>

      <div className="scope-bar">
        <div className="seg" role="group" aria-label="视图层级">
          <Button variant="ghost" size="sm"
            className={level === 'macro' ? 'active' : ''}
            data-level="macro"
            onClick={(): void => handleLevelChange('macro')}>
            机队全貌
          </Button>
          <Button variant="ghost" size="sm"
            className={level === 'focus' ? 'active' : ''}
            data-level="focus"
            onClick={(): void => handleLevelChange('focus')}>
            聚焦事项
          </Button>
        </div>

        {level === 'macro' ? (
          <Select value={fleet} onValueChange={(v: string): void => onFleetChange?.(v)}>
            <SelectTrigger aria-label="机型范围" className="trinity-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fleetOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Select value={focusMatterId}
            onValueChange={(v: string): void => onFocusMatterChange?.(v)}>
            <SelectTrigger aria-label="当前工程事项" className="trinity-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(data && readableCoverage(data, 'matters') ? scopeMatters(data, 'macro', 'all', '') : []).map((m: TrinityMatter) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.code} · {m.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <span className="asof">{formatAsof(data, level, focusMatter)}</span>
      </div>

      {level === 'macro' ? (
        <div className="metrics" data-geometry="metrics">
          <div className="metric">
            <b>{metricText(metrics.visibleMatters)}</b>
            <span>可见工程事项</span>
            <small>{completeMatterTotal(data) ? '去重后的当前范围' : '当前范围尚未完整取得'}</small>
          </div>
          <div className="metric">
            <b className="warm-number">{metricText(metrics.attention)}</b>
            <span>有条件需继续核对</span>
            <small>可直接查看原事项与依据</small>
          </div>
          <div className="metric">
            <b>{metricText(metrics.knowledgeWorks)}</b>
            <span>已有知识工作</span>
            <small>来自正常分析与复核</small>
          </div>
          <div className="metric">
            <b>{metricText(metrics.effectWatch)}</b>
            <span>有关效果观察</span>
            <small>不以进入观察代表验证有效</small>
          </div>
        </div>
      ) : (
        <div className="focus-strip">
          <div>
            <h2>
              {focusMatter ? `${focusMatter.code} · ${focusMatter.title}` : '未选择事项'}
            </h2>
            <p>{focusMatter?.brief ?? '当前范围未取得聚焦事项。'}</p>
          </div>
          <div className="row">
            <Button variant="outline" size="sm" disabled={!focusMatter}
              onClick={(): void => focusMatter &&
                emitNavigate({ type: 'matter-timeline', matterId: focusMatter.id })}>
              查看历程
            </Button>
            <Button variant="outline" size="sm" disabled={!focusMatter}
              onClick={(): void => focusMatter &&
                emitNavigate({ type: 'matter-reading', matterId: focusMatter.id })}>
              阅读事项
            </Button>
          </div>
        </div>
      )}

        {(!data || data.availability && data.availability !== 'complete' || data.coverage &&
          Object.values(data.coverage).some((v) => v && v !== 'complete')) && (
          <p className="coverage-note" role="status">
            {!data || data.availability === 'loading' ? '正在取得授权资料，当前只展示固定环结构。' :
              data.availability === 'failed' ? '资料读取失败，当前数字与事项保持未知。' :
                data.availability === 'denied' ? '当前授权范围不可读，未将未知内容记为零。' :
                  '当前仅取得部分范围，数字与事项按已取得记录显示。'}
          </p>
        )}
        <>
          <div className="situation-grid">
            <TrinityRings
              stages={frameworkData.stages}
              knowledgeStages={frameworkData.knowledgeStages}
              selectedStageId={selectedStageId}
              selectedKnowledgeId={selectedKnowledgeId}
              level={level}
              stageLabelFor={stageLabelFor}
              focusActiveStageIds={focusMatter?.activeStages ?? []}
              onSelectStage={handleSelectStage}
              onSelectKnowledge={handleSelectKnowledge}
              onNavigate={emitNavigate}
            />
            <aside className="card inspector" id="situation-inspector"
              data-geometry="inspector">
              <TrinityStagePanel
                data={frameworkData}
                scope={scope}
                selectedStageId={selectedStageId}
                selectedKnowledgeId={selectedKnowledgeId}
                onNavigate={emitNavigate}
              />
            </aside>
          </div>

          <div className="bottom-grid">
            <section className="card bottom-card">
              <div className="row">
                <h3>最近的工程进展</h3>
                <Button variant="ghost" size="sm" className="push"
                  onClick={(): void => emitNavigate({ type: 'view', view: 'timeline' })}>
                  完整时间轴 <ArrowRight size={14} />
                </Button>
              </div>
              {events.length > 0 ? (
                <div className="event-list">
                  {events.map((e: TrinityEventItem) => (
                    <div key={e.id} className="item">
                      <span className="date">{(e.date ?? '').slice(5)}</span>
                      <button type="button"
                        onClick={(): void => emitNavigate({ type: 'event', eventId: e.id })}>
                        {e.title}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="tiny muted">{completeMatterTotal(data) && completeCoverage(data, 'events') ? '当前范围暂无已取得的进展记录' : '进展记录尚未完整取得'}</p>
              )}
            </section>
            <section className="card bottom-card">
              <div className="row">
                <h3>工作形成的知识</h3>
                <Button variant="ghost" size="sm" className="push"
                  onClick={(): void => emitNavigate({ type: 'knowledge-view' })}>
                  查阅知识 <ArrowRight size={14} />
                </Button>
              </div>
              <div className="knowledge-list">
                {knowledge.length === 0 && !completeCoverage(data, 'knowledge') && <p className="tiny muted">知识记录尚未完整取得</p>}
                {knowledge.map((k: TrinityKnowledgeItem) => (
                  <div key={k.id} className="item">
                    <BookOpen size={14} />
                    <button type="button"
                      onClick={(): void =>
                        emitNavigate({ type: 'knowledge-item', knowledgeId: k.id })}>
                      {k.title}
                      <span className="tiny muted knowledge-scope">
                        {frameworkData.stages.find((s) => s.id === k.phase)?.title} ·
                        {k.reuseCountKnown === false
                          ? '复用范围尚未核实'
                          : `${k.reuse.length} 个已记录复用范围`}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
    </div>
  );
}
