import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod/v4';
import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type {
  BilingualTranslationArtifactV2,
  TranslationBlockRevisionV2,
  TranslationResultManifestV2,
  TranslationWorkspaceReadingV2,
  TranslationWorkspaceV2,
} from '@shared/canonical-translation-v2.interface';
import {
  canonicalJson,
  parseTaskEnvelope,
} from '../action-attempt/action-attempt-envelope';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import type { OpenClawTaskEnvelope } from '../action-attempt/action-attempt-envelope.types';
import { parseExecutionModel } from '../model-settings/canonical-execution-model';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { buildTranslationSourcePlan } from './canonical-translation-source-plan';
import { assertTranslationArtifactV2 } from './canonical-translation-v2-artifact';
import {
  buildTranslationBatchV2,
  nextTranslationWorkV2,
  translationBatchDependenciesV2,
} from './canonical-translation-v2-batch';
import {
  TRANSLATION_V2_TASK_SCHEMA,
  translationCandidateSchemaV2,
  translationIssueSchemaV2,
  translationProvenanceSchemaV2,
  translationManifestSchemaV2,
  translationArtifactDescriptorSchema,
} from './canonical-translation-v2.contract';
import {
  buildTranslationWorkspaceReadingV2,
  checkTranslationBlockV2,
} from './canonical-translation-v2-quality';
import {
  CanonicalTranslationWorkspaceRepository,
  type TranslationWorkspaceFence,
} from './canonical-translation-workspace.repository';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
} from './canonical-service-scope.authorization';

const id = z.string().trim().min(1).max(200);
const positive = z.number().int().positive();
const base = {
  attemptRef: id,
  leaseToken: z.string().uuid(),
  leaseGeneration: positive,
};
const nullableTokens = z.number().int().nonnegative().nullable();
const actualExecution = z
  .strictObject({
    modelRef: id,
    modelVersion: z.string().trim().min(1),
    skillVersion: id,
    promptVersion: id,
    providerRequestId: z.string().min(1).nullable(),
    generatedAt: z.string().datetime().nullable(),
    usage: z.strictObject({
      inputTokens: nullableTokens,
      outputTokens: nullableTokens,
    }),
  })
  .transform((value) => ({
    ...value,
    providerRequestId: value.providerRequestId ?? null,
    generatedAt: value.generatedAt ?? null,
    usage: {
      inputTokens: value.usage.inputTokens ?? null,
      outputTokens: value.usage.outputTokens ?? null,
    },
  }));
const modelCandidate = z.strictObject({
  blockId: id,
  elements: z.array(
    z.strictObject({
      kind: z.enum([
        'paragraph',
        'heading',
        'list_item',
        'advisory',
        'table_cell',
        'caption',
        'label',
      ]),
      translatedText: z.string().refine((value) => value.trim().length > 0),
      anchorIds: z.array(id).min(1),
    }),
  ),
});
const semanticReview = z.strictObject({
  blockId: id,
  issues: z.array(
    translationIssueSchemaV2.omit({
      origin: true,
      blockIds: true,
      sourceFindingId: true,
    }),
  ),
});

