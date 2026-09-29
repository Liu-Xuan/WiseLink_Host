import { DocumentTranslationRuntimeService } from '../../server/modules/canonical-host/document-translation-runtime.service';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { sealDocumentTranslationTaskEnvelope } from '../../server/modules/action-attempt/document-translation-task-envelope';
import { documentDeliveryRequestId } from '../../server/modules/canonical-host/document-delivery-ref';

function setup() {
  const original = originalFixture();
  const documentVersionId = original.binding.documentVersionId;
  const parseRunId = original.binding.parseRunId;
  const authorization = { authorizeDocumentWork: jest.fn().mockResolvedValue({ tenantId: 'tenant', actorUserId: 'actor', documentVersionId }) };
  const actors = { withActorScope: jest.fn(async (_actor, fn) => fn()) };
  const reader = { readDocumentOriginal: jest.fn().mockResolvedValue({ original, run: { manifestArtifact: {
    relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'a'.repeat(64), byteLength: 100,
  } } }) };
  const plugins = { prepareOriginal: jest.fn().mockResolvedValue({ workspaceId: 'workspace' }),
    taskInput: jest.fn().mockReturnValue({ schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: 'workspace',
      planRevision: 1, contextRevision: 1, methodVersion: 'semantic-translation@2.0', documentProducer: 'OFFICIAL_PLUGIN',
      source: { documentVersionId, packageId: parseRunId, originalBinding: original.binding,
        parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: `document-original://${documentVersionId}/${parseRunId}`,
          sha256: 'a'.repeat(64), byteLength: 100, mediaType: 'application/json' } } }),
    executeStep: jest.fn().mockResolvedValue({ status: 'PROGRESSED' }) };
  let row: Record<string, unknown> | null = null;
  const attempts = { readRequest: jest.fn(async (_scope, requestId) =>
    row?.triggerRequestId === requestId ? row : null), latest: jest.fn(async () => row),
    reserve: jest.fn(async (_scope, task, requestId, executionModel) => { row = { status: 'QUEUED', documentVersionId, producerRunId: parseRunId,
      attemptId: task.actionAttemptId, operationRef: task.operationRef, taskEnvelopeJson: JSON.stringify(task),
      triggerRequestId: requestId, executionModelJson: JSON.stringify(executionModel),
      deadlineAt: new Date(task.deadline), errorCode: null }; return row; }),
    recoverPartialInput: jest.fn(async (_scope, task, requestId) => { row = {
      status: 'QUEUED', documentVersionId, producerRunId: parseRunId,
      attemptId: task.actionAttemptId, operationRef: task.operationRef,
      taskEnvelopeJson: JSON.stringify(task), triggerRequestId: `${requestId}:partial-repair-v2`,
      deadlineAt: new Date(task.deadline), errorCode: null,
    }; return row; }),
    recoverKnownFailure: jest.fn(async (_scope, _predecessorRef, requestId, current, executionModel) => {
      const task = sealDocumentTranslationTaskEnvelope({
        schemaVersion: 'wiselink.document.translation_task.v1', actionAttemptId: 'DTA-successor',
        operationRef: 'DTQ-successor', tenantId: 'tenant', documentVersionId, parseRunId,
        parseRevision: current.parseRevision, workspaceId: current.modelInput.workspaceId,
        modelInput: current.modelInput, deadline: new Date(Date.now() + 60_000).toISOString(),
        idempotencyKey: 'known-failure', knownFailureRecovery: {
          kind: 'KNOWN_FAILURE', predecessorAttemptId: 'DTA-prior', predecessorAttemptRef: _predecessorRef },
      });
      row = { status: 'QUEUED', documentVersionId, producerRunId: parseRunId,
        attemptId: task.actionAttemptId, attemptNo: 2, operationRef: task.operationRef,
        taskEnvelopeJson: JSON.stringify(task), triggerRequestId: `${requestId}:known-failure`,
        executionModelJson: JSON.stringify(executionModel), deadlineAt: new Date(task.deadline), errorCode: null };
      return row;
    }),
    claim: jest.fn(async (_scope, attemptRef, principalId) => ({ attemptRef, principalId, leaseToken: 'token', leaseGeneration: 1 })),
    renew: jest.fn().mockResolvedValue(true), release: jest.fn().mockResolvedValue(true),
    cancel: jest.fn(), finish: jest.fn(), fail: jest.fn(), expire: jest.fn(),
  };
  const parsing = { status: jest.fn().mockResolvedValue({ documentVersionId }) };
  const semantics = { readReady: jest.fn().mockResolvedValue(null), read: jest.fn().mockResolvedValue({ profileRef: 'generic.author-sections.v1' }) };
  const v2 = { executeDocument: jest.fn(), assembleDocument: jest.fn(),
    documentHasInterruptedGeneration: jest.fn().mockResolvedValue(false),
    readDocumentProgress: jest.fn().mockResolvedValue({ completeness: 'PARTIAL', repairableBlockCount: 1,
      repairableBlockIds: ['repairable-block'] }) };
  const service = new DocumentTranslationRuntimeService(authorization as never, actors as never, reader as never,
    plugins as never, attempts as never, semantics as never, parsing as never, v2 as never);
  const legacy = () => {
    if (!row) throw new Error('expected row');
    const task = JSON.parse(String(row.taskEnvelopeJson));
    const { inputHash: _hash, ...unsealed } = task;
    row.taskEnvelopeJson = JSON.stringify(sealDocumentTranslationTaskEnvelope({ ...unsealed,
      modelInput: { ...unsealed.modelInput, documentProducer: 'OFFICIAL_PLUGIN' } }));
  };
  return { service, reader, plugins, attempts, authorization, parsing, semantics, v2, legacy,
    binding: { documentVersionId, parseRunId } };
}

