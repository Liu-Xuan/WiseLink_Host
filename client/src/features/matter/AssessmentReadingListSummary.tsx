import type { FC } from 'react';
import type {
  AssessmentReadingResult,
  AssessmentReadingSummary,
} from '@shared/assessment-reading.interface';

import { assessmentClaimGroups } from './assessment-reading';

export function savedReadingSummary(
  result: AssessmentReadingResult,
): AssessmentReadingSummary {
  return {
    resultRef: result.resultRef,
    resultRevision: result.resultRevision,
    headline: result.content.headline,
    listBrief: result.content.listBrief,
    decisiveClaims: assessmentClaimGroups(result).decisive.map(
      ({ claimId, text }) => ({ claimId, text }),
    ),
  };
}

const AssessmentReadingListSummary: FC<{
  summary: AssessmentReadingSummary;
}> = ({ summary }) => (
  <span
    className="library-saved-list-summary"
    data-result-ref={summary.resultRef}
    data-result-revision={summary.resultRevision}
  >
    {summary.roundCompletion === 'IN_PROGRESS' ? (
      <small>分析进行中 · 已保存工作</small>
    ) : null}
    <strong className="library-saved-list-brief">{summary.headline}</strong>
    <small className="library-saved-list-brief">{summary.listBrief}</small>
    {summary.decisiveClaims.map((claim) => (
      <small
        className="library-saved-list-brief"
        data-claim-id={claim.claimId}
        key={claim.claimId}
      >
        {claim.text}
      </small>
    ))}
  </span>
);

export default AssessmentReadingListSummary;
