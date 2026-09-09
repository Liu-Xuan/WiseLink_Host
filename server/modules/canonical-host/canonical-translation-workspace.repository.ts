import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import type { UnifiedPackageArtifactDescriptor } from '@shared/api.interface';
import type {
  TranslationBlockCandidateV2,
  TranslationBlockCheckV2,
  TranslationBlockDependenciesV2,
  TranslationBlockProvenanceV2,
  TranslationBlockRevisionV2,
  TranslationGenerationRequestV2,
  TranslationResultManifestV2,
  TranslationSourcePlanV2,
  TranslationWorkspaceV2,
} from '@shared/canonical-translation-v2.interface';
import {
  actionAttempt,
  translationBlockRevision,
  translationWorkspace,
  workItem,
} from '../../database/schema';
import {
  canonicalJson,
  parseTaskEnvelope,
} from '../action-attempt/action-attempt-envelope';
import { parseExecutionModel } from '../model-settings/canonical-execution-model';
import { checkTranslationBlockV2 } from './canonical-translation-v2-quality';
import {
  TRANSLATION_V2_METHOD_VERSION,
  TRANSLATION_V2_PROMPT_VERSION,
  TRANSLATION_V2_TASK_SCHEMA,
  parseTranslationJson,
  translationArtifactDescriptorSchema,
  translationCandidateSchemaV2,
  translationCheckSchemaV2,
  translationDependenciesSchemaV2,
  translationGenerationSchemaV2,
  translationManifestSchemaV2,
  translationProvenanceSchemaV2,
  translationSourcePlanSchemaV2,
} from './canonical-translation-v2.contract';

type Database = Pick<
  PostgresJsDatabase,
  'select' | 'insert' | 'update' | 'execute'
>;
type WorkspaceRow = typeof translationWorkspace.$inferSelect;
type BlockRow = typeof translationBlockRevision.$inferSelect;
type AttemptRow = typeof actionAttempt.$inferSelect;
const activeStatuses = ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'];
const blockSnapshotColumns = {
  blockRevisionId: translationBlockRevision.blockRevisionId,
  workspaceId: translationBlockRevision.workspaceId,
  blockId: translationBlockRevision.blockId,
  planRevision: translationBlockRevision.planRevision,
  contentRevision: translationBlockRevision.contentRevision,
  rowVersion: translationBlockRevision.rowVersion,
  generationRequestRef: translationBlockRevision.generationRequestRef,
  originAttemptId: translationBlockRevision.originAttemptId,
  authorKind: translationBlockRevision.authorKind,
  authorUserId: translationBlockRevision.authorUserId,
  candidateJson: translationBlockRevision.candidateJson,
  dependenciesJson: translationBlockRevision.dependenciesJson,
  provenanceJson: translationBlockRevision.provenanceJson,
  generatedAt: translationBlockRevision.generatedAt,
  savedAt: translationBlockRevision.savedAt,
  checkJson: translationBlockRevision.checkJson,
  checkedAt: translationBlockRevision.checkedAt,
  selectedForReading: translationBlockRevision.selectedForReading,
};
type SnapshotBlockRow = Pick<BlockRow, keyof typeof blockSnapshotColumns>;

export interface TranslationWorkspaceScope {
  tenantId: string;
  workItemId: string;
  workspaceId: string;
}

export interface TranslationWorkspaceFence extends TranslationWorkspaceScope {
  attemptRef: string;
  principalId: string;
  leaseToken: string;
  leaseGeneration: number;
}

export interface TranslationActualModelExecution {
  modelRef: string;
  modelVersion: string;
  skillVersion: string;
  promptVersion: string;
  providerRequestId: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null };
  generatedAt: string | null;
}

