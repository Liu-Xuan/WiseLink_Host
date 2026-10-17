import type { LcmCollectionContext } from './lcm-export-staging.interface';
import type { LcmNativeMatrix } from './lcm-native-matrix.interface';

export interface LcmDatabaseScope {
  tenantId: string;
  actorId: string;
  authorizedSourceInstanceIds: string[];
}

export interface LcmDatabaseImportResult {
  snapshotId: string;
  replayed: boolean;
  recordCount: number;
  coordinateCount: number;
}

export interface LcmNativeDatabaseImport {
  scope: LcmDatabaseScope;
  sourceInstanceId: string;
  requestId: string;
  context: LcmCollectionContext;
  originalFileName: string;
  localSourcePath: string;
  rawSha256: string;
  rawByteLength: number;
  artifactRef: string;
  matrix: LcmNativeMatrix;
  personalSourceAdmission?: {
    applicationScopeId: string;
    permissionRevision: string;
  };
}
