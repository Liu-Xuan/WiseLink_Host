import { ArrowRight } from 'lucide-react';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import {
  attentionItems, completeAssessmentCoverage, scopeSources,
} from './trinity-model';
import type {
  TrinityMatter, TrinityNavigationTarget, TrinityReviewConditionItem,
  TrinitySituationData, TrinitySourceCategoryMeta, TrinitySourceItem,
  TrinityStageMeta,
} from './trinity-types';

interface TrinityStagePanelProps {
  data: TrinitySituationData;
  scope: TrinityMatter[] | null;
  level: 'macro' | 'focus';
  selectedStageId: string;
  selectedSourceId: string;
  onNavigate: (target: TrinityNavigationTarget) => void;
}

function ReviewConditions({
  conditions, onNavigate,
}: {
  conditions: TrinityReviewConditionItem[] | null | undefined;
  onNavigate: (target: TrinityNavigationTarget) => void;
}) {
  if (conditions === undefined || conditions === null) {
    return <p className="empty-tip">
      {conditions === null
        ? '聚焦事项已取得，但尚无当前已保存工作。'
        : '当前范围未携带聚焦事项的已保存工作。'}
    </p>;
  }
  if (conditions.length === 0)
    return <p className="empty-tip">当前已保存工作未单独保存复看条件。</p>;
  return <div className="matter-list">
    {conditions.map((condition: TrinityReviewConditionItem) => (
      <button key={condition.itemId} type="button" className="phase-matter"
        data-review-condition={condition.itemId}
        onClick={(): void => onNavigate({
          type: 'matter-work', matterId: condition.matterId,
          workRef: condition.matterWorkRevisionId,
        })}>
        <small>工作修订 {condition.workingRevision}</small>
        <strong>{condition.text}</strong>
        <small>依据引用：{condition.basisRefs.length
          ? condition.basisRefs.join('、') : '未单独保存'}</small>
      </button>
    ))}
  </div>;
}

export default function TrinityStagePanel({
  data, scope, level, selectedStageId, selectedSourceId, onNavigate,
}: TrinityStagePanelProps) {
  if (selectedStageId) {
    const stage: TrinityStageMeta | undefined = data.stages.find(
      (item: TrinityStageMeta) => item.id === selectedStageId,
    );
    if (!stage) return null;
    const matters: TrinityMatter[] = (scope ?? []).filter(
      (matter: TrinityMatter) =>
        matter.activeAssessmentStages.includes(selectedStageId),
    );
    return <>
      <div className="eyebrow">外环 · {stage.caption}</div>
      <h2>{stage.title}</h2>
      <p className="lead">{stage.purpose}</p>
      <section>
        <h3>这一环节形成什么</h3>
        <p>{stage.output}</p>
      </section>
      <section>
        <div className="row">
          <h3>当前关联事项</h3>
          <Badge variant="outline">
            {scope && completeAssessmentCoverage(data) ? `${matters.length} 项` : '已取得范围'}
          </Badge>
        </div>
        {matters.length ? <div className="matter-list">
          {matters.map((matter: TrinityMatter) => (
            <button key={matter.id} type="button" className="phase-matter"
              data-focus={matter.id}
              onClick={(): void => onNavigate({
                type: 'focus-matter', matterId: matter.id,
              })}>
              <small>{matter.code || '工程事项'} · {matter.fleet}</small>
              <strong>{matter.title}</strong><small>{matter.status}</small>
            </button>
          ))}
        </div> : <p className="empty-tip">
          当前范围尚未取得该评估环节的关联工作，不推断为已完成或不适用。
        </p>}
      </section>
      {stage.id === 'update' ? <section>
        <div className="row"><h3>已保存复看条件</h3></div>
        <p>这是候选工作内容，不代表已经触发、逾期或正式采用。</p>
        <ReviewConditions conditions={data.reviewConditions}
          onNavigate={onNavigate} />
      </section> : null}
      <div className="end-actions">
        <Button variant="outline" size="sm"
          onClick={(): void => onNavigate({
            type: 'stage-library', stageId: stage.id,
          })}>查看有关事项</Button>
        <Button variant="outline" size="sm"
          onClick={(): void => onNavigate({ type: 'knowledge-view' })}>
          查阅已有知识 <ArrowRight size={14} />
        </Button>
      </div>
    </>;
  }

  if (selectedSourceId) {
    const category: TrinitySourceCategoryMeta | undefined =
      data.sourceCategories.find(
        (item: TrinitySourceCategoryMeta) => item.id === selectedSourceId,
      );
    if (!category) return null;
    const sources: TrinitySourceItem[] = scope
      ? scopeSources(data, scope).filter(
        (source: TrinitySourceItem) => source.category === selectedSourceId,
      ) : [];
    return <>
      <div className="eyebrow">内环 · {category.subtitle}</div>
      <h2>{category.title}</h2>
      <p className="lead">{category.purpose}</p>
      <section>
        <h3>当前取得的材料</h3>
        {sources.length ? <div className="matter-list">
          {sources.map((source: TrinitySourceItem) => (
            <button key={source.id} type="button" className="source-item"
              data-source={source.id}
              onClick={(): void => onNavigate({
                type: 'source-item', sourceId: source.id,
              })}>
              <small>{source.version}</small><strong>{source.title}</strong>
              <span>{source.contribution}</span>
            </button>
          ))}
        </div> : <p className="empty-tip">
          当前授权读取未取得这一类材料。缺少记录不表示该类信息不存在。
        </p>}
      </section>
      <div className="end-actions">
        <Button variant="outline" size="sm"
          onClick={(): void => onNavigate({ type: 'view', view: 'library' })}>
          进入资料库 <ArrowRight size={14} />
        </Button>
      </div>
    </>;
  }

  if (level === 'focus' && scope?.[0]) {
    const matter: TrinityMatter = scope[0];
    return <>
      <div className="eyebrow">{matter.code || '聚焦事项'} · 当前授权认识</div>
      <h2>目前怎样理解</h2>
      <p className="lead">{matter.brief}</p>
      <section className="condition-panel">
        <h3>会改变判断的条件</h3><p>{matter.next}</p>
      </section>
      <section><h3>综合覆盖</h3><p>{matter.status}</p></section>
      <div className="end-actions">
        <Button size="sm" onClick={(): void => onNavigate({
          type: 'matter-reading', matterId: matter.id,
        })}>阅读完整认识</Button>
        <Button variant="outline" size="sm"
          onClick={(): void => onNavigate({ type: 'knowledge-view' })}>
          查阅知识
        </Button>
      </div>
    </>;
  }

  const attention: TrinityMatter[] = attentionItems(scope).slice(0, 4);
  return <>
    <div className="eyebrow">宏观概览 · 从资料到评估</div>
    <h2>当前关注</h2>
    <p className="lead">先看哪些事项需要继续核对，再进入具体依据与认识。</p>
    <div className="attention-list">
      {attention.map((matter: TrinityMatter) => (
        <button key={matter.id} type="button" className="attention-item"
          onClick={(): void => onNavigate({
            type: 'focus-matter', matterId: matter.id,
          })}>
          <Badge variant="secondary" className="at-badge">{matter.tag}</Badge>
          <strong>{matter.title}</strong><p>{matter.next}</p>
        </button>
      ))}
      {!attention.length ? <p className="empty-tip">
        当前读取范围尚未取得可确定的待核事项；未知不会显示为零。
      </p> : null}
    </div>
    <div className="end-actions">
      <Button variant="outline" size="sm"
        onClick={(): void => onNavigate({ type: 'view', view: 'library' })}>
        查看本范围事项
      </Button>
    </div>
  </>;
}
