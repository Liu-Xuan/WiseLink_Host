import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { actionAttempt, translationBlockRevision, translationWorkspace } from '../../database/schema';
import type { CanonicalExecutionModelSelection } from '@shared/api.interface';
import { canonicalJson, canonicalSha256 } from './action-attempt-envelope';
import { parseDocumentTranslationTaskEnvelope, type DocumentTranslationTaskEnvelope } from './document-translation-task-envelope';
import { parseExecutionModel } from '../model-settings/canonical-execution-model';

export interface DocumentTranslationScope { tenantId: string; actorUserId: string; documentVersionId: string }
export interface DocumentTranslationFence { attemptRef: string; principalId: string; leaseToken: string; leaseGeneration: number }

/** A document branch of the existing ActionAttempt queue, under fresh actor scope. */
@Injectable()
// Registered by CanonicalHostModule.forRoot during integration.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentTranslationAttemptRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async latest(scope: DocumentTranslationScope, requestId?: string) {
    const [row] = await this.db.select().from(actionAttempt).where(and(owned(scope),
      requestId ? inArray(actionAttempt.triggerRequestId,
        [requestId, `${requestId}:hosted-m3`, `${requestId}:partial-repair`]) : undefined))
      .orderBy(desc(actionAttempt.attemptNo)).limit(1);
    return row ?? null;
  }

  async readRequest(scope: DocumentTranslationScope, requestId: string) {
    const [row] = await this.db.select().from(actionAttempt).where(and(owned(scope), eq(actionAttempt.triggerRequestId, requestId))).limit(1);
    return row ?? null;
  }

  async expire(scope: DocumentTranslationScope): Promise<void> {
    const now = new Date();
    await this.db.update(actionAttempt).set({ status: 'FAILED', errorCode: 'DOCUMENT_TRANSLATION_DEADLINE_EXPIRED',
      terminalReason: 'DOCUMENT_TRANSLATION_DEADLINE_EXPIRED', completedAt: now, updatedAt: now })
      .where(and(owned(scope), inArray(actionAttempt.status, ['QUEUED','RUNNING','RETRY_SCHEDULED']), lte(actionAttempt.deadlineAt, now)));
  }

  async reserve(scope: DocumentTranslationScope, task: DocumentTranslationTaskEnvelope, requestId: string,
    executionModel: CanonicalExecutionModelSelection | null = null, predecessorRef?: string,
    successorKind: 'QUOTA' | 'PARTIAL' = 'QUOTA') {
    const parsed = parseDocumentTranslationTaskEnvelope(canonicalJson(task));
    if (parsed.modelInput.documentProducer === 'HOSTED_M3') {
      if (!executionModel || parseExecutionModel(executionModel).modelRef !== 'm3probe/minimax-m3')
        throw new Error('DOCUMENT_TRANSLATION_HOSTED_MODEL_INVALID');
    } else if (executionModel) throw new Error('DOCUMENT_TRANSLATION_OFFICIAL_MODEL_INVALID');
    if (parsed.tenantId !== scope.tenantId || parsed.documentVersionId !== scope.documentVersionId ||
        !requestId || requestId.length > 96) throw new Error('DOCUMENT_TRANSLATION_RESERVATION_SCOPE_INVALID');
    return this.db.transaction(async tx => {
      // Serialize reservations by real document; no WorkItem is involved.
      const locked = await tx.execute(sql`SELECT document_version_id FROM dm_document_version
        WHERE document_version_id=${scope.documentVersionId} FOR UPDATE`);
      if (!locked.length) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
      if (predecessorRef) {
        const [prior] = await tx.select().from(actionAttempt).where(and(owned(scope),
          eq(actionAttempt.operationRef, predecessorRef))).limit(1).for('update');
        if (!prior || prior.triggerRequestId === null || prior.producerRunId !== parsed.parseRunId)
          throw new Error('DOCUMENT_TRANSLATION_RECOVERY_INELIGIBLE');
        const priorTask = parseDocumentTranslationTaskEnvelope(prior.taskEnvelopeJson ?? '');
        if (successorKind === 'PARTIAL') {
          const rootRequestId = prior.triggerRequestId.endsWith(':hosted-m3')
            ? prior.triggerRequestId.slice(0, -':hosted-m3'.length) : prior.triggerRequestId;
          if (requestId !== `${rootRequestId}:partial-repair` ||
              prior.triggerRequestId.endsWith(':partial-repair') || prior.status !== 'SUCCEEDED' ||
              prior.terminalReason !== 'REMAINING_LIMITATIONS' || !prior.resultEnvelopeJson ||
              priorTask.workspaceId !== parsed.workspaceId ||
              priorTask.parseRevision !== parsed.parseRevision ||
              canonicalJson(priorTask.modelInput.source) !== canonicalJson(parsed.modelInput.source) ||
              priorTask.modelInput.planRevision !== parsed.modelInput.planRevision ||
              priorTask.modelInput.contextRevision !== parsed.modelInput.contextRevision ||
              priorTask.modelInput.methodVersion !== parsed.modelInput.methodVersion)
            throw new Error('DOCUMENT_TRANSLATION_PARTIAL_SUCCESSOR_INELIGIBLE');
          const result = JSON.parse(prior.resultEnvelopeJson) as { status?: string; artifact?: { completeness?: string } };
          if (result.status !== 'REMAINING_LIMITATIONS' || result.artifact?.completeness !== 'PARTIAL')
            throw new Error('DOCUMENT_TRANSLATION_PARTIAL_SUCCESSOR_INELIGIBLE');
          // A lost CONTINUE_PARTIAL receipt must read back the fixed successor
          // even after its first repair has changed the workspace state.
          const [existing] = await tx.select().from(actionAttempt).where(and(owned(scope),
            eq(actionAttempt.idempotencyKey, parsed.idempotencyKey))).limit(1);
          if (existing) {
            const savedTask = parseDocumentTranslationTaskEnvelope(existing.taskEnvelopeJson ?? '');
            if (existing.triggerRequestId !== requestId || existing.producerRunId !== parsed.parseRunId ||
                savedTask.parseRevision !== parsed.parseRevision || savedTask.workspaceId !== parsed.workspaceId ||
                canonicalJson(savedTask.modelInput) !== canonicalJson(parsed.modelInput))
              throw new Error('DOCUMENT_TRANSLATION_REQUEST_CONFLICT');
            return existing;
          }
          const [workspace] = await tx.select({ result: translationWorkspace.resultArtifactJson })
            .from(translationWorkspace).where(and(eq(translationWorkspace.tenantId, scope.tenantId),
              eq(translationWorkspace.documentVersionId, scope.documentVersionId),
              eq(translationWorkspace.workspaceId, priorTask.workspaceId))).limit(1).for('update');
          if (!workspace?.result) throw new Error('DOCUMENT_TRANSLATION_PARTIAL_SUCCESSOR_INELIGIBLE');
          const [repairable] = await tx.execute<{ repairable: boolean }>(sql`SELECT EXISTS (
            SELECT 1 FROM ${translationBlockRevision} r
            WHERE r.tenant_id=${scope.tenantId} AND r.workspace_id=${priorTask.workspaceId}
              AND r.selected_for_reading=false AND r.check_json IS NOT NULL
              AND r.content_revision=(SELECT max(newer.content_revision) FROM ${translationBlockRevision} newer
                WHERE newer.tenant_id=r.tenant_id AND newer.workspace_id=r.workspace_id AND newer.block_id=r.block_id)
              AND jsonb_path_exists(r.check_json::jsonb,
                '$.issues[*] ? (@.severity == "BLOCK" && @.origin != "SOURCE")')
              AND NOT jsonb_path_exists(r.check_json::jsonb,
                '$.issues[*] ? (@.severity == "BLOCK" && @.origin == "SOURCE")')
          ) AS repairable`);
          if (!repairable?.repairable) throw new Error('DOCUMENT_TRANSLATION_PARTIAL_SUCCESSOR_INELIGIBLE');
        } else {
          if (requestId !== `${prior.triggerRequestId}:hosted-m3` ||
              prior.status !== 'FAILED' || prior.errorCode !== 'DOCUMENT_PLUGIN_QUOTA_EXHAUSTED' ||
              prior.startedAt !== null || prior.projectionApplied || prior.resultEnvelopeJson !== null ||
              priorTask.modelInput.documentProducer !== 'OFFICIAL_PLUGIN')
            throw new Error('DOCUMENT_TRANSLATION_RECOVERY_INELIGIBLE');
          const [saved] = await tx.select({ id: translationBlockRevision.blockRevisionId })
            .from(translationBlockRevision).where(and(eq(translationBlockRevision.tenantId, scope.tenantId),
              eq(translationBlockRevision.originAttemptId, prior.attemptId))).limit(1);
          const [workspace] = await tx.select({ result: translationWorkspace.resultArtifactJson })
            .from(translationWorkspace).where(and(eq(translationWorkspace.tenantId, scope.tenantId),
              eq(translationWorkspace.workspaceId, priorTask.workspaceId))).limit(1);
          if (saved || workspace?.result !== null) throw new Error('DOCUMENT_TRANSLATION_RECOVERY_HAS_OUTPUT');
        }
      }
      const current = await tx.execute<{ parseRunId: string; parseRevision: number; sha256: string; byteLength: number }>(sql`
        SELECT parse_run_id AS "parseRunId",parse_revision AS "parseRevision",
          manifest_artifact->>'sha256' AS sha256,(manifest_artifact->>'byteLength')::bigint AS "byteLength"
        FROM dm_document_parse_run WHERE tenant_id=${scope.tenantId} AND document_version_id=${scope.documentVersionId}
          AND status='PUBLISHED' ORDER BY parse_revision DESC LIMIT 1 FOR SHARE`);
      if (current[0]?.parseRunId !== parsed.parseRunId || current[0].parseRevision !== parsed.parseRevision ||
          current[0].sha256 !== parsed.modelInput.source.parsedArtifact.sha256 ||
          Number(current[0].byteLength) !== parsed.modelInput.source.parsedArtifact.byteLength)
        throw new Error('DOCUMENT_TRANSLATION_RESERVATION_SOURCE_CHANGED');
      const [existing] = await tx.select().from(actionAttempt).where(and(owned(scope), eq(actionAttempt.idempotencyKey, parsed.idempotencyKey))).limit(1);
      if (existing) {
        const prior = parseDocumentTranslationTaskEnvelope(existing.taskEnvelopeJson ?? '');
        if (prior.parseRunId !== parsed.parseRunId || prior.parseRevision !== parsed.parseRevision ||
            canonicalJson(prior.modelInput) !== canonicalJson(parsed.modelInput)) throw new Error('DOCUMENT_TRANSLATION_REQUEST_CONFLICT');
        return existing;
      }
      const [latest] = await tx.select().from(actionAttempt).where(and(eq(actionAttempt.tenantId, scope.tenantId),
        eq(actionAttempt.documentVersionId, scope.documentVersionId), eq(actionAttempt.subjectKind, 'DOCUMENT_VERSION')))
        .orderBy(desc(actionAttempt.attemptNo)).limit(1);
      if (latest && ['QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING'].includes(latest.status)) {
        if (latest.producerRunId === parsed.parseRunId || (latest.inputRevision ?? Infinity) >= parsed.parseRevision)
          throw new Error('DOCUMENT_TRANSLATION_ALREADY_ACTIVE');
        // Publishing a newer original supersedes the old computation, not its
        // saved reading. Cancellation and successor reservation commit together.
        await tx.update(actionAttempt).set({ status: 'CANCELLED', cancelRequestedAt: new Date(),
          terminalReason: 'DOCUMENT_ORIGINAL_SUPERSEDED', completedAt: new Date(), updatedAt: new Date() })
          .where(and(owned(scope), eq(actionAttempt.attemptId, latest.attemptId)));
      }
      const [row] = await tx.insert(actionAttempt).values({ attemptId: parsed.actionAttemptId, operationRef: parsed.operationRef,
        subjectKind: 'DOCUMENT_VERSION', workItemId: null, documentVersionId: scope.documentVersionId,
        tenantId: scope.tenantId, actorUserId: scope.actorUserId, producerRunId: parsed.parseRunId,
        actionType: 'DOCUMENT_TRANSLATE', attemptNo: (latest?.attemptNo ?? 0) + 1,
        triggerRequestId: requestId, requestOrigin: 'HOST_DOCUMENT', status: 'QUEUED',
        leaseGeneration: 0, claimCount: 0, retryCount: 0, maxAttempts: 3,
        inputRevision: parsed.parseRevision, taskEnvelopeJson: canonicalJson(parsed), taskInputHash: parsed.inputHash,
        executionModelJson: executionModel ? canonicalJson(executionModel) : null,
        idempotencyKey: parsed.idempotencyKey, deadlineAt: new Date(parsed.deadline),
        packageArtifactRef: parsed.modelInput.source.parsedArtifact.ref,
        packageArtifactSha256: parsed.modelInput.source.parsedArtifact.sha256,
      }).returning();
      return row;
    });
  }

  async assertQuotaSuccessor(scope: DocumentTranslationScope, requestId: string, attemptRef: string, parseRunId: string) {
    const prior = await this.readRequest(scope, requestId);
    if (!prior || prior.operationRef !== attemptRef || prior.producerRunId !== parseRunId ||
        prior.status !== 'FAILED' || prior.errorCode !== 'DOCUMENT_PLUGIN_QUOTA_EXHAUSTED' ||
        prior.startedAt !== null || prior.projectionApplied ||
        parseDocumentTranslationTaskEnvelope(prior.taskEnvelopeJson ?? '').modelInput.documentProducer !== 'OFFICIAL_PLUGIN')
      throw new Error('DOCUMENT_TRANSLATION_RECOVERY_INELIGIBLE');
  }

  async claim(scope: DocumentTranslationScope, attemptRef: string, principalId: string): Promise<DocumentTranslationFence | null> {
    if (!/^[A-Za-z0-9:_-]{1,160}$/.test(principalId)) throw new Error('DOCUMENT_TRANSLATION_PRINCIPAL_INVALID');
    const now = new Date();
    const [row] = await this.db.update(actionAttempt).set({ status: 'RUNNING', startedAt: now, leaseOwner: principalId,
      leaseToken: randomUUID(), leaseGeneration: sql`${actionAttempt.leaseGeneration} + 1`,
      leaseExpiresAt: sql`LEAST(${actionAttempt.deadlineAt}, now()+interval '120 seconds')`,
      claimCount: sql`${actionAttempt.claimCount} + 1`, lastHeartbeatAt: now, updatedAt: now,
    }).where(and(owned(scope), eq(actionAttempt.operationRef, attemptRef), active(now),
      or(isNull(actionAttempt.leaseExpiresAt), lte(actionAttempt.leaseExpiresAt, now)))).returning();
    return row ? { attemptRef, principalId, leaseToken: row.leaseToken!, leaseGeneration: row.leaseGeneration } : null;
  }

  async renew(scope: DocumentTranslationScope, fence: DocumentTranslationFence): Promise<boolean> {
    const now = new Date();
    const rows = await this.db.update(actionAttempt).set({ lastHeartbeatAt: now,
      leaseExpiresAt: sql`LEAST(${actionAttempt.deadlineAt}, now()+interval '120 seconds')`, updatedAt: now })
      .where(and(owned(scope), fenced(fence), active(now), gt(actionAttempt.leaseExpiresAt, now))).returning({ id: actionAttempt.attemptId });
    return rows.length === 1;
  }

  async release(scope: DocumentTranslationScope, fence: DocumentTranslationFence): Promise<boolean> {
    const rows = await this.db.update(actionAttempt).set({ leaseOwner: null, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(and(owned(scope), fenced(fence))).returning({ id: actionAttempt.attemptId });
    return rows.length === 1;
  }

  async cancel(scope: DocumentTranslationScope, attemptRef: string): Promise<void> {
    const now = new Date();
    await this.db.update(actionAttempt).set({ status: 'CANCELLED', cancelRequestedAt: now,
      terminalReason: 'DOCUMENT_TRANSLATION_CANCELLED', completedAt: now, updatedAt: now })
      .where(and(owned(scope), eq(actionAttempt.operationRef, attemptRef), inArray(actionAttempt.status, ['QUEUED','RUNNING','RETRY_SCHEDULED'])));
  }

  async finish(scope: DocumentTranslationScope, fence: DocumentTranslationFence, result: {
    workspaceId: string; status: 'DONE' | 'REMAINING_LIMITATIONS'; artifact: unknown;
  }): Promise<void> {
    const now = new Date();
    const body = { schemaVersion: 'wiselink.document.translation_result.v1', ...result };
    const rows = await this.db.update(actionAttempt).set({ status: 'SUCCEEDED', completedAt: now, updatedAt: now,
      terminalReason: result.status, resultEnvelopeJson: canonicalJson(body), resultContentHash: canonicalSha256(body),
    }).where(and(owned(scope), fenced(fence), active(now), gt(actionAttempt.leaseExpiresAt, now))).returning({ id: actionAttempt.attemptId });
    if (rows.length !== 1) throw new Error('DOCUMENT_TRANSLATION_FINISH_FENCE_REJECTED');
  }

  async fail(scope: DocumentTranslationScope, fence: DocumentTranslationFence, error: unknown): Promise<boolean> {
    const candidate = error instanceof Error ? error.message : '';
    const code = /^[A-Z][A-Z0-9_]{1,159}$/.test(candidate) ? candidate : 'DOCUMENT_TRANSLATION_STEP_FAILED';
    const now = new Date();
    const rows = await this.db.update(actionAttempt).set({ status: 'FAILED', errorCode: code, terminalReason: code,
      completedAt: now, updatedAt: now }).where(and(owned(scope), fenced(fence), active(now), gt(actionAttempt.leaseExpiresAt, now)))
      .returning({ id: actionAttempt.attemptId });
    return rows.length === 1;
  }
}

function owned(scope: DocumentTranslationScope) {
  return and(eq(actionAttempt.tenantId, scope.tenantId), eq(actionAttempt.actorUserId, scope.actorUserId),
    eq(actionAttempt.documentVersionId, scope.documentVersionId), eq(actionAttempt.subjectKind, 'DOCUMENT_VERSION'),
    eq(actionAttempt.actionType, 'DOCUMENT_TRANSLATE'));
}
function active(now: Date) {
  return and(inArray(actionAttempt.status, ['QUEUED','RUNNING','RETRY_SCHEDULED']),
    isNull(actionAttempt.cancelRequestedAt), gt(actionAttempt.deadlineAt, now));
}
function fenced(fence: DocumentTranslationFence) {
  return and(eq(actionAttempt.operationRef, fence.attemptRef), eq(actionAttempt.leaseOwner, fence.principalId),
    eq(actionAttempt.leaseToken, fence.leaseToken), eq(actionAttempt.leaseGeneration, fence.leaseGeneration));
}
