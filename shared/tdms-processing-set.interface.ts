import type { TdmsExactEndpoint } from './tdms-source.interface';

/** Additive, inactive Host seam. This is not a collector or runtime capability. */
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
