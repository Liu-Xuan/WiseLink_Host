import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import {
  JOBAID_PROBLEM_RESULT_SCHEMA,
  JOBAID_PROBLEM_WORK_SCHEMA,
  type JobAidWorkRevision,
} from '@shared/jobaid-problem-assessment.interface';
import {
  canonicalJson,
  parseTaskEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type {
  ActionAttemptRow,
  ReserveActionAttemptInput,
} from '../../server/modules/action-attempt/action-attempt.types';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { projectCommonAssessmentContext } from '../../server/modules/canonical-host/canonical-host-common-context.service';
import { createConfigurationEvidenceReevaluation } from '../../server/modules/canonical-host/configuration-evidence/configuration-evidence-reevaluation.state';
import { JOBAID_METHOD_BINDING } from '../../server/modules/canonical-host/jobaid-method-pack';
import { parseJobAidProblemTask } from '../../server/modules/canonical-host/jobaid-problem-task';

const REQUEST_1 = '00000000-0000-4000-8000-000000000101';
const REQUEST_2 = '00000000-0000-4000-8000-000000000102';
const TENANT = 'tenant-jobaid-continuation';
const OWNER = 'owner-jobaid';
const ENGLISH = `Do not replace unless the indication persists after 5 seconds. ${'A normal inspection does not exclude intermittent failure. '.repeat(50)}Retain this final condition.`;
const scope = {
  tenantId: TENANT,
  workItemId: 'WI-JOBAID-CONTINUE',
  principalId: 'service:openclaw-real',
  appId: 'app_17bzc551rsg',
  authorizationFingerprint: 'permission-service',
};

describe('JobAid continuation requests', () => {
  const originalFlag = process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
  beforeEach(() => {
    process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '1';
  });
  afterEach(() => {
    if (originalFlag === undefined)
      delete process.env.WL_JOBAID_PROBLEM_V2_ENABLED;
    else process.env.WL_JOBAID_PROBLEM_V2_ENABLED = originalFlag;
  });

  it.each(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] as const)(
    'returns the same %s request after WorkItem revision advances without reserving, reading sources or preparing configuration again',
    async (status) => {
      const h = harness();
      const first = await h.enqueue(REQUEST_1);
      h.rows.get(first.attemptRef)!.status = status;
      h.advanceRevision();
      process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '0';
      const reads = h.artifactStore.readActualBytes.mock.calls.length;

      await expect(h.enqueue(REQUEST_1)).resolves.toEqual({
        ...first,
        status,
        created: false,
      });
      expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
      expect(h.artifactStore.readActualBytes).toHaveBeenCalledTimes(reads);
      expect(h.registrar.compareAndSet).not.toHaveBeenCalled();
    },
  );

  it('creates a new request from complete persisted work and exact English source while retaining the failed attempt', async () => {
    const h = harness();
    const first = await h.enqueue(REQUEST_1);
    h.rows.get(first.attemptRef)!.status = 'FAILED';
    const failed = structuredClone(h.rows.get(first.attemptRef));
    const previous = savedWork();
    h.work.listForRuntime.mockResolvedValue([previous]);

    const second = await h.enqueue(REQUEST_2);
    const input = parseJobAidProblemTask(h.task(second.attemptRef));

    expect(second).toMatchObject({
      created: true,
      status: 'QUEUED',
      workItemRevision: 5,
    });
    expect(second.attemptRef).not.toBe(first.attemptRef);
    expect(h.rows.get(first.attemptRef)).toEqual(failed);
    expect(input.previousWork).toEqual(previous);
    expect(input.modelInput.previousWork).toMatchObject({
      workRevisionRef: previous.workRevisionRef,
      content: { understanding: previous.content.understanding },
    });
    expect(input.modelInput.expectedWorkRevision).toBe(previous.workRevision);
    expect(
      input.sourceCatalog.find((item) => item.kind === 'DOCUMENT_PASSAGE')
        ?.excerpt,
    ).toBe(ENGLISH);
    expect(h.work.listForRuntime).toHaveBeenLastCalledWith({
      tenantId: TENANT,
      workItemId: scope.workItemId,
      actorUserId: OWNER,
    });
    expect(h.task(second.attemptRef).idempotencyKey).toBe(
      `openclaw-v2:dynamic:${scope.workItemId}:DV-JOBAID:${REQUEST_2}`,
    );
  });

  it.each(['INITIAL_PROBLEM_ASSESSMENT', 'OVERALL_CONSISTENCY'] as const)(
    'prepares a failed configuration %s stage once and claims the same queued request without rebuilding input',
    async (purpose) => {
      const h = harness();
      const workItem = h.current();
      const marker = createConfigurationEvidenceReevaluation({
        triggerSnapshotId: 'CONFIG-2',
        triggerConfigurationRevision: 2,
        adoptionWorkItemRevision: 5,
      });
      marker.status = 'FAILED';
      marker.stages.applicability.status = 'SUCCEEDED';
      marker.stages.applicability.attempt = {
        attemptId: 'ATT-APP',
        attemptRef: 'AQ-APP',
        inputRevision: 4,
        baseRevision: 4,
      };
      marker.stages.applicability.committedWorkItemRevision = 5;
      marker.stagedBundle.applicabilityInput = {
        applicabilityContextRef: 'APPCTX-STAGED',
      } as never;
      marker.stagedBundle.applicability = {
        status: 'CANDIDATE_ONLY',
        currentness: 'CURRENT',
        decision: 'APPLICABLE',
        aircraftNumber: 'B-TEST',
        assessmentAsOf: '2026-09-09',
        blockingUnknownCount: 0,
        sourceExpressionCount: 1,
        pass: 1,
      } as never;
      workItem.configurationEvidenceReevaluation = marker;
      workItem.configurationEvidenceCurrent = {
        snapshotId: 'CONFIG-2',
        configurationRevision: 2,
      } as never;
      workItem.integratedAssessment = {
        status: 'BASE_RULE_CANDIDATE_READY',
        baseRules: {
          schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
          sourceResultId: 'openclaw-dynamic://prior',
        },
      } as never;
      const serving = structuredClone(workItem.integratedAssessment);
      if (purpose === 'OVERALL_CONSISTENCY') {
        marker.stages.dynamic.status = 'SUCCEEDED';
        marker.stages.dynamic.attempt = {
          attemptId: 'ATT-DYNAMIC',
          attemptRef: 'AQ-DYNAMIC',
          inputRevision: 4,
          baseRevision: 4,
        };
        marker.stages.dynamic.committedWorkItemRevision = 5;
        marker.stages.overall.status = 'FAILED';
        marker.stages.overall.terminal = {
          status: 'FAILED',
          code: 'TEST_FAILURE',
          message: null,
        };
        marker.stages.overall.committedWorkItemRevision = 5;
        marker.stagedBundle.baseRules = structuredClone(
          workItem.integratedAssessment!.baseRules,
        );
        h.work.listForRuntime.mockResolvedValue([savedWork()]);
      } else {
        marker.stages.dynamic.status = 'FAILED';
        marker.stages.dynamic.terminal = {
          status: 'FAILED',
          code: 'TEST_FAILURE',
          message: null,
        };
        marker.stages.dynamic.committedWorkItemRevision = 5;
      }

      const queued = await h.enqueue(REQUEST_1, purpose);
      await h.service.begin(h.current(), scope, purpose, REQUEST_1);
      const replay = await h.enqueue(REQUEST_1, purpose);

      expect(queued.workItemRevision).toBe(6);
      expect(h.current().revision).toBe(6);
      expect(h.registrar.compareAndSet).toHaveBeenCalledTimes(1);
      expect(h.registrar.compareAndSet).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedRevision: 5,
          syncPrimaryAttempt: false,
        }),
      );
      expect(h.current().integratedAssessment).toEqual(serving);
      expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
      expect(h.artifactStore.readActualBytes).toHaveBeenCalledTimes(1);
      expect(h.task(queued.attemptRef).baseRevision).toBe(6);
      expect(
        parseJobAidProblemTask(h.task(queued.attemptRef)).modelInput
          .hostApplicability,
      ).toEqual({
        decision: 'APPLICABLE',
        currentness: 'CURRENT',
        aircraftNumber: 'B-TEST',
        assessmentAsOf: '2026-09-09',
        blockingUnknownCount: 0,
        sourceExpressionCount: 1,
        pass: 1,
      });
      expect(replay).toEqual({ ...queued, status: 'RUNNING', created: false });
    },
  );

  it('refuses to reclaim a terminal explicit request and never replays its model input', async () => {
    const h = harness();
    const queued = await h.enqueue(REQUEST_1);
    h.rows.get(queued.attemptRef)!.status = 'CANCELLED';
    h.advanceRevision();

    await expect(
      h.service.begin(
        h.current(),
        scope,
        'INITIAL_PROBLEM_ASSESSMENT',
        REQUEST_1,
      ),
    ).rejects.toThrow('ACTION_ATTEMPT_ALREADY_CANCELLED');
    expect(h.attempts.reserveAndClaim).not.toHaveBeenCalled();
    expect(h.attempts.reserve).toHaveBeenCalledTimes(1);
  });

  it('retains the old no-request key and rejects disabled new v2 requests before source I/O', async () => {
    const h = harness();
    process.env.WL_JOBAID_PROBLEM_V2_ENABLED = '0';
    await expect(h.enqueue(REQUEST_1)).rejects.toThrow(
      'JOBAID_PROBLEM_V2_NEW_REQUEST_DISABLED',
    );
    expect(h.artifactStore.readActualBytes).not.toHaveBeenCalled();
    const legacy = await h.service.begin(
      h.current(),
      scope,
      'INITIAL_PROBLEM_ASSESSMENT',
    );
    expect(legacy.task.idempotencyKey).toBe(
      `openclaw-v1:dynamic:${scope.workItemId}:5:problem-v2`,
    );
    expect(h.attempts.reserveAndClaim).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale new request before resetting a configuration stage or reserving work', async () => {
    const h = harness();
    const requested = structuredClone(h.current());
    h.advanceRevision();
    await expect(
      h.service.enqueueContinuation(
        requested,
        TENANT,
        'permission-browser',
        REQUEST_1,
        'INITIAL_PROBLEM_ASSESSMENT',
      ),
    ).rejects.toThrow('JOBAID_WORK_ITEM_BINDING_CHANGED');
    expect(h.registrar.compareAndSet).not.toHaveBeenCalled();
    expect(h.attempts.reserve).not.toHaveBeenCalled();
  });
});

