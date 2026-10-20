import type { TdmsArtifactSelection } from './tdms-file-service-import.interface';

/** Independent DM lineage readback; never overwrites the retained candidate receipt. */
export interface TdmsFormalDocumentRegistrationReceipt {
  schemaVersion: 'wiselink.tdms-formal-document-registration.v1';
  requestId: string;
  bindingId: string;
  payloadDigest: string;
  receiverId: string;
  documentUploadRequestId: string;
  sourceAttachmentId: string;
  sourceAttachmentVersion: null;
  status: 'COMMITTED' | 'REVIEW_REQUIRED' | 'PENDING';
  documentVersionId: string | null;
  preflightId: string | null;
  sha256: string;
  byteLength: number;
  readbackVerified: boolean;
  mappedAt: string | null;
}

export interface TdmsFormalDocumentMapping {
  requestId: string;
  bindingId: string;
  sourceRef: string;
  status: 'COMMITTED' | 'REVIEW_REQUIRED';
  documentVersionId: string | null;
  preflightId: string | null;
  sha256: string;
  byteLength: number;
  readbackVerified: boolean;
  mappedAt: string;
}

/** Current Host metadata only. Session identity never grants Source access. */
export interface TdmsNativeReceiverBinding {
  schemaVersion: 'wiselink.tdms-native-host-receiver-binding.v1';
  receiverId: string;
  tenantRef: string;
  applicationRef: string;
  principalRef: string;
  sourceSystem: 'TDMS';
  sourceInstanceRef: string;
  authorityRevision: string;
  authorityEvidenceRef: string;
  sessionEvidenceRef: string;
  observedAt: string;
}

/** Staging validates the unchanged package, but imports no record or SourceRef. */
export interface TdmsUploadSelectionAssociationRequest {
  package: unknown;
  selection: TdmsArtifactSelection['selection'];
}

/** Current authorization for this upload only; never a transferable Source grant. */
export interface TdmsUploadSelectionPreflight {
  requestId: string;
  bindingId: string;
  receiverId: string;
  payloadDigest: string;
  status: 'AUTHORIZED_UPLOAD';
}

export interface TdmsUploadSelectionAssociationReceipt {
  schemaVersion: 'wiselink.tdms-upload-selection-association.v1';
  requestId: string;
  bindingId: string;
  receiverId: string;
  packageId: string;
  payloadDigest: string;
  status: 'STAGED_CANDIDATE';
  selection: TdmsArtifactSelection['selection'];
  sourceAttachmentId: string;
  ownerSnapshotId: string;
  sha256: string;
  byteLength: number;
  readbackVerified: true;
  documentVersionId: null;
}
