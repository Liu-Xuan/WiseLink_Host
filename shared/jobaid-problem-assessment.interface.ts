import type {
  AssessmentEvidence,
  AssessmentReadingClaim,
  AssessmentReadingResult,
} from './assessment-reading.interface';
import type {
  CanonicalCommonAssessmentContext,
  UnifiedPackageArtifactDescriptor,
} from './api.interface';

export const JOBAID_PROBLEM_WORK_SCHEMA =
  'wiselink.jobaid-problem-work.v2' as const;
export const JOBAID_PROBLEM_TASK_SCHEMA =
  'wiselink.jobaid-problem-task.v2' as const;
export const JOBAID_PROBLEM_RESULT_SCHEMA =
  'wiselink.jobaid-problem-result.v2' as const;

/** Model-facing context saved in the existing versioned assessment task input. */
export interface JobAidAssessmentContextPackage {
  basedOnWorkItemRevision: number;
  basedOnWorkingRevision: number | null;
  primaryDocument: CanonicalCommonAssessmentContext['primaryDocument'] & {
    readingStatus: CanonicalCommonAssessmentContext['documentReading']['status'];
  };
  supplementaryMaterials: {
    status: CanonicalCommonAssessmentContext['relatedMaterials']['status'];
    reason: string | null;
    items: Array<
      Omit<
        CanonicalCommonAssessmentContext['relatedMaterials']['items'][number],
        'availableSourceRefIds' | 'readFragments'
      > & {
        availableEvidenceRefs: string[];
        deliveredEvidenceRefs: string[];
      }
    >;
  };
  sourceOrigins: Array<{
    evidenceRef: string;
    origin: string;
    contentNature:
      | 'SOURCE_DOCUMENT_CONTENT'
      | 'UNVERIFIED_ENGINEER_STATEMENT'
      | 'UNVERIFIED_QUERY_RESPONSE'
      | 'PRIOR_CANDIDATE'
      | 'CONTROLLED_HOST_FACT'
      | 'METHOD_MATERIAL';
  }>;
  knowledgeRetrieval: CanonicalCommonAssessmentContext['knowledgeRetrieval'];
}

export interface JobAidMethodBinding {
  packRef: string;
  version: string;
  sources: Array<{
    sourceIdentity: string;
    versionLabel: string;
    documentVersionId: string | null;
    status: 'CONFIRMED' | 'VERSION_UNCONFIRMED';
  }>;
  attachment5: 'R00_CONTENT_REPORTED_R01_LINK_UNCONFIRMED';
}

export interface JobAidClassificationProposal {
  label: string;
  reason: string;
  basisRefs: string[];
}

export interface JobAidRiskScenario {
  scenario: string;
  conditions: string[];
  method: 'JA_AC_R01';
  severity: JobAidClassificationProposal | null;
  likelihood: JobAidClassificationProposal | null;
  /** Host calculation. Unknown never has score zero or an inferred low grade. */
  score: number | null;
  riskGrade: 1 | 2 | 3 | 4 | 5 | null;
  gradeMeaning: string | null;
  importantEvent: { event: string; basisRefs: string[]; reason: string } | null;
  limitations: string[];
  controlComparison: string;
}

export interface JobAidRequirementHandling {
  methodRef: string;
  requirement: string;
  conditions: string[];
  treatment:
    | 'ADDRESSED'
    | 'CONDITIONS_UNCONFIRMED'
    | 'NOT_APPLICABLE_WITH_BASIS'
    | 'LATER_BUSINESS_STAGE'
    | 'NOT_YET_ADDRESSED';
  basisRefs: string[];
  explanation: string;
}

export interface JobAidProblemIssue {
  issueKey: string;
  issueRef: string;
  question: string;
  understanding: string;
  statements: AssessmentReadingClaim[];
  riskScenarios: JobAidRiskScenario[];
  measures: Array<{
    text: string;
    addresses: string;
    limitations: string[];
    status: 'PROPOSED' | 'REPORTED_IMPLEMENTED' | 'VERIFIED_EFFECTIVE';
    basisRefs: string[];
  }>;
  /** Separate method identities; no conversion to JA-AC grades. */
  otherClassifications: Array<{
    method:
      | 'SAE_EVENT_CATEGORY'
      | 'SOURCE_DOCUMENT_CLASSIFICATION'
      | 'EO_ATTRIBUTE';
    value: string;
    reason: string;
    basisRefs: string[];
  }>;
  openQuestions: Array<{
    question: string;
    affects: string;
    nextEvidence: string;
    reason: string;
  }>;
  requirementHandling: JobAidRequirementHandling[];
  sourceDependencies: string[];
  premiseRefs: string[];
  legacyCriterionRefs?: string[];
}

