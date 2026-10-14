import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ClipboardCopy,
  FileSearch2,
  Link2,
  LoaderCircle,
  Sparkles,
} from 'lucide-react';

import { Button } from '@client/src/components/ui/button';
import SavedAssessmentReading from '@client/src/features/matter/SavedAssessmentReading';
import type { DocumentAssessmentEvidence } from '@client/src/features/matter/assessment-reading';
import {
  quicklookMarkdown,
  type EngineeringQuicklookView,
} from '@client/src/features/navigation/contextual-navigation';

interface EngineeringQuicklookProps {
  title: string;
  quicklook: EngineeringQuicklookView | null;
  loading?: boolean;
  readError?: { title: string; message: string } | null;
  onOpenWorkbench: () => void;
  onContinueReview: () => void;
  onOpenFamily: () => void;
  onLocateEvidence: (sourceRefId: string) => void;
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
}

export default function EngineeringQuicklook({
  title,
  quicklook,
  loading = false,
  readError = null,
  onOpenWorkbench,
  onContinueReview,
  onOpenFamily,
  onLocateEvidence,
  onLocateDocument,
}: EngineeringQuicklookProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );

  const hasSavedAssessment = Boolean(
    quicklook?.readingResult || quicklook?.resultIdentity,
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
      data-result-ref={quicklook?.resultIdentity?.resultRef}
      data-result-revision={quicklook?.resultIdentity?.revision}
    >
      <div className="library-panel-heading">
        <div>
          <span className="library-section-label">当前选择</span>
          <h2>工程快览</h2>
        </div>
        <Sparkles aria-hidden="true" />
      </div>

      {!quicklook ? (
        <div className="library-quicklook-empty" role="status">
          {loading ? (
            <LoaderCircle className="library-spin" aria-hidden="true" />
          ) : readError ? (
            <AlertTriangle aria-hidden="true" />
          ) : (
            <FileSearch2 aria-hidden="true" />
          )}
          <strong>
            {loading
              ? '正在读取已保存摘要…'
              : (readError?.title ?? '选择资料查看工程摘要')}
          </strong>
          {readError ? <p>{readError.message}</p> : null}
        </div>
      ) : (
        <div className="library-quicklook-scroll">
          {readError ? (
            <div className="library-quicklook-read-error" role="alert">
              <strong>{readError.title}</strong>
              <p>{readError.message} 以下保留上次读取的摘要。</p>
            </div>
          ) : loading ? (
            <p className="library-quicklook-note" role="status">
              正在更新已保存摘要…
            </p>
          ) : null}
          <header className="library-quicklook-title">
            <div>
              <h3>{title}</h3>
              {hasSavedAssessment ? (
                <p>
                  {[quicklook.authorityLabel, quicklook.freshnessLabel]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          </header>

          {hasSavedAssessment && quicklook.sourceReadNote ? (
            <p className="library-quicklook-note">{quicklook.sourceReadNote}</p>
          ) : null}

          {!hasSavedAssessment ? (
            <div className="library-quicklook-empty" role="status">
              <FileSearch2 aria-hidden="true" />
              <strong>暂无已保存评估</strong>
            </div>
          ) : quicklook.readingResult ? (
            <SavedAssessmentReading
              result={quicklook.readingResult}
              onLocateDocument={onLocateDocument}
            />
          ) : (
            <>
              {quicklook.currentJudgment ? (
                <section className="library-quicklook-judgment">
                  <span>
                    <Sparkles aria-hidden="true" /> 当前判断
                  </span>
                  <p>{quicklook.currentJudgment}</p>
                </section>
              ) : null}

              {quicklook.applicabilitySummary || quicklook.whyItMatters ? (
                <dl className="library-quicklook-facts">
                  {quicklook.applicabilitySummary ? (
                    <div>
                      <dt>适用范围</dt>
                      <dd>{quicklook.applicabilitySummary}</dd>
                    </div>
                  ) : null}
                  {quicklook.whyItMatters ? (
                    <div>
                      <dt>为什么需要关注</dt>
                      <dd>{quicklook.whyItMatters}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}

              {quicklook.keyEvidence.length > 0 ? (
                <section className="library-quicklook-section">
                  <h3>
                    <Link2 aria-hidden="true" /> 关键依据
                    {typeof quicklook.sourceCount === 'number' ? (
                      <small>{quicklook.sourceCount} 条来源</small>
                    ) : null}
                  </h3>

                  <ul>
                    {quicklook.keyEvidence.map((evidence, index: number) => (
                      <li key={`statement:${index}`}>
                        <p>{evidence.label}</p>
                        {evidence.sourceRefIds.map(
                          (sourceRefId: string, sourceIndex: number) => (
                            <button
                              key={`${sourceRefId}:${sourceIndex}`}
                              type="button"
                              onClick={() => onLocateEvidence(sourceRefId)}
                            >
                              <span>核对依据 {sourceIndex + 1}</span>
                              <ArrowRight aria-hidden="true" />
                            </button>
                          ),
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {quicklook.unresolvedQuestions.length > 0 ? (
                <section className="library-quicklook-section is-warning">
                  <h3>
                    <AlertTriangle aria-hidden="true" /> 未决问题
                  </h3>

                  <ul>
                    {quicklook.unresolvedQuestions.map(
                      (question: string, index: number) => (
                        <li key={`${index}:${question}`}>{question}</li>
                      ),
                    )}
                  </ul>
                </section>
              ) : null}

              {quicklook.recommendedActions.length > 0 ? (
                <section className="library-quicklook-section is-next">
                  <h3>
                    <Check aria-hidden="true" /> 建议下一步
                  </h3>

                  <ol>
                    {quicklook.recommendedActions.map(
                      (action: string, index: number) => (
                        <li key={`${index}:${action}`}>{action}</li>
                      ),
                    )}
                  </ol>
                </section>
              ) : null}
            </>
          )}
          {quicklook.currentVersionLabel ||
          quicklook.derivedArtifactCount !== null ? (
            <details className="library-quicklook-family">
              <summary>当前版本／派生产物</summary>
              <dl>
                {quicklook.currentVersionLabel ? (
                  <div>
                    <dt>当前版本</dt>
                    <dd>{quicklook.currentVersionLabel}</dd>
                  </div>
                ) : null}
                {quicklook.derivedArtifactCount !== null ? (
                  <div>
                    <dt>派生产物</dt>
                    <dd>{quicklook.derivedArtifactCount} 项</dd>
                  </div>
                ) : null}
              </dl>
              <Button type="button" variant="outline" onClick={onOpenFamily}>
                打开当前资料 <ArrowRight aria-hidden="true" />
              </Button>
            </details>
          ) : null}

          <div className="library-quicklook-actions">
            <Button type="button" onClick={onOpenWorkbench}>
              阅读原文 <ArrowRight aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" onClick={onContinueReview}>
              继续复核
            </Button>
            {!quicklook.currentVersionLabel &&
            quicklook.derivedArtifactCount === null ? (
              <Button type="button" variant="outline" onClick={onOpenFamily}>
                打开当前资料 <ArrowRight aria-hidden="true" />
              </Button>
            ) : null}
            {hasSavedAssessment ? (
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
            ) : null}
          </div>
        </div>
      )}
    </aside>
  );
}
