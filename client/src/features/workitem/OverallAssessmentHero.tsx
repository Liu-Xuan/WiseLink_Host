import {
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  FileSearch2,
  Gauge,
  Link2,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Target,
  Wrench,
} from 'lucide-react';

import type {
  EngineeringStatementView,
  WorkItemView,
} from '@client/src/services/viewModelMappers';
import {
  AUTHORITY_LABELS,
  FRESHNESS_LABELS,
  staleReasonLabel,
} from '@client/src/services/viewModelMappers';
import type { OverallRegenerationControl } from './useOverallRegeneration';

import './workitem-overview.css';

function SourceBoundStatement({
  statement,
  judgment = false,
  onViewEvidence,
}: {
  statement: EngineeringStatementView;
  judgment?: boolean;
  onViewEvidence?: (sourceRefId?: string) => void;
}) {
  return (
    <li className="wl-engineering-statement" data-judgment={judgment}>
      <p className="wl-engineering-statement-text">{statement.text}</p>
      <div className="wl-engineering-statement-meta">
        <span className="wl-statement-basis" data-basis={statement.basis}>
          {statement.basis === 'SOURCE_FACT' ? '来源事实' : '条件性推断'}
        </span>
        <button
          type="button"
          className="wl-source-ref-button"
          onClick={() => onViewEvidence?.(statement.sourceRefIds[0])}
          disabled={!onViewEvidence}
        >
          <Link2 aria-hidden="true" />
          {statement.sourceRefIds.length} 条原文依据
        </button>
      </div>
    </li>
  );
}

function StatementList({
  statements,
  onViewEvidence,
}: {
  statements: EngineeringStatementView[];
  onViewEvidence?: (sourceRefId?: string) => void;
}) {
  return (
    <ul className="wl-engineering-list">
      {statements.map((statement, index) => (
        <SourceBoundStatement
          key={`${statement.text}-${index}`}
          statement={statement}
          onViewEvidence={onViewEvidence}
        />
      ))}
    </ul>
  );
}

/**
 * 综合评估主卡。
 * 第一屏只呈现有当前 DocumentVersion SourceRef 支撑的工程结论、影响与动作；
 * 候选状态、版本、模型与计数统一收进折叠技术详情。
 */
