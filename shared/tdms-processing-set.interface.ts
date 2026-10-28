import type { TdmsExactEndpoint } from './tdms-source.interface';

/** Retained Host observations. Producing an unresolved set establishes no Source cohort or currentness. */
export const TDMS_PROCESSING_SET_SCHEMA =
  'wiselink.tdms-processing-set.v1' as const;
export interface TdmsProcessingSetScope {
  tenantId: string;
  sourceKey: string;
  sourceInstanceId: string;
  scopeId: string;
}
export type TdmsSetCoverage = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
export interface TdmsProcessingSetMember {
  memberRef: string;
  assessmentFamilyRef: string | null;
  assessmentBusinessRevisionKey: string | null;
  assessmentObservationRef: string | null;
  membershipResolution: 'CONFIRMED' | 'OBSERVED_ONLY' | 'UNRESOLVED';
  processingAssessmentAssertionRefs: string[];
  cohortMembershipEvidenceRefs: string[];
  assessmentSuccessionEvidenceRefs: string[];
  /** Expected identity is retention-authorized metadata, never an inferred R00 match. */
  expectedSourceRecordId: string | null;
  gaps: string[];
}
/** Ref-only immutable roster. Bodies remain exclusively in tdms_record_revision. */
export interface TdmsProcessingRevisionSet {
  schemaVersion: typeof TDMS_PROCESSING_SET_SCHEMA;
  scope: TdmsProcessingSetScope;
  setRevisionRef: string;
  processingFamilyRef: string;
  cohortRef: string | null;
  processingObservationRef: string;
  familyIdentityEvidenceRefs: string[];
  cohortIdentityEvidenceRefs: string[];
  predecessorCohortRef: string | null;
  successionEvidenceRefs: string[];
  supersedesSetRevisionRef: string | null;
  rootBindings: Array<{
    endpoint: Exclude<TdmsExactEndpoint, { kind: 'UNRESOLVED' }>;
    fileProcessingAssertionRefs: string[];
    applicabilityEvidenceRefs: string[];
  }>;
  rosterEvidenceRefs: string[];
  sourceRosterRevision: string | null;
  captureRefs: string[];
  observationWindow: { before: string; after: string };
  membershipCoverage: TdmsSetCoverage;
  versionMappingCoverage: TdmsSetCoverage;
  approvedBodyCaptureCoverage: TdmsSetCoverage;
  approvalReadiness: 'ALL_APPROVED' | 'PENDING' | 'UNKNOWN';
  sourceConsistency: 'ATOMIC' | 'NON_ATOMIC' | 'UNKNOWN';
  sourceTransactionRef: string | null;
  currentness: 'CURRENT' | 'HISTORICAL' | 'UNKNOWN';
  currentnessEvidenceRefs: string[];
  /** Optional ref-only four-layer context. Artifact descriptors/bytes and owner
   * versions stay in the exact existing revision; equal bytes do not merge ACLs.
   * Storage container evidence never establishes business type or eligibility. */
  objectContextBindings?: Array<{
    ownerObservationRef: string;
    attachmentRelationAssertionRefs: string[];
    sourceContainerEvidenceRefs: string[];
    businessClassificationEvidenceRefs: string[];
    productEligibility: 'UNKNOWN';
    gaps: string[];
  }>;
  members: TdmsProcessingSetMember[];
  gaps: string[];
}
export interface TdmsProcessingSetHead {
  scope: TdmsProcessingSetScope;
  processingFamilyRef: string;
  selectedSetRevisionRef: string;
  generation: number;
}
export interface TdmsProcessingSetSaveReceipt {
  setRevisionRef: string;
  /** Null also means selected-set READ was not confirmed; never infer head absence. */
  selectedSetRevisionRef: string | null;
  /** Disclosed only with an authorized selectedSetRevisionRef. */
  generation: number | null;
  disposition: 'SELECTED' | 'HISTORY_ONLY' | 'UNRESOLVED' | 'REPLAY';
}

/** Exact saved references only. Neither a submitted set nor a Source proof/admission. */
export interface TdmsProcessingSetFromRetainedRequest {
  scope: TdmsProcessingSetScope;
  /** Reuses setRevisionRef's existing immutable replay/unique-key semantics. */
  operationRef: string;
  captures: Array<{ packageId: string; captureRef: string }>;
  processingObservationRef: string | null;
  rootObservationRefs: string[];
  assessmentObservationRefs: string[];
  expectedGeneration: number | null;
}
export interface TdmsProcessingSetProducerDiagnostic {
  code:
    | 'OBSERVED_PROCESSING_SET_UNRESOLVED'
    | 'PROCESSING_OBSERVATION_NOT_ACQUIRED';
  sourceFamilyConfirmed: false;
  cohortConfirmed: false;
  sourceCurrentness: 'UNKNOWN';
  gaps: string[];
}
export type TdmsProcessingSetFromRetainedResponse =
  | {
      status: 'RETAINED_UNRESOLVED';
      receipt: TdmsProcessingSetSaveReceipt;
      diagnostic: TdmsProcessingSetProducerDiagnostic;
    }
  | {
      status: 'NOT_RETAINED';
      receipt: null;
      diagnostic: TdmsProcessingSetProducerDiagnostic;
    };
export interface TdmsProcessingSetFrozenReadRequest {
  scope: TdmsProcessingSetScope;
  setRevisionRef: string;
}
export interface TdmsProcessingSetSelectedReadRequest {
  scope: TdmsProcessingSetScope;
  /** Host observation grouping; does not establish a Source processing family. */
  processingFamilyRef: string;
}
export interface TdmsProcessingSetFrozenReadResponse {
  set: TdmsProcessingRevisionSet;
}
export interface TdmsProcessingSetSelectedReadResponse {
  selection: {
    head: TdmsProcessingSetHead;
    set: TdmsProcessingRevisionSet;
  } | null;
}
