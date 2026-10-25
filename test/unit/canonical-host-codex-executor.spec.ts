import 'reflect-metadata';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const decorator = () => () => undefined;
  return { ...actual, Body: decorator, Controller: decorator, Post: decorator, Req: decorator, Res: decorator };
});

import {
  canonicalHostExecutor, canonicalExecutorMcpIdentity, canonicalExecutorRuntime,
} from '../../server/modules/canonical-host/canonical-host-executor-policy';
import { CanonicalHostOpenClawMcpOpenApiController } from '../../server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller';
import { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } from '../../server/modules/canonical-host/configured-development-service-scope.authorization';
import { AutomaticWorkItemDispatchService } from '../../server/modules/canonical-host/automatic-work-item-dispatch.service';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import { toHostedDiscovery } from '../../server/modules/canonical-host/openclaw-overall-synthesis.processor';
import { ActionAttemptRepository } from '../../server/modules/action-attempt/action-attempt.repository';

const config = {
  WL_MODEL_EXECUTOR: 'CODEX', WL_CODEX_RUNTIME_APP_ID: 'app_testcodex',
  WL_CODEX_SERVICE_SCOPE_ENABLED: '1', WL_CODEX_GATEWAY_AUTH_MODE: 'API_KEY',
  WL_CODEX_SERVICE_SCOPE_ENV: 'UAT', WL_CODEX_SERVICE_PRINCIPAL_ID: 'service:codex-test',
  WL_CODEX_SERVICE_TENANT_ID: 'tenant-test', WL_CODEX_SERVICE_WORK_ITEM_ID: 'WI-new',
  WL_CODEX_SERVICE_REQUEST_ID: 'REQ-intake-new', WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED: '1',
};
const keys = [...Object.keys(config), ...Object.keys(config).filter(key => key.startsWith('WL_CODEX_'))
  .map(key => key.replace('WL_CODEX_', 'WL_OPENCLAW_'))];
const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));

beforeEach(() => { for (const key of keys) delete process.env[key]; });
afterEach(() => {
  for (const key of keys) {
    if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
  }
});

function controller() {
  const mcp = { handle: jest.fn() };
  const queue = { nextWorkItem: jest.fn().mockResolvedValue({ status: 'IDLE' }),
    acknowledgeWorkItem: jest.fn(), blockWorkItem: jest.fn(), applyPendingModelConfiguration: jest.fn() };
  const scope = { assertTransport: jest.fn(), assertAutoWorkItemQueueTransport: jest.fn() };
  return { mcp, queue, scope,
    controller: new CanonicalHostOpenClawMcpOpenApiController(mcp as never, queue as never, scope as never) };
}

