import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalAeoEditingDraftCreateRequest,
  CanonicalAeoEditingDraftFeedbackRequest,
  CanonicalAeoEditingDraftReadModel,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import {
  createAeoDraftAssistanceCandidate,
  diffAeoEditingKnowledgeVersions,
  regenerateAeoDraftSelection,
  recordAeoDraftFeedback,
  type AeoDraftAssistanceCandidate,
} from '../aeo-authoring/aeo-editing-knowledge';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';
import {
  assertAeoEditingDraftArtifact,
  buildAeoEditingBlockingGaps,
  encodeAeoEditingDraftArtifact,
  makeAeoEditingDraftArtifact,
  makeRoutineSeriesPatternDraft,
  parseAeoEditingDraftArtifact,
  toAeoEditingDraftReadModel,
  type CanonicalAeoEditingDraftArtifact,
} from './canonical-aeo-editing-draft.artifact';
import {
  CanonicalAeoEditingInputProducer,
  type CanonicalAeoEditingPreparedInput,
} from './canonical-aeo-editing-input.producer';
import {
  assertActualBytes,
  assertExpectedRevision,
  assertExpectedWorkItemRevision,
  assertSameBytes,
  currentDraftMatchesInput,
  draftProjection,
  errorCode,
  feedbackInput,
  requiredDraftProjection,
  requiredHostInput,
  withoutRevision,
} from './canonical-host-aeo-editing.utils';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationDecision,
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';

