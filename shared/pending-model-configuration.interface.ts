import type { CanonicalExecutionModelSelection } from './api.interface';
/** Exact service-queue operation, not a free-form model selector. */
export interface ApplyPendingModelConfigurationRequest {
  configurationRequestId: string;
  workItemId: string;
  requestId: string;
  documentVersionId: string;
  sourceArtifactId: string;
  sourceFileSha256: string;
  sourceByteLength: number;
  expectedWorkItemRevision: number;
  expectedExecutionModel: CanonicalExecutionModelSelection | null;
  expectedSettingsRevision: number;
}
export interface PendingModelConfigurationApplication {
  configurationRequestId: string;
  appliedAt: string;
  executorPrincipalId: string;
  actorUserId: string;
  workItemId: string;
  requestId: string;
  documentVersionId: string;
  sourceArtifactId: string;
  sourceFileSha256: string;
  sourceByteLength: number;
  workItemRevision: number;
  previousModel: CanonicalExecutionModelSelection | null;
  executionModel: CanonicalExecutionModelSelection;
}
export interface ApplyPendingModelConfigurationResponse {
  status: 'MODEL_CONFIGURATION_APPLIED';
  replayed: boolean;
  application: PendingModelConfigurationApplication;
}
