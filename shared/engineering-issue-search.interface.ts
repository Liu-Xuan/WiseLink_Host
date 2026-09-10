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
}

export interface EngineeringIssueSearchResponse {
  hits: EngineeringIssueSearchHit[];
  hasMore: boolean;
}

export interface EngineeringIssueRead {
  identity: EngineeringIssueSearchHit;
  issue: JobAidProblemIssue;
  reading: AssessmentReadingResult;
}
