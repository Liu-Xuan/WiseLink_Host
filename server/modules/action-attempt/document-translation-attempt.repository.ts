import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { actionAttempt, translationBlockRevision, translationWorkspace } from '../../database/schema';
import type { CanonicalExecutionModelSelection } from '@shared/api.interface';
import { canonicalJson, canonicalSha256 } from './action-attempt-envelope';
import { parseDocumentTranslationTaskEnvelope, sealDocumentTranslationTaskEnvelope,
  type DocumentTranslationTaskEnvelope } from './document-translation-task-envelope';
import { parseExecutionModel } from '../model-settings/canonical-execution-model';
import { readTranslationWorkspaceSnapshot } from '../canonical-host/canonical-translation-workspace.repository';
import { buildTranslationWorkspaceReadingV2 } from '../canonical-host/canonical-translation-v2-quality';
import { documentTranslationRepairableBlockIds } from '../canonical-host/document-translation-repair-scope';
import { translationGenerationSchemaV2, translationManifestSchemaV2,
  translationSourcePlanSchemaV2 } from '../canonical-host/canonical-translation-v2.contract';
import { z } from 'zod/v4';

const partialResult = z.object({ status: z.literal('REMAINING_LIMITATIONS'), artifact: z.object({
  completeness: z.literal('PARTIAL'), manifest: translationManifestSchemaV2,
}) });

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
        [requestId, `${requestId}:hosted-m3`, `${requestId}:partial-repair`,
          `${requestId}:partial-repair-v2`, `${requestId}:known-failure`]) : undefined))
      .orderBy(desc(actionAttempt.attemptNo)).limit(1);
    return row ?? null;
  }

  async readRequest(scope: DocumentTranslationScope, requestId: string) {
    const [row] = await this.db.select().from(actionAttempt).where(and(owned(scope), eq(actionAttempt.triggerRequestId, requestId))).limit(1);
    return row ?? null;
  }

  /** One explicit, zero-output successor for an exact known generation failure. */
  async recoverKnownFailure(scope: DocumentTranslationScope, predecessorRef: string, rootRequestId: string,
    current: Pick<DocumentTranslationTaskEnvelope, 'parseRunId' | 'parseRevision' | 'modelInput'>,
    executionModel: CanonicalExecutionModelSelection) {
    return this.db.transaction(async tx => {
      const locked = await tx.execute(sql`SELECT document_version_id FROM dm_document_version
        WHERE document_version_id=${scope.documentVersionId} FOR UPDATE`);
      if (!locked.length) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
      const [predecessor] = await tx.select().from(actionAttempt)
        .where(and(owned(scope), eq(actionAttempt.operationRef, predecessorRef))).limit(1).for('update');
      if (!predecessor) throw new Error('DOCUMENT_TRANSLATION_PREDECESSOR_NOT_FOUND');
      const priorTask = parseDocumentTranslationTaskEnvelope(predecessor.taskEnvelopeJson ?? '');
      const currentModel = parseExecutionModel(executionModel);
      const priorModel = predecessor.executionModelJson
        ? parseExecutionModel(JSON.parse(predecessor.executionModelJson)) : null;
      if (predecessor.status !== 'FAILED' || !predecessor.errorCode || !predecessor.terminalReason ||
          predecessor.triggerRequestId !== rootRequestId || predecessor.resultEnvelopeJson !== null ||
          predecessor.resultContentHash !== null || predecessor.projectionApplied ||
          predecessor.commitStartedAt !== null || priorTask.recoveryOf || priorTask.knownFailureRecovery ||
          priorTask.modelInput.retranslateBlockIds || priorTask.modelInput.documentProducer !== 'HOSTED_M3' ||
          predecessor.attemptId !== priorTask.actionAttemptId || predecessor.operationRef !== priorTask.operationRef ||
          predecessor.taskInputHash !== priorTask.inputHash || predecessor.producerRunId !== current.parseRunId ||
          predecessor.inputRevision !== current.parseRevision || priorTask.parseRunId !== current.parseRunId ||
          priorTask.parseRevision !== current.parseRevision ||
          canonicalJson(priorTask.modelInput) !== canonicalJson(current.modelInput) ||
          !priorModel || priorModel.modelRef !== currentModel.modelRef ||
          priorModel.providerKind !== currentModel.providerKind ||
          priorModel.settingsRevision !== currentModel.settingsRevision ||
          (predecessor.leaseOwner !== null && predecessor.leaseExpiresAt !== null &&
            predecessor.leaseExpiresAt > new Date()))
        throw new Error('DOCUMENT_TRANSLATION_RECOVERY_PREDECESSOR_INVALID');
      const [published] = await tx.execute<{ parseRunId: string; parseRevision: number; sha256: string; byteLength: number }>(sql`
        SELECT parse_run_id AS "parseRunId", parse_revision AS "parseRevision",
          manifest_artifact->>'sha256' AS sha256, (manifest_artifact->>'byteLength')::bigint AS "byteLength"
        FROM dm_document_parse_run WHERE tenant_id=${scope.tenantId} AND document_version_id=${scope.documentVersionId}
          AND status='PUBLISHED' ORDER BY parse_revision DESC LIMIT 1 FOR SHARE`);
      if (published?.parseRunId !== current.parseRunId || published.parseRevision !== current.parseRevision ||
          published.sha256 !== priorTask.modelInput.source.parsedArtifact.sha256 ||
          Number(published.byteLength) !== priorTask.modelInput.source.parsedArtifact.byteLength)
        throw new Error('DOCUMENT_TRANSLATION_RECOVERY_SOURCE_CHANGED');
      const [workspaceRow] = await tx.select().from(translationWorkspace)
        .where(and(eq(translationWorkspace.tenantId, scope.tenantId),
          eq(translationWorkspace.workspaceId, priorTask.workspaceId))).limit(1).for('update');
      if (!workspaceRow || workspaceRow.workItemId !== null || workspaceRow.subjectKind !== 'DOCUMENT_VERSION' ||
          workspaceRow.documentVersionId !== scope.documentVersionId ||
          workspaceRow.packageId !== current.parseRunId || workspaceRow.targetLocale !== 'zh-CN' ||
          workspaceRow.parsedArtifactRef !== priorTask.modelInput.source.parsedArtifact.ref ||
          workspaceRow.parsedArtifactSha256 !== priorTask.modelInput.source.parsedArtifact.sha256 ||
          workspaceRow.methodVersion !== priorTask.modelInput.methodVersion ||
          workspaceRow.planRevision !== priorTask.modelInput.planRevision ||
          workspaceRow.contextRevision !== priorTask.modelInput.contextRevision)
        throw new Error('DOCUMENT_TRANSLATION_RECOVERY_WORKSPACE_CHANGED');
      const plan = translationSourcePlanSchemaV2.parse(JSON.parse(workspaceRow.sourcePlanJson));
      if (canonicalJson(plan.source) !== canonicalJson(priorTask.modelInput.source))
        throw new Error('DOCUMENT_TRANSLATION_RECOVERY_PLAN_CHANGED');
      const idempotencyKey = `document-translation:known-failure:${predecessor.attemptId}`;
      const requestId = `${rootRequestId}:known-failure`;
      const [existing] = await tx.select().from(actionAttempt).where(and(owned(scope),
        eq(actionAttempt.idempotencyKey, idempotencyKey))).limit(1);
      const [latest] = await tx.select().from(actionAttempt).where(and(eq(actionAttempt.tenantId, scope.tenantId),
        eq(actionAttempt.documentVersionId, scope.documentVersionId), eq(actionAttempt.subjectKind, 'DOCUMENT_VERSION'),
        eq(actionAttempt.actionType, 'DOCUMENT_TRANSLATE'))).orderBy(desc(actionAttempt.attemptNo)).limit(1);
      if (existing) {
        const task = parseDocumentTranslationTaskEnvelope(existing.taskEnvelopeJson ?? '');
        if (task.knownFailureRecovery?.predecessorAttemptId !== predecessor.attemptId ||
            task.knownFailureRecovery.predecessorAttemptRef !== predecessorRef ||
            task.actionAttemptId !== existing.attemptId || task.operationRef !== existing.operationRef ||
            existing.triggerRequestId !== requestId ||
            canonicalJson(task.modelInput) !== canonicalJson(current.modelInput) ||
            workspaceRow.activeAttemptId !== existing.attemptId || latest?.attemptId !== existing.attemptId)
          throw new Error('DOCUMENT_TRANSLATION_RECOVERY_REQUEST_CONFLICT');
        return existing;
      }
      if (workspaceRow.resultArtifactJson !== null || workspaceRow.resultManifestJson !== null)
        throw new Error('DOCUMENT_TRANSLATION_RECOVERY_HAS_OUTPUT');
      const generations = z.array(translationGenerationSchemaV2).parse(JSON.parse(workspaceRow.generationRequestsJson));
      const predecessorGenerations = generations.filter(item => item.attemptId === predecessor.attemptId);
      if (!predecessorGenerations.length || predecessorGenerations.some(item =>
          item.status !== 'FAILED' || item.error?.outcome !== 'KNOWN_FAILURE') ||
          generations.some(item => item.status === 'REGISTERED' || item.error?.outcome === 'GENERATION_UNKNOWN'))
        throw new Error('DOCUMENT_TRANSLATION_RECOVERY_GENERATION_UNSETTLED');
      const generationRefs = predecessorGenerations.map(item => item.generationRequestRef);
      const [saved] = await tx.select({ id: translationBlockRevision.blockRevisionId }).from(translationBlockRevision)
        .where(and(eq(translationBlockRevision.tenantId, scope.tenantId),
          eq(translationBlockRevision.workspaceId, workspaceRow.workspaceId),
          or(eq(translationBlockRevision.originAttemptId, predecessor.attemptId),
            inArray(translationBlockRevision.generationRequestRef, generationRefs)))).limit(1);
      if (saved) throw new Error('DOCUMENT_TRANSLATION_RECOVERY_SAVED_OUTPUT');
      const [activeOther] = await tx.select({ id: actionAttempt.attemptId }).from(actionAttempt)
        .where(and(eq(actionAttempt.tenantId, scope.tenantId),
          eq(actionAttempt.documentVersionId, scope.documentVersionId),
          eq(actionAttempt.subjectKind, 'DOCUMENT_VERSION'),
          eq(actionAttempt.actionType, 'DOCUMENT_TRANSLATE'),
          inArray(actionAttempt.status, ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'])))
        .limit(1);
      if (activeOther) throw new Error('DOCUMENT_TRANSLATION_RECOVERY_COORDINATOR_CHANGED');
      if (latest?.attemptId !== predecessor.attemptId || workspaceRow.activeAttemptId !== predecessor.attemptId)
        throw new Error('DOCUMENT_TRANSLATION_RECOVERY_COORDINATOR_CHANGED');
      const identity = canonicalSha256({ kind: 'DOCUMENT_TRANSLATION_KNOWN_FAILURE',
        predecessorAttemptId: predecessor.attemptId });
      const { inputHash: _priorHash, ...priorInput } = priorTask;
      const task = sealDocumentTranslationTaskEnvelope({ ...priorInput,
        actionAttemptId: `DTA-${identity.slice(0, 40)}`, operationRef: `DTQ-${identity.slice(0, 40)}`,
        deadline: new Date(Date.now() + 12 * 60 * 60_000).toISOString(), idempotencyKey,
        knownFailureRecovery: { kind: 'KNOWN_FAILURE', predecessorAttemptId: predecessor.attemptId,
          predecessorAttemptRef: predecessorRef } });
      const [successor] = await tx.insert(actionAttempt).values({ attemptId: task.actionAttemptId,
        operationRef: task.operationRef, subjectKind: 'DOCUMENT_VERSION', workItemId: null,
        documentVersionId: scope.documentVersionId, tenantId: scope.tenantId, actorUserId: scope.actorUserId,
        producerRunId: task.parseRunId, actionType: 'DOCUMENT_TRANSLATE', attemptNo: predecessor.attemptNo + 1,
        triggerRequestId: requestId, requestOrigin: 'HOST_DOCUMENT', status: 'QUEUED',
        leaseGeneration: 0, claimCount: 0, retryCount: 0, maxAttempts: 3,
        inputRevision: task.parseRevision, taskEnvelopeJson: canonicalJson(task), taskInputHash: task.inputHash,
        idempotencyKey, deadlineAt: new Date(task.deadline), executionModelJson: predecessor.executionModelJson,
        packageArtifactRef: task.modelInput.source.parsedArtifact.ref,
        packageArtifactSha256: task.modelInput.source.parsedArtifact.sha256 }).returning();
      await tx.update(translationWorkspace).set({ activeAttemptId: successor.attemptId,
        rowVersion: workspaceRow.rowVersion + 1, updatedAt: new Date() })
        .where(and(eq(translationWorkspace.tenantId, scope.tenantId),
          eq(translationWorkspace.workspaceId, workspaceRow.workspaceId)));
      return successor;
    });
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
          const snapshot = await readTranslationWorkspaceSnapshot(tx, {
            tenantId: scope.tenantId, workItemId: null,
            documentVersionId: scope.documentVersionId, workspaceId: priorTask.workspaceId,
          });
          const repairableBlockIds = documentTranslationRepairableBlockIds(
            buildTranslationWorkspaceReadingV2(snapshot.workspace, snapshot.revisions));
          if (!repairableBlockIds.length ||
              canonicalJson(repairableBlockIds) !== canonicalJson(parsed.modelInput.retranslateBlockIds ?? []))
            throw new Error('DOCUMENT_TRANSLATION_PARTIAL_SUCCESSOR_INELIGIBLE');
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

  /** Explicit compensation for a sealed partial successor with no repair scope or output. */
  async recoverPartialInput(scope: DocumentTranslationScope, task: DocumentTranslationTaskEnvelope,
    rootRequestId: string, predecessorRef: string, executionModel: CanonicalExecutionModelSelection) {
    const parsed = parseDocumentTranslationTaskEnvelope(canonicalJson(task));
    const model = parseExecutionModel(executionModel);
    const oldRequestId = `${rootRequestId}:partial-repair`;
    const requestId = `${rootRequestId}:partial-repair-v2`;
    if (model.modelRef !== 'm3probe/minimax-m3' ||
        parsed.tenantId !== scope.tenantId || parsed.documentVersionId !== scope.documentVersionId ||
        parsed.modelInput.documentProducer !== 'HOSTED_M3' ||
        parsed.idempotencyKey !== `document-translation:${scope.documentVersionId}:${requestId}` ||
        !parsed.modelInput.retranslateBlockIds?.length ||
        parsed.recoveryOf?.operationRef !== predecessorRef)
      throw new Error('DOCUMENT_TRANSLATION_PARTIAL_INPUT_RECOVERY_SCOPE_INVALID');
    return this.db.transaction(async tx => {
      const locked = await tx.execute(sql`SELECT document_version_id FROM dm_document_version
        WHERE document_version_id=${scope.documentVersionId} FOR UPDATE`);
      if (!locked.length) throw new Error('DOCUMENT_VERSION_NOT_FOUND');
      const [prior] = await tx.select().from(actionAttempt).where(and(owned(scope),
        eq(actionAttempt.operationRef, predecessorRef))).limit(1).for('update');
      if (!prior || prior.triggerRequestId !== oldRequestId ||
          prior.producerRunId !== parsed.parseRunId || prior.inputRevision !== parsed.parseRevision)
        throw new Error('DOCUMENT_TRANSLATION_PARTIAL_INPUT_RECOVERY_INELIGIBLE');
      const priorTask = parseDocumentTranslationTaskEnvelope(prior.taskEnvelopeJson ?? '');
      if (priorTask.modelInput.retranslateBlockIds ||
          priorTask.modelInput.documentProducer !== 'HOSTED_M3' ||
          parsed.recoveryOf?.inputHash !== priorTask.inputHash ||
          priorTask.workspaceId !== parsed.workspaceId ||
          canonicalJson(priorTask.modelInput.source) !== canonicalJson(parsed.modelInput.source) ||
          priorTask.modelInput.planRevision !== parsed.modelInput.planRevision ||
          priorTask.modelInput.contextRevision !== parsed.modelInput.contextRevision ||
          priorTask.modelInput.methodVersion !== parsed.modelInput.methodVersion)
        throw new Error('DOCUMENT_TRANSLATION_PARTIAL_INPUT_RECOVERY_INELIGIBLE');
      const [existing] = await tx.select().from(actionAttempt).where(and(owned(scope),
        eq(actionAttempt.triggerRequestId, requestId))).limit(1);
      if (existing) {
        const saved = parseDocumentTranslationTaskEnvelope(existing.taskEnvelopeJson ?? '');
        if (prior.status !== 'CANCELLED' ||
            prior.terminalReason !== 'DOCUMENT_TRANSLATION_PARTIAL_INPUT_SUPERSEDED' ||
            saved.recoveryOf?.operationRef !== predecessorRef ||
            saved.recoveryOf.inputHash !== priorTask.inputHash ||
            saved.parseRunId !== parsed.parseRunId || saved.parseRevision !== parsed.parseRevision ||
            canonicalJson(saved.modelInput) !== canonicalJson(parsed.modelInput))
          throw new Error('DOCUMENT_TRANSLATION_REQUEST_CONFLICT');
        return existing;
      }
      const noLease = prior.leaseOwner === null && prior.leaseToken === null && prior.leaseExpiresAt === null;
      const expiredLease = prior.leaseOwner !== null && prior.leaseToken !== null &&
        prior.leaseExpiresAt !== null && prior.leaseExpiresAt <= new Date();
      if (!['QUEUED','RUNNING','RETRY_SCHEDULED','FAILED'].includes(prior.status) ||
          (!noLease && !expiredLease) ||
          prior.resultEnvelopeJson !== null || prior.resultContentHash !== null ||
          prior.projectionApplied || prior.commitStartedAt !== null)
        throw new Error('DOCUMENT_TRANSLATION_PARTIAL_INPUT_RECOVERY_INELIGIBLE');
      const [latest] = await tx.select().from(actionAttempt).where(and(
        eq(actionAttempt.tenantId, scope.tenantId),
        eq(actionAttempt.documentVersionId, scope.documentVersionId),
        eq(actionAttempt.subjectKind, 'DOCUMENT_VERSION'),
        eq(actionAttempt.actionType, 'DOCUMENT_TRANSLATE')))
        .orderBy(desc(actionAttempt.attemptNo)).limit(1);
      if (latest?.attemptId !== prior.attemptId) throw new Error('DOCUMENT_TRANSLATION_PARTIAL_INPUT_RECOVERY_INELIGIBLE');
      const [otherActive] = await tx.select({ id: actionAttempt.attemptId }).from(actionAttempt)
        .where(and(owned(scope), inArray(actionAttempt.status,
          ['QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING']),
        sql`${actionAttempt.attemptId} <> ${prior.attemptId}`)).limit(1);
      if (otherActive) throw new Error('DOCUMENT_TRANSLATION_PARTIAL_INPUT_RECOVERY_INELIGIBLE');
      const predecessorRequestId = `${rootRequestId}:hosted-m3`;
      const [successful] = await tx.select().from(actionAttempt).where(and(owned(scope),
        inArray(actionAttempt.triggerRequestId, [rootRequestId, predecessorRequestId]),
        eq(actionAttempt.status, 'SUCCEEDED'))).orderBy(desc(actionAttempt.attemptNo)).limit(1);
      if (!successful || successful.attemptNo + 1 !== prior.attemptNo ||
          successful.producerRunId !== parsed.parseRunId ||
          successful.terminalReason !== 'REMAINING_LIMITATIONS' || !successful.resultEnvelopeJson)
        throw new Error('DOCUMENT_TRANSLATION_PARTIAL_INPUT_RECOVERY_INELIGIBLE');
      const successfulTask = parseDocumentTranslationTaskEnvelope(successful.taskEnvelopeJson ?? '');
      const result = partialResult.safeParse(JSON.parse(successful.resultEnvelopeJson));
      if (!result.success || successfulTask.workspaceId !== parsed.workspaceId ||
          canonicalJson(successfulTask.modelInput.source) !== canonicalJson(parsed.modelInput.source) ||
          result.data.artifact.manifest.workspaceId !== parsed.workspaceId ||
          result.data.artifact.manifest.planRevision !== parsed.modelInput.planRevision ||
          result.data.artifact.manifest.contextRevision !== parsed.modelInput.contextRevision)
        throw new Error('DOCUMENT_TRANSLATION_PARTIAL_INPUT_RECOVERY_INELIGIBLE');
      const [workspace] = await tx.select({ result: translationWorkspace.resultArtifactJson,
        manifest: translationWorkspace.resultManifestJson })
        .from(translationWorkspace).where(and(eq(translationWorkspace.tenantId, scope.tenantId),
          eq(translationWorkspace.documentVersionId, scope.documentVersionId),
          eq(translationWorkspace.workspaceId, parsed.workspaceId))).limit(1).for('update');
      if (!workspace?.result || !workspace.manifest ||
          canonicalJson(JSON.parse(workspace.manifest)) !==
            canonicalJson(result.data.artifact.manifest))
        throw new Error('DOCUMENT_TRANSLATION_PARTIAL_INPUT_RECOVERY_INELIGIBLE');
      const snapshot = await readTranslationWorkspaceSnapshot(tx, { tenantId: scope.tenantId,
        workItemId: null, documentVersionId: scope.documentVersionId, workspaceId: parsed.workspaceId });
      const reading = buildTranslationWorkspaceReadingV2(snapshot.workspace, snapshot.revisions);
      const selected = reading.blocks.flatMap(block => block.selected ? [{ blockId: block.source.blockId,
        blockRevisionId: block.selected.blockRevisionId, contentRevision: block.selected.contentRevision }] : []);
      const [produced] = await tx.select({ id: translationBlockRevision.blockRevisionId })
        .from(translationBlockRevision).where(and(eq(translationBlockRevision.tenantId, scope.tenantId),
          eq(translationBlockRevision.workspaceId, parsed.workspaceId),
          eq(translationBlockRevision.originAttemptId, prior.attemptId))).limit(1);
      if (!selected.length || snapshot.workspace.activeAttemptId !== prior.attemptId ||
          canonicalJson(selected) !== canonicalJson(result.data.artifact.manifest.blockRevisions) ||
          produced ||
          snapshot.workspace.generationRequests.some(request => request.attemptId === prior.attemptId &&
            (request.status !== 'FAILED' || request.error?.outcome !== 'KNOWN_FAILURE')) ||
          canonicalJson(documentTranslationRepairableBlockIds(reading)) !==
            canonicalJson(parsed.modelInput.retranslateBlockIds))
        throw new Error('DOCUMENT_TRANSLATION_PARTIAL_INPUT_RECOVERY_INELIGIBLE');
      const current = await tx.execute<{ parseRunId: string; parseRevision: number; sha256: string; byteLength: number }>(sql`
        SELECT parse_run_id AS "parseRunId",parse_revision AS "parseRevision",
          manifest_artifact->>'sha256' AS sha256,(manifest_artifact->>'byteLength')::bigint AS "byteLength"
        FROM dm_document_parse_run WHERE tenant_id=${scope.tenantId} AND document_version_id=${scope.documentVersionId}
          AND status='PUBLISHED' ORDER BY parse_revision DESC LIMIT 1 FOR SHARE`);
      if (current[0]?.parseRunId !== parsed.parseRunId || current[0].parseRevision !== parsed.parseRevision ||
          current[0].sha256 !== parsed.modelInput.source.parsedArtifact.sha256 ||
          Number(current[0].byteLength) !== parsed.modelInput.source.parsedArtifact.byteLength)
        throw new Error('DOCUMENT_TRANSLATION_RESERVATION_SOURCE_CHANGED');
      const now = new Date();
      await tx.update(actionAttempt).set({ status: 'CANCELLED', cancelRequestedAt: now,
        cancelReason: 'RECOVER_PARTIAL_INPUT: sealed task omitted repair block IDs',
        terminalReason: 'DOCUMENT_TRANSLATION_PARTIAL_INPUT_SUPERSEDED',
        leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
        completedAt: now, updatedAt: now }).where(and(owned(scope), eq(actionAttempt.attemptId, prior.attemptId)));
      const [row] = await tx.insert(actionAttempt).values({
        attemptId: parsed.actionAttemptId, operationRef: parsed.operationRef,
        subjectKind: 'DOCUMENT_VERSION', workItemId: null, documentVersionId: scope.documentVersionId,
        tenantId: scope.tenantId, actorUserId: scope.actorUserId, producerRunId: parsed.parseRunId,
        actionType: 'DOCUMENT_TRANSLATE', attemptNo: prior.attemptNo + 1,
        triggerRequestId: requestId, requestOrigin: 'HOST_DOCUMENT', status: 'QUEUED',
        leaseGeneration: 0, claimCount: 0, retryCount: 0, maxAttempts: 3,
        inputRevision: parsed.parseRevision, taskEnvelopeJson: canonicalJson(parsed), taskInputHash: parsed.inputHash,
        executionModelJson: canonicalJson(model), idempotencyKey: parsed.idempotencyKey,
        deadlineAt: new Date(parsed.deadline), packageArtifactRef: parsed.modelInput.source.parsedArtifact.ref,
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
