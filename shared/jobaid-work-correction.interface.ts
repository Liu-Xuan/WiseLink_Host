import type { JobAidRiskScenario, JobAidWorkRevision } from './jobaid-problem-assessment.interface';

export const JOBAID_WORK_CORRECTION_SCHEMA = 'wiselink.jobaid-work-correction.v1';
export const JOBAID_WORK_CORRECTION_RECEIPT_SCHEMA = 'wiselink.jobaid-work-correction-receipt.v1';

interface JobAidWorkCorrectionText {
  issueKey: string;
  issueRef: string;
  expectedOldValue: string;
  newValue: string;
  reason: string;
  /** Existing exact references in the saved work and its actual read-source registry. */
  evidenceRefs: string[];
}
export interface JobAidIssueBodyCorrection extends JobAidWorkCorrectionText {
  field: 'ISSUE_BODY';
}
export interface JobAidRiskSeverityReasonCorrection extends JobAidWorkCorrectionText {
  field: 'RISK_SEVERITY_REASON';
  scenarioIndex: number;
  /** No stable scenario id exists: compare this complete, exact prior scenario. */
  expectedScenario: JobAidRiskScenario;
}
export type JobAidWorkCorrectionChange = JobAidIssueBodyCorrection | JobAidRiskSeverityReasonCorrection;
export interface JobAidWorkCorrectionRequest {
  schemaVersion: typeof JOBAID_WORK_CORRECTION_SCHEMA;
  requestId: string;
  baseWorkRef: string;
  baseWorkRevision: number;
  expectedWorkItemRevision: number;
  changes: JobAidWorkCorrectionChange[];
}
export type JobAidWorkCorrectionChangedField =
  | Pick<JobAidIssueBodyCorrection, 'field' | 'issueKey' | 'issueRef'>
  | Pick<JobAidRiskSeverityReasonCorrection, 'field' | 'issueKey' | 'issueRef' | 'scenarioIndex'>;
export interface JobAidWorkCorrectionReceipt {
  schemaVersion: typeof JOBAID_WORK_CORRECTION_RECEIPT_SCHEMA;
  requestId: string;
  executionKind: 'HOST_MANUAL_CORRECTION';
  modelRequests: 0;
  semanticReanalysisPerformed: false;
  status: 'SAVED' | 'UNCHANGED';
  executionAttemptId: string;
  workItemId: string;
  baseWorkRef: string;
  baseWorkRevision: number;
  workRevisionRef: string;
  workRevision: number;
  workItemRevision: number;
  changedFields: JobAidWorkCorrectionChangedField[];
  adopted: false;
  candidateCarrierAdvanced: false;
  replayed: boolean;
  /** Exact immutable saved revision; a later latest-work read may legitimately differ. */
  work: JobAidWorkRevision;
}
