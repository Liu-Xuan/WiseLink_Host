import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Request } from 'express';

import type {
  CanonicalAssessmentGapProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { markDependentConfigurationPredicateTracesStale } from '../../../server/modules/canonical-host/configuration-evidence/configuration-predicate-trace.staleness';
import { adoptConfigurationEvidenceIntoWorkItem } from '../../../server/modules/canonical-host/configuration-evidence/configuration-evidence-work-item.transition';
import type {
  ConfigurationPredicateTrace,
  ConfigurationPredicateTraceStaleReason,
  ConfigurationSnapshot,
} from '../../../server/modules/canonical-host/configuration-evidence/configuration-snapshot.types';
import {
  type CommitConfigurationEvidenceInput,
  type CommitConfigurationEvidenceResult,
  type ConfigurationEvidenceReplayRead,
  type CompleteConfigurationEvidenceQueryInput,
  type ConfigurationEvidenceQueryAttemptReadModel,
  type ConfigurationEvidenceQueryStorePort,
  type ConfigurationEvidenceSnapshotSummary,
  type ConfigurationEvidenceStorePort,
  type ConfigurationEvidenceTruthSummary,
  type PersistedConfigurationEvidenceSnapshot,
  type RefreshConfigurationEvidenceRequest,
  type ReserveConfigurationEvidenceQueryInput,
} from '../../../server/modules/canonical-host/configuration-evidence/configuration-evidence.persistence.types';
import { ConfigurationEvidenceService } from '../../../server/modules/canonical-host/configuration-evidence/configuration-evidence.service';
import type {
  GetInstallationEventsCompleteResult,
  GetInstallationEventsPort,
  GetInstallationEventsQuery,
  GetInstallationEventsResult,
  InstallationEventPayload,
  InstallationEventSourceRecord,
} from '../../../server/modules/canonical-host/configuration-evidence/get-installation-events.port';
import {
  changeEventCases,
  completeResult,
  componentIdentity,
  sourceRecord,
  unavailableResult,
} from './installation-event-evidence.fixtures';

const TENANT_ID = 'tenant-configuration-evidence';
const ACTOR_ID = 'user-configuration-evidence';
const WORK_ITEM_ID = 'WI-CONFIGURATION-EVIDENCE';
const DOCUMENT_VERSION_ID = 'DV-777-FTD-31-21002';
const AS_OF = '2026-08-29T23:59:59.999Z';
const AIMS2_TARGET = {
  kind: 'EQUIPMENT' as const,
  equipmentKey: 'AIMS2',
  positionId: null,
};

describe('Host configuration-evidence persistence product chain', () => {
  it('keeps the real 587/2579 B-2035 AIMS-2 unavailable result candidate-only', async () => {
    const fleetAsset = realB2035Asset();
    const fixture = target({ fleetAsset });
    fixture.port.resultFactory = (query: GetInstallationEventsQuery) => {
      const result = unavailableResult(query, 'SOURCE_NOT_CONFIGURED');
      result.source.owner = 'canonical-host:configuration-evidence';
      result.coverage.included =
        'B-2035 is resolved from the real 587 asset / 2579 alias snapshot.';
      result.coverage.limitation =
        'The real Fleet snapshot has no configuration facts or controlled event chain.';
      return result;
    };

    const queried = await fixture.service.query(
      WORK_ITEM_ID,
      refreshBody('REQ-AIMS2-UNKNOWN', 7),
      {} as Request,
    );

    expect(fleetAsset).toMatchObject({
      assetId: 'AIRCRAFT:MODEL_MSN:B777_39L_38674',
      aircraftNumber: 'B-2035',
      msn: '38674',
      lineNumber: 1051,
    });
    expect(queried.workItemRevision).toBe(7);
    expect(queried.replayed).toBe(false);
    expect(queried.candidate.terminalStatus).toBe('NOT_CONNECTED');
    expect(queried.candidate.candidateSnapshot?.facts[0]).toMatchObject({
      targetRef: 'EQUIPMENT:AIMS2',
      truth: 'UNKNOWN',
      value: null,
      status: 'WAITING_INPUT',
      authority: 'NONE',
      supportingEvidenceRecordIds: [],
      derivedConfigEventIds: [],
    });
    expect(
      queried.candidate.candidateSnapshot?.predicateTraces[0],
    ).toMatchObject({
      truth: 'UNKNOWN',
      status: 'WAITING_INPUT',
      dependencyObservation: {
        sourceStatus: 'UNAVAILABLE',
        sourceErrorCode: 'SOURCE_NOT_CONFIGURED',
        evidenceRecords: [],
      },
    });
    expect(queried.authority).toMatchObject({
      queryAdvancesWorkItemRevision: false,
      notConnectedMeansFalse: false,
      gapBoundQuery: true,
      capabilityGrantRequired: true,
    });
    expect(queried.candidate.request.capabilityGrant).toMatchObject({
      grantRef: 'CG-REQ-AIMS2-UNKNOWN',
      gapRefs: ['GAP-CONFIGURATION'],
      affectedCriterionIds: ['APP-012'],
      sourceConfigured: true,
    });
    expect(fixture.workItem().revision).toBe(7);
    expect(fixture.store.recordCount()).toBe(0);
  });

  it('versions TRUE to FALSE, preserves old evidence, marks only the old dependency STALE, and replays exactly once', async () => {
    const fixture = target({ fleetAsset: realB2035Asset() });
    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      controlledResult(
        query,
        [
          equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1),
          equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P2', 'P2', 2),
          equipmentRecord('REMOVE', 'COMPONENT:AIMS2:P2', 'P2', 3),
        ],
        'SOURCE-OBSERVATION-REV-1',
      );

    const first = await queryAndAdopt(
      fixture,
      WORK_ITEM_ID,
      refreshBody('REQ-AIMS2-TRUE', 7),
      {} as Request,
    );
    const firstEvidence = structuredClone(
      first.persisted.snapshot.evidenceRecordRefs,
    );
    const firstFact = structuredClone(first.persisted.snapshot.facts[0]);
    expect(firstFact.truth).toBe('TRUE');

    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      controlledResult(
        query,
        [
          equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1),
          equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P2', 'P2', 2),
          equipmentRecord('REMOVE', 'COMPONENT:AIMS2:P1', 'P1', 4),
          equipmentRecord('REMOVE', 'COMPONENT:AIMS2:P2', 'P2', 3),
        ],
        'SOURCE-OBSERVATION-REV-2',
      );
    const secondBody = refreshBody('REQ-AIMS2-FALSE', 8);
    const second = await queryAndAdopt(
      fixture,
      WORK_ITEM_ID,
      secondBody,
      {} as Request,
    );
    const sourceCallsBeforeReplay = fixture.port.calls.length;
    const replay = await queryAndAdopt(
      fixture,
      WORK_ITEM_ID,
      secondBody,
      {} as Request,
    );
    const old = await fixture.service.snapshot(
      WORK_ITEM_ID,
      first.persisted.summary.snapshotId,
      {} as Request,
    );

    expect(second.persisted.snapshot.facts[0]).toMatchObject({
      truth: 'FALSE',
      value: false,
      status: 'SUPPORTED',
      authority: 'CONTROLLED_SOURCE',
    });
    expect(second.workItemRevision).toBe(9);
    expect(second.persisted.summary.configurationRevision).toBe(2);
    expect(old.persisted.snapshot.facts[0]).toEqual(firstFact);
    expect(old.persisted.snapshot.evidenceRecordRefs).toEqual(firstEvidence);
    expect(old.persisted.snapshot.predicateTraces[0]).toMatchObject({
      truth: 'TRUE',
      status: 'STALE',
      staleReason: {
        code: 'DEPENDENCY_OBSERVATION_CHANGED',
        previousStatus: 'EVALUATED',
        incomingSourceRevision: 'SOURCE-OBSERVATION-REV-2',
      },
    });
    expect(replay.replayed).toBe(true);
    expect(replay.workItemRevision).toBe(9);
    expect(replay.persisted).toEqual(second.persisted);
    expect(fixture.port.calls).toHaveLength(sourceCallsBeforeReplay);
    expect(fixture.store.recordCount()).toBe(2);
    expect(fixture.workItem().revision).toBe(9);
    expect(
      (
        await fixture.service.snapshot(
          WORK_ITEM_ID,
          first.persisted.summary.snapshotId,
          {} as Request,
        )
      ).persisted.snapshot.predicateTraces[0].staleReason,
    ).toEqual(old.persisted.snapshot.predicateTraces[0].staleReason);
  });

  it('returns the consistent current WorkItem revision when an unrelated lane advances after authorization', async () => {
    const fixture = target({ fleetAsset: realB2035Asset() });
    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      controlledResult(
        query,
        [equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1)],
        'SOURCE-AIMS2-IDEMPOTENT-REV-1',
      );
    const body = refreshBody('REQ-AIMS2-IDEMPOTENT-RACE', 7);
    const first = await queryAndAdopt(
      fixture,
      WORK_ITEM_ID,
      body,
      {} as Request,
    );
    const sourceCallsBeforeReplay = fixture.port.calls.length;
    fixture.store.advanceWorkItemRevisionBeforeNextReplay();

    const replay = await queryAndAdopt(
      fixture,
      WORK_ITEM_ID,
      body,
      {} as Request,
    );

    expect(first.workItemRevision).toBe(8);
    expect(replay).toMatchObject({
      replayed: true,
      workItemRevision: 9,
      persisted: {
        summary: {
          snapshotId: first.persisted.summary.snapshotId,
          isCurrent: true,
        },
      },
    });
    expect(fixture.workItem().revision).toBe(9);
    expect(fixture.store.recordCount()).toBe(1);
    expect(fixture.port.calls).toHaveLength(sourceCallsBeforeReplay);
  });

  it('accepts adoption readback after a later reevaluation stage revision', async () => {
    const fixture = target({ fleetAsset: realB2035Asset() });
    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      controlledResult(
        query,
        [equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1)],
        'SOURCE-STAGE-REVISION-1',
      );
    const body = refreshBody('REQ-LATER-STAGE-REVISION', 7);
    const first = await queryAndAdopt(
      fixture,
      WORK_ITEM_ID,
      body,
      {} as Request,
    );
    const staged = fixture.workItem();
    const marker = staged.configurationEvidenceReevaluation;
    if (
      !marker ||
      marker.schemaVersion !==
        'wiselink.3_1.configuration_evidence_reevaluation.v2'
    ) {
      throw new Error('REEVALUATION_V2_REQUIRED');
    }
    staged.revision += 1;
    staged.configurationEvidenceReevaluation = {
      ...marker,
      status: 'RUNNING',
      stages: {
        ...marker.stages,
        applicability: {
          ...marker.stages.applicability,
          status: 'RUNNING',
        },
      },
    };
    fixture.replaceWorkItem(staged);

    const replay = await fixture.service.adopt(
      WORK_ITEM_ID,
      first.candidateEvidenceRef,
      { expectedRevision: 7 },
      {} as Request,
    );

    expect(replay).toMatchObject({
      replayed: true,
      workItemRevision: 9,
    });
    expect(fixture.workItem().configurationEvidenceReevaluation).toMatchObject({
      status: 'RUNNING',
      adoptionWorkItemRevision: 8,
      triggerSnapshotId: first.persisted.summary.snapshotId,
    });
  });

  it('marks a dependency in older history even when the current head queried an unrelated target', async () => {
    const fixture = target({ fleetAsset: realB2035Asset() });
    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      controlledResult(
        query,
        [equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1)],
        'SOURCE-AIMS2-REV-1',
      );
    const aims2 = await queryAndAdopt(
      fixture,
      WORK_ITEM_ID,
      refreshBody('REQ-AIMS2-HISTORY-TRUE', 7),
      {} as Request,
    );

    const repairCase = changeEventCases().find(
      (candidate) => candidate.target.kind === 'REPAIR',
    );
    if (!repairCase) throw new Error('TEST_REPAIR_CASE_REQUIRED');
    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      controlledResult(
        query,
        [
          sourceRecord(repairCase.event, {
            recordId: 'WORK-ORDER:REPAIR:1',
          }),
        ],
        'SOURCE-REPAIR-REV-1',
      );
    const unrelatedHead = await queryAndAdopt(
      fixture,
      WORK_ITEM_ID,
      refreshBodyFor('REQ-REPAIR-HEAD', 8, [repairCase.target]),
      {} as Request,
    );

    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      controlledResult(
        query,
        [
          equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1),
          equipmentRecord('REMOVE', 'COMPONENT:AIMS2:P1', 'P1', 4),
        ],
        'SOURCE-AIMS2-REV-2',
      );
    await queryAndAdopt(
      fixture,
      WORK_ITEM_ID,
      refreshBody('REQ-AIMS2-HISTORY-FALSE', 9),
      {} as Request,
    );
    const oldAims2 = await fixture.service.snapshot(
      WORK_ITEM_ID,
      aims2.persisted.summary.snapshotId,
      {} as Request,
    );
    const oldRepair = await fixture.service.snapshot(
      WORK_ITEM_ID,
      unrelatedHead.persisted.summary.snapshotId,
      {} as Request,
    );

    expect(oldAims2.persisted.snapshot.predicateTraces[0]).toMatchObject({
      truth: 'TRUE',
      status: 'STALE',
      staleReason: {
        previousStatus: 'EVALUATED',
        incomingSourceRevision: 'SOURCE-AIMS2-REV-2',
      },
    });
    expect(oldRepair.persisted.snapshot.predicateTraces[0]).toMatchObject({
      truth: 'TRUE',
      status: 'EVALUATED',
      staleReason: null,
    });
  });

  it('keeps a same-instance same-time contradiction unadopted', async () => {
    const fixture = target({ fleetAsset: realB2035Asset() });
    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      controlledResult(
        query,
        [
          equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 2),
          equipmentRecord('REMOVE', 'COMPONENT:AIMS2:P1', 'P1', 2),
        ],
        'SOURCE-CONFLICT-REV-1',
      );

    const queried = await fixture.service.query(
      WORK_ITEM_ID,
      refreshBody('REQ-AIMS2-CONFLICT', 7),
      {} as Request,
    );

    expect(queried.candidate.terminalStatus).toBe('CONFLICT');
    expect(
      queried.candidate.candidateSnapshot?.coverage.sourceCompleteness,
    ).toBe('CONFLICT');
    expect(queried.candidate.candidateSnapshot?.facts[0]).toMatchObject({
      truth: 'CONFLICT',
      status: 'CONFLICT',
      authority: 'NONE',
    });
    expect(
      queried.candidate.candidateSnapshot?.predicateTraces[0],
    ).toMatchObject({
      truth: 'CONFLICT',
      status: 'CONFLICT',
    });
    expect(fixture.workItem().revision).toBe(7);
    expect(fixture.store.recordCount()).toBe(0);
  });

  it('fails ACL before Fleet or persistence I/O and records an unconfigured source truthfully', async () => {
    const denied = target({ fleetAsset: realB2035Asset(), denyAccess: true });
    await expect(
      denied.service.query(
        WORK_ITEM_ID,
        refreshBody('REQ-DENIED', 7),
        {} as Request,
      ),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(denied.fleet.readCurrentForAircraft).not.toHaveBeenCalled();
    expect(denied.port.calls).toHaveLength(0);
    expect(denied.store.recordCount()).toBe(0);

    const unconfigured = target({
      fleetAsset: realB2035Asset(),
      sourceConfigured: false,
    });
    const unavailable = await unconfigured.service.query(
      WORK_ITEM_ID,
      refreshBody('REQ-UNCONFIGURED', 7),
      {} as Request,
    );
    expect(unavailable.candidate.terminalStatus).toBe('NOT_CONNECTED');
    expect(unconfigured.fleet.readCurrentForAircraft).toHaveBeenCalledTimes(1);
    expect(unconfigured.store.recordCount()).toBe(0);
  });

  it('rejects self-reported evidence and authority fields at the HTTP service boundary', async () => {
    const fixture = target({ fleetAsset: realB2035Asset() });
    await expect(
      fixture.service.query(
        WORK_ITEM_ID,
        {
          ...refreshBody('REQ-SELF-REPORTED', 7),
          evidenceRecords: [{ recordId: 'FAKE' }],
        },
        {} as Request,
      ),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_EVIDENCE_UNKNOWN_FIELD:evidenceRecords',
      statusCode: 400,
    });
    expect(fixture.objectAccess.freshRead).not.toHaveBeenCalled();
    expect(fixture.store.recordCount()).toBe(0);
  });

  it('rejects an unknown Gap before Fleet, connector, or persistence I/O', async () => {
    const fixture = target({ fleetAsset: realB2035Asset() });
    const body = refreshBody('REQ-UNKNOWN-GAP', 7);
    body.gapRefs = ['GAP-UNKNOWN'];

    await expect(
      fixture.service.query(WORK_ITEM_ID, body, {} as Request),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_EVIDENCE_GAP_UNKNOWN:GAP-UNKNOWN',
      statusCode: 409,
    });
    expect(fixture.fleet.readCurrentForAircraft).not.toHaveBeenCalled();
    expect(fixture.port.calls).toHaveLength(0);
    expect(fixture.queryStore.count()).toBe(0);
    expect(fixture.store.recordCount()).toBe(0);
  });

  it.each([
    ['missing capability', { evidenceCapabilities: [] }],
    ['non-material P2', { materiality: 'P2_OPTIMIZATION' }],
    ['already resolved', { resolutionStatus: 'RESOLVED_BY_ENGINEER_REVIEW' }],
    [
      'controlled disposition',
      {
        disposition: {
          gapRef: 'GAP-CONFIGURATION',
          disposition: 'MITIGATE_AND_MONITOR',
          rationale: '当前用监控边界控制，不授权立即查询。',
          assumptions: [],
          controlsAndMitigations: ['持续监控构型变化。'],
          evidenceRefs: [],
          reviewBy: '2026-10-01T00:00:00.000Z',
          reopenTriggers: ['发现受影响件号。'],
          source: 'ENGINEER_CONFIRMED_DECISION_SNAPSHOT',
          reviewSequence: 2,
        },
      },
    ],
  ] as const)(
    'rejects a Gap with %s before Fleet or connector I/O',
    async (_label, gapOverrides) => {
      const fixture = target({
        fleetAsset: realB2035Asset(),
        gapOverrides: gapOverrides as Partial<CanonicalAssessmentGapProjection>,
      });

      await expect(
        fixture.service.query(
          WORK_ITEM_ID,
          refreshBody('REQ-NON-QUERYABLE', 7),
          {} as Request,
        ),
      ).rejects.toMatchObject({
        code: 'CONFIGURATION_EVIDENCE_GAP_NOT_QUERYABLE:GAP-CONFIGURATION',
        statusCode: 409,
      });
      expect(fixture.fleet.readCurrentForAircraft).not.toHaveBeenCalled();
      expect(fixture.port.calls).toHaveLength(0);
      expect(fixture.queryStore.count()).toBe(0);
    },
  );

  it('binds an idempotency key to the exact selected Gap set', async () => {
    const fixture = target({
      fleetAsset: realB2035Asset(),
      sourceConfigured: false,
    });
    const first = refreshBody('REQ-GAP-IDEMPOTENCY', 7);
    await fixture.service.query(WORK_ITEM_ID, first, {} as Request);
    const changed = structuredClone(first);
    changed.gapRefs = ['GAP-DIFFERENT'];

    await expect(
      fixture.service.query(WORK_ITEM_ID, changed, {} as Request),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_EVIDENCE_IDEMPOTENCY_PAYLOAD_MISMATCH',
      statusCode: 409,
    });
    expect(fixture.fleet.readCurrentForAircraft).toHaveBeenCalledTimes(1);
    expect(fixture.queryStore.count()).toBe(1);
  });

  it('records an unconfigured query as NOT_CONNECTED without advancing revision', async () => {
    const fixture = target({
      fleetAsset: realB2035Asset(),
      sourceConfigured: false,
    });

    const queried = await fixture.service.query(
      WORK_ITEM_ID,
      refreshBody('REQ-QUERY-NOT-CONNECTED', 7),
      {} as Request,
    );
    const readback = await fixture.service.queryStatus(
      WORK_ITEM_ID,
      queried.candidate.queryAttemptRef,
      {} as Request,
    );

    expect(queried).toMatchObject({
      workItemRevision: 7,
      replayed: false,
      candidate: {
        terminalStatus: 'NOT_CONNECTED',
        inputRevision: 7,
        sourceRecordCount: 0,
        adoption: { status: 'CANDIDATE_UNADOPTED' },
        candidateSnapshot: {
          facts: [{ truth: 'UNKNOWN', status: 'WAITING_INPUT' }],
        },
      },
      authority: {
        queryAdvancesWorkItemRevision: false,
        notConnectedMeansFalse: false,
        connectorConcurrency: 1,
      },
    });
    expect(readback.candidate).toEqual(queried.candidate);
    expect(fixture.workItem().revision).toBe(7);
    expect(fixture.port.calls).toHaveLength(0);
    expect(fixture.store.recordCount()).toBe(0);
    expect(fixture.queryStore.count()).toBe(1);
  });

  it('keeps a successful query candidate-only, then adopts it with one CAS', async () => {
    const servingBefore = servingProjectionSentinels();
    const fixture = target({
      fleetAsset: realB2035Asset(),
      workItemOverrides: servingBefore,
    });
    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      controlledResult(
        query,
        [equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1)],
        'SOURCE-QUERY-REV-1',
      );
    const body = refreshBody('REQ-QUERY-ADOPT', 7);

    const queried = await fixture.service.query(
      WORK_ITEM_ID,
      body,
      {} as Request,
    );
    const queryReplay = await fixture.service.query(
      WORK_ITEM_ID,
      body,
      {} as Request,
    );

    expect(queried).toMatchObject({
      workItemRevision: 7,
      candidate: {
        terminalStatus: 'SUCCEEDED_EVIDENCE',
        sourceRecordCount: 1,
        candidateSnapshot: { facts: [{ truth: 'TRUE' }] },
      },
    });
    expect(queryReplay.replayed).toBe(true);
    expect(fixture.workItem().revision).toBe(7);
    expect(fixture.store.recordCount()).toBe(0);
    expect(fixture.port.calls).toHaveLength(1);

    const adopted = await fixture.service.adopt(
      WORK_ITEM_ID,
      queried.candidate.candidateEvidenceRef,
      { expectedRevision: 7 },
      {} as Request,
    );
    const adoptionReplay = await fixture.service.adopt(
      WORK_ITEM_ID,
      queried.candidate.candidateEvidenceRef,
      { expectedRevision: 7 },
      {} as Request,
    );

    expect(adopted).toMatchObject({
      workItemRevision: 8,
      replayed: false,
      persisted: { snapshot: { facts: [{ truth: 'TRUE' }] } },
      reevaluation: {
        mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
        status: 'REQUIRED',
      },
    });
    expect(adoptionReplay).toMatchObject({
      workItemRevision: 8,
      replayed: true,
    });
    expect(fixture.workItem().revision).toBe(8);
    expect(fixture.workItem().configurationEvidenceReevaluation).toEqual({
      schemaVersion: 'wiselink.3_1.configuration_evidence_reevaluation.v2',
      trigger: 'CONFIGURATION_EVIDENCE_ADOPTED',
      triggerSnapshotId: adopted.persisted.summary.snapshotId,
      triggerConfigurationRevision: 1,
      adoptionWorkItemRevision: 8,
      mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
      status: 'REQUIRED',
      stages: {
        applicability: {
          status: 'PENDING',
          retryNo: 0,
          attempt: null,
          committedWorkItemRevision: null,
          terminal: null,
        },
        dynamic: {
          status: 'PENDING',
          retryNo: 0,
          attempt: null,
          committedWorkItemRevision: null,
          terminal: null,
        },
        overall: {
          status: 'PENDING',
          retryNo: 0,
          attempt: null,
          committedWorkItemRevision: null,
          terminal: null,
        },
      },
      stagedBundle: {
        applicabilityInput: null,
        applicability: null,
        baseRules: null,
      },
      promotedWorkItemRevision: null,
      candidateOnly: true,
    });
    expect({
      applicabilityInput: fixture.workItem().applicabilityInput,
      applicability: fixture.workItem().applicability,
      assessment: fixture.workItem().assessment,
      integratedAssessment: fixture.workItem().integratedAssessment,
      aeo: fixture.workItem().aeo,
    }).toEqual(servingBefore);
    expect(fixture.store.recordCount()).toBe(1);
  });

  it('rejects an adopted-candidate replay whose immutable trigger binding was changed', async () => {
    const fixture = target({ fleetAsset: realB2035Asset() });
    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      controlledResult(
        query,
        [equipmentRecord('INSTALL', 'COMPONENT:AIMS2:P1', 'P1', 1)],
        'SOURCE-TRIGGER-BINDING-REV-1',
      );
    const body = refreshBody('REQ-TRIGGER-BINDING', 7);
    const first = await queryAndAdopt(
      fixture,
      WORK_ITEM_ID,
      body,
      {} as Request,
    );
    const tampered = fixture.workItem();
    if (!tampered.configurationEvidenceReevaluation) {
      throw new Error('REEVALUATION_REQUIRED');
    }
    tampered.configurationEvidenceReevaluation = {
      ...tampered.configurationEvidenceReevaluation,
      triggerSnapshotId: 'CONFIGURATION-SNAPSHOT:TAMPERED',
    };
    fixture.replaceWorkItem(tampered);

    await expect(
      fixture.service.adopt(
        WORK_ITEM_ID,
        first.candidateEvidenceRef,
        { expectedRevision: 7 },
        {} as Request,
      ),
    ).rejects.toMatchObject({
      code: 'CONFIGURATION_EVIDENCE_CURRENT_READBACK_INVALID',
      statusCode: 503,
    });
  });

  it('does not turn an authoritative no-record response into a false fact', async () => {
    const fixture = target({ fleetAsset: realB2035Asset() });
    fixture.port.resultFactory = (query: GetInstallationEventsQuery) =>
      completeResult(query, []);

    const queried = await fixture.service.query(
      WORK_ITEM_ID,
      refreshBody('REQ-QUERY-NO-RECORD', 7),
      {} as Request,
    );

    expect(queried).toMatchObject({
      workItemRevision: 7,
      candidate: {
        terminalStatus: 'SUCCEEDED_NO_RECORD',
        sourceRecordCount: 0,
        candidateSnapshot: {
          facts: [{ truth: 'UNKNOWN', status: 'WAITING_INPUT' }],
        },
      },
      authority: { noRecordMeansFalse: false },
    });
    expect(fixture.workItem().revision).toBe(7);
    expect(fixture.store.recordCount()).toBe(0);
  });
});