/** All mutations follow fresh Host authorization and use the existing DB and lease. */
@Injectable()
export class CanonicalTranslationWorkspaceRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async prepare(input: {
    tenantId: string;
    workItemId: string;
    plan: TranslationSourcePlanV2;
  }): Promise<TranslationWorkspaceV2> {
    const plan = translationSourcePlanSchemaV2.parse(input.plan);
    return this.db.transaction(async (transaction) => {
      await assertCurrentSource(
        transaction,
        input.tenantId,
        input.workItemId,
        plan,
      );
      await transaction
        .insert(translationWorkspace)
        .values({
          workspaceId: `TW-${randomUUID()}`,
          tenantId: input.tenantId,
          workItemId: input.workItemId,
          documentVersionId: plan.source.documentVersionId,
          packageId: plan.source.packageId,
          parsedArtifactRef: plan.source.parsedArtifact.ref,
          parsedArtifactSha256: plan.source.parsedArtifact.sha256,
          targetLocale: 'zh-CN',
          planRevision: plan.planRevision,
          contextRevision: plan.documentContext.revision,
          sourcePlanJson: canonicalJson(plan),
          methodVersion: TRANSLATION_V2_METHOD_VERSION,
        })
        .onConflictDoNothing({
          target: [
            translationWorkspace.tenantId,
            translationWorkspace.workItemId,
            translationWorkspace.documentVersionId,
            translationWorkspace.parsedArtifactSha256,
            translationWorkspace.targetLocale,
          ],
        });
      const [row] = await transaction
        .select()
        .from(translationWorkspace)
        .where(
          and(
            eq(translationWorkspace.tenantId, input.tenantId),
            eq(translationWorkspace.workItemId, input.workItemId),
            eq(
              translationWorkspace.documentVersionId,
              plan.source.documentVersionId,
            ),
            eq(
              translationWorkspace.parsedArtifactSha256,
              plan.source.parsedArtifact.sha256,
            ),
            eq(translationWorkspace.targetLocale, 'zh-CN'),
          ),
        )
        .limit(1);
      if (
        !row ||
        row.parsedArtifactRef !== plan.source.parsedArtifact.ref ||
        row.packageId !== plan.source.packageId
      ) {
        throw new Error('TRANSLATION_WORKSPACE_EXACT_SOURCE_CONFLICT');
      }
      // Existing plans remain the source for their saved blocks. Replanning is
      // explicit; a code deployment must not silently relabel old anchors.
      return workspaceFromRow(row);
    });
  }

  async read(
    input: TranslationWorkspaceScope,
  ): Promise<TranslationWorkspaceV2> {
    return workspaceFromRow(await requiredWorkspace(this.db, input));
  }

  async readForSource(input: {
    tenantId: string;
    workItemId: string;
    documentVersionId: string;
    parsedArtifactRef: string;
    parsedArtifactSha256: string;
  }): Promise<TranslationWorkspaceV2 | null> {
    const [row] = await this.db
      .select()
      .from(translationWorkspace)
      .where(
        and(
          eq(translationWorkspace.tenantId, input.tenantId),
          eq(translationWorkspace.workItemId, input.workItemId),
          eq(translationWorkspace.documentVersionId, input.documentVersionId),
          eq(translationWorkspace.parsedArtifactRef, input.parsedArtifactRef),
          eq(
            translationWorkspace.parsedArtifactSha256,
            input.parsedArtifactSha256,
          ),
          eq(translationWorkspace.targetLocale, 'zh-CN'),
        ),
      )
      .limit(1);
    return row ? workspaceFromRow(row) : null;
  }

  async readBlocks(
    input: TranslationWorkspaceScope,
  ): Promise<TranslationBlockRevisionV2[]> {
    await requiredWorkspace(this.db, input);
    const rows = await this.db
      .select()
      .from(translationBlockRevision)
      .where(blockScope(input))
      .orderBy(
        asc(translationBlockRevision.blockId),
        desc(translationBlockRevision.contentRevision),
      );
    return rows.map(blockFromRow);
  }

  async readSnapshot(input: TranslationWorkspaceScope) {
    // One SELECT provides one snapshot without UPDATE-only row locks or a
    // transaction-mode switch rejected by Hosted. Aggregate the small block
    // rows so the complete source plan is transmitted only once.
    const fields = sql.join(
      Object.entries(blockSnapshotColumns).flatMap(([key, column]) => [
        sql`${key}::text`,
        sql`${column}`,
      ]),
      sql`, `,
    );
    const [snapshot] = await this.db
      .select({
        workspace: translationWorkspace,
        revisions: sql<Record<string, unknown>[]>`(
          SELECT coalesce(jsonb_agg(jsonb_build_object(${fields})
            ORDER BY ${translationBlockRevision.blockId}, ${translationBlockRevision.contentRevision} DESC), '[]'::jsonb)
          FROM ${translationBlockRevision} WHERE ${blockScope(input)}
        )`,
      })
      .from(translationWorkspace)
      .where(workspaceScope(input))
      .limit(1);
    if (!snapshot) throw new Error('TRANSLATION_WORKSPACE_NOT_FOUND');
    return {
      workspace: workspaceFromRow(snapshot.workspace),
      revisions: snapshot.revisions.map((row) =>
        blockFromRow(
          Object.fromEntries(
            Object.entries(blockSnapshotColumns).map(([key, column]) => [
              key,
              row[key] === null ? null : column.mapFromDriverValue(row[key]),
            ]),
          ) as SnapshotBlockRow,
        ),
      ),
    };
  }

  async readSemanticScope(input: {
    tenantId: string;
    workItemId: string;
    blockRevisionId: string;
  }) {
    const [row] = await this.db
      .select()
      .from(translationBlockRevision)
      .where(
        and(
          eq(translationBlockRevision.tenantId, input.tenantId),
          eq(translationBlockRevision.workItemId, input.workItemId),
          eq(translationBlockRevision.blockRevisionId, input.blockRevisionId),
        ),
      )
      .limit(1);
    if (!row) return null;
    const { workspace, revisions } = await this.readSnapshot({
      ...input,
      workspaceId: row.workspaceId,
    });
    const revision = revisions.find(
      (entry) => entry.blockRevisionId === input.blockRevisionId,
    );
    const block = workspace.plan.blocks.find(
      (entry) => entry.blockId === revision?.blockId,
    );
    if (!revision || !block)
      throw new Error('TRANSLATION_BLOCK_REVISION_NOT_FOUND');
    return {
      selectedForReading: revision.selectedForReading,
      scope: {
        workspaceId: workspace.workspaceId,
        blockId: block.blockId,
        blockRevisionId: revision.blockRevisionId,
        planRevision: revision.planRevision,
        contextRevision: revision.dependencies.contextRevision,
        sourceUnitIds: [...block.sourceUnitIds],
        anchors: workspace.plan.anchors.filter((anchor) =>
          block.anchorIds.includes(anchor.anchorId),
        ),
        elements: revision.candidate.elements,
        provenance: revision.provenance,
      },
    };
  }

  async attachAttempt(
    input: TranslationWorkspaceFence,
  ): Promise<TranslationWorkspaceV2> {
    return this.db.transaction(async (transaction) => {
      const attempt = await assertFence(transaction, input);
      const row = await requiredWorkspace(transaction, input, true);
      const workspace = workspaceFromRow(row);
      await assertCurrentSource(
        transaction,
        input.tenantId,
        input.workItemId,
        workspace.plan,
      );
      assertTaskWorkspace(attempt, workspace);
      if (row.activeAttemptId === attempt.attemptId) return workspace;
      if (row.activeAttemptId) {
        const [previous] = await transaction
          .select({ status: actionAttempt.status })
          .from(actionAttempt)
          .where(
            and(
              eq(actionAttempt.attemptId, row.activeAttemptId),
              eq(actionAttempt.tenantId, input.tenantId),
              eq(actionAttempt.workItemId, input.workItemId),
            ),
          )
          .limit(1);
        if (!previous || activeStatuses.includes(previous.status))
          throw new Error('TRANSLATION_WORKSPACE_COORDINATOR_STILL_ACTIVE');
      }
      const requests = workspace.generationRequests.map(
        (request): TranslationGenerationRequestV2 =>
          request.status === 'REGISTERED' &&
          request.attemptId !== attempt.attemptId
            ? {
                ...request,
                status: 'SUPERSEDED',
                finishedAt: new Date().toISOString(),
              }
            : request,
      );
      const [updated] = await transaction
        .update(translationWorkspace)
        .set({
          activeAttemptId: attempt.attemptId,
          generationRequestsJson: canonicalJson(requests),
          rowVersion: row.rowVersion + 1,
          updatedAt: new Date(),
        })
        .where(workspaceScope(input))
        .returning();
      return workspaceFromRow(updated);
    });
  }

  async registerGeneration(
    input: TranslationWorkspaceFence & {
      clientRequestId: string;
      blockIds: string[];
      dependencies: TranslationBlockDependenciesV2;
      purpose: TranslationGenerationRequestV2['purpose'];
      targetBlockRevisionId: string | null;
      checkTargets?: TranslationGenerationRequestV2['checkTargets'];
    },
  ): Promise<TranslationGenerationRequestV2> {
    return this.withFencedWorkspace(
      input,
      async (transaction, attempt, workspace) => {
        const dependencies = translationDependenciesSchemaV2.parse(
          input.dependencies,
        );
        assertDependencies(workspace, dependencies);
        if (
          !input.clientRequestId.trim() ||
          input.clientRequestId.length > 160 ||
          !input.blockIds.length ||
          new Set(input.blockIds).size !== input.blockIds.length ||
          input.blockIds.some(
            (id) =>
              !workspace.plan.blocks.some((block) => block.blockId === id),
          )
        ) {
          throw new Error('TRANSLATION_GENERATION_SCOPE_INVALID');
        }
        const previous = workspace.generationRequests.find(
          (request) => request.clientRequestId === input.clientRequestId,
        );
        if (previous) {
          if (
            previous.attemptId !== attempt.attemptId ||
            previous.leaseGeneration !== input.leaseGeneration ||
            canonicalJson(previous.blockIds) !==
              canonicalJson(input.blockIds) ||
            previous.purpose !== input.purpose ||
            previous.targetBlockRevisionId !== input.targetBlockRevisionId ||
            canonicalJson(previous.checkTargets ?? []) !==
              canonicalJson(input.checkTargets ?? []) ||
            canonicalJson(previous.dependencies) !== canonicalJson(dependencies)
          ) {
            throw new Error('TRANSLATION_GENERATION_IDEMPOTENCY_CONFLICT');
          }
          return previous;
        }
        if (
          workspace.generationRequests.some(
            (request) => request.status === 'REGISTERED',
          )
        ) {
          throw new Error('TRANSLATION_GENERATION_ALREADY_IN_FLIGHT');
        }
        if (input.purpose === 'CHECK_BATCH') {
          const targets = input.checkTargets ?? [];
          if (
            input.targetBlockRevisionId !== null ||
            targets.length < 2 ||
            targets.length > 32 ||
            canonicalJson(targets.map((target) => target.blockId)) !==
              canonicalJson(input.blockIds) ||
            new Set(targets.map((target) => target.blockRevisionId)).size !==
              targets.length
          )
            throw new Error('TRANSLATION_GENERATION_TARGET_INVALID');
          for (const target of targets) {
            const [row] = await transaction
              .select()
              .from(translationBlockRevision)
              .where(
                and(
                  blockScope(input),
                  eq(
                    translationBlockRevision.blockRevisionId,
                    target.blockRevisionId,
                  ),
                ),
              )
              .limit(1);
            if (
              !row ||
              row.blockId !== target.blockId ||
              row.rowVersion !== target.rowVersion ||
              row.planRevision !== workspace.plan.planRevision
            )
              throw new Error('TRANSLATION_GENERATION_TARGET_INVALID');
            const revision = blockFromRow(row);
            assertDependencies(workspace, revision.dependencies);
            if (
              revision.check?.semanticCheck !== 'PENDING' ||
              revision.check.issues.some((issue) => issue.severity === 'BLOCK')
            )
              throw new Error('TRANSLATION_GENERATION_TARGET_INVALID');
          }
        } else if (input.checkTargets !== undefined) {
          throw new Error('TRANSLATION_GENERATION_TARGET_INVALID');
        } else if (input.purpose === 'GENERATE') {
          if (input.targetBlockRevisionId !== null)
            throw new Error('TRANSLATION_GENERATION_TARGET_INVALID');
        } else {
          const [target] = await transaction
            .select()
            .from(translationBlockRevision)
            .where(
              and(
                blockScope(input),
                eq(
                  translationBlockRevision.blockRevisionId,
                  input.targetBlockRevisionId ?? '',
                ),
              ),
            )
            .limit(1);
          if (
            !target ||
            input.blockIds.length !== 1 ||
            input.blockIds[0] !== target.blockId ||
            target.planRevision !== workspace.plan.planRevision
          )
            throw new Error('TRANSLATION_GENERATION_TARGET_INVALID');
        }
        const request: TranslationGenerationRequestV2 = {
          generationRequestRef: `TG-${randomUUID()}`,
          clientRequestId: input.clientRequestId,
          attemptId: attempt.attemptId,
          leaseGeneration: input.leaseGeneration,
          blockIds: [...input.blockIds],
          dependencies,
          purpose: input.purpose,
          targetBlockRevisionId: input.targetBlockRevisionId,
          ...(input.checkTargets
            ? { checkTargets: structuredClone(input.checkTargets) }
            : {}),
          status: 'REGISTERED',
          registeredAt: new Date().toISOString(),
          finishedAt: null,
          error: null,
        };
        await saveRequests(transaction, input, workspace, [
          ...workspace.generationRequests,
          request,
        ]);
        return request;
      },
    );
  }

  async recordGenerationFailure(
    input: TranslationWorkspaceFence & {
      generationRequestRef: string;
      error: NonNullable<TranslationGenerationRequestV2['error']>;
    },
  ): Promise<TranslationGenerationRequestV2> {
    return this.withFencedWorkspace(
      input,
      async (transaction, attempt, workspace) => {
        const request = requiredGeneration(
          workspace,
          input.generationRequestRef,
          attempt,
        );
        if (request.status === 'SAVED') return request;
        if (request.status === 'FAILED') {
          if (canonicalJson(request.error) !== canonicalJson(input.error))
            throw new Error('TRANSLATION_GENERATION_FAILURE_CONFLICT');
          return request;
        }
        if (request.status !== 'REGISTERED')
          throw new Error('TRANSLATION_GENERATION_SUPERSEDED');
        // Unknown generation cannot silently open a new dispatch slot. The
        // adapter must query/reconcile, or finish this attempt with its work intact.
        const updated = translationGenerationSchemaV2.parse({
          ...request,
          status:
            input.error.outcome === 'GENERATION_UNKNOWN'
              ? 'REGISTERED'
              : 'FAILED',
          finishedAt: new Date().toISOString(),
          error: input.error,
        });
        await saveRequests(
          transaction,
          input,
          workspace,
          workspace.generationRequests.map((entry) =>
            entry.generationRequestRef === request.generationRequestRef
              ? updated
              : entry,
          ),
        );
        return updated;
      },
    );
  }

  /** A fresh browser-authorized engineer creates a new immutable candidate. */
  async saveEngineerRevision(
    input: TranslationWorkspaceScope & {
      actorUserId: string;
      expectedWorkItemRevision: number;
      requestId: string;
      baseBlockRevisionId: string;
      expectedRowVersion: number;
      candidate: TranslationBlockCandidateV2;
    },
  ): Promise<TranslationBlockRevisionV2> {
    const candidate = translationCandidateSchemaV2.parse(input.candidate);
    return this.db.transaction(async (transaction) => {
      // Match model lock order (attempt, workspace, source); editing is available
      // after an attempt ends, so its late writes cannot replace the human text.
      const before = await requiredWorkspace(transaction, input, false);
      if (before.activeAttemptId) {
        const [attempt] = await transaction
          .select()
          .from(actionAttempt)
          .where(
            and(
              eq(actionAttempt.attemptId, before.activeAttemptId),
              eq(actionAttempt.tenantId, input.tenantId),
              eq(actionAttempt.workItemId, input.workItemId),
            ),
          )
          .limit(1)
          .for('update');
        if (attempt && activeStatuses.includes(attempt.status))
          throw new Error('TRANSLATION_ENGINEER_REVISION_ATTEMPT_ACTIVE');
      }
      const workspace = workspaceFromRow(
        await requiredWorkspace(transaction, input, true),
      );
      if (workspace.activeAttemptId !== before.activeAttemptId)
        throw new Error('TRANSLATION_WORKSPACE_COORDINATOR_CHANGED');
      await assertCurrentSource(
        transaction,
        input.tenantId,
        input.workItemId,
        workspace.plan,
      );
      const [owner] = await transaction
        .select({
          owner: workItem.requestedByUserId,
          revision: workItem.revision,
        })
        .from(workItem)
        .where(
          and(
            eq(workItem.tenantId, input.tenantId),
            eq(workItem.workItemId, input.workItemId),
          ),
        )
        .limit(1)
        .for('share');
      if (owner?.owner !== input.actorUserId)
        throw new Error('TRANSLATION_ENGINEER_REVISION_OWNER_MISMATCH');
      const requestRef = `ENGINEER:${input.requestId}`;
      const [existing] = await transaction
        .select()
        .from(translationBlockRevision)
        .where(
          and(
            blockScope(input),
            eq(translationBlockRevision.generationRequestRef, requestRef),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.candidateJson !== canonicalJson(candidate) ||
          existing.authorUserId !== input.actorUserId
        )
          throw new Error('TRANSLATION_BLOCK_IDEMPOTENCY_CONFLICT');
        return blockFromRow(existing);
      }
      if (owner.revision !== input.expectedWorkItemRevision)
        throw new Error('TRANSLATION_ENGINEER_REVISION_WORK_ITEM_CHANGED');
      const [latest] = await transaction
        .select()
        .from(translationBlockRevision)
        .where(
          and(
            blockScope(input),
            eq(translationBlockRevision.blockId, candidate.blockId),
          ),
        )
        .orderBy(desc(translationBlockRevision.contentRevision))
        .limit(1);
      if (
        !latest ||
        latest.blockRevisionId !== input.baseBlockRevisionId ||
        latest.rowVersion !== input.expectedRowVersion
      )
        throw new Error('TRANSLATION_ENGINEER_REVISION_CAS_CONFLICT');
      const baseRevision = blockFromRow(latest);
      // This editor changes wording only; list/table identity and multi-anchor
      // paragraph mappings remain the exact mappings reviewed by the engineer.
      if (
        canonicalJson(
          candidate.elements.map(
            ({ translatedText: _text, ...element }) => element,
          ),
        ) !==
        canonicalJson(
          baseRevision.candidate.elements.map(
            ({ translatedText: _text, ...element }) => element,
          ),
        )
      )
        throw new Error('TRANSLATION_ENGINEER_REVISION_MAPPING_CHANGED');
      assertDependencies(workspace, baseRevision.dependencies);
      const provenance: TranslationBlockProvenanceV2 = {
        authorKind: 'ENGINEER',
        authorUserId: input.actorUserId,
        executionModel: null,
        modelVersion: null,
        skillVersion: null,
        promptVersion: null,
        generationRequestRef: requestRef,
        originAttemptId: null,
        providerRequestId: null,
        usage: { inputTokens: null, outputTokens: null },
      };
      const check = checkTranslationBlockV2({
        plan: workspace.plan,
        candidate,
        semanticReview: {
          result: { blockId: candidate.blockId, issues: [] },
          provenance,
        },
      });
      const selected = !check.issues.some(
        (issue) => issue.severity === 'BLOCK',
      );
      const now = new Date();
      if (selected)
        await transaction
          .update(translationBlockRevision)
          .set({
            selectedForReading: false,
            rowVersion: sql`${translationBlockRevision.rowVersion} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              blockScope(input),
              eq(translationBlockRevision.blockId, candidate.blockId),
              eq(translationBlockRevision.selectedForReading, true),
            ),
          );
      const [inserted] = await transaction
        .insert(translationBlockRevision)
        .values({
          blockRevisionId: `TB-${randomUUID()}`,
          tenantId: input.tenantId,
          workItemId: input.workItemId,
          workspaceId: input.workspaceId,
          blockId: candidate.blockId,
          planRevision: workspace.plan.planRevision,
          contentRevision: latest.contentRevision + 1,
          generationRequestRef: requestRef,
          originAttemptId: null,
          authorKind: 'ENGINEER',
          authorUserId: input.actorUserId,
          candidateJson: canonicalJson(candidate),
          dependenciesJson: canonicalJson(baseRevision.dependencies),
          provenanceJson: canonicalJson(provenance),
          generatedAt: null,
          checkStatus: 'CHECKED',
          checkJson: canonicalJson(check),
          checkedAt: now,
          selectedForReading: selected,
        })
        .returning();
      await transaction
        .update(translationWorkspace)
        .set({
          rowVersion: workspace.rowVersion + 1,
          updatedAt: now,
          ...(selected
            ? { resultArtifactJson: null, resultManifestJson: null }
            : {}),
        })
        .where(workspaceScope(input));
      return blockFromRow(inserted);
    });
  }

  async saveCandidates(
    input: TranslationWorkspaceFence & {
      generationRequestRef: string;
      candidates: TranslationBlockCandidateV2[];
      actualExecution: TranslationActualModelExecution;
    },
  ): Promise<TranslationBlockRevisionV2[]> {
    return this.withFencedWorkspace(
      input,
      async (transaction, attempt, workspace) => {
        const request = requiredGeneration(
          workspace,
          input.generationRequestRef,
          attempt,
        );
        if (!['REGISTERED', 'SAVED'].includes(request.status))
          throw new Error('TRANSLATION_GENERATION_SUPERSEDED');
        if (request.purpose === 'CHECK')
          throw new Error('TRANSLATION_GENERATION_PURPOSE_INVALID');
        assertDependencies(workspace, request.dependencies);
        const provenance = modelProvenance(
          attempt,
          request,
          input.actualExecution,
        );
        if (
          new Set(input.candidates.map((candidate) => candidate.blockId))
            .size !== input.candidates.length ||
          !input.candidates.length ||
          input.candidates.some(
            (candidate) => !request.blockIds.includes(candidate.blockId),
          )
        ) {
          throw new Error('TRANSLATION_BLOCK_GENERATION_SCOPE_INVALID');
        }
        const saved: TranslationBlockRevisionV2[] = [];
        for (const raw of input.candidates) {
          const candidate = translationCandidateSchemaV2.parse(raw);
          const [existing] = await transaction
            .select()
            .from(translationBlockRevision)
            .where(
              and(
                blockScope(input),
                eq(translationBlockRevision.blockId, candidate.blockId),
                eq(
                  translationBlockRevision.generationRequestRef,
                  request.generationRequestRef,
                ),
              ),
            )
            .limit(1);
          if (existing) {
            if (
              existing.candidateJson !== canonicalJson(candidate) ||
              existing.provenanceJson !== canonicalJson(provenance) ||
              existing.dependenciesJson !== canonicalJson(request.dependencies)
            )
              throw new Error('TRANSLATION_BLOCK_IDEMPOTENCY_CONFLICT');
            saved.push(blockFromRow(existing));
            continue;
          }
          const [latest] = await transaction
            .select({ revision: translationBlockRevision.contentRevision })
            .from(translationBlockRevision)
            .where(
              and(
                blockScope(input),
                eq(translationBlockRevision.blockId, candidate.blockId),
              ),
            )
            .orderBy(desc(translationBlockRevision.contentRevision))
            .limit(1);
          // The workspace row is locked throughout allocation and insertion.
          const [inserted] = await transaction
            .insert(translationBlockRevision)
            .values({
              blockRevisionId: `TB-${randomUUID()}`,
              tenantId: input.tenantId,
              workItemId: input.workItemId,
              workspaceId: workspace.workspaceId,
              blockId: candidate.blockId,
              planRevision: workspace.plan.planRevision,
              contentRevision: (latest?.revision ?? 0) + 1,
              generationRequestRef: request.generationRequestRef,
              originAttemptId: attempt.attemptId,
              authorKind: 'MODEL',
              authorUserId: attempt.actorUserId,
              candidateJson: canonicalJson(candidate),
              dependenciesJson: canonicalJson(request.dependencies),
              provenanceJson: canonicalJson(provenance),
              generatedAt: parseOptionalDate(input.actualExecution.generatedAt),
            })
            .returning();
          saved.push(blockFromRow(inserted));
        }
        const allSaved = await transaction
          .select({ blockId: translationBlockRevision.blockId })
          .from(translationBlockRevision)
          .where(
            and(
              blockScope(input),
              eq(
                translationBlockRevision.generationRequestRef,
                request.generationRequestRef,
              ),
            ),
          );
        const complete = request.blockIds.every((id) =>
          allSaved.some((entry) => entry.blockId === id),
        );
        await saveRequests(
          transaction,
          input,
          workspace,
          workspace.generationRequests.map((entry) =>
            entry.generationRequestRef === request.generationRequestRef &&
            complete
              ? {
                  ...entry,
                  status: 'SAVED',
                  finishedAt: entry.finishedAt ?? new Date().toISOString(),
                  error: null,
                }
              : entry,
          ),
        );
        return saved;
      },
    );
  }

  async checkAndSelect(
    input: TranslationWorkspaceFence & {
      blockRevisionId: string;
      expectedRowVersion: number;
      check: TranslationBlockCheckV2;
    },
  ): Promise<TranslationBlockRevisionV2> {
    const check = translationCheckSchemaV2.parse(input.check);
    return this.withFencedWorkspace(input, (transaction, attempt, workspace) =>
      this.applyBlockCheck(transaction, attempt, workspace, input, check),
    );
  }

  async checkAndSelectBatch(
    input: TranslationWorkspaceFence & {
      generationRequestRef: string;
      checks: {
        blockRevisionId: string;
        expectedRowVersion: number;
        check: TranslationBlockCheckV2;
      }[];
    },
  ): Promise<TranslationBlockRevisionV2[]> {
    const checks = input.checks.map((entry) => ({
      ...entry,
      check: translationCheckSchemaV2.parse(entry.check),
    }));
    return this.withFencedWorkspace(
      input,
      async (transaction, attempt, workspace) => {
        const request = requiredGeneration(
          workspace,
          input.generationRequestRef,
          attempt,
        );
        const targets = request.checkTargets ?? [];
        if (
          request.purpose !== 'CHECK_BATCH' ||
          !['REGISTERED', 'SAVED'].includes(request.status) ||
          targets.length < 2 ||
          targets.length !== checks.length ||
          checks.some(
            (entry, index) =>
              entry.blockRevisionId !== targets[index].blockRevisionId ||
              entry.expectedRowVersion !== targets[index].rowVersion ||
              entry.check.semanticCheck !== 'COMPLETED' ||
              entry.check.semanticReview?.generationRequestRef !==
                request.generationRequestRef,
          )
        )
          throw new Error('TRANSLATION_SEMANTIC_CHECK_BATCH_BINDING_INVALID');
        if (request.status === 'SAVED') {
          const saved = [];
          for (const entry of checks) {
            const [row] = await transaction
              .select()
              .from(translationBlockRevision)
              .where(
                and(
                  blockScope(input),
                  eq(
                    translationBlockRevision.blockRevisionId,
                    entry.blockRevisionId,
                  ),
                ),
              )
              .limit(1);
            if (!row || row.checkJson !== canonicalJson(entry.check))
              throw new Error('TRANSLATION_BLOCK_CHECK_CAS_CONFLICT');
            saved.push(blockFromRow(row));
          }
          return saved;
        }
        const saved = [];
        for (const entry of checks) {
          saved.push(
            await this.applyBlockCheck(
              transaction,
              attempt,
              workspace,
              { ...input, ...entry },
              entry.check,
              request,
            ),
          );
        }
        await saveRequests(
          transaction,
          input,
          workspace,
          workspace.generationRequests.map((entry) =>
            entry.generationRequestRef === request.generationRequestRef
              ? {
                  ...entry,
                  status: 'SAVED',
                  finishedAt: new Date().toISOString(),
                  error: null,
                }
              : entry,
          ),
        );
        return saved;
      },
    );
  }

  private async applyBlockCheck(
    transaction: Database,
    attempt: AttemptRow,
    workspace: TranslationWorkspaceV2,
    input: TranslationWorkspaceFence & {
      blockRevisionId: string;
      expectedRowVersion: number;
    },
    check: TranslationBlockCheckV2,
    batchRequest?: TranslationGenerationRequestV2,
  ): Promise<TranslationBlockRevisionV2> {
    const [row] = await transaction
      .select()
      .from(translationBlockRevision)
      .where(
        and(
          blockScope(input),
          eq(translationBlockRevision.blockRevisionId, input.blockRevisionId),
        ),
      )
      .limit(1)
      .for('update');
    if (!row) throw new Error('TRANSLATION_BLOCK_REVISION_NOT_FOUND');
    const revision = blockFromRow(row);
    assertDependencies(workspace, revision.dependencies);
    if (row.rowVersion !== input.expectedRowVersion) {
      if (row.checkJson === canonicalJson(check)) return revision;
      throw new Error('TRANSLATION_BLOCK_CHECK_CAS_CONFLICT');
    }
    const request = workspace.generationRequests.find(
      (entry) =>
        entry.generationRequestRef === revision.provenance.generationRequestRef,
    );
    if (!request || request.status === 'SUPERSEDED')
      throw new Error('TRANSLATION_GENERATION_SUPERSEDED');
    const block = workspace.plan.blocks.find(
      (entry) => entry.blockId === row.blockId,
    )!;
    if (
      block.sourceIssues.some(
        (issue) =>
          !check.issues.some(
            (checkedIssue) =>
              checkedIssue.code === issue.code &&
              checkedIssue.origin === issue.origin &&
              checkedIssue.severity === issue.severity,
          ),
      )
    ) {
      throw new Error('TRANSLATION_BLOCK_SOURCE_ISSUES_MISSING');
    }
    let requests = workspace.generationRequests;
    if (check.semanticCheck === 'COMPLETED') {
      const review = check.semanticReview;
      if (!review)
        throw new Error('TRANSLATION_SEMANTIC_CHECK_PROVENANCE_MISSING');
      const checkRequest = requiredGeneration(
        workspace,
        review.generationRequestRef,
        attempt,
      );
      if (
        (batchRequest
          ? checkRequest.purpose !== 'CHECK_BATCH' ||
            checkRequest.generationRequestRef !==
              batchRequest.generationRequestRef ||
            !checkRequest.checkTargets?.some(
              (target) =>
                target.blockId === row.blockId &&
                target.blockRevisionId === row.blockRevisionId &&
                target.rowVersion === input.expectedRowVersion,
            )
          : checkRequest.purpose !== 'CHECK' ||
            checkRequest.targetBlockRevisionId !== row.blockRevisionId) ||
        !checkRequest.blockIds.includes(row.blockId) ||
        !['REGISTERED', 'SAVED'].includes(checkRequest.status)
      )
        throw new Error('TRANSLATION_SEMANTIC_CHECK_REQUEST_INVALID');
      const actual = modelProvenance(attempt, checkRequest, {
        modelRef: review.executionModel?.modelRef ?? '',
        modelVersion: review.modelVersion ?? '',
        skillVersion: review.skillVersion ?? '',
        promptVersion: review.promptVersion ?? '',
        providerRequestId: review.providerRequestId,
        usage: review.usage,
        generatedAt: null,
      });
      if (canonicalJson(actual) !== canonicalJson(review))
        throw new Error('TRANSLATION_SEMANTIC_CHECK_PROVENANCE_INVALID');
      if (!batchRequest && checkRequest.blockIds.length !== 1)
        throw new Error('TRANSLATION_SEMANTIC_CHECK_SCOPE_INVALID');
      if (!batchRequest)
        requests = requests.map((entry) =>
          entry.generationRequestRef === checkRequest.generationRequestRef
            ? {
                ...entry,
                status: 'SAVED',
                finishedAt: entry.finishedAt ?? new Date().toISOString(),
                error: null,
              }
            : entry,
        );
    } else if (check.semanticReview !== null)
      throw new Error('TRANSLATION_SEMANTIC_CHECK_STATUS_INVALID');
    const selected =
      check.semanticCheck !== 'PENDING' &&
      !check.issues.some((issue) => issue.severity === 'BLOCK');
    if (selected)
      await transaction
        .update(translationBlockRevision)
        .set({
          selectedForReading: false,
          rowVersion: sql`${translationBlockRevision.rowVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            blockScope(input),
            eq(translationBlockRevision.blockId, row.blockId),
            eq(translationBlockRevision.selectedForReading, true),
          ),
        );
    const [updated] = await transaction
      .update(translationBlockRevision)
      .set({
        checkStatus: 'CHECKED',
        checkJson: canonicalJson(check),
        checkedAt: new Date(),
        selectedForReading: selected,
        rowVersion: row.rowVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          blockScope(input),
          eq(translationBlockRevision.blockRevisionId, row.blockRevisionId),
        ),
      )
      .returning();
    await transaction
      .update(translationWorkspace)
      .set({
        rowVersion: workspace.rowVersion + 1,
        updatedAt: new Date(),
        generationRequestsJson: canonicalJson(requests),
        ...(selected || row.selectedForReading
          ? { resultArtifactJson: null, resultManifestJson: null }
          : {}),
      })
      .where(workspaceScope(input));
    workspace.rowVersion += 1;
    return blockFromRow(updated);
  }

  async saveFinalArtifact(
    input: TranslationWorkspaceFence & {
      artifact: UnifiedPackageArtifactDescriptor;
      manifest: TranslationResultManifestV2;
    },
  ): Promise<TranslationWorkspaceV2> {
    const artifact = translationArtifactDescriptorSchema.parse(input.artifact);
    const manifest = translationManifestSchemaV2.parse(input.manifest);
    return this.withFencedWorkspace(
      input,
      async (transaction, _attempt, workspace) => {
        if (
          workspace.resultArtifact &&
          canonicalJson(workspace.resultArtifact) === canonicalJson(artifact) &&
          canonicalJson(workspace.resultManifest) === canonicalJson(manifest)
        )
          return workspace;
        if (
          workspace.workspaceId !== manifest.workspaceId ||
          workspace.rowVersion !== manifest.workspaceRowVersion ||
          workspace.plan.planRevision !== manifest.planRevision ||
          workspace.plan.documentContext.revision !== manifest.contextRevision
        ) {
          throw new Error('TRANSLATION_FINAL_MANIFEST_CAS_CONFLICT');
        }
        const rows = await transaction
          .select()
          .from(translationBlockRevision)
          .where(
            and(
              blockScope(input),
              eq(translationBlockRevision.selectedForReading, true),
            ),
          );
        const expected = rows
          .map((row) => ({
            blockId: row.blockId,
            blockRevisionId: row.blockRevisionId,
            contentRevision: row.contentRevision,
          }))
          .sort((a, b) => a.blockId.localeCompare(b.blockId));
        if (
          canonicalJson(expected) !==
          canonicalJson(
            [...manifest.blockRevisions].sort((a, b) =>
              a.blockId.localeCompare(b.blockId),
            ),
          )
        ) {
          throw new Error('TRANSLATION_FINAL_SELECTION_CHANGED');
        }
        const [updated] = await transaction
          .update(translationWorkspace)
          .set({
            resultArtifactJson: canonicalJson(artifact),
            resultManifestJson: canonicalJson(manifest),
            rowVersion: workspace.rowVersion + 1,
            updatedAt: new Date(),
          })
          .where(workspaceScope(input))
          .returning();
        return workspaceFromRow(updated);
      },
    );
  }

  private async withFencedWorkspace<T>(
    input: TranslationWorkspaceFence,
    operation: (
      database: Database,
      attempt: AttemptRow,
      workspace: TranslationWorkspaceV2,
    ) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      const attempt = await assertFence(transaction, input);
      const workspace = workspaceFromRow(
        await requiredWorkspace(transaction, input, true),
      );
      if (workspace.activeAttemptId !== attempt.attemptId)
        throw new Error('TRANSLATION_WORKSPACE_COORDINATOR_CHANGED');
      assertTaskWorkspace(attempt, workspace);
      await assertCurrentSource(
        transaction,
        input.tenantId,
        input.workItemId,
        workspace.plan,
      );
      return operation(transaction, attempt, workspace);
    });
  }
}

