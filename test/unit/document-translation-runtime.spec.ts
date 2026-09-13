import { DocumentTranslationRuntimeService } from '../../server/modules/canonical-host/document-translation-runtime.service';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';

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
  const attempts = { readRequest: jest.fn(async () => row), latest: jest.fn(async () => row),
    reserve: jest.fn(async (_scope, task) => { row = { status: 'QUEUED', documentVersionId, producerRunId: parseRunId,
      attemptId: task.actionAttemptId, operationRef: task.operationRef, taskEnvelopeJson: JSON.stringify(task),
      deadlineAt: new Date(task.deadline), errorCode: null }; return row; }),
    claim: jest.fn(async (_scope, attemptRef, principalId) => ({ attemptRef, principalId, leaseToken: 'token', leaseGeneration: 1 })),
    renew: jest.fn().mockResolvedValue(true), release: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn(), finish: jest.fn(), fail: jest.fn(), expire: jest.fn(),
  };
  const service = new DocumentTranslationRuntimeService(authorization as never, actors as never, reader as never,
    plugins as never, attempts as never);
  return { service, reader, plugins, attempts, binding: { documentVersionId, parseRunId } };
}

describe('independent document translation runtime', () => {
  it('reserves from the actual original without a WorkItem and reuses the same request', async () => {
    const f = setup();
    const start = { action: 'START' as const, ...f.binding, requestId: 'request' };
    const first = await f.service.run(start);
    expect(await f.service.run(start)).toEqual(first);
    expect(f.plugins.prepareOriginal).toHaveBeenCalledTimes(1);
    expect(f.plugins.prepareOriginal.mock.calls[0][0]).not.toHaveProperty('workItemId');
    expect(f.attempts.reserve.mock.calls[0][1]).not.toHaveProperty('workItemId');
    expect(f.plugins.executeStep).not.toHaveBeenCalled();
  });
  it('executes one official step using the document fence and releases failure without replay', async () => {
    const f = setup();
    const state = await f.service.run({ action: 'START', ...f.binding, requestId: 'request' });
    if (!('attemptRef' in state)) throw new Error('expected reserved attempt');
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
    f.reader.readDocumentOriginal.mockRejectedValueOnce(new Error('SOURCE_DENIED'));
    await expect(f.service.run({ action: 'STATUS', ...f.binding })).rejects.toThrow('SOURCE_DENIED');
  });
});
