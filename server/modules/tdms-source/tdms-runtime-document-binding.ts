import type { TdmsSourceVersion } from '@shared/tdms-source.interface';

export interface TdmsDocumentUploadBinding {
  schemaVersion: 'wiselink.tdms-formal-document-binding.v1';
  requestId: string;
  bindingId: string;
  payloadDigest: string;
  scope: {
    tenantId: string;
    sourceKey: string;
    sourceInstanceId: string;
    scopeId: string;
  };
  receiverId: string;
  receiverRevision: number;
  grantRevision: number;
  permissionRevision: string;
  applicationScopeId: string;
  actorSubjectId: string;
  ownerSnapshotId: string;
  sourceRecordId: string;
  number: string;
  sourceVersion: TdmsSourceVersion;
  businessVersion: TdmsSourceVersion | null;
  sourceAttachmentId: string;
  sourceAttachmentVersion: null;
  filename: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
  selection: {
    bucketId: string;
    filePath: string;
    expectedProviderObjectId: string;
  };
}
