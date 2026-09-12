import { sealDocumentTranslationTaskEnvelope, parseDocumentTranslationTaskEnvelope,
  type DocumentTranslationTaskEnvelope } from '../../server/modules/action-attempt/document-translation-task-envelope';
import { canonicalSha256 } from '../../server/modules/action-attempt/action-attempt-envelope';

const input: Omit<DocumentTranslationTaskEnvelope, 'inputHash'> = {
  schemaVersion: 'wiselink.document.translation_task.v1', actionAttemptId: 'attempt', operationRef: 'operation',
  tenantId: 'tenant', documentVersionId: 'DV', parseRunId: 'parse', parseRevision: 1, workspaceId: 'workspace',
  deadline: '2026-09-14T00:00:00.000Z', idempotencyKey: 'request',
  modelInput: { schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: 'workspace', planRevision: 1,
    contextRevision: 1, methodVersion: 'semantic-translation@2.0', documentProducer: 'OFFICIAL_PLUGIN',
    source: { documentVersionId: 'DV', packageId: 'parse',
      originalBinding: { documentVersionId: 'DV', parseRunId: 'parse', parseRevision: 1,
        sourceArtifactId: 'PDF', sourceSha256: 'b'.repeat(64), sourceByteLength: 234 },
      parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate',
      ref: 'document-original://DV/parse', sha256: 'a'.repeat(64), byteLength: 123, mediaType: 'application/json' } } },
};

describe('document translation task binding', () => {
  it('seals a real document subject without engineering identity or model claims', () => {
    const sealed = sealDocumentTranslationTaskEnvelope(input);
    expect(parseDocumentTranslationTaskEnvelope(JSON.stringify(sealed))).toEqual(sealed);
    expect(sealed).not.toHaveProperty('workItemId');
    expect(sealed).not.toHaveProperty('executionModel');
  });
  it('rejects injected WorkItem scope, corrupted hash and a signed inconsistent original', () => {
    const sealed = sealDocumentTranslationTaskEnvelope(input);
    expect(() => parseDocumentTranslationTaskEnvelope(JSON.stringify({ ...sealed, workItemId: 'fake' })))
      .toThrow('DOCUMENT_TRANSLATION_TASK_INVALID');
    expect(() => parseDocumentTranslationTaskEnvelope(JSON.stringify({ ...sealed, parseRunId: 'other' })))
      .toThrow('DOCUMENT_TRANSLATION_TASK_HASH_MISMATCH');
    const changed = { ...input, parseRunId: 'other' };
    expect(() => parseDocumentTranslationTaskEnvelope(JSON.stringify({ ...changed, inputHash: canonicalSha256(changed) })))
      .toThrow('DOCUMENT_TRANSLATION_TASK_SOURCE_MISMATCH');
  });
});