function harness() {
  let current = projection();
  const rows = new Map<string, ActionAttemptRow>();
  const task = (attemptRef: string) =>
    parseTaskEnvelope(rows.get(attemptRef)!.taskEnvelopeJson!);
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => current),
    compareAndSet: jest.fn(
      async (input: {
        expectedRevision: number;
        next: Omit<CanonicalWorkItemProjection, 'revision'>;
      }) => {
        if (input.expectedRevision !== current.revision)
          throw new Error('TEST_CAS_CONFLICT');
        current = { ...input.next, revision: input.expectedRevision + 1 };
        return structuredClone(current);
      },
    ),
  };
  const artifactStore = {
    readActualBytes: jest.fn(async () =>
      new TextEncoder().encode(
        JSON.stringify({
          sourceRefs: [
            { sourceRefId: 'SR-1', pageStart: 1, pageEnd: 1, quote: ENGLISH },
          ],
        }),
      ),
    ),
  };
  const workItems = {
    loadTenantScopedProjection: jest.fn(async () => ({
      row: {
        requestedByUserId: OWNER,
        documentVersionId: current.source.documentVersionId,
      },
      projection: current,
    })),
    loadAuthorizationBinding: jest.fn(async () => ({
      documentVersionId: current.source.documentVersionId,
    })),
  };
  const work = {
    listForRuntime: jest.fn(async (): Promise<JobAidWorkRevision[]> => []),
  };
  const attempts = {
    readRequest: jest.fn(
      async (input: { idempotencyKey: string }) =>
        [...rows.values()].find(
          (row) =>
            task(row.operationRef!).idempotencyKey === input.idempotencyKey,
        ) ?? null,
    ),
    reserve: jest.fn(async (input: ReserveActionAttemptInput) => {
      const operationRef = `AQ-CONTINUATION-${rows.size + 1}`;
      const actionAttemptId = `ATT-CONTINUATION-${rows.size + 1}`;
      const envelope = sealTaskEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
        actionAttemptId,
        operationRef,
        taskType: input.taskType,
        priority: 100,
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        inputRevision: input.inputRevision,
        baseRevision: input.baseRevision,
        documentVersionId: input.documentVersionId,
        sourceRefs: input.sourceRefs!,
        allowedConnectors: [],
        hostResolvedMissingInputs: [],
        modelInput: await input.buildModelInput({
          attemptId: actionAttemptId,
          operationRef,
          triggerRequestId: 'TRIGGER-CONTINUATION',
          attemptNo: rows.size + 1,
          createdAt: new Date('2026-09-09T00:00:00.000Z'),
        }),
        deadline: '2026-09-09T01:00:00.000Z',
        idempotencyKey: input.idempotencyKey,
      });
      const row = {
        operationRef,
        status: 'QUEUED',
        taskEnvelopeJson: canonicalJson(envelope),
      } as ActionAttemptRow;
      rows.set(operationRef, row);
      return { row, task: envelope, created: true };
    }),
    reserveAndClaim: jest.fn(async (input: ReserveActionAttemptInput) => {
      const existing = await attempts.readRequest(input);
      const reserved = existing
        ? { row: existing, task: task(existing.operationRef!) }
        : await attempts.reserve(input);
      reserved.row.status = 'RUNNING';
      return {
        attemptRef: reserved.task.operationRef,
        status: 'RUNNING',
        leaseToken: REQUEST_2,
        leaseGeneration: 1,
        leaseExpiresAt: '2026-09-09T00:30:00.000Z',
        task: reserved.task,
      };
    }),
  };
  const service = new CanonicalJobAidProblemService(
    registrar as never,
    artifactStore as never,
    {} as never,
    {} as never,
    {} as never,
    attempts as never,
    workItems as never,
    { hasActiveOfficialActorMapping: jest.fn(async () => true) } as never,
    {
      buildForWorkItemWithEvidence: jest.fn(async () => ({
        common: projectCommonAssessmentContext(
          current,
          {
            context: { status: 'UNAVAILABLE', reason: 'SYNTHETIC_TEST' },
            documentReadingStatus: 'AVAILABLE',
            items: [],
            sections: [],
            resourceRefs: [],
          },
          [],
        ),
        availableReadingEvidence: [],
      })),
    } as never,
    work as never,
  );
  return {
    service,
    rows,
    task,
    registrar,
    artifactStore,
    attempts,
    work,
    current: () => current,
    advanceRevision: () => {
      current = { ...current, revision: current.revision + 1 };
    },
    enqueue: (
      requestId: string,
      purpose:
        | 'INITIAL_PROBLEM_ASSESSMENT'
        | 'OVERALL_CONSISTENCY' = 'INITIAL_PROBLEM_ASSESSMENT',
    ) =>
      service.enqueueContinuation(
        current,
        TENANT,
        'permission-browser',
        requestId,
        purpose,
      ),
  };
}

