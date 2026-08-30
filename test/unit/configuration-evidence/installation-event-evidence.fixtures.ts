import type {
  ConfigurationEvidenceTarget,
  ControlledComponentIdentity,
  GetInstallationEventsCompleteResult,
  GetInstallationEventsConflictResult,
  GetInstallationEventsFailureCode,
  GetInstallationEventsPartialResult,
  GetInstallationEventsQuery,
  GetInstallationEventsUnavailableResult,
  InstallationEventPayload,
  InstallationEventSourceRecord,
} from '../../../server/modules/canonical-host/configuration-evidence/get-installation-events.port';
import type {
  ConfigurationEventEvidenceBinding,
  ConfigurationEvidenceDiagnosticCode,
  InstallationEventEvidenceProjection,
} from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.types';

export const TEST_ASSET_ID: string = 'AIRCRAFT:MODEL_MSN:B777_39L_38674';
export const TEST_ASSESSMENT_AS_OF: string = '2026-08-29T23:59:59.999Z';

export function configurationQuery(
  target: ConfigurationEvidenceTarget = {
    kind: 'COMPONENT',
    componentId: 'COMPONENT:AIMS2:NEW',
    positionId: 'POSITION:AIMS',
  },
): GetInstallationEventsQuery {
  return {
    schemaVersion: 'wiselink.3_1.get_installation_events_query.v0.candidate',
    aircraft: {
      assetId: TEST_ASSET_ID,
      aircraftNumber: 'B-2035',
      msn: '38674',
      lineNumber: 1051,
    },
    target: structuredClone(target),
    windowStart: null,
    assessmentAsOf: TEST_ASSESSMENT_AS_OF,
  };
}

export function componentIdentity(
  componentId: string,
  equipmentKey: string | null = 'AIMS2',
): ControlledComponentIdentity {
  return {
    componentId,
    partNumber: `PN:${componentId}`,
    serialNumber: `SN:${componentId}`,
    equipmentKey,
  };
}

export function sourceRecord(
  event: InstallationEventPayload,
  overrides: Partial<Omit<InstallationEventSourceRecord, 'event'>> = {},
): InstallationEventSourceRecord {
  return {
    recordId: `WORK-ORDER:${event.kind}:1`,
    revision: 'REV-1',
    authorityClass:
      event.kind === 'SOFTWARE_LOAD'
        ? 'SOFTWARE_LOAD_EVENT_SOR'
        : event.kind === 'MODIFICATION_EMBODIMENT' ||
            event.kind === 'REPAIR_ACCOMPLISHMENT'
          ? 'MAINTENANCE_RELEASE_RECORD'
          : 'INSTALLATION_EVENT_SOR',
    controlStatus: 'CONTROLLED',
    observedAt: '2026-08-29T12:00:00.000Z',
    freshness: 'AS_OF',
    coverage: {
      included: 'Exact controlled source record and revision.',
      limitation: 'Limited to the exact aircraft, target and query window.',
      completeness: 'COMPLETE',
    },
    aircraftAssetId: TEST_ASSET_ID,
    position: {
      positionId: 'POSITION:AIMS',
      sourcePositionKey: 'AIMS-CABINET',
    },
    effectiveAt: '2026-08-28T08:00:00.000Z',
    recordedAt: '2026-08-28T09:00:00.000Z',
    event: structuredClone(event),
    ...overrides,
  };
}

export function completeResult(
  query: GetInstallationEventsQuery,
  records: readonly InstallationEventSourceRecord[],
): GetInstallationEventsCompleteResult {
  return {
    status: 'COMPLETE',
    source: sourceObservation(),
    queryScope: structuredClone(query),
    coverage: completeCoverage(),
    records: structuredClone(records),
    error: null,
  };
}

export function partialResult(
  query: GetInstallationEventsQuery,
  records: readonly InstallationEventSourceRecord[],
): GetInstallationEventsPartialResult {
  return {
    status: 'PARTIAL',
    source: sourceObservation(),
    queryScope: structuredClone(query),
    coverage: {
      ...completeCoverage(),
      completeness: 'PARTIAL',
      allRecordsRead: false,
      limitation: 'The source response was truncated after one page.',
    },
    records: structuredClone(records),
    error: {
      code: 'TRUNCATED',
      message: 'Only the first source page was returned.',
      retryable: true,
    },
  };
}

export function conflictResult(
  query: GetInstallationEventsQuery,
  records: readonly InstallationEventSourceRecord[],
): GetInstallationEventsConflictResult {
  return {
    status: 'CONFLICT',
    source: sourceObservation(),
    queryScope: structuredClone(query),
    coverage: completeCoverage(),
    records: structuredClone(records),
    error: {
      code: 'SOURCE_CONFLICT',
      message: 'The source reports unresolved controlled records.',
      retryable: false,
    },
  };
}

export function unavailableResult(
  query: GetInstallationEventsQuery,
  code: Exclude<
    GetInstallationEventsFailureCode,
    'PARTIAL_RESULTS' | 'TRUNCATED' | 'SOURCE_CONFLICT'
  > = 'SOURCE_NOT_CONFIGURED',
): GetInstallationEventsUnavailableResult {
  return {
    status: 'UNAVAILABLE',
    source: {
      ...sourceObservation(),
      sourceRevision: 'UNAVAILABLE',
      freshness: 'UNKNOWN',
    },
    queryScope: structuredClone(query),
    coverage: {
      included: 'The exact Host query was retained.',
      limitation: 'No controlled installation-event SoR response is available.',
      completeness: 'UNKNOWN',
      allRecordsRead: false,
      exactAircraftMatch: true,
      exactTargetMatch: true,
    },
    records: [],
    error: {
      code,
      message: 'No controlled installation-event source is configured.',
      retryable: false,
    },
  };
}

