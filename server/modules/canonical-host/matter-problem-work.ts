import type { AssessmentReadingResult, AssessmentReadingClaim } from '@shared/assessment-reading.interface';
import type { JobAidProblemWorkContent } from '@shared/jobaid-problem-assessment.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { jobAidProblemModelWorkContent } from './jobaid-problem-task';
import { materializeJobAidWork } from './jobaid-problem-work';

/** Reuse JobAid validation and Host risk calculation, with the real Matter identity. */
export function validateMatterProblemWork(
  content: JobAidProblemWorkContent,
  matterId: string,
  result: AssessmentReadingResult | null,
): void {
  if (!['NOT_AVAILABLE', 'CURRENT', 'STALE'].includes(content.overviewStatus)) fail('ENGINEERING_OVERVIEW_STATUS_INVALID');
  const reconstructed = materializeJobAidWork(
    jobAidProblemModelWorkContent(content),
    {
      matterId,
      methodBinding: content.methodBinding,
      previous: null,
      persistedOverviewStatus: content.overviewStatus,
      evidence: content.evidence,
      readSourceRefs: content.readSourceRefs,
      capabilities: content.capabilities,
      history: content.historyReview,
    },
  );
  const { historicalSourceSchema, ...currentContent } = content;
  if (historicalSourceSchema !== undefined && historicalSourceSchema !== 'wiselink.jobaid-problem-work.v2') fail('ENGINEERING_HISTORICAL_SCHEMA_INVALID');
  if (canonicalJson(reconstructed) !== canonicalJson(currentContent))
    fail('ENGINEERING_MATTER_PROBLEM_WORK_INVALID');
  const claims: AssessmentReadingClaim[] = [];
  const decisive: string[] = [];
  if (
    !result ||
    canonicalJson(result.content.issueArticles) !== canonicalJson(content.issues.map(({ issueKey, issueRef, question, body }) => ({ issueKey, issueRef, question, body }))) ||
    result.scope.kind !== 'ENGINEERING_MATTER' ||
    result.scope.matterId !== matterId ||
    result.content.headline !== content.headline ||
    result.content.listBrief !== content.listBrief ||
    result.content.lead !== content.understanding ||
    (!historicalSourceSchema && (canonicalJson(result.content.claims) !== canonicalJson(claims) ||
    canonicalJson(result.content.decisiveClaimIds) !== canonicalJson(decisive)))
  )
    fail('ENGINEERING_MATTER_PROBLEM_READING_MISMATCH');
  const evidence = new Map(
    content.evidence.map((item) => [item.evidenceRef, item]),
  );
  for (const item of result.evidence)
    if (
      canonicalJson(evidence.get(item.evidenceRef) ?? null) !==
      canonicalJson(item)
    )
      fail('ENGINEERING_MATTER_PROBLEM_EVIDENCE_MISMATCH');
}

function fail(code: string): never {
  throw Object.assign(new Error(code), { code, statusCode: 409 });
}
