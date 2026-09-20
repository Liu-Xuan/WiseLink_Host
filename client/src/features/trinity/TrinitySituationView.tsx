import { useEffect, useMemo, useState } from 'react';
import {
  Clock, Compass, Network, Pause, Play, Settings2, X,
} from 'lucide-react';
import { useWlTheme } from '@client/src/app/providers/ThemeProvider';
import { Button } from '@client/src/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@client/src/components/ui/select';
import {
  completeAssessmentCoverage, completeMatterTotal, formatAsof,
  readableCoverage, scopeMatters, scopeSources, situationMetrics,
  stageLabel, toggleSelection, TRINITY_FLEET_OPTIONS,
  TRINITY_SOURCE_CATEGORY_META, TRINITY_STAGE_META,
} from './trinity-model';
import TrinityRings from './TrinityRings';
import TrinityStagePanel from './TrinityStagePanel';
import type {
  TrinityLevel, TrinityMatter, TrinityNavigationTarget,
  TrinitySituationData, TrinitySituationMetrics,
} from './trinity-types';
import './trinity.css';

const WALKTHROUGH = [
  { sourceId: 'documents', stageId: '', title: '从工程文件开始',
    text: '解析原文与各自版本，保留问题、要求和适用条件。' },
  { sourceId: 'configuration', stageId: '', title: '围绕同一事项聚合',
    text: '把有关文件、对象、历史工作和工程师补充放回同一问题中理解。' },
  { sourceId: '', stageId: 'conditions', title: '将信息转为判断依据',
    text: '核对资料的作用、范围与限制，让重要判断回到真正支持它的来源。' },
  { sourceId: '', stageId: 'analysis', title: '以细致分析减少遗漏',
    text: '分析实际问题、风险情景与措施边界，保留决定性条件。' },
  { sourceId: '', stageId: 'review', title: '协同工程师开展综合评估',
    text: '先给出有内容的认识，再通过追问、纠正与补材料共同核对。' },
  { sourceId: '', stageId: 'update', title: '持续更新，依据可追溯',
    text: '纳入真实变化，说明哪些认识改变、哪些仍然成立。' },
] as const;

export interface TrinitySituationViewProps {
  data?: TrinitySituationData | null;
  fleetOptions?: ReadonlyArray<{ value: string; label: string }>;
  level?: TrinityLevel;
  fleet?: string;
  focusMatterId?: string;
  selectedStageId?: string;
  selectedSourceId?: string;
  onLevelChange?: (level: TrinityLevel) => void;
  onFleetChange?: (fleet: string) => void;
  onFocusMatterChange?: (matterId: string) => void;
  onSelectStage?: (stageId: string) => void;
  onSelectSource?: (sourceId: string) => void;
  onSelectionChange?: (selection: {
    stageId: string;
    sourceId: string;
  }) => void;
  onNavigate?: (target: TrinityNavigationTarget) => void;
}

function metricText(value: number | null): string {
  return value === null ? '—' : String(value);
}

