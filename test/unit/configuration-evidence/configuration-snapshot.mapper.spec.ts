import type {
  ConfigurationEvidenceTarget,
  GetInstallationEventsQuery,
  InstallationEventPayload,
  InstallationEventSourceRecord,
} from '../../../server/modules/canonical-host/configuration-evidence/get-installation-events.port';
import { markDependentConfigurationPredicateTracesStale } from '../../../server/modules/canonical-host/configuration-evidence/configuration-predicate-trace.staleness';
import { mapConfigurationSnapshot } from '../../../server/modules/canonical-host/configuration-evidence/configuration-snapshot.mapper';
import type {
  ConfigurationPredicateTrace,
  ConfigurationSnapshot,
  ConfigurationSnapshotFact,
} from '../../../server/modules/canonical-host/configuration-evidence/configuration-snapshot.types';
import { mapInstallationEventEvidence } from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.mapper';
import type { InstallationEventEvidenceProjection } from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.types';
import {
  changeEventCases,
  completeResult,
  componentIdentity,
  configurationQuery,
  sourceRecord,
  TEST_ASSESSMENT_AS_OF,
  TEST_ASSET_ID,
} from './installation-event-evidence.fixtures';

describe('configuration snapshot mapper', () => {
  it('projects a closed multi-position chain as source-bound current TRUE', () => {
    const projection: InstallationEventEvidenceProjection = equipmentProjection(
      [
        equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1),
        equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P2', 'P2', 2),
        equipmentEventRecord('REMOVE', 'COMPONENT:AIMS2:P2', 'P2', 3),
      ],
    );

    const snapshot: ConfigurationSnapshot = snapshotFrom([projection]);
    const fact: ConfigurationSnapshotFact = snapshot.facts[0];
    const trace: ConfigurationPredicateTrace = snapshot.predicateTraces[0];

    expect(snapshot.coverage).toEqual({
      scope: 'REQUESTED_TARGETS_ONLY',
      sourceCompleteness: 'COMPLETE',
      requestedTargetCount: 1,
      completeTargetCount: 1,
      allRequestedRecordsRead: true,
      sourceSliceRefs: [snapshot.sourceSlices[0].sourceSliceRef],
      fullAircraftConfigurationClaimed: false,
    });
    expect(fact).toMatchObject({
      targetRef: 'EQUIPMENT:AIMS2',
      property: 'component.installed',
      truth: 'TRUE',
      value: true,
      status: 'SUPPORTED',
      authority: 'CONTROLLED_SOURCE',
      currentness: 'AS_OF',
      temporal: {
        validFrom: '2026-08-28T01:00:00.000Z',
        validThroughAsOf: TEST_ASSESSMENT_AS_OF,
      },
    });
    expect(trace).toMatchObject({
      truth: 'TRUE',
      value: true,
      status: 'EVALUATED',
      factAssertionId: fact.factAssertionId,
      sourceSliceRef: snapshot.sourceSlices[0].sourceSliceRef,
      staleReason: null,
    });
    expect(trace.supportingEvidenceRecordIds).toEqual(
      fact.supportingEvidenceRecordIds,
    );
    expect(trace.derivedConfigEventIds).toEqual(fact.derivedConfigEventIds);
    expect(trace.dependencyObservation.evidenceRecords).toEqual(
      snapshot.evidenceRecordRefs.map((record) => ({
        evidenceRecordId: record.evidenceRecordId,
        sourceSystem: record.sourceSystem,
        recordId: record.recordId,
        revision: record.revision,
      })),
    );
    expect(
      snapshot.relations.some(
        (relation) =>
          relation.relation === 'DERIVED_FROM' &&
          relation.fromRef === fact.factAssertionId &&
          fact.derivedConfigEventIds.includes(relation.toRef) &&
          relation.evidenceRecordId !== null &&
          relation.sourceBindingId !== null,
      ),
    ).toBe(true);
    expect(
      snapshot.relations.filter(
        (relation) => relation.relation !== 'DEPENDS_ON',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: 'SUPPORTS',
          toRef: fact.factAssertionId,
          evidenceRecordId: fact.supportingEvidenceRecordIds[0],
        }),
      ]),
    );
    expect(snapshot.authority).toEqual({
      candidateOnly: true,
      readOnly: true,
      writesCurrentConfiguration: false,
      returnsApplicabilityDecision: false,
      fullAircraftConfigurationClaimed: false,
    });
  });

  it('projects complete coverage with every known instance removed as FALSE', () => {
    const projection: InstallationEventEvidenceProjection = equipmentProjection(
      [
        equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1),
        equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P2', 'P2', 2),
        equipmentEventRecord('REMOVE', 'COMPONENT:AIMS2:P1', 'P1', 3),
        equipmentEventRecord('REMOVE', 'COMPONENT:AIMS2:P2', 'P2', 4),
      ],
    );

    const snapshot: ConfigurationSnapshot = snapshotFrom([projection]);

    expect(snapshot.facts[0]).toMatchObject({
      truth: 'FALSE',
      value: false,
      status: 'SUPPORTED',
      authority: 'CONTROLLED_SOURCE',
      currentness: 'AS_OF',
      temporal: {
        validFrom: '2026-08-28T04:00:00.000Z',
        validThroughAsOf: TEST_ASSESSMENT_AS_OF,
      },
    });
    expect(snapshot.facts[0].derivedConfigEventIds).toHaveLength(2);
    expect(snapshot.predicateTraces[0]).toMatchObject({
      truth: 'FALSE',
      value: false,
      status: 'EVALUATED',
    });
  });

  it('retains a same-instance same-time contradiction as CONFLICT', () => {
    const projection: InstallationEventEvidenceProjection = equipmentProjection(
      [
        equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 2),
        equipmentEventRecord('REMOVE', 'COMPONENT:AIMS2:P1', 'P1', 2),
      ],
    );

    const snapshot: ConfigurationSnapshot = snapshotFrom([projection]);

    expect(snapshot.coverage.sourceCompleteness).toBe('CONFLICT');
    expect(snapshot.facts[0]).toMatchObject({
      truth: 'CONFLICT',
      value: null,
      status: 'CONFLICT',
      authority: 'NONE',
      currentness: 'CONFLICT',
      temporal: {
        validFrom: null,
        validThroughAsOf: TEST_ASSESSMENT_AS_OF,
      },
    });
    expect(snapshot.predicateTraces[0]).toMatchObject({
      truth: 'CONFLICT',
      value: null,
      status: 'CONFLICT',
    });
    expect(
      snapshot.relations.some(
        (relation) =>
          relation.relation === 'AFFECTED_BY' &&
          relation.fromRef === snapshot.facts[0].factAssertionId &&
          relation.evidenceRecordId !== null,
      ),
    ).toBe(true);
  });

  it('preserves the other finite event relations in deterministic target order', () => {
    const replacement: InstallationEventEvidenceProjection = projectionFor(
      configurationQuery(),
      sourceRecord(
        {
          kind: 'REPLACE',
          installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
          removedComponent: componentIdentity('COMPONENT:AIMS2:OLD'),
        },
        { recordId: 'WORK-ORDER:REPLACE:AIMS2' },
      ),
    );
    const softwareQuery: GetInstallationEventsQuery = configurationQuery({
      kind: 'SOFTWARE',
      softwareKey: 'AIMS2-BP-V18',
      targetComponentId: 'COMPONENT:AIMS2:NEW',
      positionId: 'POSITION:AIMS',
    });
    const software: InstallationEventEvidenceProjection = projectionFor(
      softwareQuery,
      sourceRecord(
        {
          kind: 'SOFTWARE_LOAD',
          softwareLoad: {
            softwareLoadId: 'SOFTWARE-LOAD:AIMS2:V18',
            softwareKey: 'AIMS2-BP-V18',
            version: 'V18',
            targetComponentId: 'COMPONENT:AIMS2:NEW',
          },
        },
        { recordId: 'LOAD-RECORD:AIMS2:V18' },
      ),
    );
    const changeProjections: InstallationEventEvidenceProjection[] =
      changeEventCases().map((changeCase) =>
        projectionFor(
          configurationQuery(changeCase.target),
          sourceRecord(changeCase.event, {
            recordId: `RELEASE:${changeCase.label}`,
          }),
        ),
      );
    const projections: InstallationEventEvidenceProjection[] = [
      replacement,
      software,
      ...changeProjections,
    ];

    const snapshot: ConfigurationSnapshot = snapshotFrom(projections);
    const reversed: ConfigurationSnapshot = snapshotFrom(
      [...projections].reverse(),
    );

    expect(reversed).toEqual(snapshot);
    expect(snapshot.facts).toHaveLength(4);
    expect(snapshot.facts.every((fact) => fact.truth === 'TRUE')).toBe(true);
    expect(
      snapshot.configEvents
        .map((event) => event.eventKind)
        .sort((left, right) => left.localeCompare(right)),
    ).toEqual([
      'MODIFICATION_EMBODIMENT',
      'REPAIR_ACCOMPLISHMENT',
      'REPLACE',
      'SOFTWARE_LOAD',
    ]);
    expect(snapshot.relations.map((relation) => relation.relation)).toEqual(
      expect.arrayContaining([
        'REPLACES',
        'LOADS_SOFTWARE',
        'LOADED_ON',
        'EMBODIES_MODIFICATION',
        'ACCOMPLISHES_REPAIR',
        'AFFECTS_ITEM',
        'DEPENDS_ON',
      ]),
    );
    expect(
      snapshot.relations
        .filter((relation) => relation.sourceBindingId !== null)
        .every((relation) => relation.evidenceRecordId !== null),
    ).toBe(true);
  });

  it('marks only the predicate whose exact source observation changed STALE', () => {
    const originalEquipment: InstallationEventEvidenceProjection =
      equipmentProjection([
        equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1),
      ]);
    const repairCase = changeEventCases().find(
      (changeCase) => changeCase.target.kind === 'REPAIR',
    );
    if (!repairCase) throw new Error('TEST_REPAIR_CASE_REQUIRED');
    const repair: InstallationEventEvidenceProjection = projectionFor(
      configurationQuery(repairCase.target),
      sourceRecord(repairCase.event, {
        recordId: 'RELEASE:REPAIR:UNCHANGED',
      }),
    );
    const snapshot: ConfigurationSnapshot = snapshotFrom([
      originalEquipment,
      repair,
    ]);
    const incomingQuery: GetInstallationEventsQuery = {
      ...aircraftEquipmentQuery(),
      assessmentAsOf: '2026-08-30T23:59:59.999Z',
    };
    const incomingEquipment: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query: incomingQuery,
        result: completeResult(incomingQuery, [
          equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1),
          equipmentEventRecord(
            'REMOVE',
            'COMPONENT:AIMS2:P1',
            'P1',
            5,
            '2026-08-30T08:00:00.000Z',
          ),
        ]),
      });

    const staleSnapshot: ConfigurationSnapshot =
      markDependentConfigurationPredicateTracesStale({
        snapshot,
        incomingProjections: [incomingEquipment],
      });
    const originalEquipmentTrace: ConfigurationPredicateTrace = traceFor(
      snapshot,
      'EQUIPMENT',
    );
    const staleEquipmentTrace: ConfigurationPredicateTrace = traceFor(
      staleSnapshot,
      'EQUIPMENT',
    );
    const staleRepairTrace: ConfigurationPredicateTrace = traceFor(
      staleSnapshot,
      'REPAIR',
    );

    expect(originalEquipmentTrace.status).toBe('EVALUATED');
    expect(staleEquipmentTrace).toMatchObject({
      truth: 'TRUE',
      value: true,
      status: 'STALE',
      factAssertionId: originalEquipmentTrace.factAssertionId,
      supportingEvidenceRecordIds:
        originalEquipmentTrace.supportingEvidenceRecordIds,
      derivedConfigEventIds: originalEquipmentTrace.derivedConfigEventIds,
      staleReason: {
        code: 'DEPENDENCY_OBSERVATION_CHANGED',
        previousStatus: 'EVALUATED',
        incomingSourceStatus: 'COMPLETE',
      },
    });
    expect(staleEquipmentTrace.staleReason?.incomingConfigEventIds).toEqual(
      incomingEquipment.configEvents.map((event) => event.configEventId).sort(),
    );
    expect(staleRepairTrace.status).toBe('EVALUATED');
    expect(staleSnapshot.facts).toEqual(snapshot.facts);
    expect(staleSnapshot.evidenceRecordRefs).toEqual(
      snapshot.evidenceRecordRefs,
    );
    expect(
      snapshot.predicateTraces.every((trace) => trace.staleReason === null),
    ).toBe(true);
  });
});

