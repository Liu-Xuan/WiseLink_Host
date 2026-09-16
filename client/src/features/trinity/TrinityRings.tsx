import { useMemo } from 'react';
import {
  Brain,
  BookOpen,
  Eye,
  FileText,
  Layers,
  RefreshCw,
  Search,
  Shield,
  Wrench,
} from 'lucide-react';
import {
  buildRingArrows,
  knowledgeAnchor,
  nodePositionPercent,
  stageAnchor,
  TRINITY_RING,
} from './trinity-model';
import type {
  TrinityKnowledgeStageMeta,
  TrinityMatter,
  TrinityNavigationTarget,
  TrinityStageMeta,
} from './trinity-types';

const STAGE_ICONS = [
  Search, Eye, BookOpen, FileText, Layers, Wrench, Shield, RefreshCw,
] as const;

interface TrinityRingsProps {
  stages: TrinityStageMeta[];
  knowledgeStages: TrinityKnowledgeStageMeta[];
  selectedStageId: string;
  selectedKnowledgeId: string;
  level: 'macro' | 'focus';
  stageLabelFor: (stageId: string) => string;
  focusActiveStageIds: string[];
  onSelectStage: (stageId: string) => void;
  onSelectKnowledge: (stageId: string) => void;
  onNavigate: (target: TrinityNavigationTarget) => void;
}

export default function TrinityRings({
  stages, knowledgeStages, selectedStageId, selectedKnowledgeId,
  level, stageLabelFor, focusActiveStageIds, onSelectStage, onSelectKnowledge, onNavigate,
}: TrinityRingsProps) {
  const arrows = useMemo(() => buildRingArrows(), []);
  const hasSelection = selectedStageId !== '' || selectedKnowledgeId !== '';
  const focusActives = useMemo(() => new Set(focusActiveStageIds), [focusActiveStageIds]);

  return (
    <section className="card ring-card" data-geometry="ring-card">
      <div className="ring-header">
        <span className="legend"><i />业务环 · 事项全生命周期</span>
        <span className="legend knowledge"><i />知识环 · 工作中积累与复用</span>
      </div>
      <div className="ring-board" data-geometry="ring-board">
        <div className="ring-ambient" aria-hidden="true" />
        <svg
          className="ring-svg"
          viewBox={`0 0 ${TRINITY_RING.viewWidth} ${TRINITY_RING.viewHeight}`}
          aria-hidden="true"
        >
          <ellipse
            className="outer-route"
            cx={TRINITY_RING.cx}
            cy={TRINITY_RING.cy}
            rx={TRINITY_RING.outerRx}
            ry={TRINITY_RING.outerRy}
          />
          <ellipse
            className="ring-halo"
            cx={TRINITY_RING.cx}
            cy={TRINITY_RING.cy}
            rx={TRINITY_RING.innerRx + 6}
            ry={TRINITY_RING.innerRy + 4}
          />
          <ellipse
            className="inner-route"
            cx={TRINITY_RING.cx}
            cy={TRINITY_RING.cy}
            rx={TRINITY_RING.innerRx}
            ry={TRINITY_RING.innerRy}
          />
          {arrows.map((a: { d: string; transform: string; kind: string }, i: number) => (
            <path
              key={i}
              className={a.kind === 'business' ? 'ring-arrow' : 'ring-knowledge-arrow'}
              d={a.d}
              transform={a.transform}
            />
          ))}
          <path
            className={`ring-bridge ${hasSelection ? 'on' : ''}`}
            d="M870 303Q750 319 687 372M497 437Q519 475 500 538"
          />
        </svg>

        {stages.map((s: TrinityStageMeta, i: number) => {
          const pos = nodePositionPercent(stageAnchor(i));
          const Icon = STAGE_ICONS[i];
          const isFocusActive = level === 'focus' && focusActives.has(s.id);
          const isFocusUnentered = level === 'focus' && !focusActives.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              className={`stage-node ${selectedStageId === s.id ? 'selected' : ''} ${
                isFocusActive ? 'focus-active' : isFocusUnentered ? 'focus-unentered' : ''
              }`}
              style={pos}
              data-stage={s.id}
              data-geometry={`stage-${s.id}`}
              aria-label={`${s.title}，${stageLabelFor(s.id)}`}
              onClick={(): void => onSelectStage(s.id)}
            >
              <span className="stage-top">
                <small>{String(i + 1).padStart(2, '0')}</small>
                <Icon size={16} />
              </span>
              <strong>{s.title}</strong>
              <span className="stage-count">{stageLabelFor(s.id)}</span>
            </button>
          );
        })}

        {knowledgeStages.map((k: TrinityKnowledgeStageMeta, i: number) => {
          const pos = nodePositionPercent(knowledgeAnchor(i));
          return (
            <button
              key={k.id}
              type="button"
              className={`knowledge-node ${selectedKnowledgeId === k.id ? 'selected' : ''}`}
              style={pos}
              data-kstage={k.id}
              onClick={(): void => onSelectKnowledge(k.id)}
              aria-label={`${k.title}，知识循环`}
            >
              <strong>{k.title}</strong>
              <small>知识循环</small>
            </button>
          );
        })}

        <button
          type="button"
          className="agent-core"
          data-action="agent"
          data-geometry="agent-core"
          aria-label="查看工程智能体如何协助工作"
          onClick={(): void => onNavigate({ type: 'agent' })}
        >
          <Brain size={22} />
          <strong>工程智能体</strong>
          <small>理解 · 调查 · 评估 · 协作</small>
          <span className="core-status">
            <i className="dot" />
            基于已有知识，继续工程工作
          </span>
        </button>
      </div>

      <div className="mobile-rings" aria-label="移动端业务环与知识环">
        <button
          type="button"
          className="mobile-core"
          data-action="agent"
          onClick={(): void => onNavigate({ type: 'agent' })}
        >
          <Brain size={20} />
          <span>
            <strong>工程智能体</strong>
            <small>理解 · 调查 · 评估 · 协作</small>
          </span>
        </button>
        <div className="mobile-stage-grid">
          {stages.map((s: TrinityStageMeta, i: number) => (
            <button
              key={s.id}
              type="button"
              data-stage={s.id}
              className={selectedStageId === s.id ? 'selected' : ''}
              onClick={(): void => onSelectStage(s.id)}
            >
              <small>{String(i + 1).padStart(2, '0')}</small>
              <span className="stage-next">→</span>
              <strong>{s.title}</strong>
              <small>{stageLabelFor(s.id)}</small>
            </button>
          ))}
        </div>
        <div className="mobile-knowledge">
          {knowledgeStages.map((k: TrinityKnowledgeStageMeta) => (
            <button
              key={k.id}
              type="button"
              data-kstage={k.id}
              onClick={(): void => onSelectKnowledge(k.id)}
            >
              {k.title}
            </button>
          ))}
        </div>
      </div>

      <div className="ring-caption">
        <span>同一事项可在多个环节并行，阶段数量不相加作总数。</span>
        <span>箭头表示业务循环，不代表已执行。</span>
      </div>
    </section>
  );
}
