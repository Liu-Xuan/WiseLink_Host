import type {
  TdmsPackageArtifact,
  TdmsSourcePackage,
  TdmsRecordReadResponse,
} from './tdms-source.interface';
import type { TdmsEngineeringExecutionReading } from './tdms-engineering-execution.interface';
/** Small transport envelope; locators/object pins are not TDMS business identity or authority. */
export interface TdmsArtifactSelection extends Omit<
  TdmsPackageArtifact,
  'bytesBase64'
> {
  ownerItemIds: string[];
  selection: {
    bucketId: string;
    filePath: string;
    expectedProviderObjectId: string;
  };
}
export interface TdmsFileServiceImport {
  sourceKey: string;
  sourceInstanceId: string;
  scopeId: string;
  /** Original DTO remains intact; no inline artifacts/member references in this transport. */
  package: TdmsSourcePackage;
  artifactSelections: TdmsArtifactSelection[];
}

/** Two independent facts: the source declaration at its observation time and Host byte acquisition. */
export interface TdmsAttachmentAcquisitionFact {
  memberId: string;
  sourceAttachmentId: string;
  sourceAttachmentVersion: string | null;
  acquisitionId: string;
  sourceObservedAtDeclared: string;
  sourceReadStatusAtObservation: 'NOT_READ' | 'FAILED' | null;
  sourceObservationRevisionRef: string | null;
  hostBytesVerifiedAt: string;
  currentSourcePermissionChecked: true;
  semanticReadPerformed: false;
  engineeringExecutionVerified: false;
}
export interface TdmsFileServiceRecordReadResponse extends TdmsRecordReadResponse {
  attachmentAcquisitions?: TdmsAttachmentAcquisitionFact[];
  engineeringExecution?: TdmsEngineeringExecutionReading;
}
