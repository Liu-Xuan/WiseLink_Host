export type ConfigurationEventKind =
  | 'INSTALL'
  | 'REMOVE'
  | 'REPLACE'
  | 'SOFTWARE_LOAD'
  | 'MODIFICATION_EMBODIMENT'
  | 'REPAIR_ACCOMPLISHMENT';

export type ConfigurationEventAuthorityClass =
  | 'INSTALLATION_EVENT_SOR'
  | 'SOFTWARE_LOAD_EVENT_SOR'
  | 'MAINTENANCE_RELEASE_RECORD';

export type ConfigurationEvidenceFreshness =
  | 'CURRENT'
  | 'AS_OF'
  | 'STALE'
  | 'UNKNOWN';

export type ConfigurationEvidenceCompleteness =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'UNKNOWN';

export interface ConfigurationEvidenceCoverage {
  included: string;
  limitation: string;
  completeness: ConfigurationEvidenceCompleteness;
}

export interface InstallationEventAircraftQuery {
  assetId: string;
  aircraftNumber: string;
  msn: string | null;
  lineNumber: number | null;
}

export type ConfigurationEvidenceTarget =
  | {
      kind: 'COMPONENT';
      componentId: string;
      positionId: string | null;
    }
  | {
      kind: 'EQUIPMENT';
      equipmentKey: string;
      positionId: string | null;
    }
  | {
      kind: 'SOFTWARE';
      softwareKey: string;
      targetComponentId: string | null;
      positionId: string | null;
    }
  | {
      kind: 'MODIFICATION';
      modificationId: string;
    }
  | {
      kind: 'REPAIR';
      repairId: string;
    };

export interface GetInstallationEventsQuery {
  schemaVersion: 'wiselink.3_1.get_installation_events_query.v0.candidate';
  aircraft: InstallationEventAircraftQuery;
  target: ConfigurationEvidenceTarget;
  windowStart: string | null;
  assessmentAsOf: string;
}

export interface ControlledConfigurationPositionIdentity {
  positionId: string;
  sourcePositionKey: string;
}

export interface ControlledComponentIdentity {
  componentId: string;
  partNumber: string | null;
  serialNumber: string | null;
  equipmentKey: string | null;
}

export interface ControlledSoftwareLoadIdentity {
  softwareLoadId: string;
  softwareKey: string;
  version: string | null;
  targetComponentId: string | null;
}

export interface ControlledModificationIdentity {
  modificationId: string;
}

export interface ControlledRepairIdentity {
  repairId: string;
}

export interface ControlledAffectedItemReference {
  kind: 'AIRCRAFT' | 'POSITION' | 'PART' | 'COMPONENT' | 'EQUIPMENT';
  id: string;
}

export type InstallationEventPayload =
  | {
      kind: 'INSTALL';
      installedComponent: ControlledComponentIdentity;
    }
  | {
      kind: 'REMOVE';
      removedComponent: ControlledComponentIdentity;
    }
  | {
      kind: 'REPLACE';
      installedComponent: ControlledComponentIdentity;
      removedComponent: ControlledComponentIdentity;
    }
  | {
      kind: 'SOFTWARE_LOAD';
      softwareLoad: ControlledSoftwareLoadIdentity;
    }
  | {
      kind: 'MODIFICATION_EMBODIMENT';
      modification: ControlledModificationIdentity;
      affectedItem: ControlledAffectedItemReference;
    }
  | {
      kind: 'REPAIR_ACCOMPLISHMENT';
      repair: ControlledRepairIdentity;
      affectedItem: ControlledAffectedItemReference;
    };

export interface InstallationEventSourceRecord {
  recordId: string;
  revision: string;
  authorityClass: ConfigurationEventAuthorityClass;
  controlStatus: 'CONTROLLED' | 'RETRACTED' | 'UNVERIFIED';
  observedAt: string;
  freshness: ConfigurationEvidenceFreshness;
  coverage: ConfigurationEvidenceCoverage;
  aircraftAssetId: string;
  position: ControlledConfigurationPositionIdentity | null;
  effectiveAt: string;
  recordedAt: string;
  event: InstallationEventPayload;
}

