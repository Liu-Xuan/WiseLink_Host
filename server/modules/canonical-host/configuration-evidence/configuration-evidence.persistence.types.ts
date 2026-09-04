import type {
  CanonicalAssessmentGapMateriality,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';

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

export const CONFIGURATION_EVIDENCE_QUERY_STORE = Symbol(
  'CONFIGURATION_EVIDENCE_QUERY_STORE',
);

export interface RefreshConfigurationEvidenceRequest {
  schemaVersion: 'wiselink.3_1.refresh_configuration_evidence.v1';
  requestId: string;
  expectedRevision: number;
  aircraftIdentifier: string;
  assessmentAsOf: string;
  windowStart: string | null;
  gapRefs: string[];
  targets: ConfigurationEvidenceTarget[];
}

export interface ResolvedConfigurationEvidenceRequest extends RefreshConfigurationEvidenceRequest {
  aircraft: InstallationEventAircraftQuery;
  capabilityGrant: ConfigurationEvidenceCapabilityGrant;
}

export interface ConfigurationEvidenceCapabilityGrant {
  schemaVersion: 'wiselink.3_1.configuration_evidence_capability_grant.v1';
  grantRef: string;
  capability: 'GET_INSTALLATION_EVENTS';
  inputRevision: number;
  gapRefs: string[];
  affectedCriterionIds: string[];
  materialities: CanonicalAssessmentGapMateriality[];
  sourceConfigured: boolean;
  issuedAt: string;
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

export interface ConfigurationEvidenceSnapshotReadResponse {
  schemaVersion: 'wiselink.3_1.configuration_evidence_snapshot_read.v1';
  workItemId: string;
  workItemRevision: number;
  persisted: PersistedConfigurationEvidenceSnapshot;
  authority: ConfigurationEvidenceReadAuthority;
}

export type ConfigurationEvidenceQueryTerminalStatus =
  | 'RUNNING'
  | 'SUCCEEDED_EVIDENCE'
  | 'SUCCEEDED_NO_RECORD'
  | 'NOT_CONNECTED'
  | 'ACCESS_DENIED'
  | 'CONFLICT'
  | 'FAILED_VALIDATION'
  | 'TIMEOUT'
  | 'CANCELED';

export interface ConfigurationEvidenceQueryAttemptReadModel {
  queryAttemptRef: string;
  candidateEvidenceRef: string;
  workItemId: string;
  inputRevision: number;
  roundNo: number;
  queryCount: number;
  queryFingerprint: string;
  request: ResolvedConfigurationEvidenceRequest;
  terminalStatus: ConfigurationEvidenceQueryTerminalStatus;
  sourceRecordCount: number;
  projections: InstallationEventEvidenceProjection[] | null;
  candidateSnapshot: ConfigurationSnapshot | null;
  startedAt: string;
  deadlineAt: string;
  completedAt: string | null;
  adoption:
    | { status: 'CANDIDATE_UNADOPTED' }
    | {
        status: 'ADOPTED';
        snapshotId: string;
        workItemRevision: number;
        adoptedAt: string;
      };
}

export interface ConfigurationEvidenceQueryResponse {
  schemaVersion: 'wiselink.3_1.configuration_evidence_query_response.v1';
  workItemId: string;
  workItemRevision: number;
  replayed: boolean;
  candidate: ConfigurationEvidenceQueryAttemptReadModel;
  authority: ConfigurationEvidenceQueryAuthority;
}

export interface ConfigurationEvidenceAdoptionResponse {
  schemaVersion: 'wiselink.3_1.configuration_evidence_adoption_response.v1';
  workItemId: string;
  workItemRevision: number;
  replayed: boolean;
  candidateEvidenceRef: string;
  persisted: PersistedConfigurationEvidenceSnapshot;
  reevaluation: {
    mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL';
    status: 'REQUIRED';
    trigger: 'CONFIGURATION_EVIDENCE_ADOPTED';
  };
  authority: ConfigurationEvidenceQueryAuthority;
}

export interface ConfigurationEvidenceQueryAuthority {
  owner: 'CANONICAL_HOST';
  candidateOnly: true;
  queryAdvancesWorkItemRevision: false;
  adoptionRequiresExpectedRevision: true;
  connectorConcurrency: 1;
  maxRounds: 2;
  maxQueries: 5;
  noRecordMeansFalse: false;
  notConnectedMeansFalse: false;
  gapBoundQuery: true;
  capabilityGrantRequired: true;
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

export interface ReserveConfigurationEvidenceQueryInput {
  tenantId: string;
  actorId: string;
  workItemId: string;
  request: ResolvedConfigurationEvidenceRequest;
  queryAttemptRef: string;
  candidateEvidenceRef: string;
  queryFingerprint: string;
  startedAt: string;
  deadlineAt: string;
}

export interface CompleteConfigurationEvidenceQueryInput {
  tenantId: string;
  actorId: string;
  workItemId: string;
  queryAttemptRef: string;
  terminalStatus: Exclude<ConfigurationEvidenceQueryTerminalStatus, 'RUNNING'>;
  projections: InstallationEventEvidenceProjection[];
  candidateSnapshot: ConfigurationSnapshot;
  sourceRecordCount: number;
  completedAt: string;
}

export interface ConfigurationEvidenceQueryStorePort {
  findByRequest(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel | null>;
  findByQueryAttemptRef(input: {
    tenantId: string;
    workItemId: string;
    queryAttemptRef: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel | null>;
  findByCandidateEvidenceRef(input: {
    tenantId: string;
    workItemId: string;
    candidateEvidenceRef: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel | null>;
  reserve(
    input: ReserveConfigurationEvidenceQueryInput,
  ): Promise<{
    replayed: boolean;
    attempt: ConfigurationEvidenceQueryAttemptReadModel;
  }>;
  complete(
    input: CompleteConfigurationEvidenceQueryInput,
  ): Promise<ConfigurationEvidenceQueryAttemptReadModel>;
  markAdopted(input: {
    tenantId: string;
    workItemId: string;
    candidateEvidenceRef: string;
    snapshotId: string;
    workItemRevision: number;
    adoptedAt: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel>;
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

export const CONFIGURATION_EVIDENCE_QUERY_AUTHORITY: ConfigurationEvidenceQueryAuthority =
  {
    owner: 'CANONICAL_HOST',
    candidateOnly: true,
    queryAdvancesWorkItemRevision: false,
    adoptionRequiresExpectedRevision: true,
    connectorConcurrency: 1,
    maxRounds: 2,
    maxQueries: 5,
    noRecordMeansFalse: false,
    notConnectedMeansFalse: false,
    gapBoundQuery: true,
    capabilityGrantRequired: true,
  };
