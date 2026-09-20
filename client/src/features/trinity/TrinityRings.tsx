import { useMemo } from 'react';
import {
  Activity, BookOpen, Brain, FileCheck2, FileText, History, Layers,
  ListChecks, MessageSquare, RefreshCw, Search, Shield,
} from 'lucide-react';
import {
  nodePositionPercent, sourceAnchor, stageAnchor, TRINITY_RING,
} from './trinity-model';
import type {
  TrinityNavigationTarget, TrinitySourceCategoryMeta, TrinityStageMeta,
} from './trinity-types';

const ASSESSMENT_ICONS = [
  Search, ListChecks, Shield, FileCheck2, MessageSquare, RefreshCw,
] as const;
const SOURCE_ICONS = [
  FileText, Activity, Layers, History, BookOpen, MessageSquare,
] as const;

interface TrinityRingsProps {
  stages: TrinityStageMeta[];
  sourceCategories: TrinitySourceCategoryMeta[];
  selectedStageId: string;
  selectedSourceId: string;
  level: 'macro' | 'focus';
  stageLabelFor: (stageId: string) => string;
  sourceLabelFor: (sourceId: string) => string;
  focusActiveStageIds: string[];
  motionEnabled: boolean;
  walkthroughStageId: string;
  walkthroughSourceId: string;
  onSelectStage: (stageId: string) => void;
  onSelectSource: (sourceId: string) => void;
  onNavigate: (target: TrinityNavigationTarget) => void;
}

export default function TrinityRings({
  stages, sourceCategories, selectedStageId, selectedSourceId, level,
  stageLabelFor, sourceLabelFor, focusActiveStageIds, motionEnabled,
  walkthroughStageId, walkthroughSourceId, onSelectStage, onSelectSource,
  onNavigate,
}: TrinityRingsProps) {
  const focusActives: Set<string> = useMemo(
    () => new Set(focusActiveStageIds), [focusActiveStageIds],
  );
  return (
    <section className="card ring-card source-assessment-orbit"
      data-geometry="ring-card" data-motion={motionEnabled ? 'running' : 'paused'}>
      <div className="ring-header">
        <span className="legend source"><i />内环 · 围绕事项聚合信息</span>
        <span className="legend"><i />外环 · 协同工程师评估</span>
      </div>
      <div className="ring-board" data-geometry="ring-board">
        <div className="ring-ambient" aria-hidden="true" />
        <svg className="ring-svg"
          viewBox={`0 0 ${TRINITY_RING.viewWidth} ${TRINITY_RING.viewHeight}`}
          aria-hidden="true">
          <ellipse className="outer-bed" cx={TRINITY_RING.cx} cy={TRINITY_RING.cy}
            rx={TRINITY_RING.outerRx} ry={TRINITY_RING.outerRy} />
          <ellipse className="outer-route" cx={TRINITY_RING.cx} cy={TRINITY_RING.cy}
            rx={TRINITY_RING.outerRx} ry={TRINITY_RING.outerRy} />
          <ellipse className="outer-glimmer" cx={TRINITY_RING.cx} cy={TRINITY_RING.cy}
            rx={TRINITY_RING.outerRx} ry={TRINITY_RING.outerRy} />
          <ellipse className="inner-band" cx={TRINITY_RING.cx} cy={TRINITY_RING.cy}
            rx={TRINITY_RING.innerRx} ry={TRINITY_RING.innerRy} />
          <ellipse className="inner-route" cx={TRINITY_RING.cx} cy={TRINITY_RING.cy}
            rx={TRINITY_RING.innerRx} ry={TRINITY_RING.innerRy} />
          {sourceCategories.map((source: TrinitySourceCategoryMeta, index: number) => {
            const anchor = sourceAnchor(index);
            return <path key={source.id} className="source-flow"
              d={`M ${anchor.x} ${anchor.y} Q ${TRINITY_RING.cx} ${TRINITY_RING.cy - 42} ${TRINITY_RING.cx} ${TRINITY_RING.cy}`} />;
          })}
        </svg>
        {stages.map((stage: TrinityStageMeta, index: number) => {
          const Icon = ASSESSMENT_ICONS[index];
          const active = level === 'focus' && focusActives.has(stage.id);
          const unavailable = level === 'focus' && !active;
          return <button key={stage.id} type="button"
            className={`stage-node ${selectedStageId === stage.id ? 'selected' : ''} ${
              active ? 'focus-active' : unavailable ? 'focus-unentered' : ''
            } ${walkthroughStageId === stage.id ? 'walk-active' : ''}`}
            style={nodePositionPercent(stageAnchor(index))}
            data-stage={stage.id} data-geometry={`stage-${stage.id}`}
            aria-label={`${stage.title}，${stageLabelFor(stage.id)}`}
            onClick={(): void => onSelectStage(stage.id)}>
            <span className="stage-top"><small>{String(index + 1).padStart(2, '0')}</small><Icon size={16} /></span>
            <strong>{stage.title}</strong>
            <span className="stage-count">{stageLabelFor(stage.id)}</span>
          </button>;
        })}
        {sourceCategories.map((source: TrinitySourceCategoryMeta, index: number) => {
          const Icon = SOURCE_ICONS[index];
          return <button key={source.id} type="button"
            className={`source-node ${selectedSourceId === source.id ? 'selected' : ''} ${
              walkthroughSourceId === source.id ? 'walk-active' : ''
            }`}
            style={nodePositionPercent(sourceAnchor(index))}
            data-source-category={source.id}
            onClick={(): void => onSelectSource(source.id)}
            aria-label={`${source.title}，${sourceLabelFor(source.id)}`}>
            <Icon size={15} /><strong>{source.title}</strong>
            <small>{sourceLabelFor(source.id)}</small>
          </button>;
        })}
        <button type="button" className="agent-core" data-action="agent"
          data-geometry="agent-core" aria-label="查看工程智能体如何组织依据并协同评估"
          onClick={(): void => onNavigate({ type: 'agent' })}>
          <Brain size={28} /><strong>工程智能体</strong>
          <small>{level === 'macro' ? '分事项理解 · 分范围评估' : '理解本事项 · 协同判断'}</small>
          <span className="core-status">多源信息 → 判断依据</span>
        </button>
      </div>
      <div className="mobile-rings" aria-label="移动端信息聚合与评估辅助双环">
        <button type="button" className="mobile-core" data-action="agent"
          onClick={(): void => onNavigate({ type: 'agent' })}>
          <Brain size={20} /><span><strong>工程智能体</strong><small>多源信息 → 判断依据</small></span>
        </button>
        <div className="mobile-source-grid">
          {sourceCategories.map((source: TrinitySourceCategoryMeta) => (
            <button key={source.id} type="button" data-source-category={source.id}
              className={selectedSourceId === source.id ? 'selected' : ''}
              onClick={(): void => onSelectSource(source.id)}>
              <strong>{source.title}</strong><small>{sourceLabelFor(source.id)}</small>
            </button>
          ))}
        </div>
        <div className="mobile-stage-grid">
          {stages.map((stage: TrinityStageMeta, index: number) => (
            <button key={stage.id} type="button" data-stage={stage.id}
              className={selectedStageId === stage.id ? 'selected' : ''}
              onClick={(): void => onSelectStage(stage.id)}>
              <small>{String(index + 1).padStart(2, '0')}</small>
              <strong>{stage.title}</strong><small>{stageLabelFor(stage.id)}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="ring-caption">
        <span>内环形成依据，外环协同判断。</span>
        <span>关联位置不代表已完成，数量不相加作总体。</span>
      </div>
    </section>
  );
}
