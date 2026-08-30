import type {
  ConfigurationEvidenceFreshness,
  ConfigurationEvidenceTarget,
  GetInstallationEventsQuery,
  GetInstallationEventsResult,
  InstallationEventQueryCoverage,
  InstallationEventSourceObservation,
} from './get-installation-events.port';
import type {
  ConfigEventEvidenceProjection,
  ConfigurationEventRelation,
  ConfigurationEvidenceDiagnostic,
  ConfigurationEvidencePublicSourceError,
  CurrentConfigurationAssertionCandidate,
  CurrentConfigurationProperty,
  InstallationEvidenceRecordProjection,
} from './installation-event-evidence.types';

export type ConfigurationSnapshotTruth =
  CurrentConfigurationAssertionCandidate['truth'];

export type ConfigurationPredicateTraceStatus =
  | 'EVALUATED'
  | 'WAITING_INPUT'
  | 'CONFLICT'
  | 'STALE';

export type ConfigurationSnapshotCurrentness = 'AS_OF' | 'UNKNOWN' | 'CONFLICT';

export type ConfigurationSnapshotSourceCompleteness =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'UNKNOWN'
  | 'CONFLICT';

export interface ConfigurationSnapshotSourceSlice {
  sourceSliceRef: string;
  query: GetInstallationEventsQuery;
  sourceStatus: GetInstallationEventsResult['status'];
  sourceObservation: InstallationEventSourceObservation | null;
  sourceError: ConfigurationEvidencePublicSourceError | null;
  coverage: InstallationEventQueryCoverage;
  diagnostics: ConfigurationEvidenceDiagnostic[];
  evidenceRecordIds: string[];
  configEventIds: string[];
}

export interface ConfigurationSnapshotCoverage {
  scope: 'REQUESTED_TARGETS_ONLY';
  sourceCompleteness: ConfigurationSnapshotSourceCompleteness;
  requestedTargetCount: number;
  completeTargetCount: number;
  allRequestedRecordsRead: boolean;
  sourceSliceRefs: string[];
  fullAircraftConfigurationClaimed: false;
}

export interface ConfigurationSnapshotFactTemporal {
  validFrom: string | null;
  validThroughAsOf: string;
  recordedAt: string | null;
  observedAt: string | null;
}

export interface ConfigurationSnapshotFactCoverage {
  sourceSliceRef: string;
  sourceStatus: GetInstallationEventsResult['status'];
  sourceFreshness: ConfigurationEvidenceFreshness | null;
  queryCoverage: InstallationEventQueryCoverage;
}

export interface ConfigurationSnapshotFact {
  factAssertionId: string;
  type: 'FactAssertion';
  sourceAssertionId: string;
  aircraftAssetId: string;
  target: ConfigurationEvidenceTarget;
  targetRef: string;
  property: CurrentConfigurationProperty;
  truth: ConfigurationSnapshotTruth;
  value: boolean | string | null;
  status: CurrentConfigurationAssertionCandidate['status'];
  authority: CurrentConfigurationAssertionCandidate['authority'];
  assessmentAsOf: string;
  currentness: ConfigurationSnapshotCurrentness;
  temporal: ConfigurationSnapshotFactTemporal;
  coverage: ConfigurationSnapshotFactCoverage;
  supportingEvidenceRecordIds: string[];
  derivedConfigEventIds: string[];
}

export interface ConfigurationPredicateDependencySelector {
  aircraftAssetId: string;
  targetKey: string;
  target: ConfigurationEvidenceTarget;
  targetRef: string;
  property: CurrentConfigurationProperty;
}

export interface ConfigurationEvidenceIdentityRef {
  evidenceRecordId: string;
  sourceSystem: string;
  recordId: string;
  revision: string;
}

export interface ConfigurationPredicateDependencyObservation {
  sourceStatus: GetInstallationEventsResult['status'];
  sourceSystem: string | null;
  sourceRevision: string | null;
  sourceObservedAt: string | null;
  sourceFreshness: ConfigurationEvidenceFreshness | null;
  sourceErrorCode: string | null;
  coverage: InstallationEventQueryCoverage;
  truth: ConfigurationSnapshotTruth;
  value: boolean | string | null;
  evidenceRecords: ConfigurationEvidenceIdentityRef[];
  configEventIds: string[];
  diagnosticCodes: string[];
}

export interface ConfigurationPredicateTraceStaleReason {
  code: 'DEPENDENCY_OBSERVATION_CHANGED';
  previousStatus: ConfigurationPredicateTraceStatus;
  incomingSourceSliceRef: string;
  incomingSourceStatus: GetInstallationEventsResult['status'];
  incomingSourceSystem: string | null;
  incomingSourceRevision: string | null;
  incomingEvidenceRecordIds: string[];
  incomingConfigEventIds: string[];
}

export interface ConfigurationPredicateTrace {
  predicateTraceId: string;
  type: 'PredicateTrace';
  predicateKind: 'CURRENT_CONFIGURATION_ASSERTION';
  aircraftAssetId: string;
  target: ConfigurationEvidenceTarget;
  targetRef: string;
  property: CurrentConfigurationProperty;
  truth: ConfigurationSnapshotTruth;
  value: boolean | string | null;
  status: ConfigurationPredicateTraceStatus;
  assessmentAsOf: string;
  factAssertionId: string;
  sourceSliceRef: string;
  dependencySelector: ConfigurationPredicateDependencySelector;
  dependencyObservation: ConfigurationPredicateDependencyObservation;
  supportingEvidenceRecordIds: string[];
  derivedConfigEventIds: string[];
  staleReason: ConfigurationPredicateTraceStaleReason | null;
}

export type ConfigurationSnapshotRelation =
  | ConfigurationEventRelation
  | 'DEPENDS_ON';

export interface ConfigurationSnapshotRelationProjection {
  relationId: string;
  relation: ConfigurationSnapshotRelation;
  fromRef: string;
  toRef: string;
  evidenceRecordId: string | null;
  sourceBindingId: string | null;
}

export interface ConfigurationSnapshot {
  schemaVersion: 'wiselink.3_1.configuration_snapshot.v1.candidate';
  mode: 'READ_ONLY_CANDIDATE_PROJECTION';
  aircraftAssetId: string;
  assessmentAsOf: string;
  coverage: ConfigurationSnapshotCoverage;
  sourceSlices: ConfigurationSnapshotSourceSlice[];
  evidenceRecordRefs: InstallationEvidenceRecordProjection[];
  configEvents: ConfigEventEvidenceProjection[];
  facts: ConfigurationSnapshotFact[];
  predicateTraces: ConfigurationPredicateTrace[];
  relations: ConfigurationSnapshotRelationProjection[];
  authority: {
    candidateOnly: true;
    readOnly: true;
    writesCurrentConfiguration: false;
    returnsApplicabilityDecision: false;
    fullAircraftConfigurationClaimed: false;
  };
}
