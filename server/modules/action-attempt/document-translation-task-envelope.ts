import { z } from 'zod/v4';
import { canonicalSha256 } from './action-attempt-envelope';

const id = z.string().trim().min(1).max(96);
const schema = z.strictObject({
  schemaVersion: z.literal('wiselink.document.translation_task.v1'),
  actionAttemptId: id, operationRef: z.string().min(1).max(128),
  tenantId: z.string().min(1).max(128), documentVersionId: id,
  parseRunId: id, parseRevision: z.number().int().positive(), workspaceId: id,
  modelInput: z.strictObject({
    schemaVersion: z.literal('wiselink.3_1.translation_task.v2'),
    workspaceId: id, planRevision: z.number().int().positive(), contextRevision: z.number().int().positive(),
    methodVersion: z.string().min(1), documentProducer: z.literal('OFFICIAL_PLUGIN'),
    source: z.strictObject({ documentVersionId: id, packageId: id,
      originalBinding: z.strictObject({ documentVersionId: id, parseRunId: id, parseRevision: z.number().int().positive(),
        sourceArtifactId: z.string().min(1), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
        sourceByteLength: z.number().int().positive() }),
      parsedArtifact: z.strictObject({ storeRole: z.literal('UnifiedArtifactStoreCandidate'),
        ref: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
        byteLength: z.number().int().positive(), mediaType: z.literal('application/json') }) }),
  }),
  deadline: z.string().datetime(), idempotencyKey: z.string().min(1).max(255),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type DocumentTranslationTaskEnvelope = z.infer<typeof schema>;

export function sealDocumentTranslationTaskEnvelope(
  input: Omit<DocumentTranslationTaskEnvelope, 'inputHash'>,
): DocumentTranslationTaskEnvelope {
  return parseDocumentTranslationTaskEnvelope(JSON.stringify({ ...input, inputHash: canonicalSha256(input) }));
}

/** Separate Host task identity. It grants no WorkItem or model execution scope. */
export function parseDocumentTranslationTaskEnvelope(value: string): DocumentTranslationTaskEnvelope {
  let task: DocumentTranslationTaskEnvelope;
  try { task = schema.parse(JSON.parse(value)); } catch { throw new Error('DOCUMENT_TRANSLATION_TASK_INVALID'); }
  const { inputHash, ...input } = task;
  if (canonicalSha256(input) !== inputHash) throw new Error('DOCUMENT_TRANSLATION_TASK_HASH_MISMATCH');
  if (task.workspaceId !== task.modelInput.workspaceId ||
      task.documentVersionId !== task.modelInput.source.documentVersionId ||
      task.parseRunId !== task.modelInput.source.packageId ||
      task.documentVersionId !== task.modelInput.source.originalBinding.documentVersionId ||
      task.parseRunId !== task.modelInput.source.originalBinding.parseRunId ||
      task.parseRevision !== task.modelInput.source.originalBinding.parseRevision ||
      task.modelInput.source.parsedArtifact.ref !==
        `document-original://${encodeURIComponent(task.documentVersionId)}/${encodeURIComponent(task.parseRunId)}`)
    throw new Error('DOCUMENT_TRANSLATION_TASK_SOURCE_MISMATCH');
  return task;
}