function modelProvenance(
  attempt: AttemptRow,
  request: TranslationGenerationRequestV2,
  actual: TranslationActualModelExecution,
): TranslationBlockProvenanceV2 {
  const executionModel = parseExecutionModel(
    JSON.parse(attempt.executionModelJson ?? 'null'),
  );
  if (
    actual.modelRef !== executionModel.modelRef ||
    !/^wiselink-research-and-synthesize@r09\.c\d+$/u.test(
      actual.skillVersion,
    ) ||
    Number(actual.skillVersion.split('.c').at(-1)) < 44 ||
    ![
      TRANSLATION_V2_PROMPT_VERSION,
      'wiselink-translation-block@r09.c46',
      'wiselink-translation-block@r09.c45',
      'wiselink-translation-block@r09.c44',
    ].includes(actual.promptVersion) ||
    ['unknown', 'fallback', ''].includes(
      actual.modelVersion.trim().toLowerCase(),
    ) ||
    (actual.modelVersion.startsWith('configured-route:') &&
      actual.modelVersion !== `configured-route:${executionModel.modelRef}`)
  ) {
    throw new Error('TRANSLATION_BLOCK_RUNTIME_BINDING_INVALID');
  }
  return translationProvenanceSchemaV2.parse({
    authorKind: 'MODEL',
    authorUserId: attempt.actorUserId,
    executionModel,
    modelVersion: actual.modelVersion,
    skillVersion: actual.skillVersion,
    promptVersion: actual.promptVersion,
    generationRequestRef: request.generationRequestRef,
    originAttemptId: attempt.attemptId,
    providerRequestId: actual.providerRequestId,
    usage: actual.usage,
  });
}

