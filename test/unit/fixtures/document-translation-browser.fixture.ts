import type { TranslationBlockRevisionV2, TranslationGenerationRequestV2 } from '@shared/canonical-translation-v2.interface';
import { taskModelSelection } from '../../../server/modules/model-settings/canonical-model-catalog';
import { canonicalJson } from '../../../server/modules/action-attempt/action-attempt-envelope';
import { sealDocumentTranslationTaskEnvelope } from '../../../server/modules/action-attempt/document-translation-task-envelope';
import { buildTranslationSourcePlan } from '../../../server/modules/canonical-host/canonical-translation-source-plan';
import { documentDeliveryRequestId } from '../../../server/modules/canonical-host/document-delivery-ref';
import type { BrowserTranslationAttempt, BrowserTranslationSnapshot } from '../../../server/modules/canonical-host/document-translation-browser-policy';

/** Constructed data only. No production source, credential or model call. */
export function browserTranslationFixture() {
  const actor = { actorUserId: 'actor', tenantId: 'tenant', roles: [], appId: 'app', env: 'test' };
  const documentVersionId = 'DV-test';
  const parseRunId = 'PR-test';
  const acquisitionId = 'ACQ-test';
  const root = documentDeliveryRequestId('translation', `acquisition:${acquisitionId}`);
  const binding = { documentVersionId, parseRunId, parseRevision: 1,
    sourceArtifactId: 'SRC-test', sourceSha256: 'a'.repeat(64), sourceByteLength: 200 };
  const artifact = { storeRole: 'UnifiedArtifactStoreCandidate' as const,
    ref: `document-original://${documentVersionId}/${parseRunId}`, sha256: 'b'.repeat(64), byteLength: 100,
    mediaType: 'application/json' as const };
  const plan = buildTranslationSourcePlan({ documentVersionId, packageId: parseRunId, title: 'Constructed',
    parsedArtifact: artifact, source: { modules: [{ moduleId: 'm', order: 0 }], findings: [], references: [],
      sourceLocators: [{ sourceRefId: 'sr', kind: 'pdf_page', artifactId: 'SRC-test', pageStart: 1, pageEnd: 1,
        charStart: null, charEnd: null, charOffsetUnit: null, normalizedPath: null, xpath: null, elementId: null,
        quote: null, bbox: null }], units: [{ unitId: 'u', kind: 'paragraph', moduleId: 'm', parentUnitId: null,
        order: 0, depth: 0, continuityKey: 'u', sourceRefIds: ['sr'], sourceSegmentIds: ['s'], mapping: {},
        payload: { text: 'A constructed description.' } }] } });
  plan.source.originalBinding = binding;
  const model = taskModelSelection();
  const task = sealDocumentTranslationTaskEnvelope({ schemaVersion: 'wiselink.document.translation_task.v1',
    actionAttemptId: 'DTA-test', operationRef: 'DTQ-test', tenantId: actor.tenantId, documentVersionId,
    parseRunId, parseRevision: 1, workspaceId: 'TW-test', modelInput: {
      schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: 'TW-test', planRevision: plan.planRevision,
      contextRevision: plan.documentContext.revision, methodVersion: 'semantic-translation@2.0',
      documentProducer: 'HOSTED_M3', source: { ...plan.source, originalBinding: binding, parsedArtifact: artifact } },
    deadline: '2026-09-30T00:00:00.000Z', idempotencyKey: 'translation-test' });
  const time = '2026-09-29T00:00:00.000Z';
  const dependencies = { planRevision: plan.planRevision, contextRevision: plan.documentContext.revision,
    sourceAnchorIds: plan.blocks[0].anchorIds, contextAnchorIds: [], methodVersion: 'semantic-translation@2.0' };
  const generation: TranslationGenerationRequestV2 = { generationRequestRef: 'TG-saved', clientRequestId: 'generate',
    attemptId: task.actionAttemptId, leaseGeneration: 1, blockIds: [plan.blocks[0].blockId], dependencies,
    purpose: 'GENERATE', targetBlockRevisionId: null, status: 'SAVED', registeredAt: time, finishedAt: time, error: null };
  const failed: TranslationGenerationRequestV2 = { ...generation, generationRequestRef: 'TG-failed', clientRequestId: 'check',
    purpose: 'CHECK', targetBlockRevisionId: 'TB-test', status: 'FAILED',
    error: { origin: 'UPSTREAM', code: 'CHECK_FAILED', retryable: true, outcome: 'KNOWN_FAILURE' } };
  const revision: TranslationBlockRevisionV2 = { blockRevisionId: 'TB-test', workspaceId: 'TW-test',
    blockId: plan.blocks[0].blockId, planRevision: 1, contentRevision: 1, rowVersion: 1,
    candidate: { blockId: plan.blocks[0].blockId, elements: [{ elementId: 'e', kind: 'paragraph',
      translatedText: '一项构造说明。', anchorIds: plan.blocks[0].anchorIds }] }, dependencies,
    provenance: { authorKind: 'MODEL', authorUserId: actor.actorUserId, executionModel: model,
      modelVersion: 'test', skillVersion: 'test', promptVersion: 'test', generationRequestRef: generation.generationRequestRef,
      originAttemptId: task.actionAttemptId, providerRequestId: null, usage: { inputTokens: null, outputTokens: null } },
    generatedAt: time, savedAt: time, check: null, checkedAt: null, selectedForReading: false };
  const snapshot: BrowserTranslationSnapshot = { workspace: { workspaceId: 'TW-test', workItemId: null,
    tenantId: actor.tenantId, rowVersion: 1, methodVersion: 'semantic-translation@2.0', activeAttemptId: task.actionAttemptId,
    plan, generationRequests: [generation, failed], resultArtifact: null, resultManifest: null }, revisions: [revision] };
  const row = { attemptId: task.actionAttemptId, operationRef: task.operationRef, attemptNo: 1,
    actorUserId: actor.actorUserId, tenantId: actor.tenantId, subjectKind: 'DOCUMENT_VERSION', workItemId: null,
    documentVersionId, producerRunId: parseRunId, actionType: 'DOCUMENT_TRANSLATE', requestOrigin: 'HOST_DOCUMENT',
    triggerRequestId: root, taskEnvelopeJson: canonicalJson(task), taskInputHash: task.inputHash,
    executionModelJson: canonicalJson(model), inputRevision: 1, status: 'FAILED',
    errorCode: 'CHECK_FAILED', terminalReason: 'CHECK_FAILED', claimCount: 1,
    startedAt: new Date(time), leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
    resultEnvelopeJson: null, resultContentHash: null, projectionApplied: false, commitStartedAt: null,
    cancelRequestedAt: null, deadlineAt: new Date(task.deadline) } as BrowserTranslationAttempt;
  const original = { original: { binding }, run: { manifestArtifact: { ...artifact,
    relativePath: 'original/manifest.json', readback: 'VERIFIED' } } };
  const intent = { actorUserId: actor.actorUserId, acquisitionId, documentVersionId,
    delivery: { reading: false, translation: 'ZH_FULL' as const } };
  return { actor, documentVersionId, parseRunId, acquisitionId, root, binding, artifact, plan, model, task,
    generation, failed, revision, snapshot, row, original, intent };
}
