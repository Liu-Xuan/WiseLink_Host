import type { AssessmentReadingResult } from './assessment-reading.interface';
import type { JobAidProblemIssue, JobAidProblemWorkContent } from './jobaid-problem-assessment.interface';
import type { EngineeringMatterCorrectionNotice, EngineeringMatterOverviewCorrectionNotice, EngineeringMatterReferenceWorkNotice, EngineeringMatterOverviewSourceWork } from './matter-working.interface';

export interface EngineeringIssueSearchHit {
  subjectKind: 'WORK_ITEM' | 'ENGINEERING_MATTER';
  subjectId: string;
  workRef: string;
  workRevision: number;
  issueKey: string;
  question: string;
  sourceRefs: string[];
  /** Narrow protocol metadata; it does not grant access to the source body. */
  kind: 'SOURCE' | 'RECORD' | 'WORK';
  matchedRange: string;
  reason: string;
  rootRefs: string[];
  correctionNotices?: EngineeringMatterCorrectionNotice[];
  overviewCorrectionNotices?: EngineeringMatterOverviewCorrectionNotice[];
  referenceWorkNotices?: EngineeringMatterReferenceWorkNotice[];
  /** Coverage of the overview attached to this exact saved work, not publisher currentness. */
  overviewStatus?: 'NOT_AVAILABLE' | 'CURRENT' | 'STALE';
  overviewSourceWork?: EngineeringMatterOverviewSourceWork | null;
}

export interface EngineeringIssueSearchResponse {
  hits: EngineeringIssueSearchHit[];
  hasMore: boolean;
  limitations: string[];
}

export interface EngineeringIssueRead {
  identity: EngineeringIssueSearchHit;
  issue: JobAidProblemIssue;
  reading: AssessmentReadingResult;
}

/** A saved work is the knowledge catalogue unit; its issues are read on demand. */
export type EngineeringKnowledgeScope = 'CURRENT' | 'ALL' | 'HISTORICAL';
export type EngineeringKnowledgeIdentity = Pick<EngineeringIssueSearchHit, 'subjectKind' | 'subjectId' | 'workRef'>;
export interface EngineeringKnowledgeEntry extends EngineeringKnowledgeIdentity {
  workRevision: number;
  current: boolean;
  headline: string;
  listBrief: string;
  createdAt: string;
  overviewStatus: JobAidProblemWorkContent['overviewStatus'];
}
export interface EngineeringKnowledgePage {
  entries: EngineeringKnowledgeEntry[];
  nextCursor: string | null;
}
export interface EngineeringKnowledgeRead {
  entry: EngineeringKnowledgeEntry;
  content: JobAidProblemWorkContent;
  reading: AssessmentReadingResult;
  correctionNotices?: EngineeringMatterCorrectionNotice[];
  overviewCorrectionNotices?: EngineeringMatterOverviewCorrectionNotice[];
  referenceWorkNotices?: EngineeringMatterReferenceWorkNotice[];
  overviewSourceWork?: EngineeringMatterOverviewSourceWork | null;
}

export interface EngineeringIssueReferenceRequest {
  targetMatterId: string;
  expectedMatterRevisionId: string;
  expectedMatterRevision: number;
  expectedWorkingRevision: number;
  requestId: string;
  source: { subjectKind: 'ENGINEERING_MATTER'; subjectId: string; workRef: string; issueKey: string };
  purpose: string;
}

export interface EngineeringIssueReferenceReceipt {
  targetMatterId: string;
  source: EngineeringIssueReferenceRequest['source'];
  attemptRef: string;
  status: string;
  created: boolean;
}

export interface EngineeringIssueReferenceStatus {
  targetMatterId: string;
  attemptRef: string;
  status: string;
  errorCode: string | null;
}
