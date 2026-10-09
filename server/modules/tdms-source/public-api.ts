export { TdmsSourceModule } from './tdms-source.module';
export { TdmsSourceService } from './tdms-source.service';
/** Inactive processing-set seam; no module registration or HTTP/runtime capability. */
export { TdmsProcessingSetService } from './tdms-processing-set.service';
export { MiaodaTdmsProcessingSetRepository } from './tdms-processing-set.repository';
export { UnconfiguredTdmsProcessingSetAuthority } from './tdms-processing-set.types';
export type {
  TdmsProcessingSetAuthority,
  TdmsProcessingSetRepository,
} from './tdms-processing-set.types';
export { HostDecisionTdmsSourceAuthorization } from './tdms-source.authorization';
export { createSharedFoundationTdmsSourceAuthorization } from './tdms-shared-foundation.authorization';
export type {
  TdmsSharedFoundationReaders,
  TdmsSharedFoundationDecision,
  TdmsSharedFoundationMembers,
  TdmsSharedContextDecision,
  TdmsSharedIdentity,
  TdmsCurrentPermission,
} from './tdms-shared-foundation.authorization';
export { MiaodaTdmsArtifactStore } from './miaoda-tdms-artifact-store';
export {
  TDMS_SOURCE_AUTHORIZATION,
  TDMS_DOCUMENT_ACCESS,
  TDMS_ARTIFACT_STORE,
} from './tdms-source.types';
export type {
  TdmsSourceAuthorization,
  TdmsImportAdmission,
  TdmsImportMemberClaims,
  TdmsSourceScope,
  TdmsSourceGrant,
  TdmsDocumentAccess,
  TdmsArtifactStore,
} from './tdms-source.types';

export type {
  TdmsArtifactSelection,
  TdmsFileServiceImport,
  TdmsAttachmentAcquisitionFact,
  TdmsFileServiceRecordReadResponse,
} from '@shared/tdms-file-service-import.interface';
