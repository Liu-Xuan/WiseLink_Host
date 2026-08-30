import type {
  GetInstallationEventsQuery,
  InstallationEventPayload,
  InstallationEventSourceRecord,
} from '../../../server/modules/canonical-host/configuration-evidence/get-installation-events.port';
import { mapInstallationEventEvidence } from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.mapper';
import type {
  ConfigEventEvidenceProjection,
  InstallationEventEvidenceProjection,
} from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.types';
import {
  completeResult,
  componentIdentity,
  configurationQuery,
  diagnosticCodes,
  sourceRecord,
} from './installation-event-evidence.fixtures';

describe('aircraft-level equipment installation aggregation', () => {
  it('stays TRUE when a later removal at P2 leaves the P1 instance installed', () => {
    const query: GetInstallationEventsQuery = aircraftEquipmentQuery();
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1),
          equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P2', 'P2', 2),
          equipmentEventRecord('REMOVE', 'COMPONENT:AIMS2:P2', 'P2', 3),
        ]),
      });

    expect(projection.currentAssertion).toMatchObject({
      targetRef: 'EQUIPMENT:AIMS2',
      property: 'component.installed',
      truth: 'TRUE',
      value: true,
      status: 'SUPPORTED',
      authority: 'CONTROLLED_SOURCE',
    });
    expect(projection.currentAssertion.derivedConfigEventIds).toHaveLength(1);
    expect(
      supportedEvents(projection).map(
        (event: ConfigEventEvidenceProjection) => event.event.kind,
      ),
    ).toEqual(['INSTALL']);
    expect(diagnosticCodes(projection)).not.toContain('EVENT_STATE_CONFLICT');
  });

  it('returns FALSE only when complete coverage leaves every known instance removed', () => {
    const query: GetInstallationEventsQuery = aircraftEquipmentQuery();
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1),
          equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P2', 'P2', 2),
          equipmentEventRecord('REMOVE', 'COMPONENT:AIMS2:P1', 'P1', 3),
          equipmentEventRecord('REMOVE', 'COMPONENT:AIMS2:P2', 'P2', 4),
        ]),
      });

    expect(projection.currentAssertion).toMatchObject({
      truth: 'FALSE',
      value: false,
      status: 'SUPPORTED',
      authority: 'CONTROLLED_SOURCE',
    });
    expect(projection.currentAssertion.derivedConfigEventIds).toHaveLength(2);
    expect(
      supportedEvents(projection)
        .map((event: ConfigEventEvidenceProjection) => event.event.kind)
        .sort(),
    ).toEqual(['REMOVE', 'REMOVE']);
  });

  it('keeps same-instance same-time install/remove as CONFLICT', () => {
    const query: GetInstallationEventsQuery = aircraftEquipmentQuery();
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          equipmentEventRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 2),
          equipmentEventRecord('REMOVE', 'COMPONENT:AIMS2:P1', 'P1', 2),
        ]),
      });

    expect(projection.currentAssertion).toMatchObject({
      truth: 'CONFLICT',
      value: null,
      status: 'CONFLICT',
      authority: 'NONE',
    });
    expect(
      projection.configEvents.every(
        (event: ConfigEventEvidenceProjection) =>
          event.eventChainStatus === 'CONFLICT',
      ),
    ).toBe(true);
    expect(diagnosticCodes(projection)).toContain('EVENT_STATE_CONFLICT');
  });
});

function aircraftEquipmentQuery(): GetInstallationEventsQuery {
  return configurationQuery({
    kind: 'EQUIPMENT',
    equipmentKey: 'AIMS2',
    positionId: null,
  });
}

function equipmentEventRecord(
  kind: 'INSTALL' | 'REMOVE',
  componentId: string,
  positionId: string,
  timeIndex: number,
): InstallationEventSourceRecord {
  const event: InstallationEventPayload =
    kind === 'INSTALL'
      ? { kind, installedComponent: componentIdentity(componentId) }
      : { kind, removedComponent: componentIdentity(componentId) };
  const timestamp: string = `2026-08-28T0${timeIndex}:00:00.000Z`;
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

function supportedEvents(
  projection: InstallationEventEvidenceProjection,
): ConfigEventEvidenceProjection[] {
  const eventIds: Set<string> = new Set<string>(
    projection.currentAssertion.derivedConfigEventIds,
  );
  return projection.configEvents.filter(
    (event: ConfigEventEvidenceProjection) => eventIds.has(event.configEventId),
  );
}