export default function OverallAssessmentHero({
  view,
  onOpenWorkbench,
  onViewEvidence,
  regeneration,
  primaryActionLabel = '处理异常并完成批准',
}: {
  view: WorkItemView;
  onOpenWorkbench: () => void;
  onViewEvidence?: (sourceRefId?: string) => void;
  regeneration?: OverallRegenerationControl;
  primaryActionLabel?: string;
}) {
  const overall = view.overall;
  const requiredFactCount = overall?.applicability.requiredFacts.length ?? 0;
  const heroState =
    view.freshness === 'superseded'
      ? 'obsolete'
      : view.authority === 'formal_readback'
        ? 'formal'
        : view.freshness === 'needs_update'
          ? 'stale'
          : requiredFactCount > 0
            ? 'waiting'
            : view.authority === 'engineer_confirmed'
              ? 'engineer-confirmed'
              : 'candidate';
  const staleLabel = staleReasonLabel(overall?.staleReason ?? null);
  const authorityLabel =
    heroState === 'obsolete'
      ? '历史意见 · 已被新版本替代'
      : heroState === 'stale'
        ? '工程候选 · 当前结论需更新'
        : view.authority === 'engineer_confirmed'
          ? '工程候选 · 人工确认已记录'
          : view.authority === 'formal_readback'
            ? '正式系统回读结果'
            : '工程候选 · 待最终批准';

  if (!overall) {
    return (
      <section
        className="wl-overall-hero wl-glass-content is-empty"
        data-state="empty"
        aria-live="polite"
      >
        <span className="wl-overall-empty-mark" aria-hidden="true">
          <Sparkles className="wl-overall-empty-icon" />
        </span>
        <h2>综合评估尚未形成</h2>
        <p>当前没有可用的综合工程候选。可先查看原文与解析状态。</p>
        <button
          type="button"
          className="wl-btn wl-btn-primary"
          onClick={onOpenWorkbench}
        >
          <FileSearch2 aria-hidden="true" /> 查看原文与解析
        </button>
      </section>
    );
  }

  if (!overall.conclusion) {
    return (
      <section
        className="wl-overall-hero wl-glass-content wl-overall-structure-missing"
        data-state="waiting"
        aria-live="polite"
      >
        <span className="wl-overall-empty-mark" aria-hidden="true">
          <CircleAlert className="wl-overall-empty-icon" />
        </span>
        <h2>需要重新生成工程摘要</h2>
        <p>
          历史候选没有逐结论绑定当前文件版本原文依据，不能作为当前工程判断展示。
        </p>
        <button
          type="button"
          className="wl-btn wl-btn-primary wl-regeneration-button"
          onClick={regeneration?.run ?? onOpenWorkbench}
          disabled={regeneration?.disabled}
          aria-busy={regeneration?.busy || undefined}
          data-busy={regeneration?.busy || undefined}
        >
          {regeneration ? (
            regeneration.busy ? (
              <LoaderCircle className="wl-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )
          ) : (
            <FileSearch2 aria-hidden="true" />
          )}
          {regeneration?.label ?? '查看详情'}
        </button>
        {regeneration?.message ? (
          <p
            className="wl-regeneration-status"
            data-tone={regeneration.tone}
            role={regeneration.tone === 'error' ? 'alert' : 'status'}
          >
            {regeneration.message}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="wl-overall-hero wl-glass-content wl-focus-card"
      data-state={heroState}
      data-active={heroState === 'candidate' ? 'true' : 'false'}
    >
      <header className="wl-overall-head">
        <div>
          <p className="wl-overall-eyebrow">
            <Sparkles aria-hidden="true" /> {authorityLabel}
          </p>
          <h2>{view.title}</h2>
        </div>
        <div className="wl-overall-head-meta">
          <span>基于当前受控文件版本</span>
          <span>
            {view.freshness === 'needs_update'
              ? `结论需更新${staleLabel ? `（${staleLabel}）` : ''}`
              : requiredFactCount > 0
                ? `待确认 ${requiredFactCount} 项适用性事实`
                : '工程摘要已绑定原文依据'}
          </span>
        </div>
      </header>

      <div className="wl-overall-judgment">
        <h3>
          <Target aria-hidden="true" /> 工程结论
        </h3>
        <ul className="wl-engineering-list">
          <SourceBoundStatement
            statement={overall.conclusion}
            judgment
            onViewEvidence={onViewEvidence}
          />
        </ul>
      </div>

      <details className="wl-overall-supporting">
        <summary>
          <span>展开依据、适用范围与下一步</span>
          <small>保留当前判断作为首要信息</small>
          <ChevronDown aria-hidden="true" />
        </summary>
        <div className="wl-overall-grid">
          <section className="wl-overall-block">
            <h3>
              <CircleAlert aria-hidden="true" /> 为什么重要
            </h3>
            <StatementList
              statements={overall.whyItMatters}
              onViewEvidence={onViewEvidence}
            />
          </section>

          <section className="wl-overall-block is-wide">
            <h3>
              <Target aria-hidden="true" /> 适用飞机与当前机队匹配
            </h3>
            <StatementList
              statements={[
                ...(overall.applicability.sourceScope
                  ? [overall.applicability.sourceScope]
                  : []),
                ...(overall.applicability.fleetMatch
                  ? [overall.applicability.fleetMatch]
                  : []),
                ...overall.applicability.requiredFacts,
              ]}
              onViewEvidence={onViewEvidence}
            />
          </section>

          <section className="wl-overall-block">
            <h3>
              <Wrench aria-hidden="true" /> 实施影响
            </h3>
            <StatementList
              statements={overall.implementationImpact}
              onViewEvidence={onViewEvidence}
            />
          </section>

          <section className="wl-overall-block">
            <h3>
              <Gauge aria-hidden="true" /> 处置优先级
            </h3>
            <StatementList
              statements={overall.dispositionPriority}
              onViewEvidence={onViewEvidence}
            />
          </section>

          <section className="wl-overall-block is-wide">
            <h3>
              <ClipboardCheck aria-hidden="true" /> 下一步
            </h3>
            <StatementList
              statements={overall.nextActions}
              onViewEvidence={onViewEvidence}
            />
          </section>
        </div>
      </details>

      <footer className="wl-overall-actions">
        <button
          type="button"
          className="wl-btn wl-btn-primary"
          onClick={onOpenWorkbench}
        >
          <ListChecks aria-hidden="true" /> {primaryActionLabel}
        </button>
        {onViewEvidence ? (
          <button
            type="button"
            className="wl-btn"
            onClick={() => onViewEvidence()}
          >
            <Link2 aria-hidden="true" /> 查看全部依据
          </button>
        ) : null}
      </footer>

      <details className="wl-overall-tech">
        <summary>
          <ChevronDown aria-hidden="true" /> 技术详情
        </summary>
        <dl>
          <div>
            <dt>当前阶段</dt>
            <dd>{AUTHORITY_LABELS[view.authority]}</dd>
          </div>
          <div>
            <dt>结论状态</dt>
            <dd>
              {FRESHNESS_LABELS[view.freshness]}
              {staleLabel ? `（${staleLabel}）` : ''}
            </dd>
          </div>
          <div>
            <dt>受控文件版本</dt>
            <dd>{view.documentVersion}</dd>
          </div>
          <div>
            <dt>翻译 / 评估进度</dt>
            <dd>
              {overall.technicalDetails.translationProgress ?? '未返回'} /{' '}
              {overall.technicalDetails.evaluationProgress}
            </dd>
          </div>
          <div>
            <dt>原文依据 / 待补事实</dt>
            <dd>
              {overall.sourceCount} 条 / {requiredFactCount} 项
            </dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
