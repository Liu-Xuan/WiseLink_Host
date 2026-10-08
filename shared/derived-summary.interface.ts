import type { AssessmentEvidence } from './assessment-reading.interface';
import type { JobAidProblemIssue } from './jobaid-problem-assessment.interface';
import type { EngineeringMatterCorrectionNotice, EngineeringMatterOverviewCorrectionNotice,
  EngineeringMatterReferenceWorkNotice } from './matter-working.interface';

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
  /** Exact persisted work understanding; body remains the complete reconstruction. */
  understanding?: string;
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
  /** Host observations at first save; never rewritten by a later read. */
  contextBasis?: DerivedSummaryContextBasis;
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
  contextStatus?: DerivedSummaryContextStatus;
}

/** Exact saved body and fresh notices for those selected members only. */
export interface DerivedSummaryRevisionReadModel {
  summaryId: string;
  currentSummaryRef: string | null;
  currentRevision: number;
  revision: DerivedSummaryRevision;
  memberNotices: DerivedSummaryReadModel['memberNotices'];
  contextStatus?: DerivedSummaryContextStatus;
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
  /** Host generation fence, outside the unchanged complete model view. */
  contextBasis?: DerivedSummaryContextBasis;
  modelInput: {
    scope: DerivedSummaryScopeSelection;
    classificationStatus: 'CANDIDATE';
    instruction: string;
    members: DerivedSummaryMemberReading[];
    evidence: AssessmentEvidence[];
    limitations: string[];
  };
}

/** A finite dependency vector for the existing DerivedSummary consumer. No body,
 * permission grant, publisher-currentness assertion or independent cache key. */
export interface DerivedSummaryContextBasis {
  schemaVersion: 'wiselink.derived-summary-context.v1';
  memberNotices: Array<{ member: DerivedSummaryMember; current: boolean;
    overviewStatus: DerivedSummaryMemberReading['overviewStatus']; limitations: string[] }>;
  sources: Array<{ documentVersionId: string; familyId: string; selectedHead: string | null;
    currentGeneration: number; status: string;
    /** Highest PUBLISHED parse revision for this Host document. Null means none;
     * missing means an old basis did not observe it. Not publisher currentness. */
    publishedParse?: { parseRunId: string; parseRevision: number } | null;
    /** Latest registered semantic revision per exact parse. Missing only on old
     * saved bases; this does not identify the current/published parse. */
    semanticRevisions?: Array<{ parseRunId: string; parseRevision: number; semanticRevision: number }> }>;
  workItems: Array<{ workItemId: string; documentVersionId: string; revision: number;
    currentWorkRef: string | null; currentWorkRevision: number | null;
    resultState: { integratedStatus: string | null; baseResultRef: string | null; baseRevision: number | null;
      baseArtifactSha256: string | null; overallResultRef: string | null; overallRevision: number | null;
      overallArtifactSha256: string | null; overallStatus: string | null; staleReason: string | null;
      basedOnWorkRef: string | null; reviewRevision: number | null } }>;
  matters: Array<{ matterId: string; currentMatterRevisionId: string;
    currentWorkRef: string | null; currentWorkRevision: number | null;
    selectedWork: Array<{ workRef: string; basedOnMatterRevisionId: string;
      substantiveResultRef: string | null; substantiveResultRevision: number | null;
      overviewStatus: DerivedSummaryMemberReading['overviewStatus'];
      correctionNotices: EngineeringMatterCorrectionNotice[];
      overviewCorrectionNotices: EngineeringMatterOverviewCorrectionNotice[];
      referenceWorkNotices: EngineeringMatterReferenceWorkNotice[] }> }>;
  summaries: Array<{ summaryId: string; currentSummaryRef: string | null; currentRevision: number }>;
  /** These axes are outside this bounded atomic fence and remain unknown. */
  uncoordinatedDependencies: string[];
}

/** Latest saved head and current assessment eligibility are different facts. */
export interface DerivedSummaryContextStatus {
  state: 'UNCHANGED_HOST_CONTEXT' | 'RECHECK_REQUIRED' | 'LEGACY_UNCHECKED';
  sourceAuthority: 'CATALOG_SELECTED';
  sourceCurrentness: 'UNKNOWN';
  coverage: 'SELECTED_MEMBERS_ONLY';
  reasons: string[];
}