function sourceObservation(): GetInstallationEventsCompleteResult['source'] {
  return {
    owner: 'configuration-sor-owner',
    sourceSystem: 'CONTROLLED_MAINTENANCE_EVENT_SOR',
    sourceRevision: 'SOURCE-SNAPSHOT-2026-08-29',
    observedAt: '2026-08-29T12:00:00.000Z',
    freshness: 'AS_OF',
  };
}

function completeCoverage(): GetInstallationEventsCompleteResult['coverage'] {
  return {
    included:
      'All controlled records for the exact aircraft, target and window.',
    limitation: 'No coverage outside the requested scope.',
    completeness: 'COMPLETE',
    allRecordsRead: true,
    exactAircraftMatch: true,
    exactTargetMatch: true,
  };
}

export interface ChangeEventCase {
  label: string;
  target: ConfigurationEvidenceTarget;
  event: InstallationEventPayload;
  eventRelation: 'EMBODIES_MODIFICATION' | 'ACCOMPLISHES_REPAIR';
  recordRef: string;
  property: 'modification.embodied' | 'repair.present';
}

export function changeEventCases(): ChangeEventCase[] {
  return [
    {
      label: 'MODIFICATION_EMBODIMENT',
      target: { kind: 'MODIFICATION', modificationId: 'MOD:SB-777-31-1234' },
      event: {
        kind: 'MODIFICATION_EMBODIMENT',
        modification: { modificationId: 'MOD:SB-777-31-1234' },
        affectedItem: {
          kind: 'AIRCRAFT',
          id: 'AIRCRAFT:MODEL_MSN:B777_39L_38674',
        },
      },
      eventRelation: 'EMBODIES_MODIFICATION',
      recordRef: 'MOD:SB-777-31-1234',
      property: 'modification.embodied',
    },
    {
      label: 'REPAIR_ACCOMPLISHMENT',
      target: { kind: 'REPAIR', repairId: 'REPAIR:777-31-42' },
      event: {
        kind: 'REPAIR_ACCOMPLISHMENT',
        repair: { repairId: 'REPAIR:777-31-42' },
        affectedItem: { kind: 'POSITION', id: 'POSITION:AIMS' },
      },
      eventRelation: 'ACCOMPLISHES_REPAIR',
      recordRef: 'REPAIR:777-31-42',
      property: 'repair.present',
    },
  ];
}

export interface UnusableEvidenceCase {
  label: string;
  query: ReturnType<typeof configurationQuery>;
  record: InstallationEventSourceRecord;
  diagnostic: ConfigurationEvidenceDiagnosticCode;
}

export function unusableEvidenceCases(): UnusableEvidenceCase[] {
  const componentEvent: InstallationEventPayload = {
    kind: 'INSTALL',
    installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
  };
  const softwareQuery: GetInstallationEventsQuery = configurationQuery({
    kind: 'SOFTWARE',
    softwareKey: 'AIMS2-BP-V18',
    targetComponentId: 'COMPONENT:AIMS2:NEW',
    positionId: 'POSITION:AIMS',
  });
  return [
    {
      label: 'the record is retracted',
      query: configurationQuery(),
      record: sourceRecord(componentEvent, { controlStatus: 'RETRACTED' }),
      diagnostic: 'RECORD_NOT_CONTROLLED',
    },
    {
      label: 'the record is stale',
      query: configurationQuery(),
      record: sourceRecord(componentEvent, { freshness: 'STALE' }),
      diagnostic: 'RECORD_FRESHNESS_UNUSABLE',
    },
    {
      label: 'record coverage is partial',
      query: configurationQuery(),
      record: sourceRecord(componentEvent, {
        coverage: {
          included: 'One source row.',
          limitation: 'The source row is missing release coverage.',
          completeness: 'PARTIAL',
        },
      }),
      diagnostic: 'RECORD_COVERAGE_INCOMPLETE',
    },
    {
      label: 'the record was registered after the assessment as-of',
      query: configurationQuery(),
      record: sourceRecord(componentEvent, {
        recordedAt: '2026-08-30T09:00:00.000Z',
      }),
      diagnostic: 'RECORD_RECORDED_AFTER_AS_OF',
    },
    {
      label: 'an installation authority is used for a software-load event',
      query: softwareQuery,
      record: sourceRecord(
        {
          kind: 'SOFTWARE_LOAD',
          softwareLoad: {
            softwareLoadId: 'SOFTWARE-LOAD:AIMS2:V18',
            softwareKey: 'AIMS2-BP-V18',
            version: 'V18',
            targetComponentId: 'COMPONENT:AIMS2:NEW',
          },
        },
        { authorityClass: 'INSTALLATION_EVENT_SOR' },
      ),
      diagnostic: 'RECORD_AUTHORITY_INELIGIBLE',
    },
  ];
}

export function bindingExists(
  projection: InstallationEventEvidenceProjection,
  relation: ConfigurationEventEvidenceBinding['relation'],
  fromRef: string,
  toRef: string,
): boolean {
  return projection.bindings.some(
    (binding: ConfigurationEventEvidenceBinding) =>
      binding.relation === relation &&
      binding.fromRef === fromRef &&
      binding.toRef === toRef,
  );
}

export function diagnosticCodes(
  projection: InstallationEventEvidenceProjection,
): ConfigurationEvidenceDiagnosticCode[] {
  return projection.diagnostics.map((diagnostic) => diagnostic.code);
}
