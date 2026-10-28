import type { TdmsFileServiceRecordReadResponse } from './tdms-file-service-import.interface';
import type { TdmsSourceVersion } from './tdms-source.interface';

/** Reads retained native records explicitly bound to this exact Host version. */
export interface TdmsDocumentSourceReadRequest {
  documentVersionId: string;
  after?: string;
  limit?: number;
}

export interface TdmsDocumentSourceReadResponse {
  documentVersionId: string;
  sourceStatus: 'AVAILABLE' | 'NO_BOUND_RECORDS';
  /** Each assessment has its own status boundary: only Estimated revisions may
   * contain opinion bodies. Other assessment states expose metadata alone.
   * Parent/peer approval is never substituted for the selected assessment. */
  records: TdmsFileServiceRecordReadResponse[];
  hasMore: boolean;
  nextAfter: string | null;
}

/** A path names retained observations to be checked again from the exact DM root. */
export interface TdmsDocumentObservedLinksRequest {
  documentVersionId: string;
  rootRevisionRef: string;
  parentPath?: string[];
  after?: string;
  limit?: number;
}

export interface TdmsObservedAssociationEvidence {
  kind: 'SOURCE_OBSERVED_ASSOCIATION';
  rootRevisionRef: string;
  rootOriginalCaptureRef: string;
  /** Navigation parent; on the first hop this is the exact DM original revision. */
  parentRevisionRef: string;
  /** The retained Source metadata revision that actually contains the occurrence. */
  sourceParentRevisionRef: string;
  childRevisionRef: string;
  parentCaptureRef: string;
  childCaptureRef: string;
  parentSourcePackageId: string;
  parentPackageSha256: string;
  parentSnapshotId: string;
  parentSourceRecordId: string;
  parentSourceVersion: TdmsSourceVersion;
  childSourceRecordId: string;
  childSourceVersion: TdmsSourceVersion;
  targetSourceVersion: TdmsSourceVersion;
  tableId: string;
  occurrenceId: string;
  linkIndex: number;
  candidateAssertionRef: string;
  sourceRelationId: string;
  parentObservedAt: string;
  childObservedAt: string;
  parentOperationVerification: 'NOT_RETAINED';
  applicability: 'UNKNOWN';
  currentness: 'UNKNOWN';
  completeness: 'UNKNOWN';
  readback: 'NON_ATOMIC';
}

export interface TdmsDocumentObservedLink {
  evidence: TdmsObservedAssociationEvidence;
  /** This receipt belongs to the independently authorized child read. */
  child: TdmsFileServiceRecordReadResponse;
}

export interface TdmsDocumentObservedLinksResponse {
  documentVersionId: string;
  rootRevisionRef: string;
  parentPath: string[];
  parentRevisionRef: string;
  links: TdmsDocumentObservedLink[];
  hasMore: boolean;
  nextAfter: string | null;
  diagnostic: 'AVAILABLE' | 'NO_OBSERVED_LINKS' | 'PARENT_BODY_WITHHELD';
  gaps: Array<'PARENT_METADATA_CAPTURE_NOT_RETAINED'>;
  limitations: string[];
}
