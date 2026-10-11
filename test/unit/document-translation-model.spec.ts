import { CANONICAL_REGISTERED_MODELS, taskModelSelection } from '../../server/modules/model-settings/canonical-model-catalog';
import { isDocumentTranslationModel, requireDocumentTranslationModel } from '../../server/modules/action-attempt/document-translation-model';
import { DocumentTranslationAttemptRepository } from '../../server/modules/action-attempt/document-translation-attempt.repository';
import { sealDocumentTranslationTaskEnvelope } from '../../server/modules/action-attempt/document-translation-task-envelope';
import { CanonicalTranslationV2Service } from '../../server/modules/canonical-host/canonical-translation-v2.service';

const scope = { tenantId: 'tenant', actorUserId: 'actor', documentVersionId: 'DV' };
const task = sealDocumentTranslationTaskEnvelope({
  schemaVersion: 'wiselink.document.translation_task.v1', actionAttemptId: 'DTA-test', operationRef: 'DTQ-test',
  tenantId: 'tenant', documentVersionId: 'DV', parseRunId: 'parse', parseRevision: 1, workspaceId: 'workspace',
  deadline: '2026-10-14T00:00:00.000Z', idempotencyKey: 'request',
  modelInput: { schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: 'workspace', planRevision: 1,
    contextRevision: 1, methodVersion: 'semantic-translation@2.0', documentProducer: 'HOSTED_M3',
    source: { documentVersionId: 'DV', packageId: 'parse',
      originalBinding: { documentVersionId: 'DV', parseRunId: 'parse', parseRevision: 1,
        sourceArtifactId: 'PDF', sourceSha256: 'b'.repeat(64), sourceByteLength: 234 },
      parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'document-original://DV/parse',
        sha256: 'a'.repeat(64), byteLength: 123, mediaType: 'application/json' } } },
});