function workspaceScope(input: TranslationWorkspaceScope) {
  return and(
    eq(translationWorkspace.tenantId, input.tenantId),
    eq(translationWorkspace.workItemId, input.workItemId),
    eq(translationWorkspace.workspaceId, input.workspaceId),
  );
}

function blockScope(input: TranslationWorkspaceScope) {
  return and(
    eq(translationBlockRevision.tenantId, input.tenantId),
    eq(translationBlockRevision.workItemId, input.workItemId),
    eq(translationBlockRevision.workspaceId, input.workspaceId),
  );
}

async function requiredWorkspace(
  database: Database,
  input: TranslationWorkspaceScope,
  lock = false,
): Promise<WorkspaceRow> {
  const query = database
    .select()
    .from(translationWorkspace)
    .where(workspaceScope(input))
    .limit(1);
  const [row] = await (lock ? query.for('update') : query);
  if (!row) throw new Error('TRANSLATION_WORKSPACE_NOT_FOUND');
  return row;
}

async function assertCurrentSource(
  database: Database,
  tenantId: string,
  workItemId: string,
  plan: TranslationSourcePlanV2,
): Promise<void> {
  const [source] = await database
    .select({
      documentVersionId: workItem.documentVersionId,
      packageId: workItem.packageId,
      parsedRef: workItem.packageArtifactRef,
      parsedHash: workItem.packageArtifactSha256,
    })
    .from(workItem)
    .where(
      and(eq(workItem.tenantId, tenantId), eq(workItem.workItemId, workItemId)),
    )
    .limit(1)
    .for('share');
  if (
    !source ||
    source.documentVersionId !== plan.source.documentVersionId ||
    source.packageId !== plan.source.packageId ||
    source.parsedRef !== plan.source.parsedArtifact.ref ||
    source.parsedHash !== plan.source.parsedArtifact.sha256
  ) {
    throw new Error('TRANSLATION_WORKSPACE_SOURCE_CHANGED');
  }
}

