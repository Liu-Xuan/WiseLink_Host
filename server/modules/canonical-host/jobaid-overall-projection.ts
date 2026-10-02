import type {
  CanonicalOpenClawOverallProjection,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import { jobAidReadingResult } from './jobaid-problem-work';

/** The saved v3 work is the only source of candidate text and counts. */
export function buildJobAidOverallProjection(input: {
  workItem: CanonicalWorkItemProjection;
  revision: JobAidWorkRevision;
  artifact: UnifiedPackageArtifactDescriptor;
  actionAttemptId: string;
  sourceResultId: string;
  applicabilityStatus: string;
  modelProvenance?: {
    modelVersion: string;
    promptVersion: string;
    skillVersion: string;
    toolVersions: Record<string, string>;
  };
  deterministicSource?: {
    reviewConversationId: string;
    reviewTurnId: string;
  };
}): CanonicalOpenClawOverallProjection {
  const base = input.workItem.integratedAssessment?.baseRules;
  if (!base) throw new Error('JOBAID_OVERALL_BASE_VERSION_INVALID');
  const revision = input.revision;
  return {
    status: 'CANDIDATE_ONLY',
    revision: (input.workItem.integratedAssessment?.overallSynthesis?.revision ?? 0) + 1,
    sourceResultId: input.sourceResultId,
    basedOnBaseRuleRevision: base.revision,
    basedOnBaseRuleArtifactSha256: base.artifact.sha256,
    basedOnEngineerReviewRevision:
      input.workItem.integratedAssessment?.engineerReviews?.revision ?? null,
    basedOnEngineerReviewArtifactSha256:
      input.workItem.integratedAssessment?.engineerReviews?.artifact.sha256 ?? null,
    discoveryStatus: 'NO_DISCOVERY',
    gap: revision.content.issues.flatMap((issue) =>
      issue.openQuestions.map((q) => q.question)).join('；') || null,
    candidateRefCount: 0,
    findingCount: revision.content.issues.length,
    unresolvedCount: revision.content.issues.reduce(
      (sum, issue) => sum + issue.openQuestions.length, 0),
    authorityLevel: 'candidate_only',
    externalDiscoveryIsEvidence: false,
    artifact: input.artifact,
    actionAttemptId: input.actionAttemptId,
    staleReason: null,
    overallCandidate: revision.content.understanding,
    readingResult: jobAidReadingResult(revision),
    basedOnJobAidWorkRevisionRef: revision.workRevisionRef,
    affectedIssueKeys: revision.content.decisiveIssueKeys,
    missingInputs: revision.content.issues.flatMap((issue) =>
      issue.openQuestions.map((item) => item.question)),
    applicabilityStatus: input.applicabilityStatus,
    engineeringReviewRequired: true,
    providers: {},
    ...(input.modelProvenance ?? {}),
    ...(input.deterministicSource ? {
      executionKind: 'DETERMINISTIC_PROJECTION' as const,
      modelRequests: 0 as const,
      sourceReview: {
        ...input.deterministicSource,
        actionAttemptId: revision.actionAttemptId,
        workRevisionRef: revision.workRevisionRef,
        workRevision: revision.workRevision,
      },
    } : {}),
  };
}