export const translationWorkspaceCommandSchemaV2 = z.discriminatedUnion(
  'phase',
  [
    z.strictObject({ ...base, phase: z.literal('READ') }),
    z.strictObject({
      ...base,
      phase: z.literal('NEXT'),
      requestId: id,
      batchSemanticChecks: z.boolean().optional(),
    }),
    z.strictObject({
      ...base,
      phase: z.literal('READ_BATCH'),
      generationRequestRef: id,
      partIndex: z.number().int().nonnegative(),
    }),
    z.strictObject({
      ...base,
      phase: z.literal('SAVE'),
      generationRequestRef: id,
      candidates: z.array(modelCandidate).min(1),
      actualExecution,
    }),
    z.strictObject({
      ...base,
      phase: z.literal('CHECK'),
      generationRequestRef: id,
      expectedRowVersion: positive,
      semanticReview,
      actualExecution,
    }),
    z.strictObject({
      ...base,
      phase: z.literal('CHECK_BATCH'),
      generationRequestRef: id,
      semanticReviews: z.array(semanticReview).min(2).max(32),
      actualExecution,
    }),
    z.strictObject({
      ...base,
      phase: z.literal('RECORD_FAILURE'),
      generationRequestRef: id,
      error: z.strictObject({
        origin: z.enum([
          'TRANSPORT',
          'UPSTREAM',
          'OUTPUT_CONTRACT',
          'SOURCE',
          'TRANSLATION',
        ]),
        code: id,
        outcome: z.enum(['KNOWN_FAILURE', 'GENERATION_UNKNOWN']),
        retryable: z.boolean(),
      }),
    }),
    z.strictObject({ ...base, phase: z.literal('ASSEMBLE') }),
  ],
);
type WorkspaceCommand = z.infer<typeof translationWorkspaceCommandSchemaV2>;
const DELIVERY_PART_BYTES = 4_096;
export const translationFinalResultSchemaV2 = z.strictObject({
  schemaVersion: z.literal('wiselink.3_1.translation_final_result.v2'),
  workspaceId: id,
  manifest: translationManifestSchemaV2,
  artifact: translationArtifactDescriptorSchema,
  completeness: z.enum(['PARTIAL', 'COMPLETE_WITH_ISSUES', 'COMPLETE']),
});

