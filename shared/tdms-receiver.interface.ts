import type { TdmsArtifactSelection } from './tdms-file-service-import.interface';

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