function projection(): CanonicalWorkItemProjection {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: scope.workItemId,
    requestId: 'REQUEST-WORK-ITEM',
    revision: 5,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'permission-browser',
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: 'actor',
      decisionId: 'decision',
      decisionHash: 'hash',
      permissionSnapshotVersion: 'permission-browser',
    },
    source: { documentId: 'DOC-JOBAID', documentVersionId: 'DV-JOBAID' },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' },
    package: {
      packageId: 'PKG-JOBAID',
      title: 'Synthetic English source',
      artifact: {
        ref: 'artifact://english-package',
        sha256: 'a'.repeat(64),
        byteLength: 100,
        storeRole: 'U0_PARSED_PACKAGE',
        mediaType: 'application/json',
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  } as unknown as CanonicalWorkItemProjection;
}

function savedWork(): JobAidWorkRevision {
  return {
    workRevisionRef: 'JAWR-PERSISTED-3',
    workItemId: scope.workItemId,
    workRevision: 3,
    previousWorkRevisionRef: 'JAWR-PERSISTED-2',
    requestId: 'SAVE-3',
    actionAttemptId: 'ATT-PRIOR',
    basedOnWorkItemRevision: 5,
    documentVersionId: 'DV-JOBAID',
    createdAt: '2026-09-08T00:00:00.000Z',
    content: {
      schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
      headline: '单次正常检查不能排除间歇故障',
      listBrief: '继续核查持续状态。',
      understanding: `已保存的完整认识及条件：${ENGLISH}`,
      decisiveIssueKeys: [],
      issues: [],
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      completionReason: '本轮已完成，保持现有未知。',
      changeSummary: '保留此前工作。',
      unchangedExplanation: '未修改内容完整继承。',
      methodBinding: structuredClone(JOBAID_METHOD_BINDING),
      evidence: [],
      readSourceRefs: [],
      capabilities: [],
      historyReview: {
        required: false,
        priorAssessmentRefs: [],
        engineeringDocumentRefs: [],
        coverage: 'NOT_REQUIRED',
        limitation: null,
      },
    },
  };
}
