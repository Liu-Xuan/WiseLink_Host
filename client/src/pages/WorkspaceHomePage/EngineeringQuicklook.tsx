import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardCopy,
  FileSearch2,
  Link2,
  Sparkles,
} from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import {
  quicklookMarkdown,
  type EngineeringQuicklookView,
} from '@client/src/features/navigation/contextual-navigation';

interface EngineeringQuicklookProps {
  title: string;
  quicklook: EngineeringQuicklookView | null;
  onOpenWorkbench: () => void;
  onContinueReview: () => void;
  onOpenFamily: () => void;
  onLocateEvidence: (sourceRefId: string) => void;
}

export default function EngineeringQuicklook({
  title,
  quicklook,
  onOpenWorkbench,
  onContinueReview,
  onOpenFamily,
  onLocateEvidence,
}: EngineeringQuicklookProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );

  async function copyQuicklook(): Promise<void> {
    if (!quicklook) return;
    try {
      await navigator.clipboard.writeText(quicklookMarkdown(title, quicklook));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
    }
  }

  return (
    <aside
      className="library-quicklook-panel"
      aria-label="工程快览"
      data-wl-material="g3"
    >
      <div className="library-panel-heading">
        <div>
          <span className="library-section-label">当前选择</span>
          <h2>工程快览</h2>
        </div>
        <Sparkles aria-hidden="true" />
      </div>

      {!quicklook ? (
        <div className="library-quicklook-empty">
          <FileSearch2 aria-hidden="true" />
          <strong>选择资料查看工程摘要</strong>
          <p>当前判断、适用范围、依据、缺口和建议动作将在这里同步显示。</p>
        </div>
      ) : (
        <div className="library-quicklook-scroll">
          <header className="library-quicklook-title">
            <div>
              <h3>{title}</h3>
              <p>
                {quicklook.authorityLabel} · {quicklook.freshnessLabel}
              </p>
            </div>
            <span className="library-quicklook-boundary">工程辅助</span>
          </header>

          <section className="library-quicklook-judgment">
            <span>
              <Sparkles aria-hidden="true" /> 当前候选判断
            </span>
            <p>{quicklook.currentJudgment}</p>
          </section>

          <dl className="library-quicklook-facts">
            <div>
              <dt>适用范围</dt>
              <dd>{quicklook.applicabilitySummary}</dd>
            </div>
            <div>
              <dt>为什么需要关注</dt>
              <dd>{quicklook.whyItMatters}</dd>
            </div>
          </dl>

          <section className="library-quicklook-section">
            <h3>
              <Link2 aria-hidden="true" /> 关键依据
              {typeof quicklook.sourceCount === 'number' ? (
                <small>{quicklook.sourceCount} 条来源</small>
              ) : null}
            </h3>
            {quicklook.keyEvidence.length > 0 ? (
              <ul>
                {quicklook.keyEvidence.map((evidence, index: number) => (
                  <li key={`${evidence.sourceRefId ?? 'evidence'}:${index}`}>
                    {evidence.sourceRefId ? (
                      <button
                        type="button"
                        onClick={() =>
                          onLocateEvidence(evidence.sourceRefId ?? '')
                        }
                      >
                        <span>{evidence.label}</span>
                        <ArrowRight aria-hidden="true" />
                      </button>
                    ) : (
                      <span>{evidence.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="library-quicklook-missing">
                当前未返回可定位的关键依据。
              </p>
            )}
          </section>

          <section className="library-quicklook-section is-warning">
            <h3>
              <AlertTriangle aria-hidden="true" /> 未决问题
            </h3>
            {quicklook.unresolvedQuestions.length > 0 ? (
              <ul>
                {quicklook.unresolvedQuestions.map((question: string) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            ) : (
              <p className="library-quicklook-missing">
                当前没有明确返回的未决问题。
              </p>
            )}
          </section>

          <section className="library-quicklook-section is-next">
            <h3>
              <Check aria-hidden="true" /> 建议下一步
            </h3>
            {quicklook.recommendedActions.length > 0 ? (
              <ol>
                {quicklook.recommendedActions.map((action: string) => (
                  <li key={action}>{action}</li>
                ))}
              </ol>
            ) : (
              <p className="library-quicklook-missing">
                可进入统一工作台继续查看原文、解析结果和复核状态。
              </p>
            )}
          </section>

          <details className="library-quicklook-family">
            <summary>资料族、版本与附件</summary>
            <dl>
              <div>
                <dt>当前受控版本</dt>
                <dd>{quicklook.documentVersionLabel}</dd>
              </div>
              <div>
                <dt>关联资料</dt>
                <dd>
                  {quicklook.relatedDocumentCount === null
                    ? '进入资料族后读取'
                    : `${quicklook.relatedDocumentCount} 项`}
                </dd>
              </div>
            </dl>
            <p>
              历史版本与附件清单不在资料库首屏预取；进入资料族后按当前权限读取。
            </p>
            <Button type="button" variant="outline" onClick={onOpenFamily}>
              打开资料族与历史 <ArrowRight aria-hidden="true" />
            </Button>
          </details>

          <div className="library-quicklook-actions">
            <Button type="button" onClick={onOpenWorkbench}>
              打开统一工作台 <ArrowRight aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" onClick={onContinueReview}>
              继续复核
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void copyQuicklook()}
            >
              <ClipboardCopy aria-hidden="true" />
              {copyState === 'copied'
                ? '已复制'
                : copyState === 'error'
                  ? '复制不可用'
                  : '结构化复制'}
            </Button>
          </div>
          <p className="library-quicklook-note">
            候选摘要仅用于辅助工程判断，不会自动确认、批准或发布。
          </p>
        </div>
      )}
    </aside>
  );
}
