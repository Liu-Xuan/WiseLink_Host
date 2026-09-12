import type { AssessmentReadingResult } from '@shared/assessment-reading.interface';
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
  const reconstructed = materializeJobAidWork(
    jobAidProblemModelWorkContent(content),
    {
      matterId,
      methodBinding: content.methodBinding,
      previous: null,
      evidence: content.evidence,
      readSourceRefs: content.readSourceRefs,
      capabilities: content.capabilities,
      history: content.historyReview,
    },
  );
  if (canonicalJson(reconstructed) !== canonicalJson(content))
    fail('ENGINEERING_MATTER_PROBLEM_WORK_INVALID');
  const claims = content.issues.flatMap((issue) => issue.statements);
  const decisive = content.issues
    .filter((issue) => content.decisiveIssueKeys.includes(issue.issueKey))
    .flatMap((issue) => issue.statements.map((claim) => claim.claimId));
  if (
    !result ||
    result.scope.kind !== 'ENGINEERING_MATTER' ||
    result.scope.matterId !== matterId ||
    result.content.headline !== content.headline ||
    result.content.listBrief !== content.listBrief ||
    result.content.lead !== content.understanding ||
    canonicalJson(result.content.claims) !== canonicalJson(claims) ||
    canonicalJson(result.content.decisiveClaimIds) !== canonicalJson(decisive)
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