class ControlledInstallationEventsPort implements GetInstallationEventsPort {
  readonly calls: GetInstallationEventsQuery[] = [];
  resultFactory: (
    query: GetInstallationEventsQuery,
  ) => GetInstallationEventsResult = (query: GetInstallationEventsQuery) =>
    unavailableResult(query);

  constructor(readonly configured: boolean) {}

  async getInstallationEvents(
    query: GetInstallationEventsQuery,
  ): Promise<GetInstallationEventsResult> {
    this.calls.push(structuredClone(query));
    return this.resultFactory(query);
  }
}

class InMemoryConfigurationEvidenceStore implements ConfigurationEvidenceStorePort {
  private readonly records: PersistedConfigurationEvidenceSnapshot[] = [];
  private readonly staleBySnapshot: Map<
    string,
    Map<string, ConfigurationPredicateTraceStaleReason>
  > = new Map();
  private currentSnapshotId: string | null = null;
  private advanceRevisionOnReplay: boolean = false;

  constructor(
    private readonly currentWorkItem: () => CanonicalWorkItemProjection,
    private readonly saveWorkItem: (value: CanonicalWorkItemProjection) => void,
  ) {}

  recordCount(): number {
    return this.records.length;
  }

  advanceWorkItemRevisionBeforeNextReplay(): void {
    this.advanceRevisionOnReplay = true;
  }

