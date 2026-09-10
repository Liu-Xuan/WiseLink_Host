import type {
  AilyInitialAnalysisStatus,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  canonicalJson,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import { CanonicalInitialAnalysisContinuationService } from '../../server/modules/canonical-host/canonical-initial-analysis-continuation.service';

const actor = {
  userId: 'owner',
  tenantId: 'tenant-continuation',
  appId: 'app_17bzc551rsg',
  roles: [],
  env: 'test',
};
const request = {
  requestId: '00000000-0000-4000-8000-000000000111',
  expectedRevision: 5,
  operation: 'TRANSLATE' as const,
};
const configuration = {
  WL_TRANSLATION_V2_ENABLED: '1',
  WL_JOBAID_PROBLEM_V2_ENABLED: '1',
  WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '1',
  WL_OPENCLAW_GATEWAY_AUTH_MODE: 'API_KEY',
  WL_OPENCLAW_SERVICE_SCOPE_ENV: 'UAT',
  WL_OPENCLAW_SERVICE_PRINCIPAL_ID: 'service:continuation',
  WL_OPENCLAW_SERVICE_TENANT_ID: actor.tenantId,
  WL_OPENCLAW_SERVICE_WORK_ITEM_ID: 'WI-continuation',
};

describe('owner-requested initial continuation', () => {
  let prior: Record<string, string | undefined>;
  beforeEach(() => {
    prior = Object.fromEntries(
      Object.keys(configuration).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, configuration);
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('freshly authorizes the owner and saves only a queued request with the exact document and block scope', async () => {
    const h = harness();
    const result = await h.send({
      ...request,
      retranslateBlockIds: ['block-1'],
    });
    expect(result).toEqual({
      requestId: request.requestId,
      operation: 'TRANSLATE',
      status: 'QUEUED',
      replayed: false,
      candidateOnly: true,
    });
    expect(h.order).toEqual(['authorization', 'permissions', 'workItem']);
    expect(h.registrar.getTenantScopedByWorkItemId).toHaveBeenCalledWith({
      tenantId: actor.tenantId,
      workItemId: 'WI-continuation',
    });
    expect(h.translation.enqueueContinuation).toHaveBeenCalledWith(
      h.workItem,
      actor.tenantId,
      request.requestId,
      ['block-1'],
    );
    expect(h.jobAid.enqueueContinuation).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(
      /attemptRef|tenant|principal|lease/u,
    );
  });

  it.each(['denied', 'changed permissions', 'different service scope'])(
    'refuses %s before reading a prior request or queuing work',
    async (failure) => {
      const h = harness();
      if (failure === 'denied')
        h.authorization.authorize.mockResolvedValue({
          action: 'EVALUATE_JOB_AID',
          allowed: false,
          permissionSnapshotVersion: 'permission-1',
        });
      if (failure === 'changed permissions')
        h.permissions.freshRead.mockResolvedValue({
          permissionSnapshotVersion: 'permission-2',
        });
      if (failure === 'different service scope')
        process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID = 'WI-other';
      await expect(h.send(request)).rejects.toThrow();
      expect(h.attempts.readRequest).not.toHaveBeenCalled();
      expect(h.translation.enqueueContinuation).not.toHaveBeenCalled();
    },
  );

  it.each(['SUCCEEDED', 'CANCELLED', 'FAILED', 'WAITING_INPUT'])(
    'reads the same terminal %s receipt after the work item advances, without claiming or reserving again',
    async (status) => {
      const h = harness();
      h.workItem.revision = 9;
      h.attempts.readRequest.mockResolvedValue(savedAttempt(status));
      process.env.WL_TRANSLATION_V2_ENABLED = '0';
      await expect(h.send(request)).resolves.toMatchObject({
        status,
        replayed: true,
      });
      expect(h.initial.project).not.toHaveBeenCalled();
      expect(h.translation.enqueueContinuation).not.toHaveBeenCalled();
    },
  );

  it('rejects a changed block scope on a replay and rejects a stale new request', async () => {
    const h = harness();
    h.attempts.readRequest.mockResolvedValue(
      savedAttempt('CANCELLED', ['block-1']),
    );
    await expect(
      h.send({ ...request, retranslateBlockIds: ['block-2'] }),
    ).rejects.toThrow('REQUEST_SCOPE_CHANGED');
    h.attempts.readRequest.mockResolvedValue(null);
    h.workItem.revision += 1;
    await expect(h.send(request)).rejects.toThrow('WORK_ITEM_CHANGED');
    expect(h.translation.enqueueContinuation).not.toHaveBeenCalled();
  });

  it('inherits only the failed attempt’s explicit complete-block scope for a new continuation', async () => {
    const h = harness();
    h.status.stages.translation.attemptRef = 'AQ-failed';
    h.attempts.readScoped.mockResolvedValue(
      savedAttempt('FAILED', ['block-2']),
    );
    await h.send(request);
    expect(h.attempts.readScoped).toHaveBeenCalledWith({
      tenantId: actor.tenantId,
      workItemId: 'WI-continuation',
      attemptRef: 'AQ-failed',
    });
    expect(h.translation.enqueueContinuation).toHaveBeenCalledWith(
      h.workItem,
      actor.tenantId,
      request.requestId,
      ['block-2'],
    );
  });

  it('keeps a completed semantic translation and only accepts an explicitly chosen block replacement', async () => {
    const h = harness();
    h.status.stages.translation.status = 'SUCCEEDED';
    h.workItem.translation = {
      schemaVersion: 'wiselink.3_1.translation_candidate_projection.v2',
      completeness: 'COMPLETE',
    } as never;
    await expect(h.send(request)).rejects.toThrow(
      'TRANSLATION_ALREADY_COMPLETE',
    );
    await expect(
      h.send({ ...request, retranslateBlockIds: ['block-1'] }),
    ).resolves.toMatchObject({ status: 'QUEUED' });
  });

  it.each(['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'])(
    'does not enqueue when any initial stage is %s',
    async (status) => {
      const h = harness();
      h.status.stages.jobAid.attemptStatus = status;
      await expect(h.send(request)).rejects.toThrow(
        'EXISTING_WORK_NOT_TERMINAL',
      );
      expect(h.translation.enqueueContinuation).not.toHaveBeenCalled();
    },
  );

  it('requires ready applicability and confirmed SB, while unstarted translation does not block source analysis', async () => {
    const h = harness();
    const jobAid = { ...request, operation: 'EVALUATE_JOBAID' };
    h.status.stages.translation.status = 'PENDING';
    h.status.stages.applicability.status = 'FAILED';
    await expect(h.send(jobAid)).rejects.toThrow('PREREQUISITE_NOT_READY');
    h.status.stages.applicability.status = 'WAITING_INPUT';
    h.workItem.classification.status = 'CANDIDATE';
    await expect(h.send(jobAid)).rejects.toThrow('CONFIRMED_SB_REQUIRED');
    expect(h.jobAid.enqueueContinuation).not.toHaveBeenCalled();
    h.workItem.classification.status = 'CONFIRMED';
    await h.send(jobAid);
    expect(h.jobAid.enqueueContinuation).toHaveBeenCalledWith(
      h.workItem,
      actor.tenantId,
      'permission-1',
      request.requestId,
      'INITIAL_PROBLEM_ASSESSMENT',
    );
  });

  it('rejects invalid or injected commands before authorization', async () => {
    const h = harness();
    for (const body of [
      { ...request, actorUserId: 'other' },
      { ...request, requestId: 'not-a-uuid' },
      {
        ...request,
        operation: 'EVALUATE_JOBAID',
        retranslateBlockIds: ['block-1'],
      },
    ]) {
      await expect(h.send(body)).rejects.toThrow();
    }
    expect(h.authorization.authorize).not.toHaveBeenCalled();
  });
});

function savedAttempt(status: string, blockIds?: string[]) {
  return {
    status,
    taskEnvelopeJson: canonicalJson(
      sealTaskEnvelope({
        schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
        actionAttemptId: 'ATT-test',
        operationRef: 'AQ-test',
        taskType: 'OPENCLAW_TRANSLATE',
        priority: 0,
        tenantId: actor.tenantId,
        workItemId: 'WI-continuation',
        inputRevision: 5,
        baseRevision: 5,
        documentVersionId: 'DV-continuation',
        sourceRefs: [],
        allowedConnectors: [],
        hostResolvedMissingInputs: [],
        modelInput: blockIds ? { retranslateBlockIds: blockIds } : {},
        deadline: '2026-09-10T00:00:00.000Z',
        idempotencyKey: `openclaw-v2:translate:WI-continuation:DV-continuation:${request.requestId}`,
      }),
    ),
  };
}

function harness() {
  const order: string[] = [];
  const workItem = {
    workItemId: 'WI-continuation',
    revision: 5,
    source: { documentVersionId: 'DV-continuation' },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' },
  } as CanonicalWorkItemProjection;
  const stage = (status: string) => ({
    status,
    attemptRef: null,
    attemptStatus: null,
    terminalCode: null,
  });
  const status = {
    status: 'FAILED',
    stages: {
      translation: stage('FAILED'),
      applicability: stage('WAITING_INPUT'),
      jobAid: stage('FAILED'),
      overall: stage('PENDING'),
    },
  } as AilyInitialAnalysisStatus;
  const authorization = {
    authorize: jest.fn(async () => {
      order.push('authorization');
      return {
        action: 'EVALUATE_JOB_AID',
        allowed: true,
        permissionSnapshotVersion: 'permission-1',
      };
    }),
  };
  const permissions = {
    freshRead: jest.fn(async () => {
      order.push('permissions');
      return { permissionSnapshotVersion: 'permission-1' };
    }),
  };
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn(async () => {
      order.push('workItem');
      return workItem;
    }),
  };
  const attempts = {
    readRequest: jest
      .fn<Promise<ReturnType<typeof savedAttempt> | null>, [unknown]>()
      .mockResolvedValue(null),
    readScoped: jest.fn<Promise<ReturnType<typeof savedAttempt>>, [unknown]>(),
  };
  const initial = { project: jest.fn(async () => status) };
  const translation = {
    enqueueContinuation: jest.fn(async () => ({
      status: 'QUEUED',
      created: true,
    })),
  };
  const jobAid = {
    enqueueContinuation: jest.fn(async () => ({
      status: 'QUEUED',
      created: true,
    })),
  };
  const service = new CanonicalInitialAnalysisContinuationService(
    authorization as never,
    permissions as never,
    registrar as never,
    attempts as never,
    initial as never,
    translation as never,
    jobAid as never,
  );
  return {
    workItem,
    status,
    authorization,
    permissions,
    registrar,
    attempts,
    initial,
    translation,
    jobAid,
    order,
    send: (body: unknown) => service.request(workItem.workItemId, body, actor),
  };
}