@Injectable()
export class CanonicalHostAeoEditingService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifacts: UnifiedArtifactStorePort,
    private readonly repository: MiaodaWorkItemRepository,
    private readonly inputProducer: CanonicalAeoEditingInputProducer,
  ) {}

  async createDraft(
    workItemId: string,
    request: CanonicalAeoEditingDraftCreateRequest,
    actor: CanonicalHostActor,
  ): Promise<CanonicalAeoEditingDraftReadModel> {
    assertExpectedRevision(request.expectedRevision);
    const workItem = await this.authorizeAndLoad(
      workItemId,
      actor,
      'CREATE_AEO_EDITING_DRAFT',
    );
    assertExpectedWorkItemRevision(workItem, request.expectedRevision);
    const prepared = await this.inputProducer.produce({
      workItem,
      request,
      actor,
    });
    const hostInput = prepared.hostInput;
    if (currentDraftMatchesInput(workItem, hostInput)) {
      return this.readPersistedDraft(workItem);
    }

    const draft = await this.buildDraft(workItem, prepared);
    const blockingGaps = draft.blockingGaps;
    const nextDraftRevision = (workItem.aeoEditingDraft?.revision ?? 0) + 1;
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: workItem.workItemId,
      actionType: 'CREATE_AEO_EDITING_DRAFT',
      triggerRequestId: workItem.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: nextDraftRevision,
    });
    if (!attempt.created) {
      return this.replayCompletedAttempt(
        workItemId,
        actor,
        'CREATE_AEO_EDITING_DRAFT',
        attempt.attemptId,
      );
    }

    try {
      const envelope = makeAeoEditingDraftArtifact({
        workItem,
        hostInput,
        draft: draft.candidate,
        blockingGaps,
      });
      const persisted = await this.persistEnvelope(envelope);
      const projection = draftProjection({
        previousRevision: workItem.aeoEditingDraft?.revision ?? 0,
        draft: draft.candidate,
        blockingGapCount: blockingGaps.length,
        hostInput,
        artifact: persisted,
        actionAttemptId: attempt.attemptId,
      });
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          aeoEditingInput: hostInput,
          aeoEditingDraft: projection,
        },
      });
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return toAeoEditingDraftReadModel({
        workItem: updated,
        artifact: envelope,
      });
    } catch (error) {
      await this.failAttempt(attempt.attemptId, error);
      throw error;
    }
  }

  async readDraft(
    workItemId: string,
    actor: CanonicalHostActor,
  ): Promise<CanonicalAeoEditingDraftReadModel> {
    const workItem = await this.authorizeAndLoad(
      workItemId,
      actor,
      'READ_AEO_EDITING_DRAFT',
    );
    return this.readPersistedDraft(workItem);
  }

  async recordFeedback(
    workItemId: string,
    request: CanonicalAeoEditingDraftFeedbackRequest,
    actor: CanonicalHostActor,
  ): Promise<CanonicalAeoEditingDraftReadModel> {
    assertExpectedRevision(request.expectedRevision);
    const workItem = await this.authorizeAndLoad(
      workItemId,
      actor,
      'RECORD_AEO_DRAFT_FEEDBACK',
    );
    assertExpectedWorkItemRevision(workItem, request.expectedRevision);
    requiredHostInput(workItem);
    const current = await this.readPersistedEnvelope(workItem);
    const updatedDraft = recordAeoDraftFeedback(
      current.draft,
      feedbackInput(workItem, request, actor),
    );
    const projection = requiredDraftProjection(workItem);
    const nextDraftRevision = projection.revision + 1;
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: workItem.workItemId,
      actionType: 'RECORD_AEO_DRAFT_FEEDBACK',
      triggerRequestId: workItem.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: nextDraftRevision,
    });
    if (!attempt.created) {
      return this.replayCompletedAttempt(
        workItemId,
        actor,
        'RECORD_AEO_DRAFT_FEEDBACK',
        attempt.attemptId,
      );
    }

    try {
      const envelope: CanonicalAeoEditingDraftArtifact = {
        ...current,
        draftRevision: projection.revision + 1,
        draft: updatedDraft,
      };
      const persisted = await this.persistEnvelope(envelope);
      const nextProjection = draftProjection({
        previousRevision: projection.revision,
        draft: updatedDraft,
        blockingGapCount: current.blockingGaps.length,
        hostInput: requiredHostInput(workItem),
        artifact: persisted,
        actionAttemptId: attempt.attemptId,
      });
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          aeoEditingDraft: nextProjection,
        },
      });
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return toAeoEditingDraftReadModel({
        workItem: updated,
        artifact: envelope,
      });
    } catch (error) {
      await this.failAttempt(attempt.attemptId, error);
      throw error;
    }
  }

  private async buildDraft(
    workItem: CanonicalWorkItemProjection,
    prepared: CanonicalAeoEditingPreparedInput,
  ): Promise<{
    candidate: AeoDraftAssistanceCandidate;
    blockingGaps: ReturnType<typeof buildAeoEditingBlockingGaps>;
  }> {
    const { hostInput, knowledge, routine } = prepared;
    if (routine) {
      if (
        workItem.aeoEditingDraft &&
        workItem.aeoEditingInput?.inputKind !== 'ROUTINE_SERIES_PATTERN'
      ) {
        throw new Error('AEO_EDITING_REGENERATION_KIND_CHANGED');
      }
      const generationRevision =
        (workItem.aeoEditingDraft?.generationRevision ?? 0) + 1;
      return {
        candidate: makeRoutineSeriesPatternDraft({
          workItemId: workItem.workItemId,
          title: hostInput.draftTitle,
          generationRevision,
          sources: routine.sources,
          currentSourceRefs: routine.sourceRefs,
        }),
        blockingGaps: [
          {
            code: 'AEO_ROUTINE_SERIES_PATTERN_NOT_GENERIC',
            message:
              'Observed B777 routine revision evidence is retained as a series-specific blocking gap and generated zero authoring suggestions.',
            sourceRefs: routine.sourceRefs,
            blocking: true,
          },
        ],
      };
    }
    if (!knowledge) throw new Error('AEO_EDITING_KNOWLEDGE_REQUIRED');
    const previousInput = workItem.aeoEditingInput;
    const previousProjection = workItem.aeoEditingDraft;
    if (previousInput && previousProjection) {
      const current = await this.readPersistedEnvelope(workItem);
      const previousKnowledge =
        await this.inputProducer.readBoundKnowledge(previousInput);
      if (!previousKnowledge) {
        throw new Error('AEO_EDITING_REGENERATION_KIND_CHANGED');
      }
      if (
        !sameStringSet(previousInput.selectedUnitIds, hostInput.selectedUnitIds)
      ) {
        throw new Error(
          'AEO_EDITING_REGENERATION_SELECTION_CHANGE_UNSUPPORTED',
        );
      }
      const diff = diffAeoEditingKnowledgeVersions(
        previousKnowledge,
        knowledge,
      );
      if (!diff.sameMatter) {
        throw new Error('AEO_DRAFT_REGENERATION_MATTER_IDENTITY_MISMATCH');
      }
      if (diff.changes.some((change) => change.change === 'REMOVED')) {
        throw new Error('AEO_EDITING_REGENERATION_REMOVED_UNIT_UNSUPPORTED');
      }
      const affected = diff.changes
        .filter(
          (change) =>
            change.change !== 'UNCHANGED' &&
            hostInput.selectedUnitIds.includes(change.unitId),
        )
        .map((change) => change.unitId);
      if (affected.length === 0) {
        throw new Error('AEO_EDITING_REGENERATION_SEMANTIC_NOOP');
      }
      return {
        candidate: regenerateAeoDraftSelection(
          current.draft,
          {
            draftKey: workItem.workItemId,
            title: hostInput.draftTitle,
            knowledge,
            selectedUnitIds: affected,
            currentSourceRefs: hostInput.currentSourceRefs,
            expectedGenerationRevision: current.draft.generationRevision,
          },
          'Host current producer and source manifest revision advanced.',
        ),
        blockingGaps: buildAeoEditingBlockingGaps(knowledge),
      };
    }
    return {
      candidate: createAeoDraftAssistanceCandidate({
        draftKey: workItem.workItemId,
        title: hostInput.draftTitle,
        knowledge,
        selectedUnitIds: hostInput.selectedUnitIds,
        currentSourceRefs: hostInput.currentSourceRefs,
      }),
      blockingGaps: buildAeoEditingBlockingGaps(knowledge),
    };
  }

  private async persistEnvelope(
    envelope: CanonicalAeoEditingDraftArtifact,
  ): Promise<UnifiedPackageArtifactDescriptor> {
    const bytes = encodeAeoEditingDraftArtifact(envelope);
    const persisted = await this.artifacts.persistAndReadback(bytes);
    assertSameBytes(bytes, persisted.bytes);
    assertActualBytes(
      persisted.bytes,
      persisted.artifact,
      'AEO_EDITING_DRAFT_PERSISTED_BYTES_MISMATCH',
    );
    return persisted.artifact;
  }

  private async readPersistedDraft(
    workItem: CanonicalWorkItemProjection,
  ): Promise<CanonicalAeoEditingDraftReadModel> {
    const artifact = await this.readPersistedEnvelope(workItem);
    return toAeoEditingDraftReadModel({ workItem, artifact });
  }

  private async readPersistedEnvelope(
    workItem: CanonicalWorkItemProjection,
  ): Promise<CanonicalAeoEditingDraftArtifact> {
    const projection = requiredDraftProjection(workItem);
    const bytes = await this.artifacts.readActualBytes(projection.artifact);
    assertActualBytes(
      bytes,
      projection.artifact,
      'AEO_EDITING_DRAFT_ACTUAL_BYTES_MISMATCH',
    );
    const artifact = parseAeoEditingDraftArtifact(bytes);
    assertAeoEditingDraftArtifact({ artifact, projection, workItem });
    return artifact;
  }

  private async authorizeAndLoad(
    workItemId: string,
    actor: CanonicalHostActor,
    action: CanonicalAuthorizationDecision['action'],
  ): Promise<CanonicalWorkItemProjection> {
    return (
      await authorizeAndLoadCanonicalWorkItem({
        authorization: this.authorization,
        permissionSnapshots: this.permissionSnapshots,
        registrar: this.registrar,
        actor,
        action,
        workItemId,
      })
    ).workItem;
  }

  private async replayCompletedAttempt(
    workItemId: string,
    actor: CanonicalHostActor,
    action: CanonicalAuthorizationDecision['action'],
    attemptId: string,
  ): Promise<CanonicalAeoEditingDraftReadModel> {
    const current = await this.authorizeAndLoad(workItemId, actor, action);
    if (current.aeoEditingDraft?.actionAttemptId !== attemptId) {
      throw new Error('AEO_EDITING_DRAFT_INCOMPLETE_PRIOR_ATTEMPT');
    }
    return this.readPersistedDraft(current);
  }

  private async failAttempt(attemptId: string, error: unknown): Promise<void> {
    await this.repository.failAssessmentAction({
      attemptId,
      errorCode: errorCode(error),
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}