describe('independent document translation runtime', () => {
  it('requires the fixed delivery and predecessor for explicit known-failure recovery', async () => {
    const f = setup();
    const deliveryRef = 'acquisition:sample';
    const requestId = documentDeliveryRequestId('translation', deliveryRef);
    const first = await f.service.run({ action: 'START', ...f.binding, deliveryRef, requestId });
    if (!('attemptRef' in first)) throw new Error('expected first attempt');
    await expect(f.service.run({ action: 'RECOVER_KNOWN_FAILURE', ...f.binding,
      attemptRef: first.attemptRef! })).rejects.toThrow('RECOVERY_SCOPE_INVALID');
    const recovered = await f.service.run({ action: 'RECOVER_KNOWN_FAILURE', ...f.binding,
      deliveryRef, attemptRef: first.attemptRef! });
    expect(recovered).toMatchObject({ status: 'QUEUED', attemptRef: 'DTQ-successor' });
    expect(f.attempts.recoverKnownFailure).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'actor' }), first.attemptRef, requestId,
      expect.objectContaining({ modelInput: expect.objectContaining({ documentProducer: 'HOSTED_M3' }) }),
      expect.objectContaining({ modelRef: 'm3probe/minimax-m3' }));
    expect(await f.service.run({ action: 'STATUS', ...f.binding, deliveryRef })).toMatchObject(recovered);
    expect(f.authorization.authorizeDocumentWork).toHaveBeenLastCalledWith({
      documentVersionId: f.binding.documentVersionId, deliveryRef, purpose: 'TRANSLATION' });
  });
  it('returns saved-output reconciliation instead of dispatching another model attempt', async () => {
    const f = setup();
    const deliveryRef = 'acquisition:sample';
    const requestId = documentDeliveryRequestId('translation', deliveryRef);
    const first = await f.service.run({ action: 'START', ...f.binding, deliveryRef, requestId });
    if (!('attemptRef' in first)) throw new Error('expected first attempt');
    f.attempts.recoverKnownFailure.mockRejectedValueOnce(new Error('DOCUMENT_TRANSLATION_RECOVERY_SAVED_OUTPUT'));
    const result = await f.service.run({ action: 'RECOVER_KNOWN_FAILURE', ...f.binding,
      deliveryRef, attemptRef: first.attemptRef! });
    expect(result).toMatchObject({ attemptRef: first.attemptRef,
      recoveryStatus: 'REQUIRES_RECONCILIATION', progress: { completeness: 'PARTIAL' } });
    expect(f.attempts.reserve).toHaveBeenCalledTimes(1);
  });
  it('requires separate cancellation authority for a selected delivery', async () => {
    const f = setup();
    f.authorization.authorizeDocumentWork.mockRejectedValue(new Error('DYNAMIC_CANCEL_DENIED'));
    await expect(f.service.run({ action: 'CANCEL', ...f.binding,
      deliveryRef: 'work-item:WI-one', attemptRef: 'DTQ-one' }))
      .rejects.toThrow('DYNAMIC_CANCEL_DENIED');
    expect(f.authorization.authorizeDocumentWork).toHaveBeenCalledWith({
      documentVersionId: f.binding.documentVersionId,
      deliveryRef: 'work-item:WI-one', purpose: 'CANCEL' });
    expect(f.attempts.cancel).not.toHaveBeenCalled();
  });
  it('reserves from the actual original without a WorkItem and reuses the same request', async () => {
    const f = setup();
    const start = { action: 'START' as const, ...f.binding, requestId: 'request' };
    const first = await f.service.run(start);
    expect(await f.service.run(start)).toEqual(first);
    expect(f.plugins.prepareOriginal).toHaveBeenCalledTimes(1);
    expect(f.plugins.prepareOriginal.mock.calls[0][0]).not.toHaveProperty('workItemId');
    expect(f.attempts.reserve.mock.calls[0][1]).not.toHaveProperty('workItemId');
    expect(f.plugins.executeStep).not.toHaveBeenCalled();
    expect(f.attempts.reserve.mock.calls[0][3].modelRef).toBe('m3probe/minimax-m3');
  });
  it('claims only a stored Hosted M3 route and stops an interrupted generation before dispatch', async () => {
    const f = setup();
    const started = await f.service.run({ action: 'START', ...f.binding, requestId: 'request' });
    if (!('attemptRef' in started)) throw new Error('expected attempt');
    const claimed = await f.service.run({ action: 'CLAIM', ...f.binding, attemptRef: started.attemptRef! });
    expect(claimed).toMatchObject({ fence: { leaseGeneration: 1 },
      executionModel: { modelRef: 'm3probe/minimax-m3' }, task: { modelInput: { documentProducer: 'HOSTED_M3' } } });
    f.v2.documentHasInterruptedGeneration.mockResolvedValueOnce(true);
    const stopped = await f.service.run({ action: 'CLAIM', ...f.binding, attemptRef: started.attemptRef! });
    expect(stopped).toMatchObject({ status: 'REQUIRES_ATTENTION',
      errorCode: 'DOCUMENT_TRANSLATION_GENERATION_OUTCOME_UNKNOWN' });
    expect(f.attempts.release).toHaveBeenCalledTimes(1);
    expect(f.v2.executeDocument).not.toHaveBeenCalled();
  });
  it('derives one partial successor from the exact delivery and leaves the completed attempt intact', async () => {
    const f = setup();
    const deliveryRef = 'acquisition:sample';
    const requestId = documentDeliveryRequestId('translation', deliveryRef);
    const first = await f.service.run({ action: 'START', ...f.binding, deliveryRef, requestId });
    if (!('attemptRef' in first)) throw new Error('expected first attempt');
    const prior = await f.attempts.readRequest({}, requestId);
    Object.assign(prior!, { status: 'SUCCEEDED', terminalReason: 'REMAINING_LIMITATIONS' });
    const status = await f.service.run({ action: 'STATUS', ...f.binding, deliveryRef });
    expect(status).toMatchObject({ status: 'SUCCEEDED', partialRepairAvailable: true });
    await expect(f.service.run({ action: 'CONTINUE_PARTIAL', ...f.binding,
      attemptRef: first.attemptRef! })).rejects.toThrow('DOCUMENT_TRANSLATION_PARTIAL_SCOPE_INVALID');
    const continued = await f.service.run({ action: 'CONTINUE_PARTIAL', ...f.binding,
      deliveryRef, attemptRef: first.attemptRef! });
    expect(continued).toMatchObject({ status: 'QUEUED' });
    expect(f.attempts.reserve.mock.calls[1].slice(2)).toMatchObject([
      `${requestId}:partial-repair`, { modelRef: 'm3probe/minimax-m3' }, first.attemptRef, 'PARTIAL']);
    expect(f.attempts.reserve.mock.calls[1][1].modelInput.retranslateBlockIds).toEqual(['repairable-block']);
    f.v2.readDocumentProgress.mockResolvedValueOnce({ completeness: 'COMPLETE', repairableBlockCount: 0,
      repairableBlockIds: [] });
    await f.service.run({ action: 'CONTINUE_PARTIAL', ...f.binding,
      deliveryRef, attemptRef: first.attemptRef! });
    expect(f.attempts.reserve.mock.calls[2][1].modelInput.retranslateBlockIds).toEqual(['repairable-block']);
    expect(f.v2.readDocumentProgress).toHaveBeenCalledTimes(2);
    expect(prior).toMatchObject({ status: 'SUCCEEDED', terminalReason: 'REMAINING_LIMITATIONS' });
    expect(f.authorization.authorizeDocumentWork).toHaveBeenCalledWith({ documentVersionId: f.binding.documentVersionId,
      deliveryRef, purpose: 'TRANSLATION' });
  });
  it('uses a separate exact recovery action without requesting CANCEL authority', async () => {
    const f = setup();
    const deliveryRef = 'acquisition:sample';
    const requestId = documentDeliveryRequestId('translation', deliveryRef);
    const old = await f.service.run({ action: 'START', ...f.binding, deliveryRef, requestId });
    if (!('attemptRef' in old)) throw new Error('expected attempt');
    const prior = await f.attempts.readRequest({}, requestId);
    if (!prior) throw new Error('expected prior');
    prior.triggerRequestId = `${requestId}:partial-repair`;
    const oldHash = JSON.parse(String(prior.taskEnvelopeJson)).inputHash;
    await expect(f.service.run({ action: 'RECOVER_PARTIAL_INPUT', ...f.binding,
      attemptRef: old.attemptRef! })).rejects.toThrow('RECOVERY_SCOPE_INVALID');
    const recovered = await f.service.run({ action: 'RECOVER_PARTIAL_INPUT', ...f.binding,
      deliveryRef, attemptRef: old.attemptRef! });
    expect(recovered).toMatchObject({ status: 'QUEUED' });
    expect(f.attempts.recoverPartialInput.mock.calls[0].slice(2))
      .toMatchObject([requestId, old.attemptRef, { modelRef: 'm3probe/minimax-m3' }]);
    const recoveryTask = f.attempts.recoverPartialInput.mock.calls[0][1];
    expect(recoveryTask.recoveryOf).toEqual({ operationRef: old.attemptRef, inputHash: oldHash });
    expect(recoveryTask.modelInput.retranslateBlockIds).toEqual(['repairable-block']);
    expect(f.authorization.authorizeDocumentWork).toHaveBeenLastCalledWith({
      documentVersionId: f.binding.documentVersionId, deliveryRef, purpose: 'TRANSLATION' });
    expect(f.attempts.cancel).not.toHaveBeenCalled();
  });
  it('executes one official step using the document fence and releases failure without replay', async () => {
    const f = setup();
    const state = await f.service.run({ action: 'START', ...f.binding, requestId: 'request' });
    if (!('attemptRef' in state)) throw new Error('expected reserved attempt');
    f.legacy();
    const input = { action: 'STEP' as const, ...f.binding, attemptRef: state.attemptRef! };
    await f.service.run(input);
    expect(f.plugins.executeStep).toHaveBeenCalledWith(expect.objectContaining({ fence: expect.objectContaining({
      workItemId: null, documentVersionId: f.binding.documentVersionId, workspaceId: 'workspace', leaseToken: 'token',
    }) }));
    expect(f.attempts.release).toHaveBeenCalledTimes(1);
    f.plugins.executeStep.mockRejectedValueOnce(new Error('PLUGIN_FAILURE'));
    await expect(f.service.run(input)).rejects.toThrow('PLUGIN_FAILURE');
    expect(f.attempts.fail).toHaveBeenCalledTimes(1);
    expect(f.attempts.release).toHaveBeenCalledTimes(2);
  });
  it('reports confirmed reservation permission denial without exposing SQL or classifying unknown outcomes', async () => {
    const f = setup();
    const denied = Object.assign(new Error('private SQL parameters'), { code: '42501' });
    f.attempts.reserve.mockRejectedValueOnce(Object.assign(new Error('Drizzle query'), { cause: denied }));
    await expect(f.service.run({ action: 'START', ...f.binding, requestId: 'denied' }))
      .rejects.toThrow(/^DOCUMENT_TRANSLATION_ADMISSION_DENIED$/);
    const unknown = new Error('CONNECTION_LOST');
    f.attempts.reserve.mockRejectedValueOnce(unknown);
    await expect(f.service.run({ action: 'START', ...f.binding, requestId: 'unknown' })).rejects.toBe(unknown);
    expect(f.plugins.executeStep).not.toHaveBeenCalled();
  });
  it('requires fresh source access even for status and never executes a mismatched attempt', async () => {
    const f = setup();
    await f.service.run({ action: 'START', ...f.binding, requestId: 'request' });
    await expect(f.service.run({ action: 'STEP', ...f.binding, attemptRef: 'other' })).rejects.toThrow('ATTEMPT_NOT_FOUND');
    expect(f.plugins.executeStep).not.toHaveBeenCalled();
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_DENIED'));
    await expect(f.service.run({ action: 'STATUS', ...f.binding })).rejects.toThrow('SOURCE_DENIED');
  });
  it('keeps status, duplicate start and cancel available without original bytes or semantic reads', async () => {
    const f = setup();
    const start = { action: 'START' as const, ...f.binding, requestId: 'request' };
    const state = await f.service.run(start);
    if (!('attemptRef' in state)) throw new Error('expected attempt');
    f.reader.readDocumentOriginal.mockClear().mockRejectedValue(new Error('STORAGE_UNAVAILABLE'));
    f.semantics.read.mockClear();
    await expect(f.service.run({ action: 'STATUS', ...f.binding })).resolves.toEqual(state);
    await expect(f.service.run(start)).resolves.toEqual(state);
    await f.service.run({ action: 'CANCEL', ...f.binding, attemptRef: state.attemptRef! });
    expect(f.attempts.cancel).toHaveBeenCalledTimes(1);
    expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
    expect(f.semantics.read).not.toHaveBeenCalled();
    expect(f.parsing.status).toHaveBeenCalledTimes(4);
  });

  it('does not consume content for idle, mismatched, terminal or unclaimed steps', async () => {
    const f = setup();
    await expect(f.service.run({ action: 'STATUS', ...f.binding })).resolves.toMatchObject({ status: 'IDLE' });
    expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
    const state = await f.service.run({ action: 'START', ...f.binding, requestId: 'request' });
    if (!('attemptRef' in state)) throw new Error('expected attempt');
    f.legacy();
    f.reader.readDocumentOriginal.mockClear();
    const step = { action: 'STEP' as const, ...f.binding, attemptRef: state.attemptRef! };
    await expect(f.service.run({ ...step, parseRunId: 'other' })).rejects.toThrow('SOURCE_CHANGED');
    await expect(f.service.run({ ...step, attemptRef: 'other' })).rejects.toThrow('ATTEMPT_NOT_FOUND');
    f.attempts.claim.mockResolvedValueOnce(null as never);
    await expect(f.service.run(step)).resolves.toMatchObject({ status: 'BUSY' });
    const row = await f.attempts.latest();
    if (!row) throw new Error('expected row');
    row.status = 'COMPLETED';
    await expect(f.service.run(step)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
    expect(f.plugins.executeStep).not.toHaveBeenCalled();
    expect(f.attempts.expire).toHaveBeenCalledTimes(6);
  });

  it('rejects withdrawn access and mismatched authorized scope before controlling an attempt', async () => {
    const f = setup();
    const state = await f.service.run({ action: 'START', ...f.binding, requestId: 'request' });
    if (!('attemptRef' in state)) throw new Error('expected attempt');
    f.parsing.status.mockRejectedValueOnce(new Error('SOURCE_DENIED'));
    await expect(f.service.run({ action: 'CANCEL', ...f.binding, attemptRef: state.attemptRef! })).rejects.toThrow('SOURCE_DENIED');
    expect(f.attempts.cancel).not.toHaveBeenCalled();
    f.authorization.authorizeDocumentWork.mockResolvedValueOnce({ tenantId: 'tenant', actorUserId: 'actor', documentVersionId: 'wrong' });
    await expect(f.service.run({ action: 'STATUS', ...f.binding })).rejects.toThrow('AUTHORIZATION_SCOPE_MISMATCH');
  });

  it('validates bytes on admitted content paths and releases a claimed step on source failure', async () => {
    const f = setup();
    const state = await f.service.run({ action: 'START', ...f.binding, requestId: 'request' });
    if (!('attemptRef' in state)) throw new Error('expected attempt');
    f.legacy();
    f.reader.readDocumentOriginal.mockRejectedValue(new Error('ORIGINAL_INTEGRITY_FAILED'));
    await expect(f.service.run({ action: 'STEP', ...f.binding, attemptRef: state.attemptRef! })).rejects.toThrow('ORIGINAL_INTEGRITY_FAILED');
    expect(f.attempts.fail).toHaveBeenCalledTimes(1);
    expect(f.attempts.release).toHaveBeenCalledTimes(1);
    expect(f.plugins.executeStep).not.toHaveBeenCalled();
    const fresh = setup();
    fresh.reader.readDocumentOriginal.mockRejectedValue(new Error('ORIGINAL_INTEGRITY_FAILED'));
    await expect(fresh.service.run({ action: 'START', ...fresh.binding, requestId: 'new' })).rejects.toThrow('ORIGINAL_INTEGRITY_FAILED');
    expect(fresh.attempts.reserve).not.toHaveBeenCalled();
  });

  it('keeps plugin callbacks fresh and prevents finish after revoked access', async () => {
    const f = setup();
    const state = await f.service.run({ action: 'START', ...f.binding, requestId: 'request' });
    if (!('attemptRef' in state)) throw new Error('expected attempt');
    f.legacy();
    f.plugins.executeStep.mockImplementationOnce(async (input) => {
      f.reader.readDocumentOriginal.mockRejectedValueOnce(new Error('SOURCE_REVOKED'));
      await input.assertAuthorized();
      return { status: 'DONE' };
    });
    await expect(f.service.run({ action: 'STEP', ...f.binding, attemptRef: state.attemptRef! })).rejects.toThrow('SOURCE_REVOKED');
    expect(f.attempts.finish).not.toHaveBeenCalled();
    expect(f.attempts.release).toHaveBeenCalledTimes(1);
  });

  it('reports registered semantic readiness for the requested idle parse without hydrating content', async () => {
    const f = setup();
    f.semantics.readReady.mockResolvedValue({ semanticRevision: 1, profileRef: 'profile' });
    await expect(f.service.run({ action: 'STATUS', ...f.binding })).resolves.toMatchObject({
      status: 'IDLE', parseRunId: f.binding.parseRunId, semanticReady: true });
    expect(f.reader.readDocumentOriginal).not.toHaveBeenCalled();
    expect(f.semantics.read).not.toHaveBeenCalled();
    await f.service.run({ action: 'START', ...f.binding, requestId: 'request' });
    f.semantics.readReady.mockResolvedValueOnce(null);
    await expect(f.service.run({ action: 'STATUS', ...f.binding, parseRunId: 'new-parse' })).resolves.toMatchObject({
      status: 'IDLE', parseRunId: 'new-parse', semanticReady: false,
      previousAttempt: { parseRunId: f.binding.parseRunId } });
    expect(f.semantics.readReady).toHaveBeenLastCalledWith(expect.objectContaining({ documentVersionId: f.binding.documentVersionId }), 'new-parse');
  });

});