describe('single active Host executor', () => {
  it('keeps HOSTED by default and rejects unsupported configuration', () => {
    expect(canonicalHostExecutor()).toBe('HOSTED');
    expect(canonicalExecutorMcpIdentity('HOSTED')).toEqual({ name: 'wiselink-openclaw-engineering-assessment', version: '1.2.0' });
    expect(canonicalExecutorMcpIdentity('CODEX')).toEqual({ name: 'wiselink-codex-engineering-assessment', version: '1.2.0' });
    process.env.WL_MODEL_EXECUTOR = 'BOTH';
    expect(() => canonicalHostExecutor()).toThrow('CANONICAL_EXECUTOR_CONFIG_INVALID');
  });

  it('does not infer CODEX runtime app identity from legacy configuration', async () => {
    Object.assign(process.env, config);
    delete process.env.WL_CODEX_RUNTIME_APP_ID;
    expect(() => canonicalExecutorRuntime()).toThrow('CANONICAL_CODEX_RUNTIME_CONFIG_REQUIRED');
    await expect(new ConfiguredDevelopmentCanonicalServiceScopeAuthorization()
      .assertTransport({ transport: 'CODEX_MCP' })).rejects.toThrow('CANONICAL_CODEX_RUNTIME_CONFIG_REQUIRED');
  });

  it('requires a separate, exact CODEX grant and never inherits legacy grants', async () => {
    for (const [key, value] of Object.entries(config)) process.env[key.replace('WL_CODEX_', 'WL_OPENCLAW_')] = value;
    process.env.WL_MODEL_EXECUTOR = 'CODEX';
    process.env.WL_CODEX_RUNTIME_APP_ID = 'app_testcodex';
    const scope = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    await expect(scope.assertTransport({ transport: 'CODEX_MCP' })).rejects.toThrow('CANONICAL_CODEX_EXACT_SCOPE_REQUIRED');
    Object.assign(process.env, config);
    process.env.WL_OPENCLAW_SERVICE_PRINCIPAL_ID = 'service:legacy';
    await expect(scope.assertTransport({ transport: 'CODEX_MCP' })).resolves.toBeUndefined();
    delete process.env.WL_CODEX_SERVICE_TENANT_ID;
    await expect(scope.assertTransport({ transport: 'CODEX_MCP' })).rejects.toMatchObject({ code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE' });
  });

  it('rechecks the exact intake and the live lease for CODEX business access', async () => {
    Object.assign(process.env, config);
    const lease = { principalId: config.WL_CODEX_SERVICE_PRINCIPAL_ID, tenantId: 'tenant-test', workItemId: 'WI-new',
      requestId: 'REQ-intake-new', actorUserId: 'actor', documentId: 'DOC', documentVersionId: 'DV',
      sourceArtifactId: 'source', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 10,
      leaseGeneration: 1, leaseExpiresAt: new Date('2099-01-01').toISOString() };
    const authority = { authorizeActiveLease: jest.fn().mockResolvedValue(lease) };
    const scope = new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(authority as never);
    await expect(scope.authorizeOpenClawWorkItem({ operation: 'BEGIN_DYNAMIC', workItemId: 'WI-new' }))
      .resolves.toMatchObject({ principalId: 'service:codex-test', automaticWorkItemLease: { requestId: 'REQ-intake-new' } });
    await expect(scope.authorizeOpenClawWorkItem({ operation: 'BEGIN_DYNAMIC', workItemId: 'WI-old' }))
      .rejects.toThrow('CANONICAL_CODEX_REQUEST_SCOPE_MISMATCH');
    authority.authorizeActiveLease.mockResolvedValue({ ...lease, requestId: 'REQ-old' });
    await expect(scope.authorizeOpenClawWorkItem({ operation: 'BEGIN_DYNAMIC', workItemId: 'WI-new' }))
      .rejects.toThrow('CANONICAL_CODEX_REQUEST_SCOPE_MISMATCH');
  });

  it('denies legacy MCP and every legacy queue mutation after CODEX is active', async () => {
    Object.assign(process.env, config);
    const h = controller();
    const forgedRequest = { headers: { 'x-model-executor': 'CODEX', 'x-app-id': 'app_testcodex' } };
    for (const operation of [
      () => h.controller.handleOpenClawMcp(forgedRequest as never, {} as never, { method: 'tools/call' }),
      () => h.controller.nextWorkItem(),
      () => h.controller.acknowledgeWorkItem({} as never),
      () => h.controller.blockWorkItem({} as never),
      () => h.controller.applyPendingModelConfiguration({}),
    ]) await expect(operation()).rejects.toThrow('CANONICAL_EXECUTOR_ENDPOINT_INACTIVE');
    expect(h.mcp.handle).not.toHaveBeenCalled();
    for (const method of Object.values(h.queue)) expect(method).not.toHaveBeenCalled();
    expect(h.scope.assertTransport).not.toHaveBeenCalled();
  });

  it('rejects an old request paused in transport authorization during the executor switch', async () => {
    const h = controller();
    h.scope.assertTransport.mockImplementation(async () => { Object.assign(process.env, config); });
    await expect(h.controller.handleOpenClawMcp({} as never, {} as never, { method: 'tools/call' }))
      .rejects.toThrow('CANONICAL_EXECUTOR_ENDPOINT_INACTIVE');
    expect(h.mcp.handle).not.toHaveBeenCalled();
  });

  it('does not manufacture a historical discovery app identity from current configuration', () => {
    Object.assign(process.env, config);
    const stored = { searchRunRef: 'search:boeing:recorded', sourceSystem: 'CODEX', query: 'query',
      resultStatus: 'ACCESS_DENIED' as const, observedAt: '2026-01-01T00:00:00Z', candidates: [],
      accessRestricted: true, truncated: false, partialOnly: false, failureCode: 'UNAVAILABLE' };
    const original = toHostedDiscovery(stored);
    process.env.WL_CODEX_RUNTIME_APP_ID = 'app_reconfigured';
    expect(toHostedDiscovery(stored)).toEqual(original);
    expect(original).toMatchObject({ runtime: 'CODEX', resultStatus: 'ACCESS_DENIED' });
    expect(original).not.toHaveProperty('runtimeAppId');
    expect(toHostedDiscovery({ ...stored, sourceSystem: 'FEISHU_HOSTED_OPENCLAW' })).not.toHaveProperty('runtimeAppId');
  });

  it('routes CODEX using the fixed server argument, regardless of caller headers', async () => {
    Object.assign(process.env, config);
    const h = controller();
    const request = { headers: { 'x-model-executor': 'HOSTED', 'x-app-id': 'forged' } } as never;
    const response = {} as never;
    const body = { method: 'initialize' };
    await h.controller.handleCodexMcp(request, response, body);
    expect(h.scope.assertTransport).toHaveBeenCalledWith({ transport: 'CODEX_MCP' });
    expect(h.mcp.handle).toHaveBeenCalledWith(request, response, body, 'CODEX');
    await h.controller.nextCodexWorkItem();
    expect(h.queue.nextWorkItem).toHaveBeenCalledTimes(1);
    delete process.env.WL_MODEL_EXECUTOR;
    await expect(h.controller.handleCodexMcp(request, response, body)).rejects.toThrow('CANONICAL_EXECUTOR_ENDPOINT_INACTIVE');
  });

  it('limits queue discovery to the configured WI and never scans Review or document queues', async () => {
    Object.assign(process.env, config);
    const items = { listAutoProcessingCandidates: jest.fn().mockResolvedValue([]),
      listCompletedAutoProcessingReviewSubjects: jest.fn() };
    const scope = { authorizeOpenClawAutoWorkItemQueue: async () => ({ principalId: 'service:codex-test',
      appId: 'app_17bzc551rsg', tenantId: 'tenant-test', authorizationFingerprint: `sha256:${'a'.repeat(64)}` }) };
    const dispatch = new AutomaticWorkItemDispatchService(items as never, {} as never, scope as never);
    await expect(dispatch.nextWorkItem()).resolves.toEqual({ status: 'IDLE' });
    expect(items.listAutoProcessingCandidates).toHaveBeenCalledWith(expect.objectContaining({ workItemId: 'WI-new' }));
    expect(items.listCompletedAutoProcessingReviewSubjects).not.toHaveBeenCalled();
    await expect(dispatch.nextWorkItem({ resumeWorkItemId: 'WI-old' })).rejects.toThrow('CANONICAL_CODEX_REQUEST_SCOPE_MISMATCH');
    expect(items.listAutoProcessingCandidates).toHaveBeenCalledTimes(1);
  });
});

describe('CODEX document delivery authority', () => {
  function documentScope() {
    Object.assign(process.env, config);
    const lease = { principalId: config.WL_CODEX_SERVICE_PRINCIPAL_ID, tenantId: 'tenant-test', workItemId: 'WI-new',
      requestId: 'REQ-intake-new', actorUserId: 'actor', documentId: 'DOC', documentVersionId: 'DV-new',
      sourceArtifactId: 'source', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 10,
      leaseGeneration: 1, leaseExpiresAt: new Date('2099-01-01').toISOString() };
    const intent = { workItemId: lease.workItemId, requestId: lease.requestId, actorUserId: lease.actorUserId,
      documentVersionId: lease.documentVersionId, sourceArtifactId: lease.sourceArtifactId,
      sourceFileSha256: lease.sourceFileSha256, sourceByteLength: lease.sourceByteLength,
      delivery: { reading: true, translation: 'ZH_FULL' }, executionModel: { modelRef: 'miaoda/glm-5.3' } };
    const authority = { authorizeActiveLease: jest.fn().mockResolvedValue(lease) };
    const workItems = { readDocumentDeliveryIntents: jest.fn().mockResolvedValue([intent]) };
    const catalog = { readDocumentUploadDeliveryIntents: jest.fn().mockResolvedValue([]) };
    return { authority, workItems, catalog, lease, intent,
      scope: new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(authority as never, workItems as never, catalog as never) };
  }

  it.each(['SOURCE', 'READING', 'TRANSLATION'] as const)('permits the exact leased WI document for %s', async purpose => {
    const h = documentScope();
    const result = await h.scope.authorizeDocumentWork({ documentVersionId: 'DV-new', deliveryRef: 'work-item:WI-new', purpose });
    expect(result).toMatchObject({ principalId: 'service:codex-test', tenantId: 'tenant-test', actorUserId: 'actor', documentVersionId: 'DV-new' });
    expect(h.authority.authorizeActiveLease).toHaveBeenCalledWith({ tenantId: 'tenant-test', principalId: 'service:codex-test', workItemId: 'WI-new' });
    if (purpose !== 'SOURCE') expect(result).toMatchObject({ modelWorkItemId: 'WI-new',
      sourceBinding: { sourceArtifactId: 'source', sourceSha256: 'a'.repeat(64), sourceByteLength: 10 } });
  });

  it.each([undefined, 'work-item:WI-other', 'acquisition:other'])('denies unbound delivery %s before reading any intents', async deliveryRef => {
    const h = documentScope();
    await expect(h.scope.authorizeDocumentWork({ documentVersionId: 'DV-new', deliveryRef, purpose: 'SOURCE' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(h.authority.authorizeActiveLease).not.toHaveBeenCalled();
    expect(h.workItems.readDocumentDeliveryIntents).not.toHaveBeenCalled();
    expect(h.catalog.readDocumentUploadDeliveryIntents).not.toHaveBeenCalled();
  });

  it('denies a different document or expired lease before reading intents', async () => {
    const h = documentScope();
    await expect(h.scope.authorizeDocumentWork({ documentVersionId: 'DV-other', deliveryRef: 'work-item:WI-new', purpose: 'SOURCE' }))
      .rejects.toMatchObject({ statusCode: 404 });
    h.authority.authorizeActiveLease.mockResolvedValue({ ...h.lease, leaseExpiresAt: new Date('2020-01-01').toISOString() });
    await expect(h.scope.authorizeDocumentWork({ documentVersionId: 'DV-new', deliveryRef: 'work-item:WI-new', purpose: 'SOURCE' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(h.workItems.readDocumentDeliveryIntents).not.toHaveBeenCalled();
  });

  it.each(['requestId', 'actorUserId', 'documentVersionId', 'sourceArtifactId', 'sourceFileSha256', 'sourceByteLength'] as const)(
    'denies a delivery intent with mismatched %s', async field => {
      const h = documentScope();
      h.workItems.readDocumentDeliveryIntents.mockResolvedValue([{ ...h.intent, [field]: field === 'sourceByteLength' ? 99 : 'other' }]);
      await expect(h.scope.authorizeDocumentWork({ documentVersionId: 'DV-new', deliveryRef: 'work-item:WI-new', purpose: 'SOURCE' }))
        .rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('CODEX queue ownership under the existing transaction lock', () => {
  it.each([
    { status: 'LEASED', leaseOwner: 'service:openclaw-main', leaseGeneration: 1 },
    { status: 'WAITING', leaseOwner: null, leaseGeneration: 2 },
  ])('rejects historical ownership before terminalizing or claiming: %j', async grant => {
    const terminalize = jest.spyOn(ActionAttemptRepository.prototype, 'terminalizeExpiredActiveForSuccessor');
    const lock = jest.fn().mockResolvedValueOnce([{ revision: 1 }])
      .mockResolvedValueOnce([{ ...grant, leaseExpiresAt: new Date('2020-01-01') }]);
    const query = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), for: lock };
    const database = { select: jest.fn(() => query), update: jest.fn() };
    const repo = new MiaodaWorkItemRepository({ transaction: async (run: (db: unknown) => unknown) => run(database) } as never);
    try {
      await expect(repo.claimAutoProcessingCandidate({ tenantId: 'tenant', workItemId: 'WI-new', requestId: 'REQ-new',
        actorUserId: 'actor', documentId: 'DOC', documentVersionId: 'DV', sourceArtifactId: 'source', sourceFileSha256: 'a'.repeat(64),
        sourceByteLength: 10, expectedWorkItemRevision: 1, leaseOwner: 'service:codex-test', leaseToken: 'token',
        now: new Date(), leaseExpiresAt: new Date('2099-01-01'), preserveExecutorOwnership: true }))
        .rejects.toMatchObject({ code: 'CANONICAL_CODEX_LEGACY_WORK_NOT_ADOPTABLE' });
      expect(terminalize).not.toHaveBeenCalled();
      expect(database.update).not.toHaveBeenCalled();
    } finally { terminalize.mockRestore(); }
  });
});

it('preserves a same-CODEX COMMITTING result and original fences for projection recovery', async () => {
  const { canonicalJson, sealTaskEnvelope, sealResultEnvelope } = await import('../../server/modules/action-attempt/action-attempt-envelope');
  const now = new Date();
  const task = sealTaskEnvelope({ schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-codex', operationRef: 'AQ-codex', taskType: 'OPENCLAW_DYNAMIC_EVALUATION', priority: 100,
    tenantId: 'tenant', workItemId: 'WI-new', inputRevision: 1, baseRevision: 1, documentVersionId: 'DV',
    sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [],
    modelInput: { automaticWorkItemLease: { requestId: 'REQ-new', leaseGeneration: 3 } },
    deadline: new Date(now.getTime() + 60_000).toISOString(), idempotencyKey: 'exact-request' });
  const result = sealResultEnvelope({ schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: task.actionAttemptId, operationRef: task.operationRef, taskType: task.taskType,
    workItemId: task.workItemId, baseRevision: 1, status: 'SUCCEEDED', businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null, modelOutput: '{"workRevisionRef":"work-saved"}', outputArtifactRefs: [], sourceRefs: [],
    factsConsidered: [], missingInputs: [], conflicts: [], warnings: [], modelVersion: 'glm-5.3',
    promptVersion: 'program-1', skillVersion: 'wiselink-research-and-synthesize@r09.c10',
    toolVersions: { 'wiselink-openclaw-engineering-assessment': '1.2.0', 'model-executor': 'CODEX' },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 }, errorCode: null, errorDetail: null });
  const policy = await import('../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy');
  Object.assign(process.env, config);
  const boundRow = { attemptId: task.actionAttemptId, operationRef: task.operationRef, actionType: task.taskType,
    tenantId: task.tenantId, workItemId: task.workItemId, inputRevision: task.inputRevision, baseRevision: task.baseRevision,
    documentVersionId: task.documentVersionId, idempotencyKey: task.idempotencyKey,
    taskInputHash: task.inputHash, taskEnvelopeJson: canonicalJson(task) };
  expect(policy.preflightCanonicalHostOpenClawResult({ row: boundRow as never, result }).result).toEqual(result);
  const { contentHash: _contentHash, ...resultBody } = result;
  const legacyResult = sealResultEnvelope({ ...resultBody, toolVersions: { 'wiselink-openclaw-engineering-assessment': '1.2.0' } });
  expect(() => policy.preflightCanonicalHostOpenClawResult({ row: boundRow as never, result: legacyResult }))
    .toThrow('CANONICAL_RESULT_EXECUTOR_MISMATCH');
  expect(policy.parseCanonicalHostOpenClawStoredResult({ task, row: { ...boundRow,
    resultEnvelopeJson: canonicalJson(legacyResult), resultContentHash: legacyResult.contentHash } as never })).toEqual(legacyResult);
  const grant = { status: 'LEASED', leaseOwner: 'service:codex-test', leaseToken: 'original-queue-token',
    leaseGeneration: 3, leaseExpiresAt: new Date('2020-01-01'), requestId: 'REQ-new', actorUserId: 'actor',
    documentId: 'DOC', documentVersionId: 'DV', sourceArtifactId: 'source', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 10 };
  const active = { status: 'COMMITTING', tenantId: 'tenant', workItemId: 'WI-new', documentVersionId: 'DV',
    actionType: task.taskType, attemptId: task.actionAttemptId, operationRef: task.operationRef, taskInputHash: task.inputHash,
    leaseOwner: grant.leaseOwner, leaseToken: 'original-attempt-token', leaseExpiresAt: grant.leaseExpiresAt,
    taskEnvelopeJson: canonicalJson(task), resultEnvelopeJson: canonicalJson(result), resultContentHash: result.contentHash,
    commitStartedAt: new Date('2020-01-01'), cancelRequestedAt: null };
  const locks = jest.fn().mockResolvedValueOnce([{ revision: 1, projectionJson: null }])
    .mockResolvedValueOnce([grant]).mockResolvedValueOnce([active]);
  const query = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), for: locks };
  const update = { set: jest.fn().mockReturnThis(), where: jest.fn().mockResolvedValue([]) };
  const database = { select: jest.fn(() => query), update: jest.fn(() => update) };
  const repository = new MiaodaWorkItemRepository({ transaction: async (run: (db: unknown) => unknown) => run(database) } as never);
  const authority = jest.fn().mockResolvedValue(undefined);
  const terminalize = jest.spyOn(ActionAttemptRepository.prototype, 'terminalizeExpiredActiveForSuccessor')
    .mockImplementation(async () => undefined as never);
  try {
    await expect(repository.claimAutoProcessingCandidate({ tenantId: 'tenant', workItemId: 'WI-new', requestId: 'REQ-new',
      actorUserId: 'actor', documentId: 'DOC', documentVersionId: 'DV', sourceArtifactId: 'source', sourceFileSha256: 'a'.repeat(64),
      sourceByteLength: 10, expectedWorkItemRevision: 1, leaseOwner: 'service:codex-test', leaseToken: 'unused-new-token',
      now, leaseExpiresAt: new Date('2099-01-01'), preserveExecutorOwnership: true, assertCommittingRecoveryAuthorized: authority }))
      .resolves.toMatchObject({ leaseGeneration: 3, leaseToken: 'original-queue-token' });
    expect(authority).toHaveBeenCalledWith(active, database);
    expect(update.set.mock.calls).toHaveLength(2);
    for (const [changes] of update.set.mock.calls) expect(Object.keys(changes).sort()).toEqual(['leaseExpiresAt', 'updatedAt']);
  } finally { terminalize.mockRestore(); }
});


describe('CODEX fresh queue grant with prior static-scope history', () => {
  function fixture(history: { status: string; claimCount: number; leaseGeneration: number; terminalReason?: string } | null) {
    const prior = history && (history.claimCount > 0 || history.leaseGeneration > 0 || history.status !== 'QUEUED')
      ? [{ attemptId: 'ATT-prior-static' }] : [];
    const locks = jest.fn().mockResolvedValueOnce([{ revision: 1 }])
      .mockResolvedValueOnce([{ status: 'WAITING', leaseOwner: null, leaseGeneration: 0 }])
      .mockResolvedValueOnce(prior).mockResolvedValueOnce([]);
    const query = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(), for: locks };
    const updates = { set: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([{ leaseGeneration: 1, leaseToken: 'new-codex-token' }]) };
    const database = { select: jest.fn(() => query), update: jest.fn(() => updates) };
    const repository = new MiaodaWorkItemRepository({ transaction: async (run: (db: unknown) => unknown) => run(database) } as never);
    const terminalize = jest.spyOn(ActionAttemptRepository.prototype, 'terminalizeExpiredActiveForSuccessor')
      .mockImplementation(async () => undefined as never);
    const claim = () => repository.claimAutoProcessingCandidate({ tenantId: 'tenant', workItemId: 'WI-new', requestId: 'REQ-new',
      actorUserId: 'actor', documentId: 'DOC', documentVersionId: 'DV', sourceArtifactId: 'source', sourceFileSha256: 'a'.repeat(64),
      sourceByteLength: 10, expectedWorkItemRevision: 1, leaseOwner: 'service:codex-test', leaseToken: 'new-codex-token',
      now: new Date(), leaseExpiresAt: new Date('2099-01-01'), preserveExecutorOwnership: true });
    const assertHistoryPredicate = () => {
      const rendered = new PgDialect().sqlToQuery(query.where.mock.calls[2][0] as SQL);
      expect(rendered.params).toEqual(['tenant', 'WI-new', 'OPENCLAW_TRANSLATE', 'OPENCLAW_APPLICABILITY_EVALUATION',
        'OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS', 0, 0, 'QUEUED']);
      expect(rendered.sql).toMatch(/"claim_count" > /u);
      expect(rendered.sql).toMatch(/"lease_generation" > /u);
      expect(rendered.sql).toMatch(/"status" <> /u);
      expect(rendered.params).not.toContain('PARSE_PDF');
      expect(locks.mock.calls[2]).toEqual(['update']);
    };
    return { claim, assertHistoryPredicate, terminalize, database, locks, updates };
  }

  it.each([
    { status: 'RUNNING', claimCount: 1, leaseGeneration: 1, terminalReason: undefined },
    { status: 'FAILED', claimCount: 1, leaseGeneration: 1, terminalReason: 'MODEL_OUTCOME_UNKNOWN' },
  ])('rejects former static execution %j without terminalizing or updating anything', async history => {
    const h = fixture(history);
    try {
      await expect(h.claim()).rejects.toMatchObject({ code: 'CANONICAL_CODEX_LEGACY_WORK_NOT_ADOPTABLE', statusCode: 409 });
      h.assertHistoryPredicate();
      expect(h.terminalize).not.toHaveBeenCalled();
      expect(h.database.update).not.toHaveBeenCalled();
      expect(h.locks).toHaveBeenCalledTimes(3);
    } finally { h.terminalize.mockRestore(); }
  });

  it('claims a new request that has only an unexecuted QUEUED intent', async () => {
    const h = fixture({ status: 'QUEUED', claimCount: 0, leaseGeneration: 0 });
    try {
      await expect(h.claim()).resolves.toEqual({ leaseGeneration: 1, leaseToken: 'new-codex-token' });
      h.assertHistoryPredicate();
      expect(h.terminalize).toHaveBeenCalledTimes(4);
      expect(h.database.update).toHaveBeenCalledTimes(1);
      expect(h.updates.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'LEASED', leaseOwner: 'service:codex-test' }));
      expect(h.locks).toHaveBeenCalledTimes(4);
    } finally { h.terminalize.mockRestore(); }
  });
});
