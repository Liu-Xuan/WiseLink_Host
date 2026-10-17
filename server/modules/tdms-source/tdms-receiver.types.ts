import type { TdmsArtifactSelection } from '@shared/tdms-file-service-import.interface';
import type { TdmsUploadSelectionAssociationReceipt } from '@shared/tdms-receiver.interface';
import type { TdmsDailyArtifactObservation } from './tdms-daily-metadata-contract';
import type {
  TdmsAction,
  TdmsImportMemberClaims,
  TdmsSourceScope,
} from './tdms-source.types';

export interface TdmsReceiverRow extends Record<string, unknown> {
  receiverId: string;
  tenantId: string;
  applicationScopeId: string;
  sourceKey: string;
  sourceInstanceId: string;
  scopeId: string;
  sourceSubjectNamespace: string;
  sourceSubjectId: string;
  authorityRef: string;
  authorityRevision: string;
  authorityEvidenceRef: string;
  approvedBySubject: string;
  approvedAt: string;
  validFrom: string;
  validUntil: string;
  status: string;
  revokedAt: string | null;
  revision: number;
  actorSubjectId: string;
  grantSourceSubjectNamespace: string;
  grantSourceSubjectId: string;
  permissionRevision: string;
  grantAuthorityEvidenceRef: string;
  grantApprovedBySubject: string;
  grantApprovedAt: string;
  grantValidFrom: string;
  grantValidUntil: string;
  grantStatus: string;
  grantRevokedAt: string | null;
  grantRevision: number;
  actions: unknown;
}

export interface TdmsReceiverAction {
  allowed: true;
  authorityRef: string;
  authorityRevision: string;
  authorityEvidenceRef: string;
  approvedBySubject: string;
  validFrom: string;
  validUntil: string;
  purpose: string;
  captureRetentionAllowed?: true;
  nativeProjectionAllowed?: true;
  retainedCaptureReadAllowed?: true;
  permittedMembers: TdmsImportMemberClaims;
}

export interface TdmsReceiverAuthority {
  row: TdmsReceiverRow;
  scope: TdmsSourceScope;
  permissionRevision: string;
  action: TdmsAction;
  decision: TdmsReceiverAction;
}

export interface TdmsStoredSelection {
  scope: TdmsSourceScope;
  applicationScopeId: string;
  actorSubjectId: string;
  receiverId: string;
  receiverRevision: number;
  grantRevision: number;
  permissionRevision: string;
  payloadDigest: string;
  packageId: string;
  memberClaims: TdmsImportMemberClaims;
  observation: TdmsDailyArtifactObservation;
  artifact: TdmsArtifactSelection;
  receipt: TdmsUploadSelectionAssociationReceipt;
}
