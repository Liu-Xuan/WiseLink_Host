import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { JobAidIssueArticle } from '@client/src/pages/DocumentParsingPage/JobAidIssueArticle';
import type { DocumentAssessmentEvidence } from './assessment-reading';
import ReferenceWorkNotices from './ReferenceWorkNotices';
import MatterSavedWorkNotices from './MatterSavedWorkNotices';
import EngineeringIssueBody from './EngineeringIssueBody';
import { SavedJobAidIssueContext, SavedJobAidMethodNotice } from './SavedJobAidReadingContext';
import '@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css';

export default function MatterProblemWork({
  revision,
  onLocateDocument,
  showReferenceNotices = true,
  showMethodNotice = true,
  showSavedWorkNotices = true,
}: {
  revision: EngineeringMatterWorkingRevisionReadModel | null;
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
  showReferenceNotices?: boolean;
  showMethodNotice?: boolean;
  showSavedWorkNotices?: boolean;
}) {
  const work = revision?.state.problemWork;
  if (!work || !revision) return null;
  return (
    <section
      className="wl-jobaid-workspace mt-6 space-y-4"
      aria-label="已保存的问题分析"
    >
      <h2 className="text-lg font-semibold">问题分析</h2>
      {showMethodNotice ? <SavedJobAidMethodNotice work={work} /> : null}
      {work.historicalSourceSchema ? (
        <p>历史工作按原内容展开；这不是本轮新生成的分析。</p>
      ) : null}
      <p className="text-sm leading-7">{work.completionReason}</p>
      {work.overviewStatus !== 'CURRENT' ? (
        <p>
          {work.overviewStatus === 'STALE'
            ? '现有综合尚未覆盖本次问题更新。'
            : '问题正文可读；综合尚未形成。'}
        </p>
      ) : null}
      {showSavedWorkNotices ? <MatterSavedWorkNotices revision={revision} /> : null}
      {work.issues.map((issue) => (
        <article
          key={issue.issueRef}
          data-issue-ref={issue.issueRef}
          className="rounded-xl border border-border p-4"
        >
          <h3 className="font-medium">{issue.question}</h3>
          {showReferenceNotices ? (
            <ReferenceWorkNotices
              notices={revision.referenceWorkNotices?.filter((notice) =>
                notice.affectedIssueKeys.includes(issue.issueKey),
              )}
            />
          ) : null}
          <p className="text-sm text-muted-foreground">本版保存的完整问题判断</p>
          {issue.body ? <EngineeringIssueBody body={issue.body} evidence={work.evidence} onLocateDocument={onLocateDocument} /> : <p>未取得本版保存正文，不能用问题标题替代判断。</p>}
          <SavedJobAidIssueContext issue={issue} evidence={work.evidence} onLocateDocument={onLocateDocument} />
          <details className="wl-jobaid-evidence">
            <summary>展开本问题的分析理由与方法依据</summary>
            <div className="wl-jobaid-article mt-4">
              <JobAidIssueArticle
                issue={issue}
                evidence={work.evidence}
                onLocateDocument={onLocateDocument}
                bodyAlreadyVisible
                contextAlreadyVisible
              />
            </div>
          </details>
        </article>
      ))}
      {work.capabilities
        .filter((item) => item.status !== 'AVAILABLE')
        .map((item) => (
          <p key={item.capability} className="text-sm text-muted-foreground">
            {item.impact}
          </p>
        ))}
      {work.historyReview.limitation ? (
        <p className="text-sm text-muted-foreground">
          {work.historyReview.limitation}
        </p>
      ) : null}
    </section>
  );
}