function snapshotFrom(
  projections: InstallationEventEvidenceProjection[],
): ConfigurationSnapshot {
  return mapConfigurationSnapshot({
    aircraftAssetId: TEST_ASSET_ID,
    assessmentAsOf: TEST_ASSESSMENT_AS_OF,
    projections,
  });
}

function aircraftEquipmentQuery(): GetInstallationEventsQuery {
  return configurationQuery({
    kind: 'EQUIPMENT',
    equipmentKey: 'AIMS2',
    positionId: null,
  });
}

function equipmentProjection(
  records: InstallationEventSourceRecord[],
): InstallationEventEvidenceProjection {
  const query: GetInstallationEventsQuery = aircraftEquipmentQuery();
  return mapInstallationEventEvidence({
    query,
    result: completeResult(query, records),
  });
}

function equipmentEventRecord(
  kind: 'INSTALL' | 'REMOVE',
  componentId: string,
  positionId: string,
  timeIndex: number,
  timestamp: string = `2026-08-28T${String(timeIndex).padStart(
    2,
    '0',
  )}:00:00.000Z`,
): InstallationEventSourceRecord {
  const event: InstallationEventPayload =
    kind === 'INSTALL'
      ? { kind, installedComponent: componentIdentity(componentId) }
      : { kind, removedComponent: componentIdentity(componentId) };
  return sourceRecord(event, {
    recordId: `WORK-ORDER:${kind}:${positionId}:${timeIndex}`,
    position: {
      positionId: `POSITION:${positionId}`,
      sourcePositionKey: positionId,
    },
    effectiveAt: timestamp,
    recordedAt: timestamp,
  });
}

function projectionFor(
  query: GetInstallationEventsQuery,
  record: InstallationEventSourceRecord,
): InstallationEventEvidenceProjection {
  return mapInstallationEventEvidence({
    query,
    result: completeResult(query, [record]),
  });
}

function traceFor(
  snapshot: ConfigurationSnapshot,
  kind: ConfigurationEvidenceTarget['kind'],
): ConfigurationPredicateTrace {
  const trace: ConfigurationPredicateTrace | undefined =
    snapshot.predicateTraces.find(
      (candidate: ConfigurationPredicateTrace) =>
        candidate.target.kind === kind,
    );
  if (!trace) throw new Error(`TEST_TRACE_NOT_FOUND:${kind}`);
  return trace;
}
