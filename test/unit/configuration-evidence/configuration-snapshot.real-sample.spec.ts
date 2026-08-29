import type {
  GetInstallationEventsQuery,
  GetInstallationEventsUnavailableResult,
} from '../../../server/modules/canonical-host/configuration-evidence/get-installation-events.port';
import { mapConfigurationSnapshot } from '../../../server/modules/canonical-host/configuration-evidence/configuration-snapshot.mapper';
import type { ConfigurationSnapshot } from '../../../server/modules/canonical-host/configuration-evidence/configuration-snapshot.types';
import { mapInstallationEventEvidence } from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.mapper';
import type { InstallationEventEvidenceProjection } from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.types';
import { unavailableResult } from './installation-event-evidence.fixtures';

const B2035_AIMS2_QUERY: GetInstallationEventsQuery = {
  schemaVersion: 'wiselink.3_1.get_installation_events_query.v0.candidate',
  aircraft: {
    assetId: 'AIRCRAFT:MODEL_MSN:B777_39L_38674',
    aircraftNumber: 'B-2035',
    msn: '38674',
    lineNumber: 1051,
  },
  target: {
    kind: 'EQUIPMENT',
    equipmentKey: 'AIMS2',
    positionId: null,
  },
  windowStart: null,
  assessmentAsOf: '2026-08-29T23:59:59.999Z',
};

describe('777 FTD B-2035 configuration snapshot sample', () => {
  it('keeps AIMS-2 UNKNOWN and its predicate WAITING_INPUT without event facts', () => {
    const result: GetInstallationEventsUnavailableResult = unavailableResult(
      B2035_AIMS2_QUERY,
      'SOURCE_NOT_CONFIGURED',
    );
    result.source = {
      owner: 'canonical-host:configuration-evidence',
      sourceSystem: 'UNCONFIGURED_INSTALLATION_EVENT_SOR',
      sourceRevision: 'UNAVAILABLE',
      observedAt: '2026-08-29T00:00:00.000Z',
      freshness: 'UNKNOWN',
    };
    result.coverage = {
      included:
        'B-2035 identity is resolved from the 587 asset / 2579 alias Fleet snapshot.',
      limitation:
        'The imported Fleet snapshot has 0 configuration facts and no controlled install, remove or replace event chain.',
      completeness: 'UNKNOWN',
      allRecordsRead: false,
      exactAircraftMatch: true,
      exactTargetMatch: true,
    };
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query: B2035_AIMS2_QUERY,
        result,
      });

    const snapshot: ConfigurationSnapshot = mapConfigurationSnapshot({
      aircraftAssetId: B2035_AIMS2_QUERY.aircraft.assetId,
      assessmentAsOf: B2035_AIMS2_QUERY.assessmentAsOf,
      projections: [projection],
    });

    expect(snapshot.coverage).toEqual({
      scope: 'REQUESTED_TARGETS_ONLY',
      sourceCompleteness: 'UNKNOWN',
      requestedTargetCount: 1,
      completeTargetCount: 0,
      allRequestedRecordsRead: false,
      sourceSliceRefs: [snapshot.sourceSlices[0].sourceSliceRef],
      fullAircraftConfigurationClaimed: false,
    });
    expect(snapshot.facts[0]).toMatchObject({
      targetRef: 'EQUIPMENT:AIMS2',
      property: 'component.installed',
      truth: 'UNKNOWN',
      value: null,
      status: 'WAITING_INPUT',
      authority: 'NONE',
      currentness: 'UNKNOWN',
      supportingEvidenceRecordIds: [],
      derivedConfigEventIds: [],
      temporal: {
        validFrom: null,
        validThroughAsOf: B2035_AIMS2_QUERY.assessmentAsOf,
      },
    });
    expect(snapshot.predicateTraces[0]).toMatchObject({
      truth: 'UNKNOWN',
      value: null,
      status: 'WAITING_INPUT',
      supportingEvidenceRecordIds: [],
      derivedConfigEventIds: [],
      dependencyObservation: {
        sourceStatus: 'UNAVAILABLE',
        sourceSystem: 'UNCONFIGURED_INSTALLATION_EVENT_SOR',
        sourceRevision: 'UNAVAILABLE',
        sourceFreshness: 'UNKNOWN',
        sourceErrorCode: 'SOURCE_NOT_CONFIGURED',
        truth: 'UNKNOWN',
        value: null,
        evidenceRecords: [],
        configEventIds: [],
      },
    });
    expect(snapshot.evidenceRecordRefs).toEqual([]);
    expect(snapshot.configEvents).toEqual([]);
    expect(snapshot.sourceSlices[0]).toMatchObject({
      sourceStatus: 'UNAVAILABLE',
      sourceError: { code: 'SOURCE_NOT_CONFIGURED' },
      coverage: result.coverage,
      evidenceRecordIds: [],
      configEventIds: [],
    });
    expect(snapshot.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relation: 'AFFECTED_BY',
          fromRef: snapshot.facts[0].factAssertionId,
          toRef: snapshot.sourceSlices[0].sourceSliceRef,
        }),
        expect.objectContaining({
          relation: 'DEPENDS_ON',
          fromRef: snapshot.predicateTraces[0].predicateTraceId,
          toRef: snapshot.facts[0].factAssertionId,
        }),
        expect.objectContaining({
          relation: 'DEPENDS_ON',
          fromRef: snapshot.predicateTraces[0].predicateTraceId,
          toRef: snapshot.sourceSlices[0].sourceSliceRef,
        }),
      ]),
    );
    expect(snapshot.authority.writesCurrentConfiguration).toBe(false);
    expect(snapshot.authority.returnsApplicabilityDecision).toBe(false);
    expect(snapshot.authority.fullAircraftConfigurationClaimed).toBe(false);
  });
});
