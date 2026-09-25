import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../../server/modules/work-item/production-miaoda-browser-ingress';
import type { Request } from 'express';
import { MatterActionAttemptService } from '../../server/modules/canonical-host/matter-action-attempt.service';
import { MatterAssessmentActivityController } from '../../server/modules/canonical-host/matter-assessment-activity.controller';
import { EngineeringMatterWorkingRepository } from '../../server/modules/canonical-host/engineering-matter-working.repository';
import { EngineeringMatterWorkingService } from '../../server/modules/canonical-host/engineering-matter-working.service';
import { CanonicalModelSettingsService } from '../../server/modules/model-settings/canonical-model-settings.service';
import type { CanonicalServiceScopeAuthorizationPort } from '../../server/modules/canonical-host/canonical-service-scope.authorization';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import {
  canonicalJson,
  canonicalSha256,
  sealMatterTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type { MatterActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { activityCursor } from '../../server/modules/canonical-host/matter-assessment-activity';

const mockRead = jest.fn();
jest.mock(
  '../../server/modules/action-attempt/action-attempt.repository',
  () => ({
    ActionAttemptRepository: jest.fn().mockImplementation(() => ({
      readMatterByOperationRef: (...args: unknown[]) => mockRead(...args),
    })),
  }),
);
jest.mock(
  '../../server/modules/canonical-host/canonical-host-request-actor',
  () => ({ hostActor: () => actor }),
);
const actor: CanonicalHostActor = {
  userId: 'a',
  tenantId: 't',
  appId: 'app_17bzc551rsg',
  roles: [],
  env: 'runtime',
  objectAccessActor: {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'a' },
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId: 't',
      version: 'miaoda-hosted-native-sso.v1',
      decidedAt: '2026-09-22T00:00:00Z',
    },
    tenantId: 't',
    applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'runtime',
    platformRoles: [],
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    feishuUserId: null,
    feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  },
};
const scope = { tenantId: 't', actorUserId: 'a', matterId: 'm' };
function row(): MatterActionAttemptRow {
  const task = sealMatterTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v2',
    taskType: 'OPENCLAW_MATTER_ASSESSMENT',
    actionAttemptId: 'att',
    operationRef: 'aq',
    tenantId: 't',
    priority: 100,
    subject: {
      kind: 'ENGINEERING_MATTER',
      matterId: 'm',
      matterRevisionId: 'mr',
    },
    trigger: { kind: 'SOURCE_CHANGE', inputIds: ['i'] },
    workingBasis: { inputs: [], priorWorkRef: null },
    inputRevision: 2,
    baseRevision: 0,
    sourceRefs: [],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: { sourceCatalog: [] },
    deadline: '2026-09-22T12:00:00.000Z',
    idempotencyKey: 'test',
  });
  return {
    attemptId: 'att',
    operationRef: 'aq',
    triggerRequestId: 'req',
    workItemId: null,
    subjectKind: 'ENGINEERING_MATTER',
    matterId: 'm',
    matterRevisionId: 'mr',
    actionType: task.taskType,
    attemptNo: 1,
    status: 'RUNNING',
    requestOrigin: 'OPENCLAW_MCP_V1',
    tenantId: 't',
    actorUserId: 'a',
    priority: 100,
    inputRevision: 2,
    baseRevision: 0,
    documentVersionId: null,
    taskEnvelopeJson: canonicalJson(task),
    taskInputHash: task.inputHash,
    resultEnvelopeJson: null,
    resultContentHash: null,
    idempotencyKey: 'test',
    claimCount: 1,
    retryCount: 0,
    maxAttempts: 2,
    leaseOwner: 'PRIVATE',
    leaseToken: 'PRIVATE',
    leaseGeneration: 1,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    nextAttemptAt: null,
    deadlineAt: null,
    cancelRequestedAt: null,
    cancelReason: null,
    terminalReason: null,
    projectionApplied: false,
    executorSessionKey: 'PRIVATE',
    commitStartedAt: null,
    leaseSlot: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    reviewActivityJson: JSON.stringify([
      {
        kind: 'MATTER_JOBAID_WORK_SAVED',
        requestId: 'r',
        workRevisionRef: 'w',
        proposal: 'PRIVATE',
      },
    ]),
  };
}
function fixture() {
  const selections: Array<Array<{ ref: string }>> = [[{ ref: 'aq' }]];
  const select = jest.fn(() => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: async () => selections.shift() ?? [] }),
        limit: async () => selections.shift() ?? [],
      }),
    }),
  }));
  const authorizeRuntimeInputs = jest.fn().mockResolvedValue({});
  const executor = { database: { select }, authorizeRuntimeInputs };
  const basis = jest.fn().mockResolvedValue(undefined);
  const readByRef = jest.fn().mockResolvedValue({
    basedOnMatterRevisionId: 'mr',
    source: { kind: 'ENGINEERING_MATTER', actionAttemptId: 'att' },
  });
  const working = {
    withTransaction: async <T>(fn: (value: typeof executor) => Promise<T>) =>
      fn(executor),
    authorizeAttemptWorkingBasis: basis,
    readByRef,
  };
  const service = new MatterActionAttemptService(
    working as unknown as EngineeringMatterWorkingRepository,
    null as unknown as CanonicalModelSettingsService,
  );
  mockRead.mockReset().mockResolvedValue(row());
  return {
    service,
    selections,
    select,
    basis,
    readByRef,
    authorizeRuntimeInputs,
  };
}