export interface InstallationEventSourceObservation {
  owner: string;
  sourceSystem: string;
  sourceRevision: string;
  observedAt: string;
  freshness: ConfigurationEvidenceFreshness;
}

export interface InstallationEventQueryCoverage extends ConfigurationEvidenceCoverage {
  allRecordsRead: boolean;
  exactAircraftMatch: boolean;
  exactTargetMatch: boolean;
}

export type GetInstallationEventsFailureCode =
  | 'SOURCE_NOT_CONFIGURED'
  | 'ACCESS_DENIED'
  | 'TIMEOUT'
  | 'SOURCE_UNAVAILABLE'
  | 'AIRCRAFT_AMBIGUOUS'
  | 'TARGET_AMBIGUOUS'
  | 'PARTIAL_RESULTS'
  | 'TRUNCATED'
  | 'SOURCE_CONFLICT';

export interface GetInstallationEventsFailure {
  code: GetInstallationEventsFailureCode;
  message: string;
  retryable: boolean;
}

interface GetInstallationEventsResultBase {
  source: InstallationEventSourceObservation;
  queryScope: GetInstallationEventsQuery;
  coverage: InstallationEventQueryCoverage;
}

export interface GetInstallationEventsCompleteResult extends GetInstallationEventsResultBase {
  status: 'COMPLETE';
  records: readonly InstallationEventSourceRecord[];
  error: null;
}

export interface GetInstallationEventsPartialResult extends GetInstallationEventsResultBase {
  status: 'PARTIAL';
  records: readonly InstallationEventSourceRecord[];
  error: GetInstallationEventsFailure & {
    code: 'PARTIAL_RESULTS' | 'TRUNCATED';
  };
}

export interface GetInstallationEventsConflictResult extends GetInstallationEventsResultBase {
  status: 'CONFLICT';
  records: readonly InstallationEventSourceRecord[];
  error: GetInstallationEventsFailure & {
    code: 'SOURCE_CONFLICT';
  };
}

export interface GetInstallationEventsUnavailableResult extends GetInstallationEventsResultBase {
  status: 'UNAVAILABLE';
  records: readonly [];
  error: GetInstallationEventsFailure & {
    code:
      | 'SOURCE_NOT_CONFIGURED'
      | 'ACCESS_DENIED'
      | 'TIMEOUT'
      | 'SOURCE_UNAVAILABLE'
      | 'AIRCRAFT_AMBIGUOUS'
      | 'TARGET_AMBIGUOUS';
  };
}

export type GetInstallationEventsResult =
  | GetInstallationEventsCompleteResult
  | GetInstallationEventsPartialResult
  | GetInstallationEventsConflictResult
  | GetInstallationEventsUnavailableResult;

/**
 * Future configuration SoR adapters implement this read-only Host port.
 * The port reports source records and coverage only; it never returns an
 * applicability decision or writes a current Fleet fact.
 */
export interface GetInstallationEventsPort {
  readonly configured: boolean;
  getInstallationEvents(
    query: GetInstallationEventsQuery,
  ): Promise<GetInstallationEventsResult>;
}

export class UnconfiguredGetInstallationEventsAdapter implements GetInstallationEventsPort {
  readonly configured: boolean = false;

  async getInstallationEvents(
    _query: GetInstallationEventsQuery,
  ): Promise<GetInstallationEventsResult> {
    throw Object.assign(
      new Error('GET_INSTALLATION_EVENTS_SOURCE_NOT_CONFIGURED'),
      {
        code: 'GET_INSTALLATION_EVENTS_SOURCE_NOT_CONFIGURED',
        statusCode: 503,
      },
    );
  }
}