export interface JobAidProblemWorkContent {
  schemaVersion: typeof JOBAID_PROBLEM_WORK_SCHEMA;
  headline: string;
  listBrief: string;
  understanding: string;
  decisiveIssueKeys: string[];
  issues: JobAidProblemIssue[];
  roundCompletion: 'IN_PROGRESS' | 'COMPLETE' | 'COMPLETE_WITH_OPEN_QUESTIONS';
  completionReason: string;
  changeSummary: string;
  unchangedExplanation: string;
  methodBinding: JobAidMethodBinding;
  /** All actual inputs, including important premises not eventually cited. */
  evidence: AssessmentEvidence[];
  readSourceRefs: string[];
  capabilities: Array<{
    capability: string;
    status:
      | 'AVAILABLE'
      | 'NOT_CONNECTED'
      | 'ACCESS_DENIED'
      | 'NOT_FOUND'
      | 'PARTIAL'
      | 'READ_FAILED';
    impact: string;
  }>;
  historyReview: {
    required: boolean;
    priorAssessmentRefs: string[];
    engineeringDocumentRefs: string[];
    coverage: 'AVAILABLE_HISTORY_REVIEWED' | 'PARTIAL' | 'NOT_REQUIRED';
    limitation: string | null;
  };
}

export interface JobAidWorkRevision {
  workRevisionRef: string;
  workItemId: string;
  workRevision: number;
  previousWorkRevisionRef: string | null;
  requestId: string;
  actionAttemptId: string;
  basedOnWorkItemRevision: number;
  documentVersionId: string;
  createdAt: string;
  content: JobAidProblemWorkContent;
}

export interface CanonicalJobAidProblemCandidateProjection {
  schemaVersion: typeof JOBAID_PROBLEM_RESULT_SCHEMA;
  status: 'CANDIDATE_ONLY';
  revision: number;
  sourceResultId: string;
  workRevisionRef: string;
  workRevision: number;
  issueCount: number;
  openQuestionCount: number;
  roundCompletion: 'COMPLETE' | 'COMPLETE_WITH_OPEN_QUESTIONS';
  methodBinding: JobAidMethodBinding;
  headline: string;
  listBrief: string;
  artifact: UnifiedPackageArtifactDescriptor;
  actionAttemptId: string;
  /** Saved once, shared by the default brief and detailed issue view. */
  readingResult: AssessmentReadingResult;
}

export interface JobAidWorkingReadModel {
  schemaVersion: 'wiselink.jobaid-working-read.v2';
  enabled: boolean;
  workItemId: string;
  current: JobAidWorkRevision | null;
  executionStatus: string | null;
  currentInputChanged: boolean;
  overallStatus: 'NOT_AVAILABLE' | 'CURRENT' | 'STALE';
  overallBasedOnWorkRevisionRef: string | null;
}

export function isJobAidProblemProjection(
  value: unknown,
): value is CanonicalJobAidProblemCandidateProjection {
  return (
    !!value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    value.schemaVersion === JOBAID_PROBLEM_RESULT_SCHEMA
  );
}

export function jobAidReadingResult(
  revision: JobAidWorkRevision,
): AssessmentReadingResult {
  return {
    resultRef: revision.workRevisionRef,
    resultRevision: revision.workRevision,
    scope: {
      kind: 'WORK_ITEM',
      workItemId: revision.workItemId,
      documentVersionId: revision.documentVersionId,
    },
    content: {
      schemaVersion: 'wiselink.3_1.assessment_reading.v1',
      headline: revision.content.headline,
      listBrief: revision.content.listBrief,
      lead: revision.content.understanding,
      claims: revision.content.issues.flatMap((item) => item.statements),
      decisiveClaimIds: revision.content.issues
        .filter((item) =>
          revision.content.decisiveIssueKeys.includes(item.issueKey),
        )
        .flatMap((item) => item.statements.map((claim) => claim.claimId)),
    },
    evidence: structuredClone(revision.content.evidence),
    candidateOnly: true,
  };
}