describe('Matter activity authorized service', () => {
  it('rejects an automatic attempt without a usable operation reference', async () => {
    const selections: Array<unknown[]> = [
      [{ currentMatterRevisionId: 'mr' }], [{ ref: null }],
    ];
    const database = { select: jest.fn(() => ({ from: () => ({ where: () => ({
      limit: async () => selections.shift() ?? [],
    }) }) })) };
    const executor = {
      database,
      authorizeRuntimeInputs: jest.fn().mockResolvedValue({ currentInputs: [] }),
      loadCurrent: jest.fn().mockResolvedValue(null),
    };
    const working = { withTransaction: async <T>(fn: (value: typeof executor) => Promise<T>) => fn(executor) };
    const service = new MatterActionAttemptService(
      working as unknown as EngineeringMatterWorkingRepository,
      null as unknown as CanonicalModelSettingsService,
    );
    await expect(service.readExecutionSummaryForBrowser(scope, actor))
      .rejects.toThrow('ACTION_ATTEMPT_IDENTITY_INVALID');
  });
  it.each([
    { baseRevision: 0, currentRevision: 0, status: 'RUNNING', sourceAttemptId: null },
    { baseRevision: 7, currentRevision: 16, status: 'SUCCEEDED', sourceAttemptId: 'manual-sb' },
    { baseRevision: 0, currentRevision: 12, status: 'FAILED', sourceAttemptId: 'manual-777' },
    { baseRevision: 0, currentRevision: 1, status: 'FAILED', sourceAttemptId: 'att' },
  ])('retains the exact-input automatic attempt after later work (%s)', async ({ baseRevision, currentRevision, status, sourceAttemptId }) => {
    const selections: Array<unknown[]> = [
      [{ currentMatterRevisionId: 'mr' }], [{ ref: 'aq' }], [{ currentMatterRevisionId: 'mr' }],
    ];
    const select = jest.fn(() => ({ from: () => ({ where: () => ({
      limit: async () => selections.shift() ?? [],
    }) }) }));
    const executor = {
      database: { select },
      authorizeRuntimeInputs: jest.fn().mockResolvedValue({ currentInputs: [] }),
      loadCurrent: jest.fn().mockResolvedValue(currentRevision ? {
        matterWorkRevisionId: 'current-work', workingRevision: currentRevision,
        source: { kind: 'ENGINEERING_MATTER', actionAttemptId: sourceAttemptId },
        state: { coverage: [] },
      } : null),
    };
    const working = {
      withTransaction: async <T>(fn: (value: typeof executor) => Promise<T>) => fn(executor),
      authorizeAttemptWorkingBasis: jest.fn(),
    };
    const service = new MatterActionAttemptService(
      working as unknown as EngineeringMatterWorkingRepository,
      null as unknown as CanonicalModelSettingsService,
    );
    const stored = row();
    const { inputHash: _oldHash, ...taskFields } = JSON.parse(stored.taskEnvelopeJson!);
    const task = sealMatterTaskEnvelope({ ...taskFields, baseRevision,
      workingBasis: { ...taskFields.workingBasis,
        priorWorkRef: baseRevision ? 'prior-work' : null } });
    mockRead.mockReset().mockResolvedValue({ ...stored, baseRevision, status,
      taskEnvelopeJson: canonicalJson(task), taskInputHash: task.inputHash });
    const summary = await service.readExecutionSummaryForBrowser(scope, actor);
    expect(summary).toMatchObject({
      matterId: 'm', matterRevisionId: 'mr', workingRevision: currentRevision,
      state: status, attemptRef: 'aq', baseWorkingRevision: baseRevision,
      inputs: { workItems: 0, documents: 0, pending: 0 },
    });
    expect(summary.tools.candidateSaved).toBe(true);
    expect(summary.currentWorkSavedByAttempt).toBe(sourceAttemptId === 'att');
    expect(JSON.stringify(summary)).not.toContain('PRIVATE');
  });
  it('shows IDLE without falling back when the exact input key has no attempt', async () => {
    const selections: Array<unknown[]> = [
      [{ currentMatterRevisionId: 'mr' }], [], [{ currentMatterRevisionId: 'mr' }],
    ];
    const currentInputs = [{
      inputId: 'source', workItemId: 'source', workItemRevision: 3,
      documentVersionId: 'document', resultRef: null, resultRevision: null,
      original: { parseRunId: 'new-parse', parseRevision: 2 },
    }];
    const where = jest.fn((_condition: SQL) => ({ limit: async () => selections.shift() ?? [] }));
    const select = jest.fn(() => ({ from: () => ({ where }) }));
    const executor = {
      database: { select },
      authorizeRuntimeInputs: jest.fn().mockResolvedValue({ currentInputs }),
      loadCurrent: jest.fn().mockResolvedValue({
        matterWorkRevisionId: 'later-work', workingRevision: 16,
        source: { kind: 'ENGINEERING_MATTER', actionAttemptId: 'old-att' },
        state: { coverage: [] },
      }),
    };
    const working = {
      withTransaction: async <T>(fn: (value: typeof executor) => Promise<T>) => fn(executor),
    };
    const service = new MatterActionAttemptService(
      working as unknown as EngineeringMatterWorkingRepository,
      null as unknown as CanonicalModelSettingsService,
    );
    mockRead.mockReset();
    const summary = await service.readExecutionSummaryForBrowser(scope, actor);
    expect(summary).toMatchObject({
      state: 'IDLE', attemptRef: null, baseWorkingRevision: null,
      workingRevision: 16,
    });
    expect(mockRead).not.toHaveBeenCalled();
    const params = new PgDialect().sqlToQuery(where.mock.calls[1][0]).params;
    const currentKey = `matter-auto:m:${canonicalSha256({
      matterRevisionId: 'mr', inputs: currentInputs,
    })}`;
    const oldKey = `matter-auto:m:${canonicalSha256({
      matterRevisionId: 'mr', inputs: [{ ...currentInputs[0],
        original: { parseRunId: 'old-parse', parseRevision: 1 } }],
    })}`;
    expect(params).toContain(currentKey);
    expect(params).not.toContain(oldKey);
  });
  it('discovers active independently from saved work and never returns row internals', async () => {
    const f = fixture();
    const page = await f.service.readActivityForBrowser(scope, {}, actor);
    expect(page.attempt).toMatchObject({
      attemptRef: 'aq',
      active: true,
      baseWorkingRevision: 0,
    });
    expect(f.readByRef).not.toHaveBeenCalled();
    expect(f.select).toHaveBeenCalledTimes(1);
    expect(f.basis).toHaveBeenCalledWith(
      expect.objectContaining({ basedOnMatterRevisionId: 'mr' }),
      expect.anything(),
    );
    expect(JSON.stringify(page)).not.toContain('PRIVATE');
  });
  it('falls back to latest only when no active attempt exists; exact misses never fallback', async () => {
    const f = fixture();
    f.selections.splice(0, 1, [], [{ ref: 'aq' }]);
    mockRead.mockResolvedValue({ ...row(), status: 'SUCCEEDED' });
    expect(
      (await f.service.readActivityForBrowser(scope, {}, actor)).attempt
        ?.active,
    ).toBe(false);
    expect(f.select).toHaveBeenCalledTimes(2);
    mockRead.mockResolvedValue(null);
    await expect(
      f.service.readActivityForBrowser(scope, { attemptRef: 'missing' }, actor),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(f.select).toHaveBeenCalledTimes(2);
  });
  it.each(['tenantId', 'actorUserId', 'matterId'] as const)(
    'rejects a row from a different %s',
    async (key) => {
      const f = fixture();
      mockRead.mockResolvedValue({ ...row(), [key]: 'other' });
      await expect(
        f.service.readActivityForBrowser(scope, { attemptRef: 'aq' }, actor),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(f.basis).not.toHaveBeenCalled();
    },
  );
  it('rejects missing native identity, changed task binding and revoked source basis', async () => {
    const f = fixture();
    expect(() =>
      f.service.readActivityForBrowser(
        scope,
        {},
        { ...actor, objectAccessActor: undefined },
      ),
    ).toThrow();
    mockRead.mockResolvedValue({ ...row(), taskInputHash: 'changed' });
    await expect(
      f.service.readActivityForBrowser(scope, { attemptRef: 'aq' }, actor),
    ).rejects.toThrow('TASK_ENVELOPE_ROW_BINDING_MISMATCH');
    mockRead.mockResolvedValue(row());
    f.basis.mockRejectedValue(new Error('SOURCE_REVOKED'));
    await expect(
      f.service.readActivityForBrowser(scope, { attemptRef: 'aq' }, actor),
    ).rejects.toThrow('SOURCE_REVOKED');
  });
  it('retains recursive source authorization for referenced Matter work', async () => {
    const f = fixture();
    const value = row();
    const { inputHash: _oldHash, ...fields } = JSON.parse(
      value.taskEnvelopeJson!,
    );
    const task = sealMatterTaskEnvelope({
      ...fields,
      modelInput: {
        sourceCatalog: [
          {
            kind: 'PRIOR_RESULT',
            sourceWork: {
              subjectId: 'reference',
              workRef: 'prior',
              issueKey: 'issue',
            },
          },
        ],
      },
    });
    mockRead.mockResolvedValue({
      ...value,
      taskEnvelopeJson: canonicalJson(task),
      taskInputHash: task.inputHash,
    });
    const authorizeReferenceMatter = jest
      .fn()
      .mockRejectedValue(new Error('REFERENCE_REVOKED'));
    await expect(
      f.service.readActivityForBrowser(
        { ...scope, authorizeReferenceMatter },
        { attemptRef: 'aq' },
        actor,
      ),
    ).rejects.toThrow('REFERENCE_REVOKED');
    expect(authorizeReferenceMatter).toHaveBeenCalledWith('reference');
    await expect(
      f.service.readActivityForBrowser(scope, { attemptRef: 'aq' }, actor),
    ).rejects.toThrow('MATTER_REFERENCE_SERVICE_SCOPE_UNAVAILABLE');
  });
  it('pins historical work to its associated attempt and rejects a substituted cursor', async () => {
    const f = fixture();
    const page = await f.service.readActivityForBrowser(
      scope,
      { workRef: 'w' },
      actor,
    );
    expect(page.selection).toBe('EXACT_WORK');
    expect(f.authorizeRuntimeInputs).toHaveBeenCalledWith(
      expect.objectContaining({ basedOnMatterRevisionId: 'mr' }),
    );
    f.selections.push([{ ref: 'aq' }]);
    const cursor = activityCursor(
      scope,
      { workRef: 'w' },
      { attemptRef: 'other', offset: 0 },
    );
    await expect(
      f.service.readActivityForBrowser(scope, { workRef: 'w', cursor }, actor),
    ).rejects.toThrow('MATTER_ACTIVITY_CURSOR_INVALID');
    f.readByRef.mockResolvedValue(null);
    await expect(
      f.service.readActivityForBrowser(scope, { workRef: 'missing' }, actor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('Matter activity GET handler', () => {
  function setup() {
    const working = { readWorking: jest.fn(), readWorkingRevision: jest.fn() };
    const attempts = {
      readActivityForBrowser: jest.fn().mockResolvedValue({ items: [] }),
    };
    const authorize = jest
      .fn()
      .mockImplementation(async ({ matterId }: { matterId: string }) => ({
        appId: actor.appId,
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        principalId: 'p',
        matterId,
      }));
    const controller = new MatterAssessmentActivityController(
      working as unknown as EngineeringMatterWorkingService,
      attempts as unknown as MatterActionAttemptService,
      {
        authorizeOpenClawMatterRequest: authorize,
      } as unknown as CanonicalServiceScopeAuthorizationPort,
    );
    return { working, attempts, authorize, controller };
  }
  it('declares a GET behind the existing production browser ingress guard', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, MatterAssessmentActivityController),
    ).toBe('api/canonical-host/engineering-matters');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        MatterAssessmentActivityController.prototype.read,
      ),
    ).toBe(':matterId/assessment-activity');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        MatterAssessmentActivityController.prototype.read,
      ),
    ).toBe(RequestMethod.GET);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MatterAssessmentActivityController),
    ).toContain(ProductionMiaodaBrowserObjectIngressGuard);
  });
  const request = { userContext: {} } as unknown as Request;
  it('uses fresh exact-work authorization and passes a fail-closed reference callback', async () => {
    const f = setup();
    await f.controller.read('m', { workRef: 'w', limit: '10' }, request);
    expect(f.working.readWorkingRevision).toHaveBeenCalledWith('m', 'w', actor);
    expect(f.working.readWorking).not.toHaveBeenCalled();
    const passed = f.attempts.readActivityForBrowser.mock.calls[0][0];
    f.authorize.mockResolvedValue({
      appId: actor.appId,
      tenantId: 'other',
      actorUserId: actor.userId,
      principalId: 'p',
      matterId: 'ref',
    });
    await expect(passed.authorizeReferenceMatter('ref')).rejects.toThrow();
  });
  it('rejects caller authority, malformed pagination and service identity mismatches before activity read', async () => {
    const f = setup();
    for (const query of [
      { actor: 'fake' },
      { limit: '101' },
      { attemptRef: ['a', 'b'] },
      { workRef: 'w', attemptRef: 'a' },
    ])
      await expect(f.controller.read('m', query, request)).rejects.toThrow();
    f.authorize.mockResolvedValue({
      appId: actor.appId,
      tenantId: 'other',
      actorUserId: actor.userId,
      principalId: 'p',
      matterId: 'm',
    });
    await expect(f.controller.read('m', {}, request)).rejects.toThrow();
    expect(f.attempts.readActivityForBrowser).not.toHaveBeenCalled();
  });
});
