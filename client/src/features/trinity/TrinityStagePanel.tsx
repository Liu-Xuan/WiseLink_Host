import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { ArrowRight } from 'lucide-react';
import {
  attentionItems,
  scopeKnowledge,
  completeCoverage,
  completeLifecycleCoverage,
} from './trinity-model';
import type {
  TrinityKnowledgeItem,
  TrinityKnowledgeStageMeta,
  TrinityMatter,
  TrinityNavigationTarget,
  TrinitySituationData,
  TrinityStageMeta,
} from './trinity-types';

interface TrinityStagePanelProps {
  data: TrinitySituationData;
  scope: TrinityMatter[] | null;
  selectedStageId: string;
  selectedKnowledgeId: string;
  onNavigate: (target: TrinityNavigationTarget) => void;
}

export default function TrinityStagePanel({
  data, scope, selectedStageId, selectedKnowledgeId, onNavigate,
}: TrinityStagePanelProps) {
  if (selectedStageId) {
    const stage = data.stages.find((s: TrinityStageMeta) => s.id === selectedStageId);
    if (!stage) return null;
    const matters = (scope ?? []).filter((m: TrinityMatter) =>
      m.activeStages.includes(selectedStageId));
    return (
      <>
        <div className="eyebrow">业务环 · {stage.caption}</div>
        <h2>{stage.title}</h2>
        <p className="lead">{stage.purpose}</p>

        <section>
          <h3>这个环节形成什么</h3>
          <p>{stage.output}</p>
          <div className="knowledge-output">
            随业务保存，供知识库复用
            <span>来源、范围、责任与版本共同保留</span>
          </div>
        </section>

        <section>
          <div className="row">
            <h3>当前关联事项</h3>
            <Badge variant="outline">{scope && completeLifecycleCoverage(data) ? `${matters.length} 项` : '—'}</Badge>
          </div>
          {scope && matters.length > 0 ? (
            <div className="matter-list">
              {matters.map((m: TrinityMatter) => (
                <button
                  key={m.id}
                  type="button"
                  className="phase-matter"
                  data-focus={m.id}
                  onClick={(): void => onNavigate({ type: 'focus-matter', matterId: m.id })}
                >
                  <small>{m.code} · {m.fleet}</small>
                  <strong>{m.title}</strong>
                  <small>{m.status}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-tip">
              当前范围未取得此环节的记录，不自动推断已完成或不适用。
            </p>
          )}
        </section>

        <div className="end-actions">
          <Button variant="outline" size="sm"
            onClick={(): void => onNavigate({ type: 'stage-library', stageId: stage.id })}>
            表格查看
          </Button>
          <Button variant="outline" size="sm"
            onClick={(): void => onNavigate({ type: 'stage-knowledge', stageId: stage.id })}>
            查看知识产出
            <ArrowRight size={14} />
          </Button>
        </div>
      </>
    );
  }

  if (selectedKnowledgeId) {
    const k = data.knowledgeStages.find(
      (x: TrinityKnowledgeStageMeta) => x.id === selectedKnowledgeId);
    if (!k) return null;
    const examples = scope ? scopeKnowledge(data, scope).slice(0, 3) : [];
    return (
      <>
        <div className="eyebrow">知识环 · 来自业务，反哺业务</div>
        <h2>{k.title}</h2>
        <p className="lead">{k.purpose}</p>
        <section>
          <h3>当前工作中的例子</h3>
          <div className="matter-list">
            {examples.map((it: TrinityKnowledgeItem) => (
              <button
                key={it.id}
                type="button"
                className="phase-matter"
                data-knowledge={it.id}
                onClick={(): void =>
                  onNavigate({ type: 'knowledge-item', knowledgeId: it.id })}
              >
                <small>
                  {data.stages.find((s: TrinityStageMeta) => s.id === it.phase)?.title}产出 ·
                  {it.version}
                </small>
                <strong>{it.title}</strong>
                <small>{it.status}</small>
              </button>
            ))}
          </div>
          {(!scope || !completeCoverage(data, 'knowledge')) && <p className="empty-tip">当前范围未取得知识记录，不自动推断为零。</p>}
        </section>
        <section>
          <h3>不是第二套知识审批</h3>
          <p>
            治理随产生、读取和复用进行。知识可以带条件复用；正式采用仍保持独立身份。
          </p>
        </section>
        <div className="end-actions">
          <Button size="sm"
            onClick={(): void => onNavigate({ type: 'knowledge-view', phase: k.id })}>
            进入统一知识查阅
            <ArrowRight size={14} />
          </Button>
        </div>
      </>
    );
  }

  const attention = attentionItems(scope).slice(0, 3);
  return (
    <>
      <div className="eyebrow">从全貌到需要关注的工作</div>
      <h2>当前关注</h2>
      <p className="lead">先看变化与条件，再进入具体事项理解。</p>

        <div className="attention-list">
          {attention.map((m: TrinityMatter) => (
            <button
              key={m.id}
              type="button"
              className="attention-item"
              onClick={(): void => onNavigate({ type: 'focus-matter', matterId: m.id })}
            >
              <Badge variant="secondary" className="at-badge">
                {m.tag}
              </Badge>
              <strong>{m.title}</strong>
              <p>{m.next}</p>
            </button>
          ))}
        </div>

      <section>
        <h3>知识也需要跟着变化</h3>
        <p>
          文件自身更新、原文更正与工程师纠正，会使有关知识需要复看；不代表所有事项一起重算。
        </p>
      </section>
        <div className="end-actions">
          <Button variant="outline" size="sm"
            onClick={(): void => onNavigate({ type: 'view', view: 'library' })}>
            表格查看全部事项
          </Button>
          <Button variant="outline" size="sm"
            onClick={(): void => onNavigate({ type: 'knowledge-view' })}>
            知识查阅
          </Button>
        </div>
    </>
  );
}