async function assertFence(
  database: Database,
  input: TranslationWorkspaceFence,
): Promise<AttemptRow> {
  const [row] = await database
    .select()
    .from(actionAttempt)
    .where(
      and(
        eq(actionAttempt.operationRef, input.attemptRef),
        eq(actionAttempt.tenantId, input.tenantId),
        eq(actionAttempt.workItemId, input.workItemId),
      ),
    )
    .limit(1)
    .for('update');
  const now = new Date();
  if (
    !row ||
    row.actionType !== 'OPENCLAW_TRANSLATE' ||
    row.status !== 'RUNNING' ||
    row.cancelRequestedAt !== null ||
    row.leaseOwner !== input.principalId ||
    row.leaseToken !== input.leaseToken ||
    row.leaseGeneration !== input.leaseGeneration ||
    !row.leaseExpiresAt ||
    row.leaseExpiresAt <= now ||
    !row.deadlineAt ||
    row.deadlineAt <= now
  ) {
    throw new Error('TRANSLATION_WORKSPACE_LEASE_FENCE_REJECTED');
  }
  return row;
}

function assertTaskWorkspace(
  attempt: AttemptRow,
  workspace: TranslationWorkspaceV2,
): void {
  const task = parseTaskEnvelope(attempt.taskEnvelopeJson ?? '');
  if (
    task.actionAttemptId !== attempt.attemptId ||
    task.operationRef !== attempt.operationRef ||
    task.tenantId !== workspace.tenantId ||
    task.workItemId !== workspace.workItemId ||
    task.taskType !== 'OPENCLAW_TRANSLATE' ||
    task.documentVersionId !== workspace.plan.source.documentVersionId ||
    task.inputHash !== attempt.taskInputHash ||
    task.modelInput.schemaVersion !== TRANSLATION_V2_TASK_SCHEMA ||
    task.modelInput.workspaceId !== workspace.workspaceId ||
    task.modelInput.planRevision !== workspace.plan.planRevision ||
    task.modelInput.contextRevision !==
      workspace.plan.documentContext.revision ||
    task.modelInput.methodVersion !== workspace.methodVersion
  )
    throw new Error('TRANSLATION_WORKSPACE_TASK_BINDING_INVALID');
}