export default function TrinitySituationView({
  data = null, fleetOptions = TRINITY_FLEET_OPTIONS, level = 'macro',
  fleet = 'all', focusMatterId = '', selectedStageId = '',
  selectedSourceId = '', onLevelChange, onFleetChange,
  onFocusMatterChange, onSelectStage, onSelectSource, onSelectionChange,
  onNavigate,
}: TrinitySituationViewProps) {
  const {
    theme, visualMode, motionEnabled, motionPausedByUser, systemReducedMotion,
    documentHidden, setVisualMode, toggleTheme, toggleMotion,
  } = useWlTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [walkthroughIndex, setWalkthroughIndex] = useState(-1);
  const [walkthroughPlaying, setWalkthroughPlaying] = useState(false);
  const frameworkData: TrinitySituationData = data ?? {
    meta: { name: '当前授权资料', asOf: '', origin: 'AUTHORIZED_SCOPE',
      currentHostVerified: false },
    stages: TRINITY_STAGE_META,
    sourceCategories: TRINITY_SOURCE_CATEGORY_META,
    matters: [], sources: [], events: [], knowledge: [], availability: 'loading',
  };
  const scope: TrinityMatter[] | null = useMemo(
    () => data && readableCoverage(data, 'matters')
      ? scopeMatters(data, level, fleet, focusMatterId) : null,
    [data, level, fleet, focusMatterId],
  );
  const focusMatter: TrinityMatter | null = useMemo(
    () => scope?.find((matter: TrinityMatter) => matter.id === focusMatterId) ?? null,
    [scope, focusMatterId],
  );
  const metrics: TrinitySituationMetrics = situationMetrics(data, scope);
  const currentWalk = walkthroughIndex >= 0
    ? WALKTHROUGH[walkthroughIndex] : null;

  useEffect(() => {
    if (!motionEnabled || systemReducedMotion || visualMode === 'compatible'
      || documentHidden) setWalkthroughPlaying(false);
  }, [documentHidden, motionEnabled, systemReducedMotion, visualMode]);

  useEffect(() => {
    if (!walkthroughPlaying || walkthroughIndex < 0 || documentHidden
      || !motionEnabled || systemReducedMotion || visualMode === 'compatible') return;
    if (walkthroughIndex >= WALKTHROUGH.length - 1) {
      setWalkthroughPlaying(false);
      return;
    }
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      () => setWalkthroughIndex((current: number) => current + 1), 7000,
    );
    return () => clearTimeout(timer);
  }, [documentHidden, motionEnabled, systemReducedMotion, visualMode,
    walkthroughIndex, walkthroughPlaying]);

  const emitNavigate = (target: TrinityNavigationTarget): void => onNavigate?.(target);
  const emitSelection = (stageId: string, sourceId: string): void => {
    if (onSelectionChange) {
      onSelectionChange({ stageId, sourceId });
      return;
    }
    onSelectStage?.(stageId);
    onSelectSource?.(sourceId);
  };
  const handleSelectStage = (stageId: string): void => {
    emitSelection(toggleSelection(selectedStageId, stageId), '');
  };
  const handleSelectSource = (sourceId: string): void => {
    emitSelection('', toggleSelection(selectedSourceId, sourceId));
  };
  const handleLevelChange = (next: TrinityLevel): void => {
    onLevelChange?.(next);
    setWalkthroughIndex(-1);
    setWalkthroughPlaying(false);
  };
  const stageLabelFor = (stageId: string): string => stageLabel(
    scope, level, stageId,
    focusMatter?.activeAssessmentStages.includes(stageId) ?? false,
    completeAssessmentCoverage(data),
  );
  const sourceLabelFor = (sourceId: string): string => {
    if (!scope || !data || !readableCoverage(data, 'sources'))
      return '来源范围未取得';
    const count: number = scopeSources(data, scope).filter(
      (source) => source.category === sourceId,
    ).length;
    if (!data.coverage || data.coverage.sources !== 'complete')
      return count ? `已取得 ${count} 项` : '尚未接通';
    return `${count} 项材料`;
  };
  const startWalkthrough = (): void => {
    if (walkthroughIndex >= 0) {
      setWalkthroughIndex(-1);
      setWalkthroughPlaying(false);
      return;
    }
    setWalkthroughIndex(0);
    setWalkthroughPlaying(motionEnabled && !systemReducedMotion
      && visualMode !== 'compatible');
  };

  return <div className="trinity-situation" data-geometry="trinity-situation">
    <div className="page-head">
      <div>
        <p className="eyebrow">{level === 'macro'
          ? '民航维修工程管理 · 信息与判断' : '聚焦事项 · 当前授权范围'}</p>
        <h1>{level === 'macro' ? '将分散信息，转化为判断依据。'
          : focusMatter?.title ?? '工程态势'}</h1>
        <p className="subtitle">{level === 'macro'
          ? '围绕同一事项聚合多源信息与数据，理解背后的问题；协同工程师开展规范化综合评估。'
          : focusMatter?.brief ?? '正在取得事项的当前认识与依据。'}</p>
      </div>
      <div className="view-nav" role="group" aria-label="三视图入口">
        <Button variant="ghost" className="active" data-view="situation"><Compass size={15} />态势</Button>
        <Button variant="ghost" data-view="timeline"
          onClick={(): void => emitNavigate({ type: 'view', view: 'timeline' })}><Clock size={15} />时间轴</Button>
        <Button variant="ghost" data-view="graph"
          onClick={(): void => emitNavigate({ type: 'view', view: 'graph' })}><Network size={15} />图谱</Button>
      </div>
    </div>

    <div className="scope-bar">
      <div className="seg" role="group" aria-label="选择宏观或具体事项">
        <Button variant="ghost" size="sm" className={level === 'macro' ? 'active' : ''}
          data-level="macro" onClick={(): void => handleLevelChange('macro')}>宏观概览</Button>
        <Button variant="ghost" size="sm" className={level === 'focus' ? 'active' : ''}
          data-level="focus" onClick={(): void => handleLevelChange('focus')}>聚焦事项</Button>
      </div>
      {level === 'macro' ? <Select value={fleet}
        onValueChange={(value: string): void => onFleetChange?.(value)}>
        <SelectTrigger aria-label="机型范围" className="trinity-select"><SelectValue /></SelectTrigger>
        <SelectContent>{fleetOptions.map((option) => <SelectItem key={option.value}
          value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select> : <Select value={focusMatterId}
        onValueChange={(value: string): void => onFocusMatterChange?.(value)}>
        <SelectTrigger aria-label="当前工程事项" className="trinity-select"><SelectValue /></SelectTrigger>
        <SelectContent>{(data && readableCoverage(data, 'matters')
          ? scopeMatters(data, 'macro', 'all', '') : []).map((matter: TrinityMatter) =>
          <SelectItem key={matter.id} value={matter.id}>{matter.title}</SelectItem>)}</SelectContent>
      </Select>}
      <span className="asof">{formatAsof(data, level, focusMatter)}</span>
      <div className="situation-controls">
        <Button variant="ghost" size="sm" data-action="motion"
          aria-pressed={!motionEnabled} onClick={toggleMotion}>
          {motionEnabled ? <Pause size={14} /> : <Play size={14} />}
          {systemReducedMotion ? '系统减少动态效果'
            : motionPausedByUser ? '继续动态' : '暂停动态'}
        </Button>
        <Button variant={walkthroughIndex < 0 ? 'default' : 'outline'} size="sm"
          className={walkthroughIndex < 0 ? 'walkthrough-primary' : ''}
          data-action="walkthrough" onClick={startWalkthrough}>
          {walkthroughIndex < 0 ? <Play size={14} /> : <X size={14} />}
          {walkthroughIndex < 0 ? '演示评估过程' : '结束讲解'}
        </Button>
        <div className="settings-wrap">
          <Button variant="outline" size="icon" aria-label="显示与效果"
            aria-expanded={settingsOpen}
            onClick={(): void => setSettingsOpen((open: boolean) => !open)}>
            <Settings2 size={15} />
          </Button>
          {settingsOpen ? <div className="situation-settings">
            <h3>页面主题</h3>
            <Button variant="outline" size="sm" onClick={toggleTheme}>
              切换为{theme === 'dark' ? '浅色' : '深色'}
            </Button>
            <h3>视觉效果</h3>
            <div className="settings-options">{(['default', 'ultra', 'compatible'] as const).map((mode) =>
              <Button key={mode} variant={visualMode === mode ? 'default' : 'outline'}
                size="sm" aria-pressed={visualMode === mode}
                onClick={(): void => setVisualMode(mode)}>
                {mode === 'default' ? '默认' : mode === 'ultra' ? '最高' : '兼容'}
              </Button>)}</div>
          </div> : null}
        </div>
      </div>
    </div>

    <div className="metrics" data-geometry="metrics">
      <div className="metric"><b>{metricText(metrics.visibleMatters)}</b><span>工程事项</span>
        <small>{completeMatterTotal(data) ? '当前范围去重统计' : '当前范围尚未完整取得'}</small></div>
      <div className="metric"><b>{metricText(metrics.sourceCount)}</b><span>可查来源</span>
        <small>只统计当前准确读取范围</small></div>
      <div className="metric"><b className="warm-number">{metricText(metrics.attention)}</b><span>待核事项</span>
        <small>存在条件或输入需要继续核对</small></div>
      <div className="metric"><b>{metricText(metrics.synthesisPending)}</b><span>综合待更新</span>
        <small>问题工作与综合分别读取</small></div>
    </div>

    {(!data || data.availability && data.availability !== 'complete' || data.coverage &&
      Object.values(data.coverage).some((value) => value && value !== 'complete')) ?
      <p className="coverage-note" role="status">{!data || data.availability === 'loading'
        ? '正在取得授权资料，当前只展示固定信息与评估结构。'
        : data.availability === 'failed' ? '资料读取失败，当前数字与事项保持未知。'
          : data.availability === 'denied' ? '当前授权范围不可读，未将未知内容记为零。'
            : '当前仅取得部分范围，数字与事项按已取得记录显示。'}</p> : null}

    <div className="situation-grid">
      <div>
        <TrinityRings stages={frameworkData.stages}
          sourceCategories={frameworkData.sourceCategories}
          selectedStageId={selectedStageId} selectedSourceId={selectedSourceId}
          level={level} stageLabelFor={stageLabelFor} sourceLabelFor={sourceLabelFor}
          focusActiveStageIds={focusMatter?.activeAssessmentStages ?? []}
          motionEnabled={motionEnabled} walkthroughStageId={currentWalk?.stageId ?? ''}
          walkthroughSourceId={currentWalk?.sourceId ?? ''}
          onSelectStage={handleSelectStage} onSelectSource={handleSelectSource}
          onNavigate={emitNavigate} />
        {currentWalk ? <section className="walkbar" aria-label="概念流程演示">
          <div className="walktext"><small>流程演示 {walkthroughIndex + 1} / {WALKTHROUGH.length} · {currentWalk.title}</small>
            <p>{currentWalk.text}</p><div className="walk-dots">{WALKTHROUGH.map((scene, index) =>
              <button key={scene.title} type="button" className={index === walkthroughIndex ? 'current' : ''}
                aria-label={`第${index + 1}幕：${scene.title}`}
                onClick={(): void => setWalkthroughIndex(index)} />)}</div></div>
          <div className="walk-actions">
            <Button variant="outline" size="icon" aria-label="上一幕"
              disabled={walkthroughIndex === 0}
              onClick={(): void => setWalkthroughIndex((index: number) => Math.max(0, index - 1))}>‹</Button>
            <Button variant="outline" size="icon"
              aria-label={walkthroughPlaying ? '暂停讲解' : '继续讲解'}
              onClick={(): void => setWalkthroughPlaying((playing: boolean) => !playing)}>
              {walkthroughPlaying ? <Pause size={14} /> : <Play size={14} />}</Button>
            <Button variant="outline" size="icon" aria-label="下一幕"
              disabled={walkthroughIndex === WALKTHROUGH.length - 1}
              onClick={(): void => setWalkthroughIndex((index: number) =>
                Math.min(WALKTHROUGH.length - 1, index + 1))}>›</Button>
          </div>
        </section> : null}
      </div>
      <aside className="card inspector" id="situation-inspector" data-geometry="inspector">
        <TrinityStagePanel data={frameworkData} scope={scope} level={level}
          selectedStageId={selectedStageId} selectedSourceId={selectedSourceId}
          onNavigate={emitNavigate} />
      </aside>
    </div>
  </div>;
}
