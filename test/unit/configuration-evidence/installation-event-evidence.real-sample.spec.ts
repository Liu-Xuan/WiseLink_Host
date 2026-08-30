import {
  UnconfiguredGetInstallationEventsAdapter,
  type GetInstallationEventsQuery,
  type GetInstallationEventsUnavailableResult,
} from '../../../server/modules/canonical-host/configuration-evidence/get-installation-events.port';
import { mapInstallationEventEvidence } from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.mapper';
import type { InstallationEventEvidenceProjection } from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.types';
import {
  diagnosticCodes,
  unavailableResult,
} from './installation-event-evidence.fixtures';

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

describe('777 FTD B-2035 configuration-evidence sample', () => {
  it('keeps AIMS-2 UNKNOWN when Fleet identity exists but no controlled event SoR is configured', () => {
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

    expect(projection.currentAssertion).toMatchObject({
      targetRef: 'EQUIPMENT:AIMS2',
      property: 'component.installed',
      truth: 'UNKNOWN',
      value: null,
      status: 'WAITING_INPUT',
      authority: 'NONE',
      supportingEvidenceRecordIds: [],
      derivedConfigEventIds: [],
    });
    expect(projection.evidenceRecords).toEqual([]);
    expect(projection.configEvents).toEqual([]);
    expect(projection.bindings).toEqual([]);
    expect(projection.sourceError?.code).toBe('SOURCE_NOT_CONFIGURED');
    expect(diagnosticCodes(projection)).toEqual(
      expect.arrayContaining([
        'SOURCE_UNAVAILABLE',
        'SOURCE_COVERAGE_INCOMPLETE',
        'SOURCE_FRESHNESS_UNUSABLE',
        'NO_RELEVANT_CONTROLLED_EVENT',
      ]),
    );
    expect(projection.authority).toEqual({
      candidateOnly: true,
      writesCurrentConfiguration: false,
      returnsApplicabilityDecision: false,
    });
  });

  it('fails explicitly instead of silently fabricating source events', async () => {
    const adapter = new UnconfiguredGetInstallationEventsAdapter();

    expect(adapter.configured).toBe(false);
    await expect(
      adapter.getInstallationEvents(B2035_AIMS2_QUERY),
    ).rejects.toMatchObject({
      message: 'GET_INSTALLATION_EVENTS_SOURCE_NOT_CONFIGURED',
      code: 'GET_INSTALLATION_EVENTS_SOURCE_NOT_CONFIGURED',
      statusCode: 503,
    });
  });
});