function assertDependencies(
  workspace: TranslationWorkspaceV2,
  dependencies: TranslationBlockDependenciesV2,
): void {
  const ids = new Set(workspace.plan.anchors.map((anchor) => anchor.anchorId));
  if (
    dependencies.planRevision !== workspace.plan.planRevision ||
    dependencies.contextRevision !== workspace.plan.documentContext.revision ||
    dependencies.methodVersion !== workspace.methodVersion ||
    [...dependencies.sourceAnchorIds, ...dependencies.contextAnchorIds].some(
      (id) => !ids.has(id),
    )
  ) {
    throw new Error('TRANSLATION_BLOCK_DEPENDENCIES_CHANGED');
  }
}

function requiredGeneration(
  workspace: TranslationWorkspaceV2,
  ref: string,
  attempt: AttemptRow,
): TranslationGenerationRequestV2 {
  const request = workspace.generationRequests.find(
    (entry) => entry.generationRequestRef === ref,
  );
  if (
    !request ||
    request.attemptId !== attempt.attemptId ||
    request.leaseGeneration !== attempt.leaseGeneration
  ) {
    throw new Error('TRANSLATION_GENERATION_BINDING_INVALID');
  }
  return request;
}

async function saveRequests(
  database: Database,
  scope: TranslationWorkspaceScope,
  workspace: TranslationWorkspaceV2,
  requests: TranslationGenerationRequestV2[],
): Promise<void> {
  await database
    .update(translationWorkspace)
    .set({
      generationRequestsJson: canonicalJson(requests),
      rowVersion: workspace.rowVersion + 1,
      updatedAt: new Date(),
    })
    .where(workspaceScope(scope));
}

