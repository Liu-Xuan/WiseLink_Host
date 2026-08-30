import type { InstallationEventSourceRecord } from '../../../server/modules/canonical-host/configuration-evidence/get-installation-events.port';
import { mapInstallationEventEvidence } from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.mapper';
import type {
  ConfigurationEventEvidenceBinding,
  InstallationEventEvidenceProjection,
} from '../../../server/modules/canonical-host/configuration-evidence/installation-event-evidence.types';
import {
  bindingExists,
  changeEventCases,
  completeResult,
  componentIdentity,
  configurationQuery,
  conflictResult,
  diagnosticCodes,
  partialResult,
  sourceRecord,
  unusableEvidenceCases,
} from './installation-event-evidence.fixtures';

describe('installation-event evidence mapper', () => {
  it('maps a controlled INSTALL to current TRUE through one closed evidence chain', () => {
    const query = configurationQuery();
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          sourceRecord({
            kind: 'INSTALL',
            installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
          }),
        ]),
      });

    expect(projection.currentAssertion).toMatchObject({
      targetRef: 'COMPONENT:AIMS2:NEW',
      property: 'component.installed',
      truth: 'TRUE',
      value: true,
      status: 'SUPPORTED',
      authority: 'CONTROLLED_SOURCE',
    });
    expect(projection.configEvents).toHaveLength(1);
    expect(projection.configEvents[0]).toMatchObject({
      eventKind: 'INSTALL',
      occurrenceStatus: 'OBSERVED',
      eventChainStatus: 'CLOSED',
    });

    const evidenceId: string = projection.evidenceRecords[0].evidenceRecordId;
    const eventId: string = projection.configEvents[0].configEventId;
    const assertionId: string = projection.currentAssertion.assertionId;
    expect(bindingExists(projection, 'SUPPORTS', evidenceId, eventId)).toBe(
      true,
    );
    expect(bindingExists(projection, 'SUPPORTS', evidenceId, assertionId)).toBe(
      true,
    );
    expect(
      bindingExists(projection, 'DERIVED_FROM', assertionId, eventId),
    ).toBe(true);
    expect(
      projection.bindings
        .filter(
          (binding: ConfigurationEventEvidenceBinding) =>
            binding.fromRef === eventId || binding.toRef === eventId,
        )
        .every(
          (binding: ConfigurationEventEvidenceBinding) =>
            binding.evidenceRecordId === evidenceId,
        ),
    ).toBe(true);
    expect(
      bindingExists(
        projection,
        'INSTALLS',
        eventId,
        query.target.kind === 'COMPONENT' ? query.target.componentId : '',
      ),
    ).toBe(true);
  });

  it('uses an explicit latest REMOVE as controlled FALSE, not no-record inference', () => {
    const query = configurationQuery();
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          sourceRecord(
            {
              kind: 'INSTALL',
              installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
            },
            {
              recordId: 'WORK-ORDER:INSTALL:JAN',
              effectiveAt: '2026-01-10T08:00:00.000Z',
              recordedAt: '2026-01-10T09:00:00.000Z',
            },
          ),
          sourceRecord(
            {
              kind: 'REMOVE',
              removedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
            },
            { recordId: 'WORK-ORDER:REMOVE:AUG' },
          ),
        ]),
      });

    expect(projection.currentAssertion).toMatchObject({
      truth: 'FALSE',
      value: false,
      status: 'SUPPORTED',
      authority: 'CONTROLLED_SOURCE',
    });
    expect(
      projection.bindings.some(
        (binding: ConfigurationEventEvidenceBinding) =>
          binding.relation === 'REMOVES' &&
          binding.toRef === 'COMPONENT:AIMS2:NEW',
      ),
    ).toBe(true);
  });

  it('maps REPLACE as one event that installs new, removes old and links new to old', () => {
    const query = configurationQuery();
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          sourceRecord({
            kind: 'REPLACE',
            installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
            removedComponent: componentIdentity('COMPONENT:AIMS2:OLD'),
          }),
        ]),
      });
    const eventId: string = projection.configEvents[0].configEventId;
    const evidenceId: string = projection.evidenceRecords[0].evidenceRecordId;

    expect(projection.currentAssertion.truth).toBe('TRUE');
    expect(
      bindingExists(projection, 'INSTALLS', eventId, 'COMPONENT:AIMS2:NEW'),
    ).toBe(true);
    expect(
      bindingExists(projection, 'REMOVES', eventId, 'COMPONENT:AIMS2:OLD'),
    ).toBe(true);
    expect(
      bindingExists(
        projection,
        'REPLACES',
        'COMPONENT:AIMS2:NEW',
        'COMPONENT:AIMS2:OLD',
      ),
    ).toBe(true);
    expect(
      projection.bindings
        .filter((binding: ConfigurationEventEvidenceBinding) =>
          ['INSTALLS', 'REMOVES', 'REPLACES'].includes(binding.relation),
        )
        .every(
          (binding: ConfigurationEventEvidenceBinding) =>
            binding.evidenceRecordId === evidenceId,
        ),
    ).toBe(true);
  });

  it('maps SOFTWARE_LOAD to the load occurrence and its controlled host component', () => {
    const query = configurationQuery({
      kind: 'SOFTWARE',
      softwareKey: 'AIMS2-BP-V18',
      targetComponentId: 'COMPONENT:AIMS2:NEW',
      positionId: 'POSITION:AIMS',
    });
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          sourceRecord({
            kind: 'SOFTWARE_LOAD',
            softwareLoad: {
              softwareLoadId: 'SOFTWARE-LOAD:AIMS2:V18',
              softwareKey: 'AIMS2-BP-V18',
              version: 'V18',
              targetComponentId: 'COMPONENT:AIMS2:NEW',
            },
          }),
        ]),
      });
    const eventId: string = projection.configEvents[0].configEventId;

    expect(projection.currentAssertion).toMatchObject({
      property: 'software.loaded',
      truth: 'TRUE',
      value: 'SOFTWARE-LOAD:AIMS2:V18',
    });
    expect(
      bindingExists(
        projection,
        'LOADS_SOFTWARE',
        eventId,
        'SOFTWARE-LOAD:AIMS2:V18',
      ),
    ).toBe(true);
    expect(
      bindingExists(
        projection,
        'LOADED_ON',
        'SOFTWARE-LOAD:AIMS2:V18',
        'COMPONENT:AIMS2:NEW',
      ),
    ).toBe(true);
  });

  it('returns CONFLICT for two different software loads at the same effective time', () => {
    const query = configurationQuery({
      kind: 'SOFTWARE',
      softwareKey: 'AIMS2-BP-V18',
      targetComponentId: 'COMPONENT:AIMS2:NEW',
      positionId: 'POSITION:AIMS',
    });
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          sourceRecord(
            {
              kind: 'SOFTWARE_LOAD',
              softwareLoad: {
                softwareLoadId: 'SOFTWARE-LOAD:AIMS2:V18:A',
                softwareKey: 'AIMS2-BP-V18',
                version: 'V18-A',
                targetComponentId: 'COMPONENT:AIMS2:NEW',
              },
            },
            { recordId: 'SOFTWARE-RECORD:A' },
          ),
          sourceRecord(
            {
              kind: 'SOFTWARE_LOAD',
              softwareLoad: {
                softwareLoadId: 'SOFTWARE-LOAD:AIMS2:V18:B',
                softwareKey: 'AIMS2-BP-V18',
                version: 'V18-B',
                targetComponentId: 'COMPONENT:AIMS2:NEW',
              },
            },
            { recordId: 'SOFTWARE-RECORD:B' },
          ),
        ]),
      });

    expect(projection.currentAssertion).toMatchObject({
      property: 'software.loaded',
      truth: 'CONFLICT',
      value: null,
      status: 'CONFLICT',
      authority: 'NONE',
    });
    expect(diagnosticCodes(projection)).toContain('EVENT_STATE_CONFLICT');
  });

  it.each(changeEventCases())(
    'maps $label with its exact event and affected-item relations',
    ({ target, event, eventRelation, recordRef, property }) => {
      const query = configurationQuery(target);
      const projection: InstallationEventEvidenceProjection =
        mapInstallationEventEvidence({
          query,
          result: completeResult(query, [sourceRecord(event)]),
        });
      const eventId: string = projection.configEvents[0].configEventId;

      expect(projection.currentAssertion).toMatchObject({
        property,
        truth: 'TRUE',
        status: 'SUPPORTED',
      });
      expect(bindingExists(projection, eventRelation, eventId, recordRef)).toBe(
        true,
      );
      expect(
        projection.bindings.some(
          (binding: ConfigurationEventEvidenceBinding) =>
            binding.relation === 'AFFECTS_ITEM' &&
            binding.fromRef === recordRef,
        ),
      ).toBe(true);
    },
  );

  it('keeps partial source coverage UNKNOWN even when one controlled install is present', () => {
    const query = configurationQuery();
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: partialResult(query, [
          sourceRecord({
            kind: 'INSTALL',
            installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
          }),
        ]),
      });

    expect(projection.currentAssertion).toMatchObject({
      truth: 'UNKNOWN',
      value: null,
      status: 'WAITING_INPUT',
      authority: 'NONE',
    });
    expect(projection.configEvents[0].eventChainStatus).toBe('PARTIAL');
    expect(diagnosticCodes(projection)).toEqual(
      expect.arrayContaining([
        'SOURCE_RESULTS_PARTIAL',
        'SOURCE_COVERAGE_INCOMPLETE',
      ]),
    );
    expect(
      projection.bindings.some(
        (binding: ConfigurationEventEvidenceBinding) =>
          binding.relation === 'SUPPORTS' &&
          binding.toRef === projection.currentAssertion.assertionId,
      ),
    ).toBe(false);
  });

  it.each(unusableEvidenceCases())(
    'keeps current state UNKNOWN when $label',
    ({ query, record, diagnostic }) => {
      const projection: InstallationEventEvidenceProjection =
        mapInstallationEventEvidence({
          query,
          result: completeResult(query, [record]),
        });
      expect(projection.currentAssertion.truth).toBe('UNKNOWN');
      expect(projection.currentAssertion.authority).toBe('NONE');
      expect(diagnosticCodes(projection)).toContain(diagnostic);
      expect(projection.configEvents[0].eventChainStatus).not.toBe('CLOSED');
    },
  );

  it.each([
    'IPC_RECORD',
    'INVENTORY_RECORD',
    'HISTORICAL_ASSESSMENT',
    'S1000D_APPLICABILITY',
    'STRUCTURE_ONLY_GRAPH',
  ])(
    'rejects forbidden %s authority instead of claiming installation',
    (authorityClass) => {
      const query = configurationQuery();
      const record = {
        ...sourceRecord({
          kind: 'INSTALL',
          installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
        }),
        authorityClass,
      } as unknown as InstallationEventSourceRecord;
      const projection: InstallationEventEvidenceProjection =
        mapInstallationEventEvidence({
          query,
          result: completeResult(query, [record]),
        });

      expect(projection.currentAssertion).toMatchObject({
        truth: 'UNKNOWN',
        value: null,
        status: 'WAITING_INPUT',
        authority: 'NONE',
      });
      expect(projection.evidenceRecords).toEqual([]);
      expect(projection.configEvents).toEqual([]);
      expect(diagnosticCodes(projection)).toContain('RECORD_INVALID');
    },
  );

  it('preserves contradictory same-time records and returns CONFLICT', () => {
    const query = configurationQuery({
      kind: 'EQUIPMENT',
      equipmentKey: 'AIMS2',
      positionId: 'POSITION:AIMS',
    });
    const effectiveAt: string = '2026-08-28T08:00:00.000Z';
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          sourceRecord(
            {
              kind: 'INSTALL',
              installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
            },
            { recordId: 'WORK-ORDER:INSTALL:CONFLICT', effectiveAt },
          ),
          sourceRecord(
            {
              kind: 'REMOVE',
              removedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
            },
            { recordId: 'WORK-ORDER:REMOVE:CONFLICT', effectiveAt },
          ),
        ]),
      });

    expect(projection.currentAssertion).toMatchObject({
      truth: 'CONFLICT',
      value: null,
      status: 'CONFLICT',
      authority: 'NONE',
    });
    expect(projection.evidenceRecords).toHaveLength(2);
    expect(
      projection.configEvents.every(
        (event) => event.eventChainStatus === 'CONFLICT',
      ),
    ).toBe(true);
    expect(diagnosticCodes(projection)).toContain('EVENT_STATE_CONFLICT');
  });

  it('does not choose between two revisions of one source record', () => {
    const query = configurationQuery({
      kind: 'EQUIPMENT',
      equipmentKey: 'AIMS2',
      positionId: 'POSITION:AIMS',
    });
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: completeResult(query, [
          sourceRecord(
            {
              kind: 'INSTALL',
              installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
            },
            { recordId: 'WORK-ORDER:SAME', revision: 'REV-1' },
          ),
          sourceRecord(
            {
              kind: 'REMOVE',
              removedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
            },
            { recordId: 'WORK-ORDER:SAME', revision: 'REV-2' },
          ),
        ]),
      });

    expect(projection.currentAssertion.truth).toBe('CONFLICT');
    expect(projection.evidenceRecords).toHaveLength(2);
    expect(diagnosticCodes(projection)).toContain(
      'SOURCE_RECORD_REVISION_CONFLICT',
    );
  });

  it('fails closed when a complete response contains one malformed record', () => {
    const query = configurationQuery();
    const valid: InstallationEventSourceRecord = sourceRecord({
      kind: 'INSTALL',
      installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
    });
    const malformed: InstallationEventSourceRecord = {
      ...structuredClone(valid),
      recordId: 'WORK-ORDER:MALFORMED',
      effectiveAt: 'not-a-time',
    };
    const result = completeResult(query, [valid]);
    result.records = [valid, malformed] as never;
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({ query, result });

    expect(projection.currentAssertion.truth).toBe('UNKNOWN');
    expect(diagnosticCodes(projection)).toContain('RECORD_INVALID');
  });

  it('honors an explicit source CONFLICT even when individual records look controlled', () => {
    const query = configurationQuery();
    const projection: InstallationEventEvidenceProjection =
      mapInstallationEventEvidence({
        query,
        result: conflictResult(query, [
          sourceRecord({
            kind: 'INSTALL',
            installedComponent: componentIdentity('COMPONENT:AIMS2:NEW'),
          }),
        ]),
      });

    expect(projection.currentAssertion.truth).toBe('CONFLICT');
    expect(diagnosticCodes(projection)).toContain('SOURCE_CONFLICT_REPORTED');
  });
});