  async findByRequest(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
  }): Promise<ConfigurationEvidenceReplayRead | null> {
    void input.tenantId;
    const stored = this.records.find(
      (record: PersistedConfigurationEvidenceSnapshot) =>
        record.request.requestId === input.requestId &&
        input.workItemId === WORK_ITEM_ID,
    );
    if (!stored) return null;
    if (this.advanceRevisionOnReplay) {
      const current = this.currentWorkItem();
      this.saveWorkItem({
        ...structuredClone(current),
        revision: current.revision + 1,
      });
      this.advanceRevisionOnReplay = false;
    }
    return {
      workItem: structuredClone(this.currentWorkItem()),
      persisted: this.materialize(stored),
    };
  }

  async readCurrent(input: {
    tenantId: string;
    workItemId: string;
  }): Promise<PersistedConfigurationEvidenceSnapshot | null> {
    void input.tenantId;
    if (input.workItemId !== WORK_ITEM_ID || !this.currentSnapshotId) {
      return null;
    }
    const stored = this.records.find(
      (record: PersistedConfigurationEvidenceSnapshot) =>
        record.summary.snapshotId === this.currentSnapshotId,
    );
    return stored ? this.materialize(stored) : null;
  }

  async readSnapshot(input: {
    tenantId: string;
    workItemId: string;
    snapshotId: string;
  }): Promise<PersistedConfigurationEvidenceSnapshot | null> {
    void input.tenantId;
    if (input.workItemId !== WORK_ITEM_ID) return null;
    const stored = this.records.find(
      (record: PersistedConfigurationEvidenceSnapshot) =>
        record.summary.snapshotId === input.snapshotId,
    );
    return stored ? this.materialize(stored) : null;
  }

  async listHistory(input: {
    tenantId: string;
    workItemId: string;
    limit: number;
  }): Promise<ConfigurationEvidenceSnapshotSummary[]> {
    void input.tenantId;
    if (input.workItemId !== WORK_ITEM_ID) return [];
    return [...this.records]
      .reverse()
      .slice(0, input.limit)
      .map(
        (record: PersistedConfigurationEvidenceSnapshot) =>
          this.materialize(record).summary,
      );
  }

  async commit(
    input: CommitConfigurationEvidenceInput,
  ): Promise<CommitConfigurationEvidenceResult> {
    const existing = await this.findByRequest({
      tenantId: input.tenantId,
      workItemId: input.workItemId,
      requestId: input.request.requestId,
    });
    if (existing) {
      if (
        JSON.stringify(existing.persisted.request) !==
        JSON.stringify(input.request)
      ) {
        throw conflict('CONFIGURATION_EVIDENCE_IDEMPOTENCY_PAYLOAD_MISMATCH');
      }
      return {
        replayed: true,
        workItem: existing.workItem,
        persisted: existing.persisted,
      };
    }
    const workItem = this.currentWorkItem();
    if (workItem.revision !== input.expectedWorkItemRevision) {
      throw conflict('WORK_ITEM_CAS_CONFLICT');
    }
    const configurationRevision = this.records.length + 1;
    const snapshotId = `CONFIGURATION-SNAPSHOT:${input.request.requestId}`;
    for (const prior of this.records) {
      if (
        prior.snapshot.aircraftAssetId === input.snapshot.aircraftAssetId &&
        prior.snapshot.assessmentAsOf <= input.snapshot.assessmentAsOf
      ) {
        const marked = markDependentConfigurationPredicateTracesStale({
          snapshot: prior.snapshot,
          incomingProjections: input.projections,
        });
        const stale = new Map<string, ConfigurationPredicateTraceStaleReason>();
        for (const trace of marked.predicateTraces) {
          if (trace.status === 'STALE' && trace.staleReason) {
            stale.set(
              trace.predicateTraceId,
              structuredClone(trace.staleReason),
            );
          }
        }
        if (stale.size > 0) {
          this.staleBySnapshot.set(prior.summary.snapshotId, stale);
        }
      }
    }
    const truthSummary = summarizeTruth(input.snapshot);
    const summary: ConfigurationEvidenceSnapshotSummary = {
      snapshotId,
      configurationRevision,
      workItemRevisionBefore: input.expectedWorkItemRevision,
      workItemRevisionAfter: input.expectedWorkItemRevision + 1,
      aircraftAssetId: input.snapshot.aircraftAssetId,
      assessmentAsOf: input.snapshot.assessmentAsOf,
      sourceCompleteness: input.snapshot.coverage.sourceCompleteness,
      truthSummary,
      recordedByActorId: input.actorId,
      recordedAt: input.recordedAt,
      isCurrent: true,
    };
    const stored: PersistedConfigurationEvidenceSnapshot = {
      request: structuredClone(input.request),
      summary,
      snapshot: structuredClone(input.snapshot),
    };
    const next: CanonicalWorkItemProjection =
      adoptConfigurationEvidenceIntoWorkItem({
        current: workItem,
        snapshotId,
        configurationRevision,
        snapshot: input.snapshot,
        truthSummary,
        recordedAt: input.recordedAt,
      });
    this.records.push(stored);
    this.currentSnapshotId = snapshotId;
    this.saveWorkItem(next);
    return {
      replayed: false,
      workItem: structuredClone(next),
      persisted: this.materialize(stored),
    };
  }

  private materialize(
    stored: PersistedConfigurationEvidenceSnapshot,
  ): PersistedConfigurationEvidenceSnapshot {
    const materialized = structuredClone(stored);
    materialized.summary.isCurrent =
      materialized.summary.snapshotId === this.currentSnapshotId;
    const stale = this.staleBySnapshot.get(materialized.summary.snapshotId);
    if (stale) {
      materialized.snapshot.predicateTraces =
        materialized.snapshot.predicateTraces.map(
          (trace: ConfigurationPredicateTrace): ConfigurationPredicateTrace => {
            const reason = stale.get(trace.predicateTraceId);
            return reason
              ? {
                  ...trace,
                  status: 'STALE',
                  staleReason: structuredClone(reason),
                }
              : trace;
          },
        );
    }
    return materialized;
  }
}