@Injectable()
export class CanonicalTranslationV2Service {
  constructor(
    private readonly workspaces: CanonicalTranslationWorkspaceRepository,
    private readonly reader: UnifiedReaderService,
    private readonly attempts: ActionAttemptLifecycleService,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifacts: UnifiedArtifactStorePort,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  async prepare(workItem: CanonicalWorkItemProjection, tenantId: string) {
    if (!workItem.package || workItem.package.contractRevision !== 'frozen.2')
      throw new Error('TRANSLATION_STRUCTURED_SOURCE_NOT_READY');
    const source = await this.reader.readStructuredSource({
      artifact: workItem.package.artifact,
      packageId: workItem.package.packageId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (source.units.length !== workItem.package.contentUnitCount)
      throw new Error('TRANSLATION_SOURCE_UNIT_COUNT_MISMATCH');
    const firstHeading = source.units.find((unit) => unit.kind === 'heading')
      ?.payload.text;
    return this.workspaces.prepare({
      tenantId,
      workItemId: workItem.workItemId,
      plan: buildTranslationSourcePlan({
        documentVersionId: workItem.source.documentVersionId,
        packageId: workItem.package.packageId,
        parsedArtifact: workItem.package.artifact,
        title:
          typeof firstHeading === 'string' && firstHeading.trim()
            ? firstHeading
            : workItem.source.documentId,
        source,
      }),
    });
  }

  async validateRetranslationScope(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    blockIds: string[],
  ): Promise<void> {
    if (!workItem.package)
      throw new Error('TRANSLATION_STRUCTURED_SOURCE_NOT_READY');
    const workspace = await this.workspaces.readForSource({
      tenantId,
      workItemId: workItem.workItemId,
      documentVersionId: workItem.source.documentVersionId,
      parsedArtifactRef: workItem.package.artifact.ref,
      parsedArtifactSha256: workItem.package.artifact.sha256,
    });
    if (!workspace) throw new Error('TRANSLATION_WORKSPACE_NOT_FOUND');
    this.taskInput(workspace, blockIds);
  }

  taskInput(
    workspace: TranslationWorkspaceV2,
    retranslateBlockIds: string[] = [],
  ): Record<string, unknown> {
    if (
      new Set(retranslateBlockIds).size !== retranslateBlockIds.length ||
      retranslateBlockIds.some(
        (id) =>
          !workspace.plan.blocks.some(
            (block) =>
              block.blockId === id &&
              !block.sourceIssues.some((issue) => issue.severity === 'BLOCK'),
          ),
      )
    )
      throw new Error('TRANSLATION_REQUESTED_BLOCK_SCOPE_INVALID');
    return {
      schemaVersion: TRANSLATION_V2_TASK_SCHEMA,
      workspaceId: workspace.workspaceId,
      planRevision: workspace.plan.planRevision,
      contextRevision: workspace.plan.documentContext.revision,
      methodVersion: workspace.methodVersion,
      source: structuredClone(workspace.plan.source),
      ...(retranslateBlockIds.length
        ? { retranslateBlockIds: [...retranslateBlockIds] }
        : {}),
      requiredCapabilities: [
        'TRANSLATION_SEMANTIC_BLOCKS_V2',
        'TRANSLATION_DURABLE_BLOCKS_V2',
      ],
    };
  }

  async attach(input: TranslationWorkspaceFence) {
    return this.workspaces.attachAttempt(input);
  }

  /** One existing authenticated MCP boundary; the Host chooses scope and checks. */
  async execute(raw: WorkspaceCommand) {
    const input = translationWorkspaceCommandSchemaV2.parse(raw);
    const { fence, task, actorUserId, executionModel } =
      await this.scope(input);
    if (input.phase !== 'READ') await this.workspaces.attachAttempt(fence);
    const load = async () => {
      const { workspace, revisions } =
        await this.workspaces.readSnapshot(fence);
      return {
        workspace,
        revisions,
        reading: buildTranslationWorkspaceReadingV2(workspace, revisions),
      };
    };
    let state = await load();
    const requestedBlockIds =
      z
        .array(id)
        .max(64)
        .optional()
        .parse(task.modelInput.retranslateBlockIds) ?? [];
    const nextWork = () =>
      nextTranslationWorkV2(
        state.workspace,
        state.revisions,
        state.reading,
        undefined,
        {
          retranslateBlockIds: requestedBlockIds,
          batchSemanticChecks:
            input.phase === 'NEXT' && input.batchSemanticChecks === true,
        },
      );
    if (input.phase === 'READ') return summary(state.reading);
    if (input.phase === 'RECORD_FAILURE')
      return this.workspaces.recordGenerationFailure({
        ...fence,
        generationRequestRef: input.generationRequestRef,
        error: input.error,
      });
    if (input.phase === 'SAVE') {
      const saved = await this.workspaces.saveCandidates({
        ...fence,
        generationRequestRef: input.generationRequestRef,
        candidates: input.candidates.map((candidate) =>
          translationCandidateSchemaV2.parse({
            ...candidate,
            elements: candidate.elements.map((element, index) => ({
              ...element,
              elementId: `${input.generationRequestRef}:${candidate.blockId}:e${index + 1}`,
            })),
          }),
        ),
        actualExecution: input.actualExecution,
      });
      return {
        schemaVersion: 'wiselink.3_1.translation_block_save_receipt.v2',
        workspaceId: fence.workspaceId,
        generationRequestRef: input.generationRequestRef,
        blocks: saved.map((revision) => ({
          blockId: revision.blockId,
          blockRevisionId: revision.blockRevisionId,
          contentRevision: revision.contentRevision,
          rowVersion: revision.rowVersion,
          savedAt: revision.savedAt,
          checkedAt: revision.checkedAt,
          selectedForReading: revision.selectedForReading,
        })),
      };
    }
    if (input.phase === 'CHECK' || input.phase === 'CHECK_BATCH') {
      const request = state.workspace.generationRequests.find(
        (entry) => entry.generationRequestRef === input.generationRequestRef,
      );
      const targets =
        input.phase === 'CHECK_BATCH'
          ? (request?.checkTargets ?? [])
          : [
              {
                blockRevisionId: request?.targetBlockRevisionId ?? '',
                rowVersion: input.expectedRowVersion,
                blockId: request?.blockIds[0] ?? '',
              },
            ];
      const reviews =
        input.phase === 'CHECK_BATCH'
          ? input.semanticReviews
          : [input.semanticReview];
      if (
        !request ||
        request.purpose !== input.phase ||
        targets.length !== reviews.length ||
        (input.phase === 'CHECK_BATCH' &&
          targets.some(
            (target, index) => target.blockId !== reviews[index].blockId,
          ))
      )
        throw new Error('TRANSLATION_SEMANTIC_CHECK_TARGET_INVALID');
      if (input.actualExecution.modelRef !== executionModel.modelRef)
        throw new Error('TRANSLATION_SEMANTIC_CHECK_MODEL_MISMATCH');
      const {
        modelRef: _modelRef,
        generatedAt: _generatedAt,
        ...actual
      } = input.actualExecution;
      const provenance = translationProvenanceSchemaV2.parse({
        authorKind: 'MODEL',
        authorUserId: actorUserId,
        executionModel,
        ...actual,
        generationRequestRef: request.generationRequestRef,
        originAttemptId: task.actionAttemptId,
      });
      const checks = targets.map((target, index) => {
        const revision = state.revisions.find(
          (entry) => entry.blockRevisionId === target.blockRevisionId,
        );
        if (!revision || revision.blockId !== target.blockId)
          throw new Error('TRANSLATION_SEMANTIC_CHECK_TARGET_INVALID');
        return {
          blockRevisionId: target.blockRevisionId,
          expectedRowVersion: target.rowVersion,
          check: checkTranslationBlockV2({
            plan: state.workspace.plan,
            candidate: revision.candidate,
            semanticReview: { result: reviews[index], provenance },
          }),
        };
      });
      if (input.phase === 'CHECK_BATCH') {
        const saved = await this.workspaces.checkAndSelectBatch({
          ...fence,
          generationRequestRef: request.generationRequestRef,
          checks,
        });
        return {
          generationRequestRef: request.generationRequestRef,
          blocks: saved.map((entry) => ({
            blockId: entry.blockId,
            blockRevisionId: entry.blockRevisionId,
            rowVersion: entry.rowVersion,
            check: entry.check,
            selectedForReading: entry.selectedForReading,
          })),
        };
      }
      const saved = await this.workspaces.checkAndSelect({
        ...fence,
        ...checks[0],
      });
      return {
        blockRevisionId: saved.blockRevisionId,
        rowVersion: saved.rowVersion,
        check: saved.check,
        selectedForReading: saved.selectedForReading,
      };
    }
    if (input.phase === 'READ_BATCH')
      return this.batchPart(
        state.workspace,
        state.revisions,
        input.generationRequestRef,
        input.partIndex,
      );
    if (input.phase === 'NEXT') {
      const previous = state.workspace.generationRequests.find(
        (request) => request.clientRequestId === input.requestId,
      );
      if (previous) {
        if (
          previous.attemptId !== task.actionAttemptId ||
          previous.leaseGeneration !== input.leaseGeneration
        )
          throw new Error('TRANSLATION_GENERATION_IDEMPOTENCY_CONFLICT');
        if (previous.status !== 'REGISTERED')
          return {
            action: 'REQUEST_RECONCILED',
            generationRequestRef: previous.generationRequestRef,
            requestStatus: previous.status,
            progress: summary(state.reading),
          };
        return this.batchPart(
          state.workspace,
          state.revisions,
          previous.generationRequestRef,
          0,
        );
      }
      let next = nextWork();
      while (next.kind === 'LOCAL_CHECK') {
        await this.workspaces.checkAndSelect({
          ...fence,
          blockRevisionId: next.revision.blockRevisionId,
          expectedRowVersion: next.revision.rowVersion,
          check: checkTranslationBlockV2({
            plan: state.workspace.plan,
            candidate: next.revision.candidate,
          }),
        });
        state = await load();
        next = nextWork();
      }
      if (next.kind === 'DONE')
        return { action: 'DONE', progress: summary(state.reading) };
      if (next.kind === 'UNRESOLVED_GENERATION')
        return {
          action: 'UNRESOLVED_GENERATION',
          generationRequestRef: next.request.generationRequestRef,
          error: next.request.error,
          progress: summary(state.reading),
        };
      const request = await this.workspaces.registerGeneration({
        ...fence,
        clientRequestId: input.requestId,
        blockIds: next.blockIds,
        purpose: next.kind,
        targetBlockRevisionId: next.targetBlockRevisionId,
        ...(next.kind === 'CHECK_BATCH'
          ? { checkTargets: next.checkTargets }
          : {}),
        dependencies: translationBatchDependenciesV2(
          state.workspace,
          next.blockIds,
        ),
      });
      state = await load();
      return this.batchPart(
        state.workspace,
        state.revisions,
        request.generationRequestRef,
        0,
      );
    }
    if (input.phase === 'ASSEMBLE') {
      // A failed replacement must not report the older readable body as a new
      // successful translation. Keep it selected and retain the failed new work.
      if (
        requestedBlockIds.some(
          (blockId) =>
            !state.reading.blocks.some(
              (block) =>
                block.source.blockId === blockId &&
                block.selected?.provenance.originAttemptId ===
                  task.actionAttemptId,
            ),
        )
      )
        throw new Error('TRANSLATION_REQUESTED_BLOCK_NOT_REPLACED');
      return this.assembleSavedState(fence, state);
    }
    throw new Error('TRANSLATION_WORKSPACE_COMMAND_INVALID');
  }

  async assembleOfficial(fence: TranslationWorkspaceFence, assertAuthorized: () => Promise<void>) {
    const guard = async () => { await assertAuthorized(); await this.workspaces.assertOfficialExecution(fence); };
    await guard();
    const { workspace, revisions } = await this.workspaces.readSnapshot(fence);
    const result = await this.assembleSavedState(fence, {
      workspace, reading: buildTranslationWorkspaceReadingV2(workspace, revisions),
    }, guard);
    await assertAuthorized();
    return result;
  }

  private async assembleSavedState(fence: TranslationWorkspaceFence,
    state: { workspace: TranslationWorkspaceV2; reading: TranslationWorkspaceReadingV2 },
    beforeSave: () => Promise<void> = async () => undefined) {
      if (
        state.workspace.generationRequests.some(
          (request) => request.status === 'REGISTERED',
        ) ||
        state.reading.coverage.pendingCheckBlockCount > 0
      )
        throw new Error('TRANSLATION_WORK_NOT_READY_TO_ASSEMBLE');
      if (!state.reading.blocks.some((block) => block.selected))
        throw new Error('TRANSLATION_NO_READABLE_CANDIDATE');
      if (state.workspace.resultArtifact && state.workspace.resultManifest)
        return finalResult(state.workspace, state.reading);
      const manifest: TranslationResultManifestV2 = {
        workspaceId: state.workspace.workspaceId,
        planRevision: state.workspace.plan.planRevision,
        contextRevision: state.workspace.plan.documentContext.revision,
        workspaceRowVersion: state.workspace.rowVersion,
        blockRevisions: state.reading.blocks.flatMap((block) =>
          block.selected
            ? [
                {
                  blockId: block.source.blockId,
                  blockRevisionId: block.selected.blockRevisionId,
                  contentRevision: block.selected.contentRevision,
                },
              ]
            : [],
        ),
      };
      const value = finalArtifact(state.workspace, state.reading, manifest);
      assertTranslationArtifactV2(value);
      const bytes = new TextEncoder().encode(canonicalJson(value));
      const stored = await this.artifacts.persistAndReadback(bytes);
      if (!Buffer.from(stored.bytes).equals(Buffer.from(bytes)))
        throw new Error('TRANSLATION_FINAL_ARTIFACT_READBACK_MISMATCH');
      await beforeSave();
      // Artifact I/O occurs before the short manifest CAS transaction.
      const saved = await this.workspaces.saveFinalArtifact({
        ...fence,
        artifact: stored.artifact,
        manifest,
      });
      return finalResult(saved, state.reading);
  }

  async readCurrent(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
  ): Promise<TranslationWorkspaceReadingV2 | null> {
    if (!workItem.package) return null;
    const workspace = await this.workspaces.readForSource({
      tenantId,
      workItemId: workItem.workItemId,
      documentVersionId: workItem.source.documentVersionId,
      parsedArtifactRef: workItem.package.artifact.ref,
      parsedArtifactSha256: workItem.package.artifact.sha256,
    });
    if (!workspace) return null;
    const snapshot = await this.workspaces.readSnapshot(workspace);
    return buildTranslationWorkspaceReadingV2(
      snapshot.workspace,
      snapshot.revisions,
    );
  }

  async loadFinalForCommit(
    task: OpenClawTaskEnvelope,
    rawResult: unknown,
    workItem: CanonicalWorkItemProjection,
  ) {
    const result = translationFinalResultSchemaV2.parse(rawResult);
    if (
      task.modelInput.schemaVersion !== TRANSLATION_V2_TASK_SCHEMA ||
      task.modelInput.workspaceId !== result.workspaceId
    )
      throw new Error('TRANSLATION_FINAL_TASK_BINDING_INVALID');
    const { workspace, revisions } = await this.workspaces.readSnapshot({
      tenantId: task.tenantId,
      workItemId: task.workItemId,
      workspaceId: result.workspaceId,
    });
    if (
      workspace.activeAttemptId !== task.actionAttemptId ||
      workspace.plan.planRevision !== task.modelInput.planRevision ||
      workspace.plan.documentContext.revision !==
        task.modelInput.contextRevision ||
      workspace.methodVersion !== task.modelInput.methodVersion ||
      workspace.plan.source.documentVersionId !==
        workItem.source.documentVersionId ||
      workspace.plan.source.packageId !== workItem.package?.packageId ||
      canonicalJson(workspace.plan.source.parsedArtifact) !==
        canonicalJson(workItem.package?.artifact)
    )
      throw new Error('TRANSLATION_FINAL_SOURCE_OR_WORKSPACE_CHANGED');
    const reading = buildTranslationWorkspaceReadingV2(workspace, revisions);
    if (
      canonicalJson(finalResult(workspace, reading)) !== canonicalJson(result)
    )
      throw new Error('TRANSLATION_FINAL_RESULT_BINDING_INVALID');
    const value = finalArtifact(workspace, reading, result.manifest);
    assertTranslationArtifactV2(value);
    const bytes = await this.artifacts.readActualBytes(result.artifact);
    if (!Buffer.from(bytes).equals(Buffer.from(canonicalJson(value))))
      throw new Error('TRANSLATION_FINAL_ARTIFACT_READBACK_MISMATCH');
    return { result, value };
  }

  private async scope(
    input: z.infer<typeof translationWorkspaceCommandSchemaV2>,
  ) {
    const authorized = await this.serviceScope.authorizeOpenClawAttempt({
      operation: 'COMMIT_TRANSLATE',
      attemptRef: input.attemptRef,
    });
    const row = await this.attempts.readScoped({
      attemptRef: input.attemptRef,
      tenantId: authorized.tenantId,
      workItemId: authorized.workItemId,
    });
    const task = parseTaskEnvelope(row.taskEnvelopeJson ?? '');
    if (
      task.taskType !== 'OPENCLAW_TRANSLATE' ||
      task.operationRef !== input.attemptRef ||
      task.tenantId !== authorized.tenantId ||
      task.workItemId !== authorized.workItemId ||
      task.inputHash !== row.taskInputHash ||
      task.modelInput.schemaVersion !== TRANSLATION_V2_TASK_SCHEMA ||
      typeof task.modelInput.workspaceId !== 'string'
    )
      throw new Error('TRANSLATION_WORKSPACE_ATTEMPT_SCOPE_INVALID');
    const fence: TranslationWorkspaceFence = {
      tenantId: authorized.tenantId,
      workItemId: authorized.workItemId,
      workspaceId: task.modelInput.workspaceId,
      attemptRef: input.attemptRef,
      principalId: authorized.principalId,
      leaseToken: input.leaseToken,
      leaseGeneration: input.leaseGeneration,
    };
    return {
      fence,
      task,
      actorUserId: row.actorUserId,
      executionModel: parseExecutionModel(
        JSON.parse(row.executionModelJson ?? 'null'),
      ),
    };
  }

  private batchPart(
    workspace: TranslationWorkspaceV2,
    revisions: TranslationBlockRevisionV2[],
    ref: string,
    partIndex: number,
  ) {
    const request = workspace.generationRequests.find(
      (entry) => entry.generationRequestRef === ref,
    );
    if (
      !request ||
      request.status !== 'REGISTERED' ||
      request.attemptId !== workspace.activeAttemptId
    )
      throw new Error('TRANSLATION_BATCH_REQUEST_NOT_ACTIVE');
    if (request.error)
      return {
        action: 'UNRESOLVED_GENERATION',
        generationRequestRef: request.generationRequestRef,
        error: request.error,
      };
    const batch = buildTranslationBatchV2(workspace, request, revisions);
    const bytes = Buffer.from(canonicalJson(batch));
    const partCount = Math.ceil(bytes.length / DELIVERY_PART_BYTES);
    if (
      !Number.isSafeInteger(partIndex) ||
      partIndex < 0 ||
      partIndex >= partCount
    )
      throw new Error('TRANSLATION_BATCH_PART_INVALID');
    return {
      action: request.purpose,
      schemaVersion: 'wiselink.3_1.translation_batch_delivery.v2',
      workspaceId: workspace.workspaceId,
      generationRequestRef: ref,
      blockIds: request.blockIds,
      targetBlockRevisionId: request.targetBlockRevisionId,
      ...(request.checkTargets ? { checkTargets: request.checkTargets } : {}),
      targetRowVersion:
        revisions.find(
          (revision) =>
            revision.blockRevisionId === request.targetBlockRevisionId,
        )?.rowVersion ?? null,
      delivery: {
        partIndex,
        partCount,
        byteLength: bytes.length,
        payloadBase64: bytes
          .subarray(
            partIndex * DELIVERY_PART_BYTES,
            (partIndex + 1) * DELIVERY_PART_BYTES,
          )
          .toString('base64'),
      },
    };
  }
}

function summary(reading: TranslationWorkspaceReadingV2) {
  return {
    schemaVersion: 'wiselink.3_1.translation_workspace_progress.v2',
    workspaceId: reading.workspaceId,
    rowVersion: reading.rowVersion,
    completeness: reading.completeness,
    coverage: reading.coverage,
    blocks: reading.blocks.map((block) => ({
      blockId: block.source.blockId,
      readingStatus: block.readingStatus,
      blockRevisionId: block.selected?.blockRevisionId ?? null,
      issueCodes: block.issues.map((issue) => issue.code),
    })),
    finalCandidate: reading.finalCandidate,
  };
}

function finalArtifact(
  workspace: TranslationWorkspaceV2,
  reading: TranslationWorkspaceReadingV2,
  manifest: TranslationResultManifestV2,
): BilingualTranslationArtifactV2 {
  return {
    schemaVersion: 'wiselink.3_1.bilingual_translation_artifact.v2',
    candidateOnly: true,
    source: structuredClone(workspace.plan.source),
    methodVersion: workspace.methodVersion,
    manifest,
    completeness: reading.completeness,
    anchors: reading.anchors,
    blocks: reading.blocks,
    coverage: reading.coverage,
  };
}
function finalResult(
  workspace: TranslationWorkspaceV2,
  reading: TranslationWorkspaceReadingV2,
) {
  if (!workspace.resultArtifact || !workspace.resultManifest)
    throw new Error('TRANSLATION_FINAL_ARTIFACT_MISSING');
  return {
    schemaVersion: 'wiselink.3_1.translation_final_result.v2' as const,
    workspaceId: workspace.workspaceId,
    manifest: workspace.resultManifest,
    artifact: workspace.resultArtifact,
    completeness: reading.completeness,
  };
}
