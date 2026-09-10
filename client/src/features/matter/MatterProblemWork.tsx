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
      <p className="text-sm leading-7">{work.completionReason}</p>
      {work.issues.map((issue) => (
        <details
          key={issue.issueRef}
          className="rounded-xl border border-border p-4"
        >
          <summary className="cursor-pointer font-medium">
            {issue.question}
          </summary>
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
