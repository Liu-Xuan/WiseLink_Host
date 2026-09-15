import type { AssessmentReadingResult } from './assessment-reading.interface';
import type { JobAidProblemIssue } from './jobaid-problem-assessment.interface';
import type { EngineeringMatterCorrectionNotice, EngineeringMatterReferenceWorkNotice } from './matter-working.interface';

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
  referenceWorkNotices?: EngineeringMatterReferenceWorkNotice[];
  /** Coverage of the overview attached to this exact saved work, not publisher currentness. */
  overviewStatus?: 'NOT_AVAILABLE' | 'CURRENT' | 'STALE';
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