class InMemoryConfigurationEvidenceQueryStore implements ConfigurationEvidenceQueryStorePort {
  private readonly attempts: ConfigurationEvidenceQueryAttemptReadModel[] = [];

  count(): number {
    return this.attempts.length;
  }

  async findByRequest(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel | null> {
    void input.tenantId;
    return this.clone(
      this.attempts.find(
        (attempt) =>
          attempt.workItemId === input.workItemId &&
          attempt.request.requestId === input.requestId,
      ),
    );
  }

  async findByQueryAttemptRef(input: {
    tenantId: string;
    workItemId: string;
    queryAttemptRef: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel | null> {
    void input.tenantId;
    return this.clone(
      this.attempts.find(
        (attempt) =>
          attempt.workItemId === input.workItemId &&
          attempt.queryAttemptRef === input.queryAttemptRef,
      ),
    );
  }

  async findByCandidateEvidenceRef(input: {
    tenantId: string;
    workItemId: string;
    candidateEvidenceRef: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel | null> {
    void input.tenantId;
    return this.clone(
      this.attempts.find(
        (attempt) =>
          attempt.workItemId === input.workItemId &&
          attempt.candidateEvidenceRef === input.candidateEvidenceRef,
      ),
    );
  }

  async reserve(input: ReserveConfigurationEvidenceQueryInput): Promise<{
    replayed: boolean;
    attempt: ConfigurationEvidenceQueryAttemptReadModel;
  }> {
    const existing = await this.findByRequest({
      tenantId: input.tenantId,
      workItemId: input.workItemId,
      requestId: input.request.requestId,
    });
    if (existing) return { replayed: true, attempt: existing };
    const cycle = this.attempts.filter(
      (attempt) =>
        attempt.workItemId === input.workItemId &&
        attempt.inputRevision === input.request.expectedRevision,
    );
    if (cycle.some((attempt) => attempt.terminalStatus === 'RUNNING')) {
      throw conflict('CONFIGURATION_EVIDENCE_QUERY_ALREADY_RUNNING');
    }
    if (
      cycle.some(
        (attempt) => attempt.queryFingerprint === input.queryFingerprint,
      )
    ) {
      throw conflict('CONFIGURATION_EVIDENCE_QUERY_DUPLICATE');
    }
    if (cycle.length >= 2) {
      throw conflict('CONFIGURATION_EVIDENCE_QUERY_ROUND_BUDGET_EXCEEDED');
    }
    const attempt: ConfigurationEvidenceQueryAttemptReadModel = {
      queryAttemptRef: input.queryAttemptRef,
      candidateEvidenceRef: input.candidateEvidenceRef,
      workItemId: input.workItemId,
      inputRevision: input.request.expectedRevision,
      roundNo: cycle.length + 1,
      queryCount: input.request.targets.length,
      queryFingerprint: input.queryFingerprint,
      request: structuredClone(input.request),
      terminalStatus: 'RUNNING',
      sourceRecordCount: 0,
      projections: null,
      candidateSnapshot: null,
      startedAt: input.startedAt,
      deadlineAt: input.deadlineAt,
      completedAt: null,
      adoption: { status: 'CANDIDATE_UNADOPTED' },
    };
    this.attempts.push(attempt);
    return { replayed: false, attempt: structuredClone(attempt) };
  }

  async complete(
    input: CompleteConfigurationEvidenceQueryInput,
  ): Promise<ConfigurationEvidenceQueryAttemptReadModel> {
    const attempt = this.attempts.find(
      (candidate) =>
        candidate.workItemId === input.workItemId &&
        candidate.queryAttemptRef === input.queryAttemptRef,
    );
    if (!attempt) throw new Error('QUERY_ATTEMPT_NOT_FOUND');
    attempt.terminalStatus = input.terminalStatus;
    attempt.sourceRecordCount = input.sourceRecordCount;
    attempt.projections = structuredClone(input.projections);
    attempt.candidateSnapshot = structuredClone(input.candidateSnapshot);
    attempt.completedAt = input.completedAt;
    return structuredClone(attempt);
  }

  async markAdopted(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    candidateEvidenceRef: string;
    snapshotId: string;
    workItemRevision: number;
    adoptedAt: string;
  }): Promise<ConfigurationEvidenceQueryAttemptReadModel> {
    void input.tenantId;
    void input.actorId;
    const attempt = this.attempts.find(
      (candidate) =>
        candidate.workItemId === input.workItemId &&
        candidate.candidateEvidenceRef === input.candidateEvidenceRef,
    );
    if (!attempt) throw new Error('QUERY_ATTEMPT_NOT_FOUND');
    attempt.adoption = {
      status: 'ADOPTED',
      snapshotId: input.snapshotId,
      workItemRevision: input.workItemRevision,
      adoptedAt: input.adoptedAt,
    };
    return structuredClone(attempt);
  }

  private clone(
    attempt: ConfigurationEvidenceQueryAttemptReadModel | undefined,
  ): ConfigurationEvidenceQueryAttemptReadModel | null {
    return attempt ? structuredClone(attempt) : null;
  }
}

function target(input: {
  fleetAsset: Record<string, unknown>;
  denyAccess?: boolean;
  sourceConfigured?: boolean;
  gapOverrides?: Partial<CanonicalAssessmentGapProjection>;
  workItemOverrides?: Partial<CanonicalWorkItemProjection>;
}) {
  let current: CanonicalWorkItemProjection = {
    ...workItem(),
    ...structuredClone(input.workItemOverrides ?? {}),
  };
  const port = new ControlledInstallationEventsPort(
    input.sourceConfigured ?? true,
  );
  const store = new InMemoryConfigurationEvidenceStore(
    () => structuredClone(current),
    (value: CanonicalWorkItemProjection) => {
      current = structuredClone(value);
    },
  );
  const queryStore = new InMemoryConfigurationEvidenceQueryStore();
  const session = {
    actor: {
      tenantId: TENANT_ID,
      canonicalSubject: { namespace: 'MIAODA_USER_ID', id: ACTOR_ID },
    },
  };
  const sessions = { resolve: jest.fn(async () => session) };
  const objectAccess = {
    freshRead: jest.fn(async ({ action, accessRoot }) =>
      input.denyAccess
        ? {
            allowed: false,
            action,
            accessRoot,
            code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
            statusCode: 404,
            denialSource: 'MIAODA_OBJECT_ACCESS',
          }
        : {
            allowed: true,
            action,
            accessRoot,
            workItemId: WORK_ITEM_ID,
            workItemRevision: current.revision,
            requestId: current.requestId,
            documentVersionId: current.source.documentVersionId,
            tenantId: TENANT_ID,
            actorUserId: ACTOR_ID,
          },
    ),
  };
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => structuredClone(current)),
  };
  const fleet = {
    readCurrentForAircraft: jest.fn(async () => ({
      schemaVersion: 'wiselink.fleet-master-data.v1',
      sourceSnapshotId: 'FMS-REAL-587-2579',
      sourceRevisionKey: 'legacy-object-layer-export-2026-06-05',
      authorityRevision: '1',
      sourceAsOf: '2026-06-05',
      assets: [structuredClone(input.fleetAsset)],
      facts: [],
    })),
  };
  const engineerReview = {
    pageContext: jest.fn(async (candidate: CanonicalWorkItemProjection) => ({
      criterionSetId: 'JACS-72D0484B6F1C17A38F671F46',
      baseRuleRevision: 1,
      ledger: null,
      gapLedger: {
        schemaVersion: 'wiselink.3_1.assessment_gap_ledger_projection.v1',
        inputRevision: candidate.revision,
        baseRuleRevision: 1,
        currentness: 'CURRENT',
        candidateOnly: true,
        gaps: [gapFixture(input.gapOverrides)],
        summary: {
          total: 1,
          open: 1,
          partiallyResolved: 0,
          resolved: 0,
          decisionCritical: 1,
          reviewQueryable: 1,
          resolveNow: 0,
          controlledByDisposition: 0,
          assumptionOrConservative: 0,
          monitoringOrDeferred: 0,
          optimization: 0,
          lifecycle: 0,
        },
      },
      items: [],
    })),
  };
  const clock = { nowIso: () => '2026-08-30T01:02:03.000Z' };
  const service = new ConfigurationEvidenceService(
    sessions as never,
    objectAccess as never,
    registrar as never,
    fleet as never,
    engineerReview as never,
    port,
    store,
    queryStore,
    clock,
  );
  return {
    service,
    port,
    store,
    queryStore,
    fleet,
    engineerReview,
    objectAccess,
    workItem: () => structuredClone(current),
    replaceWorkItem: (value: CanonicalWorkItemProjection) => {
      current = structuredClone(value);
    },
  };
}

function servingProjectionSentinels(): Pick<
  CanonicalWorkItemProjection,
  | 'applicabilityInput'
  | 'applicability'
  | 'assessment'
  | 'integratedAssessment'
  | 'aeo'
> {
  return {
    applicabilityInput: {
      schemaVersion: 'existing-applicability-input',
      currentness: 'CURRENT',
      nested: { marker: 'preserve-applicability-input' },
    } as never,
    applicability: {
      schemaVersion: 'existing-applicability',
      status: 'SUCCEEDED',
      currentness: 'CURRENT',
      staleReason: null,
      nested: { marker: 'preserve-applicability' },
    } as never,
    assessment: {
      schemaVersion: 'existing-assessment',
      previousOverallStale: false,
      staleReason: null,
      nested: { marker: 'preserve-assessment' },
    } as never,
    integratedAssessment: {
      schemaVersion: 'existing-integrated-assessment',
      status: 'CURRENT',
      overallSynthesis: {
        status: 'CURRENT',
        staleReason: null,
        marker: 'preserve-overall-synthesis',
      },
      overallForAeoConfirmation: {
        marker: 'preserve-overall-for-aeo',
      },
    } as never,
    aeo: {
      schemaVersion: 'existing-aeo',
      marker: 'preserve-aeo',
    } as never,
  };
}

function gapFixture(
  overrides: Partial<CanonicalAssessmentGapProjection> = {},
): CanonicalAssessmentGapProjection {
  return {
    gapRef: 'GAP-CONFIGURATION',
    missingInputId: 'applicability.requires_actual_installation_evidence',
    displayLabel: '装机状态多源校验所需输入',
    reasonClass: 'CONTROLLED_FACT_MISSING',
    dataDomain: 'applicability',
    requiredFactType: 'applicability.requires_actual_installation_evidence',
    whyNeeded: '需要受控安装事件证据。',
    materiality: 'P0_DECISION_CRITICAL',
    requiredness: 'REQUIRED_FOR_CONFIRMATION',
    queryability: 'REVIEW_QUERYABLE',
    evidenceCapabilities: ['GET_INSTALLATION_EVENTS'],
    resolutionStatus: 'OPEN',
    disposition: null,
    originCriterionIds: ['APP-012'],
    affectedCriterionIds: ['APP-012'],
    sourceRefs: [],
    resolutionOptions: ['在交互式复核中补充受控事实或来源证据'],
    authority: {
      owner: 'CANONICAL_HOST',
      candidateOnly: true,
      modelMayClose: false,
      queryResultIsFact: false,
    },
    ...overrides,
  };
}

function workItem(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: WORK_ITEM_ID,
    requestId: 'REQ-WORK-ITEM',
    revision: 7,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-v7',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor-fixture',
      decisionId: 'decision-fixture',
      decisionHash: 'decision-hash-fixture',
      permissionSnapshotVersion: 'permission-v7',
    },
    source: { documentVersionId: DOCUMENT_VERSION_ID } as never,
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'FTD',
    } as never,
    package: null,
    failure: null,
    recordingFailure: null,
  };
}

