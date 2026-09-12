import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { actionAttempt } from '@server/database/schema';
import { canonicalJson, canonicalSha256 } from './action-attempt-envelope';
import { parseDocumentTranslationTaskEnvelope, type DocumentTranslationTaskEnvelope } from './document-translation-task-envelope';

export interface DocumentTranslationScope { tenantId: string; actorUserId: string; documentVersionId: string }
export interface DocumentTranslationFence { attemptRef: string; principalId: string; leaseToken: string; leaseGeneration: number }

/** A document branch of the existing ActionAttempt queue, under fresh actor scope. */
@Injectable()
// Registered by CanonicalHostModule.forRoot during integration.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentTranslationAttemptRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async latest(scope: DocumentTranslationScope) {
    const [row] = await this.db.select().from(actionAttempt).where(owned(scope)).orderBy(desc(actionAttempt.attemptNo)).limit(1);
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

  async reserve(scope: DocumentTranslationScope, task: DocumentTranslationTaskEnvelope, requestId: string) {
    const parsed = parseDocumentTranslationTaskEnvelope(canonicalJson(task));
    if (parsed.tenantId !== scope.tenantId || parsed.documentVersionId !== scope.documentVersionId ||
        !requestId || requestId.length > 96) throw new Error('DOCUMENT_TRANSLATION_RESERVATION_SCOPE_INVALID');
    return this.db.transaction(async tx => {
      // Serialize reservations by real document; no WorkItem is involved.
      const locked = await tx.execute(sql`SELECT document_version_id FROM dm_document_version
        WHERE document_version_id=${scope.documentVersionId} FOR UPDATE`);
      if (!locked.length) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
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
        inputRevision: parsed.parseRevision, taskEnvelopeJson: canonicalJson(parsed), taskInputHash: parsed.inputHash,
        idempotencyKey: parsed.idempotencyKey, deadlineAt: new Date(parsed.deadline),
        packageArtifactRef: parsed.modelInput.source.parsedArtifact.ref,
        packageArtifactSha256: parsed.modelInput.source.parsedArtifact.sha256,
      }).returning();
      return row;
    });
  }

  async claim(scope: DocumentTranslationScope, attemptRef: string, principalId: string): Promise<DocumentTranslationFence | null> {
    if (!/^[A-Za-z0-9:_-]{1,160}$/.test(principalId)) throw new Error('DOCUMENT_TRANSLATION_PRINCIPAL_INVALID');
    const now = new Date();
    const [row] = await this.db.update(actionAttempt).set({ status: 'RUNNING', leaseOwner: principalId,
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

  async release(scope: DocumentTranslationScope, fence: DocumentTranslationFence): Promise<void> {
    await this.db.update(actionAttempt).set({ leaseOwner: null, leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(and(owned(scope), fenced(fence)));
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

  async fail(scope: DocumentTranslationScope, fence: DocumentTranslationFence, error: unknown): Promise<void> {
    const candidate = error instanceof Error ? error.message : '';
    const code = /^[A-Z][A-Z0-9_]{1,159}$/.test(candidate) ? candidate : 'DOCUMENT_TRANSLATION_STEP_FAILED';
    const now = new Date();
    await this.db.update(actionAttempt).set({ status: 'FAILED', errorCode: code, terminalReason: code,
      completedAt: now, updatedAt: now }).where(and(owned(scope), fenced(fence), active(now), gt(actionAttempt.leaseExpiresAt, now)));
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
