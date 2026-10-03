import type { AssessmentEvidence } from './assessment-reading.interface';
import type { JobAidProblemIssue } from './jobaid-problem-assessment.interface';

/** Explicit analysis scope; classification candidates never grant applicability. */
export interface DerivedSummaryScopeSelection {
  kind: 'ATA4' | 'ATA2' | 'FLEET';
  title: string;
  fleetFamilyId: string;
  fleetModelIds: string[];
  ata2: string | null;
  ata4: string | null;
  selectionReason: string;
}

export type DerivedSummaryMember =
  | { kind: 'WORK_ITEM_WORK'; workItemId: string; documentVersionId: string;
      workRef: string; workRevision: number; issueKeys: string[] }
  | { kind: 'MATTER_WORK'; matterId: string; workRef: string;
      workRevision: number; issueKeys: string[] }
  | { kind: 'DERIVED_SUMMARY'; summaryId: string; summaryRef: string;
      summaryRevision: number };

export interface CreateDerivedSummaryRequest {
  requestId: string;
  scope: DerivedSummaryScopeSelection;
  members: DerivedSummaryMember[];
  instruction: string;
  /** Explicit existing official Hosted route, captured once for this request. */
  modelRef: string;
}

export interface RequestDerivedSummaryUpdate extends CreateDerivedSummaryRequest {
  expectedSummaryRevision: number;
}

export interface DerivedSummaryRequestReceipt {
  summaryId: string;
  attemptRef: string;
  status: string;
  created: boolean;
}

/** Complete authorized member text, not a catalogue or current summary projection. */
export interface DerivedSummaryMemberReading {
  member: DerivedSummaryMember;
  evidenceRef: string;
  headline: string;
  body: string;
  issues: JobAidProblemIssue[];
  evidence: AssessmentEvidence[];
  rootRefs: string[];
  limitations: string[];
  current: boolean;
  overviewStatus: 'CURRENT' | 'STALE' | 'NOT_AVAILABLE';
  /** Exact transitive leaves; a child summary is not an independent root source. */
  leaves: DerivedSummaryMember[];
}

export interface DerivedSummaryContent {
  headline: string;
  listBrief: string;
  body: string;
  limitations: string[];
}

export interface DerivedSummaryCoverage {
  member: DerivedSummaryMember;
  evidenceRef: string;
  delivered: boolean;
  used: boolean;
  rootRefs: string[];
  limitation: string;
}

export interface DerivedSummaryRevision {
  summaryId: string;
  summaryRef: string;
  revision: number;
  scope: DerivedSummaryScopeSelection;
  classificationStatus: 'CANDIDATE';
  members: DerivedSummaryMemberReading[];
  content: DerivedSummaryContent;
  evidence: AssessmentEvidence[];
  usedEvidenceRefs: string[];
  coverage: DerivedSummaryCoverage[];
  requestId: string;
  attemptRef: string;
  createdAt: string;
  candidateOnly: true;
  producer?: DerivedSummaryProducer;
}

/** Driver-observed production metadata; never supplied as source evidence. */
export interface DerivedSummaryProducer {
  configuredModelRef: string;
  actualModel: string | null;
  promptVersion: string;
  skillVersion: string;
  toolVersions: Record<string, string>;
}

/** Owned discovery metadata. Reading it never authorizes a source body. */
export interface DerivedSummaryMetadata {
  summaryId: string;
  scope: DerivedSummaryScopeSelection;
  classificationStatus: 'CANDIDATE';
  currentSummaryRef: string | null;
  currentRevision: number;
}

export interface DerivedSummaryReadModel extends DerivedSummaryMetadata {
  current: DerivedSummaryRevision | null;
  memberNotices: Array<{ member: DerivedSummaryMember; current: boolean; limitations: string[] }>;
}

/** Exact saved body and fresh notices for those selected members only. */
export interface DerivedSummaryRevisionReadModel {
  summaryId: string;
  currentSummaryRef: string | null;
  currentRevision: number;
  revision: DerivedSummaryRevision;
  memberNotices: DerivedSummaryReadModel['memberNotices'];
}

export interface DerivedSummaryRequestStatus {
  summaryId: string;
  attemptRef: string;
  status: string;
  errorCode: string | null;
  savedSummaryRefs: string[];
}

export interface DerivedSummaryTask {
  schemaVersion: 'wiselink.derived-summary-task.v1';
  taskType: 'OPENCLAW_DERIVED_SUMMARY';
  subject: { kind: 'DERIVED_SUMMARY'; summaryId: string };
  expectedSummaryRevision: number;
  requestId: string;
  modelInput: {
    scope: DerivedSummaryScopeSelection;
    classificationStatus: 'CANDIDATE';
    instruction: string;
    members: DerivedSummaryMemberReading[];
    evidence: AssessmentEvidence[];
    limitations: string[];
  };
}
