import type { AssessmentReadingResult } from './assessment-reading.interface';
import type { JobAidProblemIssue } from './jobaid-problem-assessment.interface';

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
