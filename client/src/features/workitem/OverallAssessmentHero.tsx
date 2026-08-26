import {
  FileSearch2,
  Link2,
  ListChecks,
  MessageCircleQuestion,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react';

import type { WorkItemView } from '@client/src/services/viewModelMappers';
import { staleReasonLabel } from '@client/src/services/viewModelMappers';

import './workitem-overview.css';

/**
 * 综合评估主卡（Spec R01 §4.1 / §7 OverallAssessmentHero）。
 * 默认第一屏；候选标识 + 生成信息 + 六区块；技术详情可折叠。
 * 顶部始终显示“AI 生成于何时、基于哪个文件版本、当前是否仍有效”。
 */
export default function OverallAssessmentHero({
  view,
  onOpenWorkbench,
  onViewEvidence,
  primaryActionLabel = '开始复核',
}: {
  view: WorkItemView;
  onOpenWorkbench: () => void;
  onViewEvidence?: (sourceRefId?: string) => void;
  primaryActionLabel?: string;
}) {
  const overall = view.overall;
  const staleLabel = staleReasonLabel(
    (
      overall as never as {
        staleReason?:
          | 'BASE_RULE_RESULT_CHANGED'
          | 'ENGINEER_REVIEW_CHANGED'
          | null;
      }
    )?.staleReason ?? null,
  );
  const authorityLabel =
    view.authority === 'engineer_confirmed'
      ? 'AI 初步意见 · 人工确认已记录'
      : view.authority === 'formal_readback'
        ? '正式系统回读结果'
        : 'AI 初步意见 · 待工程师复核';

  if (!overall) {
    return (
      <section
        className="wl-overall-hero wl-glass-content is-empty"
        aria-live="polite"
      >
        <span className="wl-overall-empty-mark" aria-hidden="true">
          <Sparkles className="wl-overall-empty-icon" />
        </span>
        <h2>综合评估尚未形成</h2>
        <p>
          当前尚无综合候选意见。可先核对原文与解析结果；形成候选后仍需工程师复核。
        </p>
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

  return (
    <section
      className="wl-overall-hero wl-glass-content wl-focus-card"
      data-active="true"
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
              ? `当前结论需更新${staleLabel ? `（${staleLabel}）` : ''}`
              : view.authority === 'formal_readback'
                ? '正式回读当前有效'
                : '当前候选基于最新资料'}
          </span>
        </div>
      </header>

      <div className="wl-overall-judgment">
        <h3>
          <Target aria-hidden="true" /> 当前判断
        </h3>
        <p>{overall.currentJudgment}</p>
      </div>

      <div className="wl-overall-grid">
        <div className="wl-overall-block">
          <h3>
            <Target aria-hidden="true" /> 适用范围
          </h3>
          <p>{overall.applicabilitySummary}</p>
        </div>

        <div className="wl-overall-block">
          <h3>
            <ListChecks aria-hidden="true" /> 关键依据（{overall.sourceCount}{' '}
            条来源）
          </h3>
          {overall.keyEvidence.length > 0 ? (
            <ul>
              {overall.keyEvidence.map((evidence) => (
                <li key={evidence.id}>
                  <button
                    type="button"
                    className="wl-overall-evidence"
                    onClick={() => onViewEvidence?.(evidence.sourceRefId)}
                  >
                    <Link2 aria-hidden="true" />
                    <span>{evidence.label}</span>
                    {evidence.documentLabel ? (
                      <small>{evidence.documentLabel}</small>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wl-overall-empty-note">
              当前结果尚未关联逐条原文依据，可先查看解析结果。
            </p>
          )}
        </div>

        <div className="wl-overall-block">
          <h3>
            <MessageCircleQuestion aria-hidden="true" /> 未决问题（
            {overall.unresolvedQuestions.length}）
          </h3>
          {overall.unresolvedQuestions.length > 0 ? (
            <ul className="wl-overall-plain-list">
              {overall.unresolvedQuestions.map((question) => (
                <li key={question.id}>
                  <strong>{question.label}</strong>
                  {question.impact ? (
                    <small>影响：{question.impact}</small>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="wl-overall-empty-note">当前没有未决问题。</p>
          )}
        </div>

        <div className="wl-overall-block">
          <h3>
            <ShieldAlert aria-hidden="true" /> 风险与影响
          </h3>
          {overall.riskAndImpact.length > 0 ? (
            <ul className="wl-overall-plain-list">
              {overall.riskAndImpact.map((risk, index) => (
                <li key={index}>{risk}</li>
              ))}
            </ul>
          ) : (
            <p className="wl-overall-empty-note">
              目前没有证据支持的候选风险项。
            </p>
          )}
        </div>

        <div className="wl-overall-block">
          <h3>
            <FileSearch2 aria-hidden="true" /> 待补资料（
            {overall.missingInputs.length}）
          </h3>
          {overall.missingInputs.length > 0 ? (
            <ul className="wl-overall-plain-list">
              {overall.missingInputs.map((input, index) => (
                <li key={index}>
                  <strong>{input.label}</strong>
                  {input.impact ? <small>影响：{input.impact}</small> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="wl-overall-empty-note">当前没有待补资料。</p>
          )}
        </div>

        <div className="wl-overall-block">
          <h3>
            <ListChecks aria-hidden="true" /> 复核建议
          </h3>
          {overall.reviewRecommendations.length > 0 ? (
            <ul className="wl-overall-plain-list">
              {overall.reviewRecommendations.map((item, index) => (
                <li key={index}>
                  <strong>{item.label}</strong>
                  {item.detail ? <small>{item.detail}</small> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="wl-overall-empty-note">
              系统尚未给出复核建议；可从关键依据开始核对。
            </p>
          )}
        </div>
      </div>

      <footer className="wl-overall-actions">
        <button
          type="button"
          className="wl-btn wl-btn-primary"
          onClick={onOpenWorkbench}
        >
          <FileSearch2 aria-hidden="true" /> {primaryActionLabel}
        </button>
        {onViewEvidence ? (
          <button
            type="button"
            className="wl-btn"
            onClick={() => onViewEvidence()}
          >
            <Link2 aria-hidden="true" /> 查看依据
          </button>
        ) : null}
      </footer>
    </section>
  );
}
