import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalAeoEditingDraftCreateRequest,
  CanonicalAeoEditingDraftFeedbackRequest,
  CanonicalAeoEditingDraftReadModel,
  CanonicalAeoEditingInputProjection,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import {
  createAeoDraftAssistanceCandidate,
  ingestAeoEditingKnowledgeCandidate,
  recordAeoDraftFeedback,
  type AeoDraftAssistanceCandidate,
  type AeoEditingKnowledgeCandidate,
} from '../aeo-authoring/aeo-editing-knowledge';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';
import {
  assertAeoEditingDraftArtifact,
  bindAeoEditingKnowledgeToHostSources,
  buildAeoEditingBlockingGaps,
  encodeAeoEditingDraftArtifact,
  makeAeoEditingDraftArtifact,
  parseAeoEditingDraftArtifact,
  toAeoEditingDraftReadModel,
  type CanonicalAeoEditingDraftArtifact,
} from './canonical-aeo-editing-draft.artifact';
import {
  assertActualBytes,
  assertExpectedRevision,
  assertExpectedWorkItemRevision,
  assertSameBytes,
  currentDraftMatchesInput,
  draftProjection,
  errorCode,
  feedbackInput,
  parseJson,
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
    const hostInput = requiredHostInput(workItem);
    if (currentDraftMatchesInput(workItem, hostInput)) {
      return this.readPersistedDraft(workItem);
    }

    const draft = await this.buildDraft(workItem, hostInput);
    const blockingGaps = buildAeoEditingBlockingGaps(draft.knowledge);
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
    hostInput: CanonicalAeoEditingInputProjection,
  ): Promise<{
    knowledge: AeoEditingKnowledgeCandidate;
    candidate: AeoDraftAssistanceCandidate;
  }> {
    const [producerBytes, manifestBytes] = await Promise.all([
      this.artifacts.readActualBytes(hostInput.currentProducerArtifact),
      this.artifacts.readActualBytes(hostInput.sourceManifestArtifact),
    ]);
    assertActualBytes(
      producerBytes,
      hostInput.currentProducerArtifact,
      'AEO_EDITING_CURRENT_PRODUCER_ACTUAL_BYTES_MISMATCH',
    );
    assertActualBytes(
      manifestBytes,
      hostInput.sourceManifestArtifact,
      'AEO_EDITING_SOURCE_MANIFEST_ACTUAL_BYTES_MISMATCH',
    );
    const producer = parseJson(
      producerBytes,
      'AEO_EDITING_CURRENT_PRODUCER_JSON_INVALID',
    );
    const manifest = parseJson(
      manifestBytes,
      'AEO_EDITING_SOURCE_MANIFEST_JSON_INVALID',
    );
    const normalized = ingestAeoEditingKnowledgeCandidate(producer, manifest);
    const knowledge = bindAeoEditingKnowledgeToHostSources(
      normalized,
      hostInput,
    );
    return {
      knowledge,
      candidate: createAeoDraftAssistanceCandidate({
        draftKey: workItem.workItemId,
        title: hostInput.draftTitle,
        knowledge,
        selectedUnitIds: hostInput.selectedUnitIds,
        currentSourceRefs: hostInput.currentSourceRefs,
      }),
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
