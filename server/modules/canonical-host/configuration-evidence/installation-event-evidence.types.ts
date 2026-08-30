import type {
  ConfigurationEventAuthorityClass,
  ConfigurationEventKind,
  ConfigurationEvidenceCoverage,
  ConfigurationEvidenceFreshness,
  GetInstallationEventsQuery,
  GetInstallationEventsResult,
  InstallationEventPayload,
  InstallationEventQueryCoverage,
  InstallationEventSourceObservation,
} from './get-installation-events.port';

export type ConfigurationEventRelation =
  | 'SUPPORTS'
  | 'ON_AIRCRAFT'
  | 'AT_POSITION'
  | 'INSTALLS'
  | 'REMOVES'
  | 'REPLACES'
  | 'LOADS_SOFTWARE'
  | 'LOADED_ON'
  | 'EMBODIES_MODIFICATION'
  | 'ACCOMPLISHES_REPAIR'
  | 'AFFECTS_ITEM'
  | 'DERIVED_FROM'
  | 'AFFECTED_BY';

export type ConfigurationEventChainStatus =
  | 'CLOSED'
  | 'PARTIAL'
  | 'UNKNOWN'
  | 'CONFLICT';

export type ConfigurationEvidenceDiagnosticCode =
  | 'QUERY_SCOPE_MISMATCH'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_RESULTS_PARTIAL'
  | 'SOURCE_CONFLICT_REPORTED'
  | 'SOURCE_COVERAGE_INCOMPLETE'
  | 'SOURCE_FRESHNESS_UNUSABLE'
  | 'RECORD_INVALID'
  | 'SOURCE_RECORD_IDENTITY_CONFLICT'
  | 'SOURCE_RECORD_REVISION_CONFLICT'
  | 'RECORD_AUTHORITY_INELIGIBLE'
  | 'RECORD_NOT_CONTROLLED'
  | 'RECORD_COVERAGE_INCOMPLETE'
  | 'RECORD_FRESHNESS_UNUSABLE'
  | 'RECORD_AIRCRAFT_MISMATCH'
  | 'RECORD_OUTSIDE_QUERY_WINDOW'
  | 'RECORD_RECORDED_AFTER_AS_OF'
  | 'RECORD_TARGET_MISMATCH'
  | 'NO_RELEVANT_CONTROLLED_EVENT'
  | 'EVENT_STATE_CONFLICT';

export interface ConfigurationEvidenceDiagnostic {
  code: ConfigurationEvidenceDiagnosticCode;
  sourceRecordId: string | null;
  detail: string;
}

export interface InstallationEvidenceRecordProjection {
  evidenceRecordId: string;
  type: 'EvidenceRecord';
  owner: string;
  sourceSystem: string;
  recordId: string;
  revision: string;
  authorityClass: ConfigurationEventAuthorityClass;
  evidenceRole:
    | 'INSTALLATION_EVENT_EVIDENCE'
    | 'REMOVAL_EVENT_EVIDENCE'
    | 'REPLACEMENT_EVENT_EVIDENCE'
    | 'SOFTWARE_LOAD_EVENT_EVIDENCE'
    | 'MODIFICATION_EMBODIMENT_EVIDENCE'
    | 'REPAIR_ACCOMPLISHMENT_EVIDENCE';
  controlStatus: 'CONTROLLED' | 'RETRACTED' | 'UNVERIFIED';
  observedAt: string;
  freshness: ConfigurationEvidenceFreshness;
  coverage: ConfigurationEvidenceCoverage;
  effectiveAt: string;
  recordedAt: string;
}

export interface ConfigEventEvidenceProjection {
  configEventId: string;
  type: 'ConfigEvent';
  evidenceRecordId: string;
  eventKind: ConfigurationEventKind;
  occurrenceStatus: 'OBSERVED' | 'CANDIDATE' | 'CONFLICT';
  eventChainStatus: ConfigurationEventChainStatus;
  aircraftAssetId: string;
  positionId: string | null;
  effectiveAt: string;
  recordedAt: string;
  event: InstallationEventPayload;
}

export interface ConfigurationEventEvidenceBinding {
  bindingId: string;
  relation: ConfigurationEventRelation;
  fromRef: string;
  toRef: string;
  /**
   * The one EvidenceRecord that controls this mapped relation. Event
   * semantics are never emitted without retaining this exact binding.
   */
  evidenceRecordId: string;
}

export type CurrentConfigurationProperty =
  | 'component.installed'
  | 'software.loaded'
  | 'modification.embodied'
  | 'repair.present';

export interface CurrentConfigurationAssertionCandidate {
  assertionId: string;
  type: 'FactAssertion';
  targetRef: string;
  property: CurrentConfigurationProperty;
  truth: 'TRUE' | 'FALSE' | 'UNKNOWN' | 'CONFLICT';
  status: 'SUPPORTED' | 'WAITING_INPUT' | 'CONFLICT';
  authority: 'CONTROLLED_SOURCE' | 'NONE';
  assessmentAsOf: string;
  /** Boolean for boolean registry properties; SoftwareLoad id for software.loaded. */
  value: boolean | string | null;
  supportingEvidenceRecordIds: string[];
  derivedConfigEventIds: string[];
}

export interface InstallationEventEvidenceProjection {
  schemaVersion: 'wiselink.3_1.installation_event_evidence.v0.candidate';
  mode: 'READ_ONLY_CANDIDATE_PROJECTION';
  query: GetInstallationEventsQuery;
  sourceStatus: GetInstallationEventsResult['status'];
  sourceObservation: InstallationEventSourceObservation | null;
  sourceError: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
  coverage: InstallationEventQueryCoverage;
  evidenceRecords: InstallationEvidenceRecordProjection[];
  configEvents: ConfigEventEvidenceProjection[];
  bindings: ConfigurationEventEvidenceBinding[];
  currentAssertion: CurrentConfigurationAssertionCandidate;
  diagnostics: ConfigurationEvidenceDiagnostic[];
  authority: {
    candidateOnly: true;
    writesCurrentConfiguration: false;
    returnsApplicabilityDecision: false;
  };
}
