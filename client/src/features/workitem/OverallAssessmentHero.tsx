import { useState } from 'react';
import {
  ChevronDown,
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
  onViewEvidence?: () => void;
  primaryActionLabel?: string;
}) {
  const [techOpen, setTechOpen] = useState(false);
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

  if (!overall) {
    return (
      <section
        className="wl-overall-hero wl-glass-content is-empty"
        aria-live="polite"
      >
        <Sparkles className="wl-overall-empty-icon" aria-hidden="true" />
        <h2>综合评估尚未形成</h2>
        <p>
          完成文件解析与必要评估后，综合意见会在这里显示。当前不会用示例内容代替真实结果。
        </p>
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
            <Sparkles aria-hidden="true" /> AI 初步意见 · 待工程师确认
          </p>
          <h2>{view.title}</h2>
        </div>
        <div className="wl-overall-head-meta">
          <span>基于本文件版本：{view.documentVersion}</span>
          <span>评估版本 r{overall.revision}</span>
          <span>
            {view.freshness === 'needs_update'
              ? `当前结论需更新${staleLabel ? `（${staleLabel}）` : ''}`
              : '当前结论仍有效'}
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
                    onClick={onViewEvidence}
                  >
                    <Link2 aria-hidden="true" />
                    <span>{evidence.label}</span>
                    {evidence.structurePath ? (
                      <small>{evidence.structurePath}</small>
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
          <button type="button" className="wl-btn" onClick={onViewEvidence}>
            <Link2 aria-hidden="true" /> 查看依据
          </button>
        ) : null}
        <span className="wl-overall-generated">本次结果未返回生成时间</span>
      </footer>

      <details
        className="wl-overall-tech"
        onToggle={(e) => setTechOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>
          <ChevronDown
            className={techOpen ? 'is-open' : ''}
            aria-hidden="true"
          />
          运行与版本详情（技术信息）
        </summary>
        <dl>
          <div>
            <dt>评估来源结果</dt>
            <dd>{overall.technicalDetails?.sourceResultId ?? '未返回'}</dd>
          </div>
          <div>
            <dt>基于基础规则版本</dt>
            <dd>r{overall.technicalDetails?.basedOnBaseRuleRevision ?? '—'}</dd>
          </div>
          <div>
            <dt>基于工程师复核版本</dt>
            <dd>
              {overall.technicalDetails?.basedOnEngineerReviewRevision != null
                ? `r${overall.technicalDetails.basedOnEngineerReviewRevision}`
                : '尚无工程师复核'}
            </dd>
          </div>
          <div>
            <dt>产物 SHA-256</dt>
            <dd title={overall.technicalDetails?.artifactSha256}>
              {overall.technicalDetails?.artifactSha256
                ? `${overall.technicalDetails.artifactSha256.slice(0, 18)}…`
                : '未返回'}
            </dd>
          </div>
          <div>
            <dt>分析任务</dt>
            <dd>{overall.technicalDetails?.actionAttemptId ?? '未返回'}</dd>
          </div>
        </dl>
      </details>
    </section>
  );
}
