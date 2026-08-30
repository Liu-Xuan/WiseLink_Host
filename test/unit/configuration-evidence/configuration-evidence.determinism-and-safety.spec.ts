import type {
  GetInstallationEventsUnavailableResult,
  InstallationEventSourceRecord,
} from '../../../server/modules/canonical-host/configuration-evidence/get-installation-events.port';
import { mapConfigurationSnapshot } from '../../../server/modules/canonical-host/configuration-evidence/configuration-snapshot.mapper';
import type { ConfigurationSnapshot } from '../../../server/modules/canonical-host/configuration-evidence/configuration-snapshot.types';
import { mapInstallationEventEvidence } from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.mapper';
import type { InstallationEventEvidenceProjection } from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.types';
import {
  completeResult,
  componentIdentity,
  configurationQuery,
  sourceRecord,
  unavailableResult,
} from './installation-event-evidence.fixtures';

describe('configuration-evidence deterministic and browser-safe boundary', () => {
  it('keeps semantic projections and source bindings stable when source records are reordered', () => {
    const query = configurationQuery();
    const records: InstallationEventSourceRecord[] = [
      sourceRecord(
        {
          kind: 'INSTALL',
          installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
        },
        {
          recordId: 'WORK-ORDER:INSTALL:DETERMINISTIC',
          effectiveAt: '2026-08-28T08:00:00.000Z',
          recordedAt: '2026-08-28T08:05:00.000Z',
        },
      ),
      sourceRecord(
        {
          kind: 'REMOVE',
          removedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
        },
        {
          recordId: 'WORK-ORDER:REMOVE:DETERMINISTIC',
          effectiveAt: '2026-08-28T10:00:00.000Z',
          recordedAt: '2026-08-28T10:05:00.000Z',
        },
      ),
    ];
    const forward: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, records),
      });
    const reversed: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [...records].reverse()),
      });
    const withDuplicate: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          records[0],
          structuredClone(records[0]),
          records[1],
        ]),
      });

    expect(reversed).toEqual(forward);
    expect(withDuplicate).toEqual(forward);
    expect(snapshotFor(reversed)).toEqual(snapshotFor(forward));
  });

  it('does not expose an upstream error message through a browser snapshot', () => {
    const query = configurationQuery();
    const result: GetInstallationEventsUnavailableResult = unavailableResult(
      query,
      'SOURCE_UNAVAILABLE',
    );
    const privateErrorCanary: string =
      'UPSTREAM_PRIVATE_ERROR_CANARY:CONNECTION_DETAIL:SOURCE_PATH';
    result.error.message = privateErrorCanary;
    result.error.retryable = true;

    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({ query, result });
    const snapshot: ConfigurationSnapshot = snapshotFor(projection);
    const serializedBrowserReadModel: string = JSON.stringify({
      persisted: { snapshot },
    });

    expect(projection.sourceError).toEqual({
      code: 'SOURCE_UNAVAILABLE',
      message: '受控构型事件数据源暂不可用，请稍后重试。',
      retryable: true,
    });
    expect(snapshot.sourceSlices[0].sourceError).toEqual(
      projection.sourceError,
    );
    expect(serializedBrowserReadModel).not.toContain(
      'UPSTREAM_PRIVATE_ERROR_CANARY',
    );
    expect(serializedBrowserReadModel).not.toContain('CONNECTION_DETAIL');
    expect(serializedBrowserReadModel).not.toContain('SOURCE_PATH');
    expect(serializedBrowserReadModel).not.toContain(privateErrorCanary);
  });

  it('rejects a non-public upstream error code before projection', () => {
    const query = configurationQuery();
    const result: GetInstallationEventsUnavailableResult = unavailableResult(
      query,
      'SOURCE_UNAVAILABLE',
    );
    Reflect.set(result.error, 'code', 'ECONNREFUSED');

    expect(() => mapInstallationEventEvidence({ query, result })).toThrow(
      'GET_INSTALLATION_EVENTS_RESULT_INVALID',
    );
  });
});

function snapshotFor(
  projection: InstallationEventEvidenceProjection,
): ConfigurationSnapshot {
  return mapConfigurationSnapshot({
    aircraftAssetId: projection.query.aircraft.assetId,
    assessmentAsOf: projection.query.assessmentAsOf,
    projections: [projection],
  });
}
