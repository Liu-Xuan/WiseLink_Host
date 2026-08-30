import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import type {
  ConfigurationEvidenceTarget,
  InstallationEventAircraftQuery,
} from './get-installation-events.port';
import type { InstallationEventEvidenceProjection } from './installation-event-evidence.types';
import type {
  ConfigurationSnapshot,
  ConfigurationSnapshotSourceCompleteness,
} from './configuration-snapshot.types';

export const CONFIGURATION_EVIDENCE_STORE = Symbol(
  'CONFIGURATION_EVIDENCE_STORE',
);

export interface RefreshConfigurationEvidenceRequest {
  schemaVersion: 'wiselink.3_1.refresh_configuration_evidence.v1';
  requestId: string;
  expectedRevision: number;
  aircraftIdentifier: string;
  assessmentAsOf: string;
  windowStart: string | null;
  targets: ConfigurationEvidenceTarget[];
}

export interface ResolvedConfigurationEvidenceRequest extends RefreshConfigurationEvidenceRequest {
  aircraft: InstallationEventAircraftQuery;
}

export interface ConfigurationEvidenceTruthSummary {
  trueCount: number;
  falseCount: number;
  unknownCount: number;
  conflictCount: number;
}

export interface ConfigurationEvidenceSnapshotSummary {
  snapshotId: string;
  configurationRevision: number;
  workItemRevisionBefore: number;
  workItemRevisionAfter: number;
  aircraftAssetId: string;
  assessmentAsOf: string;
  sourceCompleteness: ConfigurationSnapshotSourceCompleteness;
  truthSummary: ConfigurationEvidenceTruthSummary;
  recordedByActorId: string;
  recordedAt: string;
  isCurrent: boolean;
}

export interface PersistedConfigurationEvidenceSnapshot {
  request: ResolvedConfigurationEvidenceRequest;
  summary: ConfigurationEvidenceSnapshotSummary;
  snapshot: ConfigurationSnapshot;
}

export interface ConfigurationEvidenceCurrentReadModel {
  schemaVersion: 'wiselink.3_1.configuration_evidence_history.v1';
  workItemId: string;
  workItemRevision: number;
  status: 'EMPTY' | 'AVAILABLE';
  current: PersistedConfigurationEvidenceSnapshot | null;
  history: ConfigurationEvidenceSnapshotSummary[];
  authority: ConfigurationEvidenceReadAuthority;
}

export interface ConfigurationEvidenceRefreshResponse {
  schemaVersion: 'wiselink.3_1.configuration_evidence_refresh_response.v1';
  workItemId: string;
  workItemRevision: number;
  replayed: boolean;
  persisted: PersistedConfigurationEvidenceSnapshot;
  authority: ConfigurationEvidenceReadAuthority;
}

export interface ConfigurationEvidenceSnapshotReadResponse {
  schemaVersion: 'wiselink.3_1.configuration_evidence_snapshot_read.v1';
  workItemId: string;
  workItemRevision: number;
  persisted: PersistedConfigurationEvidenceSnapshot;
  authority: ConfigurationEvidenceReadAuthority;
}

export interface ConfigurationEvidenceReadAuthority {
  owner: 'CANONICAL_HOST';
  currentScope: 'WORK_ITEM_EVIDENCE_VIEW_ONLY';
  sourceEventsServerSupplied: true;
  applicabilityEvaluatorCreated: false;
  returnsApplicabilityDecision: false;
  fullAircraftConfigurationClaimed: false;
  globalAircraftCurrentChanged: false;
  modelInferredFacts: false;
}

export interface CommitConfigurationEvidenceInput {
  tenantId: string;
  actorId: string;
  workItemId: string;
  expectedWorkItemRevision: number;
  request: ResolvedConfigurationEvidenceRequest;
  projections: InstallationEventEvidenceProjection[];
  snapshot: ConfigurationSnapshot;
  recordedAt: string;
}

export interface CommitConfigurationEvidenceResult {
  replayed: boolean;
  workItem: CanonicalWorkItemProjection;
  persisted: PersistedConfigurationEvidenceSnapshot;
}

export interface ConfigurationEvidenceReplayRead {
  workItem: CanonicalWorkItemProjection;
  persisted: PersistedConfigurationEvidenceSnapshot;
}

export interface ConfigurationEvidenceStorePort {
  findByRequest(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
  }): Promise<ConfigurationEvidenceReplayRead | null>;
  readCurrent(input: {
    tenantId: string;
    workItemId: string;
  }): Promise<PersistedConfigurationEvidenceSnapshot | null>;
  readSnapshot(input: {
    tenantId: string;
    workItemId: string;
    snapshotId: string;
  }): Promise<PersistedConfigurationEvidenceSnapshot | null>;
  listHistory(input: {
    tenantId: string;
    workItemId: string;
    limit: number;
  }): Promise<ConfigurationEvidenceSnapshotSummary[]>;
  commit(
    input: CommitConfigurationEvidenceInput,
  ): Promise<CommitConfigurationEvidenceResult>;
}

export const CONFIGURATION_EVIDENCE_READ_AUTHORITY: ConfigurationEvidenceReadAuthority =
  {
    owner: 'CANONICAL_HOST',
    currentScope: 'WORK_ITEM_EVIDENCE_VIEW_ONLY',
    sourceEventsServerSupplied: true,
    applicabilityEvaluatorCreated: false,
    returnsApplicabilityDecision: false,
    fullAircraftConfigurationClaimed: false,
    globalAircraftCurrentChanged: false,
    modelInferredFacts: false,
  };