function workspaceFromRow(row: WorkspaceRow): TranslationWorkspaceV2 {
  const plan = parseTranslationJson(
    row.sourcePlanJson,
    translationSourcePlanSchemaV2,
    'TRANSLATION_WORKSPACE_PLAN_INVALID',
  );
  if (
    plan.planRevision !== row.planRevision ||
    plan.documentContext.revision !== row.contextRevision ||
    plan.source.documentVersionId !== row.documentVersionId ||
    plan.source.packageId !== row.packageId ||
    plan.source.parsedArtifact.ref !== row.parsedArtifactRef ||
    plan.source.parsedArtifact.sha256 !== row.parsedArtifactSha256
  ) {
    throw new Error('TRANSLATION_WORKSPACE_PLAN_BINDING_INVALID');
  }
  return {
    workspaceId: row.workspaceId,
    tenantId: row.tenantId,
    workItemId: row.workItemId,
    rowVersion: row.rowVersion,
    methodVersion: row.methodVersion,
    activeAttemptId: row.activeAttemptId,
    plan,
    generationRequests: parseTranslationJson(
      row.generationRequestsJson,
      z.array(translationGenerationSchemaV2),
      'TRANSLATION_GENERATION_RECORD_INVALID',
    ),
    resultArtifact: row.resultArtifactJson
      ? parseTranslationJson(
          row.resultArtifactJson,
          translationArtifactDescriptorSchema,
          'TRANSLATION_FINAL_ARTIFACT_INVALID',
        )
      : null,
    resultManifest: row.resultManifestJson
      ? parseTranslationJson(
          row.resultManifestJson,
          translationManifestSchemaV2,
          'TRANSLATION_FINAL_MANIFEST_INVALID',
        )
      : null,
  };
}

