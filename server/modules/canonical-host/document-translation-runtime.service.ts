import { DocumentParsingHostedService } from '../document-management/src/hosted/nest/document-parsing-hosted.service';
import { DocumentSemanticService } from './document-semantic.service';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DocumentTranslationAttemptRepository, type DocumentTranslationScope } from '../action-attempt/document-translation-attempt.repository';
import { parseDocumentTranslationTaskEnvelope, sealDocumentTranslationTaskEnvelope } from '../action-attempt/document-translation-task-envelope';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { CanonicalTranslationV2PluginService } from './canonical-translation-v2-plugin.service';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, canonicalServiceScopeUnavailable,
  type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';
import { documentDeliveryRequestId } from './document-delivery-ref';
import { taskModelSelection } from '../model-settings/canonical-model-catalog';
import { readStoredExecutionModel } from '../model-settings/canonical-execution-model';
import { CanonicalTranslationV2Service } from './canonical-translation-v2.service';
import type { TranslationWorkspaceFence } from './canonical-translation-workspace.repository';

@Injectable()
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentTranslationRuntimeService {
  constructor(@Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION) private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    private readonly actors: EngineeringMatterWorkingRepository, private readonly reader: UnifiedReaderService,
    private readonly plugins: CanonicalTranslationV2PluginService, private readonly attempts: DocumentTranslationAttemptRepository, private readonly semantics: DocumentSemanticService, private readonly parsing: DocumentParsingHostedService,
    private readonly v2: CanonicalTranslationV2Service) {}

  async run(input: { action: 'START' | 'RECOVER' | 'CONTINUE_PARTIAL' | 'STATUS' | 'STEP' | 'CANCEL' | 'CLAIM' | 'HEARTBEAT' | 'RELEASE' | 'WORKSPACE' | 'FINISH' | 'FAIL'; documentVersionId: string;
    parseRunId: string; deliveryRef?: string; requestId?: string; attemptRef?: string;
    leaseToken?: string; leaseGeneration?: number; phase?: string; workspaceCommand?: unknown; errorCode?: string }) {
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const auth = await this.authorization.authorizeDocumentWork({ documentVersionId: input.documentVersionId,
      deliveryRef: input.deliveryRef, purpose: input.action === 'CANCEL' ? 'CANCEL' : 'TRANSLATION' });
    if (auth.documentVersionId !== input.documentVersionId) throw new Error('DOCUMENT_TRANSLATION_AUTHORIZATION_SCOPE_MISMATCH');
    const scope: DocumentTranslationScope = { tenantId: auth.tenantId, actorUserId: auth.actorUserId, documentVersionId: auth.documentVersionId };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      const expectedRequestId = input.deliveryRef
        ? documentDeliveryRequestId('translation', input.deliveryRef) : undefined;
      if (expectedRequestId && input.action === 'START' && input.requestId !== expectedRequestId)
        throw new Error('DOCUMENT_TRANSLATION_DELIVERY_REQUEST_MISMATCH');
      const read = () => this.reader.readDocumentOriginal(scope.documentVersionId, input.parseRunId, { ...scope, roles: [] });
      // Control requires fresh source ACL/catalog access, not original bytes or
      // semantic hydration. A successful status is not a content-health proof.
      await this.parsing.status(scope.documentVersionId, { ...scope, roles: [] });
      const assertAuthorized = async () => { await read(); };
      if (input.action === 'START' || input.action === 'RECOVER' || input.action === 'CONTINUE_PARTIAL') {
        const requestId = input.action === 'CONTINUE_PARTIAL' && expectedRequestId
          ? `${expectedRequestId}:partial-repair` : input.requestId;
        if (input.action === 'CONTINUE_PARTIAL' && (!expectedRequestId || !input.attemptRef || input.requestId))
          throw new Error('DOCUMENT_TRANSLATION_PARTIAL_SCOPE_INVALID');
        if (!requestId) throw new Error('DOCUMENT_TRANSLATION_REQUEST_REQUIRED');
        if (input.action === 'RECOVER') {
          if (!input.attemptRef || !expectedRequestId || requestId !== `${expectedRequestId}:hosted-m3`)
            throw new Error('DOCUMENT_TRANSLATION_RECOVERY_SCOPE_INVALID');
          await this.attempts.assertQuotaSuccessor(scope, expectedRequestId, input.attemptRef, input.parseRunId);
        }
        await this.attempts.expire(scope);
        if (input.action !== 'CONTINUE_PARTIAL') {
          const prior = await this.attempts.readRequest(scope, requestId);
          if (prior) {
            if (prior.producerRunId !== input.parseRunId) throw new Error('DOCUMENT_TRANSLATION_REQUEST_CONFLICT');
            return summary(prior);
          }
        }
        const original = await read();
        const artifact = original.run.manifestArtifact;
        if (!artifact || artifact.relativePath !== 'original/manifest.json' || artifact.readback !== 'VERIFIED')
          throw new Error('DOCUMENT_ORIGINAL_MANIFEST_REQUIRED');
        const semanticMap = await this.semantics.read({ ...scope, roles: [] }, original);
        if (!semanticMap) throw new Error('DOCUMENT_SEMANTIC_NOT_READY');
        const workspace = await this.plugins.prepareOriginal({ tenantId: scope.tenantId, original: original.original, semanticMap,
          artifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: `document-original://${encodeURIComponent(scope.documentVersionId)}/${encodeURIComponent(input.parseRunId)}`,
            sha256: artifact.sha256, byteLength: artifact.byteLength, mediaType: 'application/json' }, assertAuthorized });
        const existingPartial = input.action === 'CONTINUE_PARTIAL'
          ? await this.attempts.readRequest(scope, requestId) : null;
        const retranslateBlockIds = input.action === 'CONTINUE_PARTIAL'
          ? existingPartial
            ? parseDocumentTranslationTaskEnvelope(existingPartial.taskEnvelopeJson ?? '').modelInput.retranslateBlockIds
            : (await this.v2.readDocumentProgress({ tenantId: scope.tenantId, workItemId: null,
              documentVersionId: scope.documentVersionId, workspaceId: workspace.workspaceId })).repairableBlockIds
          : undefined;
        if (input.action === 'CONTINUE_PARTIAL' && !retranslateBlockIds?.length)
          throw new Error('DOCUMENT_TRANSLATION_PARTIAL_SUCCESSOR_INELIGIBLE');
        const modelInput = this.plugins.taskInput(workspace);
        const task = sealDocumentTranslationTaskEnvelope({ schemaVersion: 'wiselink.document.translation_task.v1',
          actionAttemptId: `DTA-${randomUUID()}`, operationRef: `DTQ-${randomUUID()}`, tenantId: scope.tenantId,
          documentVersionId: scope.documentVersionId, parseRunId: input.parseRunId,
          parseRevision: original.original.binding.parseRevision, workspaceId: workspace.workspaceId,
          modelInput: { ...modelInput, ...(retranslateBlockIds ? { retranslateBlockIds } : {}),
          schemaVersion: 'wiselink.3_1.translation_task.v2',
          source: { ...modelInput.source, originalBinding: original.original.binding }, documentProducer: 'HOSTED_M3' },
          deadline: new Date(Date.now() + 12 * 60 * 60_000).toISOString(),
          idempotencyKey: `document-translation:${scope.documentVersionId}:${requestId}` });
        try {
          return summary(await this.attempts.reserve(scope, task, requestId,
            taskModelSelection(), input.action === 'START' ? undefined : input.attemptRef,
            input.action === 'CONTINUE_PARTIAL' ? 'PARTIAL' : 'QUOTA'));
        } catch (error) {
          // A confirmed DB permission rejection is distinct from an unknown
          // reservation outcome. Never expose Drizzle SQL/parameters to callers.
          if (isPermissionRejection(error)) throw new Error('DOCUMENT_TRANSLATION_ADMISSION_DENIED');
          throw error;
        }
      }
      await this.attempts.expire(scope);
      const row = await this.attempts.latest(scope, expectedRequestId);
      const idle = async () => ({ status: 'IDLE', documentVersionId: scope.documentVersionId,
        parseRunId: input.parseRunId,
        semanticReady: Boolean(await this.semantics.readReady({ ...scope, roles: [] }, input.parseRunId)) });
      if (!row) return input.action === 'STATUS' ? idle() : { status: 'IDLE', documentVersionId: scope.documentVersionId };
      if (row.producerRunId !== input.parseRunId) {
        if (input.action === 'STATUS') return { ...await idle(), previousAttempt: summary(row) };
        throw new Error('DOCUMENT_TRANSLATION_SOURCE_CHANGED');
      }
      if (input.action === 'STATUS') {
        if (row.status !== 'SUCCEEDED') return summary(row);
        const task = parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? '');
        const progress = await this.v2.readDocumentProgress({
          tenantId: scope.tenantId, workItemId: null, documentVersionId: scope.documentVersionId,
          workspaceId: task.workspaceId });
        return { ...summary(row), progress,
          partialRepairAvailable: Boolean(expectedRequestId && row.terminalReason === 'REMAINING_LIMITATIONS' &&
            progress.completeness === 'PARTIAL' &&
            progress.repairableBlockCount > 0 &&
            row.triggerRequestId !== `${expectedRequestId}:partial-repair`) };
      }
      if (!input.attemptRef || row.operationRef !== input.attemptRef) throw new Error('DOCUMENT_TRANSLATION_ATTEMPT_NOT_FOUND');
      if (input.action === 'CANCEL') { await this.attempts.cancel(scope, input.attemptRef); return summary((await this.attempts.latest(scope, expectedRequestId))!); }
      if (input.action === 'CLAIM') {
        if (parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? '').modelInput.documentProducer !== 'HOSTED_M3')
          throw new Error('DOCUMENT_TRANSLATION_HOSTED_TASK_REQUIRED');
        const executionModel = readStoredExecutionModel(row.executionModelJson);
        if (executionModel?.modelRef !== 'm3probe/minimax-m3') throw new Error('DOCUMENT_TRANSLATION_HOSTED_MODEL_INVALID');
        const fence = await this.attempts.claim(scope, input.attemptRef, `document-translation:${randomUUID()}`);
        if (fence && await this.v2.documentHasInterruptedGeneration({ ...fence, tenantId: scope.tenantId,
          workItemId: null, documentVersionId: scope.documentVersionId,
          workspaceId: parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? '').workspaceId },
          parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? '').actionAttemptId)) {
          await this.attempts.release(scope, fence);
          return { ...summary(row), status: 'REQUIRES_ATTENTION',
            errorCode: 'DOCUMENT_TRANSLATION_GENERATION_OUTCOME_UNKNOWN' };
        }
        return fence ? { ...summary(row), fence, task: parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? ''),
          executionModel } : { ...summary(row), status: 'BUSY' };
      }
      if (['HEARTBEAT','RELEASE','WORKSPACE','FINISH','FAIL'].includes(input.action)) {
        if (!input.leaseToken || !input.leaseGeneration) throw new Error('DOCUMENT_TRANSLATION_FENCE_REQUIRED');
        const principalId = row.leaseOwner;
        if (!principalId) throw new Error('DOCUMENT_TRANSLATION_LEASE_NOT_FOUND');
        const fence = { attemptRef: input.attemptRef, principalId, leaseToken: input.leaseToken,
          leaseGeneration: input.leaseGeneration };
        if (input.action === 'HEARTBEAT') {
          if (!await this.attempts.renew(scope, fence)) throw new Error('DOCUMENT_TRANSLATION_LEASE_REJECTED');
          return { renewed: true, attemptRef: input.attemptRef };
        }
        if (input.action === 'RELEASE') {
          if (!await this.attempts.release(scope, fence)) throw new Error('DOCUMENT_TRANSLATION_LEASE_REJECTED');
          return { released: true, attemptRef: input.attemptRef };
        }
        await read();
        const workspaceFence: TranslationWorkspaceFence = { ...fence, tenantId: scope.tenantId,
          workItemId: null, documentVersionId: scope.documentVersionId,
          workspaceId: parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? '').workspaceId };
        if (input.action === 'WORKSPACE') return this.v2.executeDocument(input.workspaceCommand, workspaceFence,
          scope.actorUserId, assertAuthorized, parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? ''),
          readStoredExecutionModel(row.executionModelJson)!);
        if (input.action === 'FAIL') {
          if (!await this.attempts.fail(scope, fence, new Error(input.errorCode ?? 'DOCUMENT_TRANSLATION_HOSTED_FAILED')))
            throw new Error('DOCUMENT_TRANSLATION_FAIL_FENCE_REJECTED');
          await this.attempts.release(scope, fence);
          return summary((await this.attempts.latest(scope, expectedRequestId))!);
        }
        const assembled = await this.v2.assembleDocument(workspaceFence, assertAuthorized);
        await this.attempts.finish(scope, fence, { workspaceId: workspaceFence.workspaceId,
          status: assembled.completeness === 'PARTIAL' ? 'REMAINING_LIMITATIONS' : 'DONE', artifact: assembled });
        await this.attempts.release(scope, fence);
        return { ...summary((await this.attempts.latest(scope, expectedRequestId))!),
          progress: await this.v2.readDocumentProgress(workspaceFence) };
      }
      if (parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? '').modelInput.documentProducer !== 'OFFICIAL_PLUGIN')
        throw new Error('DOCUMENT_TRANSLATION_HOSTED_STEP_REQUIRED');
      if (!['QUEUED','RUNNING','RETRY_SCHEDULED'].includes(row.status)) return summary(row);
      const task = parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? '');
      const lease = await this.attempts.claim(scope, input.attemptRef, `document-translation:${randomUUID()}`);
      if (!lease) return { ...summary(row), status: 'BUSY' };
      let renewal: Promise<void> = Promise.resolve();
      let renewalFailed = false;
      const timer = setInterval(() => {
        renewal = renewal.then(async () => { if (!await this.attempts.renew(scope, lease)) renewalFailed = true; })
          .catch(() => { renewalFailed = true; });
      }, 30_000);
      try {
        // Only a claimed live step consumes content. Keep byte validation and
        // all plugin/save authorization callbacks on the exact requested run.
        await read();
        const result = await this.plugins.executeStep({ fence: { ...lease, tenantId: scope.tenantId, workItemId: null,
          documentVersionId: scope.documentVersionId, workspaceId: task.workspaceId },
          requestId: `step:${row.attemptId}:${lease.leaseGeneration}`, assertAuthorized });
        if (renewalFailed) throw new Error('DOCUMENT_TRANSLATION_RENEWAL_FAILED');
        if (result.status === 'DONE' || result.status === 'REMAINING_LIMITATIONS') {
          await assertAuthorized();
          await this.attempts.finish(scope, lease, { workspaceId: task.workspaceId, status: result.status, artifact: result.result });
        } else if (result.status === 'NEEDS_RECOVERY') throw new Error('DOCUMENT_TRANSLATION_NEEDS_RECOVERY');
        return { ...summary((await this.attempts.latest(scope, expectedRequestId))!), stepStatus: result.status };
      } catch (error) { await this.attempts.fail(scope, lease, error); throw error; }
      finally { clearInterval(timer); await renewal; await this.attempts.release(scope, lease); }
    });
  }
}

function summary(row: NonNullable<Awaited<ReturnType<DocumentTranslationAttemptRepository['latest']>>>) {
  const task = parseDocumentTranslationTaskEnvelope(row.taskEnvelopeJson ?? '');
  return { status: row.status, documentVersionId: row.documentVersionId, parseRunId: row.producerRunId,
    attemptRef: row.operationRef, workspaceId: task.workspaceId, errorCode: row.errorCode, deadline: row.deadlineAt?.toISOString() ?? null };
}

function isPermissionRejection(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const value = current as { code?: unknown; cause?: unknown };
    if (value.code === '42501') return true;
    current = value.cause;
  }
  return false;
}