describe('document translation model boundary', () => {
  it.each(CANONICAL_REGISTERED_MODELS.filter(model => model.available).map(model => model.modelRef))('preserves the full frozen %s selection', async modelRef => {
    const model = taskModelSelection(modelRef, new Date('2026-10-01T00:00:00Z'));
    expect(requireDocumentTranslationModel(model)).toBe(model);
    const transaction = jest.fn().mockRejectedValue(new Error('TRANSACTION_REACHED'));
    const repository = new DocumentTranslationAttemptRepository({ transaction } as never);
    await expect(repository.reserve(scope, task, 'request', model)).rejects.toThrow('TRANSACTION_REACHED');
    expect(transaction).toHaveBeenCalledTimes(1);
    const service = Object.create(CanonicalTranslationV2Service.prototype);
    service.workspaces = { attachAttempt: jest.fn() };
    service.executeScoped = jest.fn().mockResolvedValue({ status: 'READ' });
    const fence = { ...scope, workItemId: null, workspaceId: 'workspace', attemptRef: 'DTQ-test',
      principalId: 'principal', leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 1 };
    await expect(service.executeDocument({ phase: 'READ', attemptRef: fence.attemptRef,
      leaseToken: fence.leaseToken, leaseGeneration: fence.leaseGeneration }, fence, 'actor',
      async () => {}, task, model)).resolves.toEqual({ status: 'READ' });
    expect(service.executeScoped.mock.calls[0][1].executionModel).toBe(model);
  });

  it.each([undefined, 'DTQ-prior'])(
    'rechecks the exact WI selection and source under the admission lock with predecessor %s', async (predecessorRef) => {
    const model = taskModelSelection('miaoda/glm-5.3');
    const selected = { tenantId: 'tenant', workItemId: 'WI-test', requestedByUserId: 'actor',
      documentVersionId: 'DV', sourceArtifactId: 'PDF', sourceFileSha256: 'b'.repeat(64),
      sourceByteLength: 234, analysisModelJson: JSON.stringify(model) };
    for (const changed of [{ analysisModelJson: JSON.stringify(taskModelSelection()) },
      { requestedByUserId: 'other' }, { documentVersionId: 'other' }, { sourceArtifactId: 'other' },
      { sourceFileSha256: 'c'.repeat(64) }, { sourceByteLength: 235 }]) {
      const locked = jest.fn().mockResolvedValue([{ ...selected, ...changed }]);
      const query = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(), for: locked };
      const tx = { select: jest.fn().mockReturnValue(query), execute: jest.fn(), insert: jest.fn() };
      const repository = new DocumentTranslationAttemptRepository({
        transaction: async (fn: (value: unknown) => unknown) => fn(tx),
      } as never);
      await expect(repository.reserve(scope, task, 'request', model, predecessorRef, 'QUOTA', 'WI-test'))
        .rejects.toThrow('DOCUMENT_TRANSLATION_WORK_ITEM_MODEL_CHANGED');
      expect(locked).toHaveBeenCalledWith('update');
      expect(tx.execute).not.toHaveBeenCalled();
      expect(tx.insert).not.toHaveBeenCalled();
    }
  });

  it.each([
    { label: 'saved envelope', documentProducer: 'OFFICIAL_PLUGIN', resultEnvelopeJson: '{}',
      savedBlocks: [], workspaceResult: null, code: 'DOCUMENT_TRANSLATION_RECOVERY_INELIGIBLE' },
    { label: 'saved block', documentProducer: 'OFFICIAL_PLUGIN', resultEnvelopeJson: null,
      savedBlocks: [{ id: 'saved-block' }], workspaceResult: null, code: 'DOCUMENT_TRANSLATION_RECOVERY_HAS_OUTPUT' },
    { label: 'saved workspace', documentProducer: 'OFFICIAL_PLUGIN', resultEnvelopeJson: null,
      savedBlocks: [], workspaceResult: '{}', code: 'DOCUMENT_TRANSLATION_RECOVERY_HAS_OUTPUT' },
    { label: 'Hosted predecessor', documentProducer: 'HOSTED_M3', resultEnvelopeJson: null,
      savedBlocks: [], workspaceResult: null, code: 'DOCUMENT_TRANSLATION_RECOVERY_INELIGIBLE' },
  ] as const)('does not insert a quota successor for $label', async (ineligible) => {
    const { inputHash: _hash, ...unsealed } = task;
    const priorTask = sealDocumentTranslationTaskEnvelope({ ...unsealed,
      actionAttemptId: 'DTA-prior', operationRef: 'DTQ-prior',
      modelInput: { ...unsealed.modelInput, documentProducer: ineligible.documentProducer } });
    const prior = { attemptId: 'DTA-prior', operationRef: 'DTQ-prior', triggerRequestId: 'request',
      producerRunId: 'parse', status: 'FAILED', errorCode: 'DOCUMENT_PLUGIN_QUOTA_EXHAUSTED',
      startedAt: null, projectionApplied: false, resultEnvelopeJson: ineligible.resultEnvelopeJson,
      executionModelJson: null, taskEnvelopeJson: JSON.stringify(priorTask) };
    const locked = jest.fn().mockResolvedValue([prior]);
    const predecessor = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(), for: locked };
    const blocks = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(ineligible.savedBlocks) };
    const workspace = { from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ result: ineligible.workspaceResult }]) };
    const tx = { select: jest.fn().mockReturnValueOnce(predecessor).mockReturnValueOnce(blocks)
      .mockReturnValueOnce(workspace), execute: jest.fn().mockResolvedValue([{ document_version_id: 'DV' }]),
      insert: jest.fn() };
    const transaction = jest.fn(async (fn: (value: unknown) => unknown) => fn(tx));
    const repository = new DocumentTranslationAttemptRepository({ transaction } as never);
    await expect(repository.reserve(scope, task, 'request:hosted-m3',
      taskModelSelection('miaoda/glm-5.3'), 'DTQ-prior', 'QUOTA')).rejects.toThrow(ineligible.code);
    expect(locked).toHaveBeenCalledWith('update');
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it.each([null, {}, { ...taskModelSelection(), modelRef: 'unregistered/model' },
    { ...taskModelSelection('miaoda/glm-5.3'), providerKind: 'CUSTOM' },
    { ...taskModelSelection(), providerKind: 'BUILT_IN' },
    { ...taskModelSelection('miaoda/glm-5.3'), extra: true },
  ])('rejects unsupported, malformed or provider-mismatched frozen selections', async model => {
    expect(isDocumentTranslationModel(model)).toBe(false);
    const transaction = jest.fn();
    const repository = new DocumentTranslationAttemptRepository({ transaction } as never);
    await expect(repository.reserve(scope, task, 'request', model as never)).rejects.toThrow('DOCUMENT_TRANSLATION_HOSTED_MODEL_INVALID');
    expect(transaction).not.toHaveBeenCalled();
  });
});
