import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DocumentTranslationAttemptRepository, type DocumentTranslationScope } from '../action-attempt/document-translation-attempt.repository';
import { parseDocumentTranslationTaskEnvelope, sealDocumentTranslationTaskEnvelope } from '../action-attempt/document-translation-task-envelope';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { CanonicalTranslationV2PluginService } from './canonical-translation-v2-plugin.service';
import { CANONICAL_SERVICE_SCOPE_AUTHORIZATION, canonicalServiceScopeUnavailable,
  type CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';

@Injectable()
// Registered by CanonicalHostModule.forRoot.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentTranslationRuntimeService {
  constructor(@Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION) private readonly authorization: CanonicalServiceScopeAuthorizationPort,
    private readonly actors: EngineeringMatterWorkingRepository, private readonly reader: UnifiedReaderService,
    private readonly plugins: CanonicalTranslationV2PluginService, private readonly attempts: DocumentTranslationAttemptRepository) {}

  async run(input: { action: 'START' | 'STATUS' | 'STEP' | 'CANCEL'; documentVersionId: string;
    parseRunId: string; requestId?: string; attemptRef?: string }) {
    if (!this.authorization.authorizeDocumentWork) throw canonicalServiceScopeUnavailable();
    const auth = await this.authorization.authorizeDocumentWork({ documentVersionId: input.documentVersionId });
    const scope: DocumentTranslationScope = { tenantId: auth.tenantId, actorUserId: auth.actorUserId, documentVersionId: auth.documentVersionId };
    return this.actors.withActorScope(scope.actorUserId, async () => {
      const read = () => this.reader.readDocumentOriginal(scope.documentVersionId, input.parseRunId, { ...scope, roles: [] });
      const original = await read();
      const assertAuthorized = async () => { await read(); };
      if (input.action === 'START') {
        if (!input.requestId) throw new Error('DOCUMENT_TRANSLATION_REQUEST_REQUIRED');
        await this.attempts.expire(scope);
        const prior = await this.attempts.readRequest(scope, input.requestId);
        if (prior) {
          if (prior.producerRunId !== input.parseRunId) throw new Error('DOCUMENT_TRANSLATION_REQUEST_CONFLICT');
          return summary(prior);
        }
        const artifact = original.run.manifestArtifact;
        if (!artifact || artifact.relativePath !== 'original/manifest.json' || artifact.readback !== 'VERIFIED')
          throw new Error('DOCUMENT_ORIGINAL_MANIFEST_REQUIRED');
        const workspace = await this.plugins.prepareOriginal({ tenantId: scope.tenantId, original: original.original,
          artifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: `document-original://${encodeURIComponent(scope.documentVersionId)}/${encodeURIComponent(input.parseRunId)}`,
            sha256: artifact.sha256, byteLength: artifact.byteLength, mediaType: 'application/json' }, assertAuthorized });
        const modelInput = this.plugins.taskInput(workspace);
        const task = sealDocumentTranslationTaskEnvelope({ schemaVersion: 'wiselink.document.translation_task.v1',
          actionAttemptId: `DTA-${randomUUID()}`, operationRef: `DTQ-${randomUUID()}`, tenantId: scope.tenantId,
          documentVersionId: scope.documentVersionId, parseRunId: input.parseRunId,
          parseRevision: original.original.binding.parseRevision, workspaceId: workspace.workspaceId,
          modelInput: { ...modelInput, schemaVersion: 'wiselink.3_1.translation_task.v2',
            source: { ...modelInput.source, originalBinding: original.original.binding } },
          deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
          idempotencyKey: `document-translation:${scope.documentVersionId}:${input.requestId}` });
        try {
          return summary(await this.attempts.reserve(scope, task, input.requestId));
        } catch (error) {
          // A confirmed DB permission rejection is distinct from an unknown
          // reservation outcome. Never expose Drizzle SQL/parameters to callers.
          if (isPermissionRejection(error)) throw new Error('DOCUMENT_TRANSLATION_ADMISSION_DENIED');
          throw error;
        }
      }
      if (input.action === 'STEP') await this.attempts.expire(scope);
      const row = await this.attempts.latest(scope);
      if (!row) return { status: 'IDLE', documentVersionId: scope.documentVersionId };
      if (row.producerRunId !== input.parseRunId) {
        if (input.action === 'STATUS') return { status: 'IDLE', documentVersionId: scope.documentVersionId,
          parseRunId: input.parseRunId, previousAttempt: summary(row) };
        throw new Error('DOCUMENT_TRANSLATION_SOURCE_CHANGED');
      }
      if (input.action === 'STATUS') return summary(row);
      if (!input.attemptRef || row.operationRef !== input.attemptRef) throw new Error('DOCUMENT_TRANSLATION_ATTEMPT_NOT_FOUND');
      if (input.action === 'CANCEL') { await this.attempts.cancel(scope, input.attemptRef); return summary((await this.attempts.latest(scope))!); }
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
        const result = await this.plugins.executeStep({ fence: { ...lease, tenantId: scope.tenantId, workItemId: null,
          documentVersionId: scope.documentVersionId, workspaceId: task.workspaceId },
          requestId: `step:${row.attemptId}:${lease.leaseGeneration}`, assertAuthorized });
        if (renewalFailed) throw new Error('DOCUMENT_TRANSLATION_RENEWAL_FAILED');
        if (result.status === 'DONE' || result.status === 'REMAINING_LIMITATIONS') {
          await assertAuthorized();
          await this.attempts.finish(scope, lease, { workspaceId: task.workspaceId, status: result.status, artifact: result.result });
        } else if (result.status === 'NEEDS_RECOVERY') throw new Error('DOCUMENT_TRANSLATION_NEEDS_RECOVERY');
        return { ...summary((await this.attempts.latest(scope))!), stepStatus: result.status };
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
