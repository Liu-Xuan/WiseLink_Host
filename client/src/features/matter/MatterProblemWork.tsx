import type { EngineeringMatterWorkingRevisionReadModel } from '@shared/matter-working.interface';
import { JobAidIssueArticle } from '@client/src/pages/DocumentParsingPage/JobAidIssueArticle';
import type { DocumentAssessmentEvidence } from './assessment-reading';
import '@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css';

export default function MatterProblemWork({
  revision,
  onLocateDocument,
}: {
  revision: EngineeringMatterWorkingRevisionReadModel | null;
  onLocateDocument: (evidence: DocumentAssessmentEvidence) => void;
}) {
  const work = revision?.state.problemWork;
  const reading = revision?.state.substantiveResult;
  if (!work || !reading) return null;
  return (
    <section
      className="wl-jobaid-workspace mt-6 space-y-4"
      aria-label="已保存的问题分析"
    >
      <h2 className="text-lg font-semibold">问题分析</h2>
      {work.historicalSourceSchema ? <p>历史工作按原内容展开；这不是本轮新生成的分析。</p> : null}
      <p className="text-sm leading-7">{work.completionReason}</p>
      {work.overviewStatus !== 'CURRENT' ? <p>{work.overviewStatus === 'STALE' ? '现有综合尚未覆盖本次问题更新。' : '问题正文可读；综合尚未形成。'}</p> : null}
      {work.issues.map((issue) => (
        <details
          key={issue.issueRef}
          className="rounded-xl border border-border p-4"
        >
          <summary className="cursor-pointer font-medium">
            {issue.question}
          </summary>
          {revision?.correctionNotices?.filter(notice => notice.issueKey === issue.issueKey).map(notice => (
            <p key={notice.attemptRef} role="note" className="mt-3 text-sm leading-7">
              {notice.correctedWorkRef ? '此版本已有后继更正；当前展示仍为原版本。' : '本问题已登记待核更正，以下内容尚未完成更正。'}
              {' '}{notice.reason}
            </p>
          ))}
          <div className="wl-jobaid-article mt-4">
            <JobAidIssueArticle
              issue={issue}
              reading={{ ...reading, evidence: work.evidence }}
              onLocateDocument={onLocateDocument}
            />
          </div>
        </details>
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