function blockFromRow(row: SnapshotBlockRow): TranslationBlockRevisionV2 {
  const candidate = parseTranslationJson(
    row.candidateJson,
    translationCandidateSchemaV2,
    'TRANSLATION_SAVED_CANDIDATE_INVALID',
  );
  const dependencies = parseTranslationJson(
    row.dependenciesJson,
    translationDependenciesSchemaV2,
    'TRANSLATION_SAVED_DEPENDENCIES_INVALID',
  );
  const provenance = parseTranslationJson(
    row.provenanceJson,
    translationProvenanceSchemaV2,
    'TRANSLATION_SAVED_PROVENANCE_INVALID',
  );
  if (
    candidate.blockId !== row.blockId ||
    dependencies.planRevision !== row.planRevision ||
    provenance.originAttemptId !== row.originAttemptId ||
    provenance.generationRequestRef !== row.generationRequestRef ||
    provenance.authorUserId !== row.authorUserId ||
    provenance.authorKind !== row.authorKind
  ) {
    throw new Error('TRANSLATION_SAVED_CONTENT_BINDING_INVALID');
  }
  return {
    blockRevisionId: row.blockRevisionId,
    workspaceId: row.workspaceId,
    blockId: row.blockId,
    planRevision: row.planRevision,
    contentRevision: row.contentRevision,
    rowVersion: row.rowVersion,
    candidate,
    dependencies,
    provenance,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    savedAt: row.savedAt.toISOString(),
    check: row.checkJson
      ? parseTranslationJson(
          row.checkJson,
          translationCheckSchemaV2,
          'TRANSLATION_SAVED_CHECK_INVALID',
        )
      : null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    selectedForReading: row.selectedForReading,
  };
}

function parseOptionalDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error('TRANSLATION_GENERATED_AT_INVALID');
  return date;
}