function refreshBody(requestId: string, expectedRevision: number) {
  return refreshBodyFor(requestId, expectedRevision, [AIMS2_TARGET]);
}

function refreshBodyFor(
  requestId: string,
  expectedRevision: number,
  targets: RefreshConfigurationEvidenceRequest['targets'],
): RefreshConfigurationEvidenceRequest {
  return {
    schemaVersion: 'wiselink.3_1.refresh_configuration_evidence.v1',
    requestId,
    expectedRevision,
    aircraftIdentifier: 'B-2035',
    assessmentAsOf: AS_OF,
    windowStart: null,
    gapRefs: ['GAP-CONFIGURATION'],
    targets,
  };
}

async function queryAndAdopt(
  fixture: ReturnType<typeof target>,
  workItemId: string,
  body: RefreshConfigurationEvidenceRequest,
  request: Request,
) {
  const queried = await fixture.service.query(workItemId, body, request);
  return fixture.service.adopt(
    workItemId,
    queried.candidate.candidateEvidenceRef,
    { expectedRevision: body.expectedRevision },
    request,
  );
}

function equipmentRecord(
  kind: 'INSTALL' | 'REMOVE',
  componentId: string,
  positionId: string,
  timeIndex: number,
): InstallationEventSourceRecord {
  const event: InstallationEventPayload =
    kind === 'INSTALL'
      ? { kind, installedComponent: componentIdentity(componentId) }
      : { kind, removedComponent: componentIdentity(componentId) };
  const timestamp = `2026-08-28T${String(timeIndex).padStart(
    2,
    '0',
  )}:00:00.000Z`;
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

function controlledResult(
  query: GetInstallationEventsQuery,
  records: InstallationEventSourceRecord[],
  sourceRevision: string,
): GetInstallationEventsCompleteResult {
  const result = completeResult(query, records);
  result.source.sourceRevision = sourceRevision;
  result.source.observedAt = sourceRevision.endsWith('2')
    ? '2026-08-29T13:00:00.000Z'
    : '2026-08-29T12:00:00.000Z';
  return result;
}

function summarizeTruth(
  snapshot: ConfigurationSnapshot,
): ConfigurationEvidenceTruthSummary {
  return {
    trueCount: snapshot.facts.filter((fact) => fact.truth === 'TRUE').length,
    falseCount: snapshot.facts.filter((fact) => fact.truth === 'FALSE').length,
    unknownCount: snapshot.facts.filter((fact) => fact.truth === 'UNKNOWN')
      .length,
    conflictCount: snapshot.facts.filter((fact) => fact.truth === 'CONFLICT')
      .length,
  };
}

function realB2035Asset(): Record<string, unknown> {
  const assets = ndjson('assets.ndjson');
  const aliases = ndjson('aliases.ndjson');
  const configurationFacts = ndjson('configuration-facts.ndjson');
  expect(assets).toHaveLength(587);
  expect(aliases).toHaveLength(2579);
  expect(configurationFacts).toHaveLength(0);
  const asset = assets.find(
    (value: Record<string, unknown>) => value.aircraftNumber === 'B-2035',
  );
  if (!asset) throw new Error('REAL_B2035_ASSET_REQUIRED');
  return asset;
}

function ndjson(filename: string): Record<string, unknown>[] {
  const content = readFileSync(
    resolve(
      process.cwd(),
      'config/fleet-master-data/ameco-fleet-20260605',
      filename,
    ),
    'utf8',
  ).trim();
  if (!content) return [];
  return content.split('\n').map((line: string) => {
    const value: unknown = JSON.parse(line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('REAL_FLEET_NDJSON_RECORD_INVALID');
    }
    return value as Record<string, unknown>;
  });
}

function conflict(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
