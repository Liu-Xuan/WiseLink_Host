import {
  assertInput,
  isObjectLocalSourceFailure,
  workItemNotFound,
} from './automatic-work-item-authorization-input';
import { committedSuccessorRevision } from './successor-overall-recovery-authorization';
import { ReviewConversationRepository } from '../review-persistence/review-conversation.repository';
import { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import { parseCanonicalHostOpenClawAttemptTask } from './canonical-host-openclaw-runtime-policy';
import { parseReviewTurnTaskContract } from './canonical-host-openclaw-review.contract';
import type { AuthorizedSuccessorReviewDelegation } from './automatic-work-item-lease-authorization.port';
import { Inject, Injectable, Optional } from '@nestjs/common';

import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import {
  AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION,
  type AutomaticWorkItemSourceAuthorizationPort,
} from './automatic-work-item-source-authorization.port';
import {
  type AutomaticWorkItemLeaseAuthorizationInput,
  type AutomaticWorkItemLeaseAuthorizationPort,
  type AuthorizedAutomaticWorkItemLease,
} from './automatic-work-item-lease-authorization.port';

@Injectable()
// Registered by CanonicalHostModule.forRoot(); the static lint rule cannot follow its dynamic providers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class MiaodaAutomaticWorkItemLeaseAuthorizationAdapter implements AutomaticWorkItemLeaseAuthorizationPort {
  constructor(
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly sourceResolver: MiaodaDocumentVersionSourceResolver,
    @Inject(AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION)
    private readonly sourceAuthorization: AutomaticWorkItemSourceAuthorizationPort,
    @Optional() private readonly conversations?: ReviewConversationRepository,
    @Optional() private readonly attempts?: ActionAttemptRepository,
  ) {}

  async authorizePendingReview(input: {
    tenantId: string;
    principalId: string;
    workItemId: string;
  }) {
    const [binding] =
      await this.workItems.listCompletedAutoProcessingReviewSubjects({
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        limit: 1,
      });
    if (!binding || !this.conversations) throw workItemNotFound();
    const pending = await this.conversations.loadPendingOpenClawTurn({
      tenantId: input.tenantId,
      workItemId: input.workItemId,
      actorId: binding.authorization.actorUserId,
      requireSuccessorDelegation: true,
    });
    if (!pending) throw workItemNotFound();
    return this.authorizeReviewDelegation({
      ...input,
      reviewConversationRef: pending.reviewConversationId,
      requestId: pending.requestId,
    });
  }

  async authorizeReviewDelegation(
    input: {
      tenantId: string;
      principalId: string;
      workItemId: string;
      reviewConversationRef: string;
      requestId: string;
    },
    allowCommittedOverall = false,
  ): Promise<AuthorizedSuccessorReviewDelegation> {
    if (
      !this.conversations ||
      !input.principalId.startsWith('service:') ||
      !input.reviewConversationRef.trim() ||
      !input.requestId.trim()
    )
      throw workItemNotFound();
    const [binding] =
      await this.workItems.listCompletedAutoProcessingReviewSubjects({
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        limit: 1,
      });
    if (!binding) throw workItemNotFound();
    const { authorization: grant, workItem: row } = binding;
    if (
      grant.status !== 'COMPLETED' ||
      grant.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST' ||
      grant.tenantId !== input.tenantId ||
      grant.workItemId !== input.workItemId ||
      !grant.actorUserId.trim() ||
      grant.actorUserId.startsWith('service:') ||
      !/^[0-9a-f]{64}$/u.test(grant.sourceFileSha256) ||
      !Number.isSafeInteger(Number(grant.sourceByteLength)) ||
      Number(grant.sourceByteLength) < 1 ||
      row.tenantId !== grant.tenantId ||
      row.workItemId !== grant.workItemId ||
      row.requestedByUserId !== grant.actorUserId ||
      row.requestId !== grant.requestId ||
      row.documentId !== grant.documentId ||
      row.documentVersionId !== grant.documentVersionId ||
      row.sourceArtifactId !== grant.sourceArtifactId ||
      row.sourceFileSha256 !== grant.sourceFileSha256 ||
      Number(row.sourceByteLength) !== Number(grant.sourceByteLength) ||
      row.actionType !== 'PARSE_PDF' ||
      row.status !== 'CANDIDATE_READBACK_VERIFIED' ||
      !row.packageId
    )
      throw workItemNotFound();
    const bindingTurn = await this.conversations.loadOpenClawTurnBinding({
      tenantId: input.tenantId,
      actorId: grant.actorUserId,
      workItemId: input.workItemId,
      reviewConversationId: input.reviewConversationRef,
      requestId: input.requestId,
    });
    if (!bindingTurn) throw workItemNotFound();
    const { conversation, turn } = bindingTurn;
    const revisionMatches =
      turn.inputRevision === row.revision ||
      (allowCommittedOverall &&
        (await committedSuccessorRevision(
          { ...input, actorUserId: grant.actorUserId },
          turn,
          row.revision,
          this.workItems,
          this.attempts,
        )));
    // Historical payloads lack overallRequested. Never turn them into new delegation.
    if (
      conversation.status !== 'ACTIVE' ||
      conversation.actorId !== grant.actorUserId ||
      conversation.tenantId !== input.tenantId ||
      conversation.workItemId !== input.workItemId ||
      conversation.reviewConversationId !== input.reviewConversationRef ||
      turn.reviewConversationId !== input.reviewConversationRef ||
      turn.requestId !== input.requestId ||
      turn.executionRequested !== true ||
      turn.overallRequested === undefined ||
      turn.reviewScope ||
      !revisionMatches ||
      (turn.purpose !== 'CHAT' && turn.purpose !== 'UPDATE_ASSESSMENT') ||
      (turn.purpose === 'UPDATE_ASSESSMENT' &&
        turn.expectedInputRevision !== turn.inputRevision) ||
      (turn.overallRequested && turn.purpose !== 'UPDATE_ASSESSMENT')
    )
      throw workItemNotFound();
    const permission = await this.sourceAuthorization.authorizeSourceRead({
      tenantId: grant.tenantId,
      actorUserId: grant.actorUserId,
      workItemId: grant.workItemId,
      requestId: grant.requestId,
      documentId: grant.documentId,
      documentVersionId: grant.documentVersionId,
      sourceArtifactId: grant.sourceArtifactId,
      sourceFileSha256: grant.sourceFileSha256,
      sourceByteLength: Number(grant.sourceByteLength),
    });
    if (
      !permission.allowed ||
      permission.action !== 'DOCUMENT_READ' ||
      permission.authorizationPolicy !== 'MIAODA_HOST_DOCUMENT_READ' ||
      permission.tenantId !== grant.tenantId ||
      permission.actorUserId !== grant.actorUserId ||
      permission.documentId !== grant.documentId ||
      permission.documentVersionId !== grant.documentVersionId ||
      permission.sourceArtifactId !== grant.sourceArtifactId ||
      permission.sourceFileSha256 !== grant.sourceFileSha256 ||
      permission.sourceByteLength !== Number(grant.sourceByteLength)
    )
      throw workItemNotFound();
    let source: Awaited<
      ReturnType<MiaodaDocumentVersionSourceResolver['resolve']>
    >;
    try {
      source = await this.sourceResolver.resolve(grant.documentVersionId, {
        // A completed WorkItem may be corrected after a later document version
        // arrives. Keep the immutable source pinned to this historical task.
        requireCurrent: false,
        expectedCreatorUserId: grant.actorUserId,
      });
    } catch (error) {
      if (isObjectLocalSourceFailure(error)) throw workItemNotFound();
      throw error;
    }
    if (
      source.version.documentId !== grant.documentId ||
      source.version.documentVersionId !== grant.documentVersionId ||
      source.version.sourceArtifactId !== grant.sourceArtifactId ||
      source.artifact.sourceArtifactId !== grant.sourceArtifactId ||
      source.version.pdfSha256 !== grant.sourceFileSha256 ||
      source.artifact.sha256 !== grant.sourceFileSha256 ||
      Number(source.version.byteLength) !== Number(grant.sourceByteLength) ||
      Number(source.artifact.byteLength) !== Number(grant.sourceByteLength)
    )
      throw workItemNotFound();
    return {
      tenantId: input.tenantId,
      principalId: input.principalId,
      workItemId: input.workItemId,
      actorUserId: grant.actorUserId,
      documentId: grant.documentId,
      documentVersionId: grant.documentVersionId,
      sourceArtifactId: grant.sourceArtifactId,
      sourceFileSha256: grant.sourceFileSha256,
      sourceByteLength: Number(grant.sourceByteLength),
      reviewConversationRef: input.reviewConversationRef,
      reviewTurnRef: turn.reviewTurnId,
      requestId: input.requestId,
      inputRevision: turn.inputRevision,
      overallRequested: turn.overallRequested === true,
    };
  }

  async authorizeSuccessorOverall(input: {
    tenantId: string;
    principalId: string;
    workItemId: string;
    reviewTurnRef: string;
  }): Promise<AuthorizedSuccessorReviewDelegation> {
    const [subject] =
      await this.workItems.listCompletedAutoProcessingReviewSubjects({
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        limit: 1,
      });
    if (!subject || !this.conversations) throw workItemNotFound();
    const [binding] = await this.conversations.listSuccessorOverallTurnBindings(
      {
        tenantId: input.tenantId,
        actorId: subject.authorization.actorUserId,
        workItemId: input.workItemId,
        reviewTurnRef: input.reviewTurnRef,
        allowCommittedRevision: true,
        limit: 1,
      },
    );
    if (
      !binding ||
      binding.turn.reviewTurnId !== input.reviewTurnRef ||
      binding.turn.overallRequested !== true ||
      !binding.turn.assistantCandidate?.jobAidWorkingUpdate?.workRevisionRef
    )
      throw workItemNotFound();
    return this.authorizeReviewDelegation(
      {
        ...input,
        reviewConversationRef: binding.conversation.reviewConversationId,
        requestId: binding.turn.requestId,
      },
      true,
    );
  }

  async authorizeReviewAttempt(input: {
    tenantId: string;
    principalId: string;
    workItemId: string;
    attemptRef: string;
  }): Promise<AuthorizedSuccessorReviewDelegation | null> {
    if (!this.attempts) throw workItemNotFound();
    const row = await this.attempts.readByOperationRef(input.attemptRef);
    if (
      !row ||
      row.tenantId !== input.tenantId ||
      row.workItemId !== input.workItemId
    )
      throw workItemNotFound();
    // A non-Review attempt may use its own existing initial lease path. A rejected
    // Review must never fall back to that lease, including generic heartbeat/read.
    if (row.actionType === 'OPENCLAW_OVERALL_SYNTHESIS') {
      const task = parseCanonicalHostOpenClawAttemptTask(row);
      const pointer = task.modelInput.successorReviewTurnRef;
      if (pointer === undefined) return null;
      if (typeof pointer !== 'string' || !pointer.trim())
        throw workItemNotFound();
      const delegation = await this.authorizeSuccessorOverall({
        ...input,
        reviewTurnRef: pointer,
      });
      const successor = task.modelInput.successorOverallBinding;
      if (
        !successor ||
        typeof successor !== 'object' ||
        Array.isArray(successor) ||
        !('reviewConversationRef' in successor) ||
        successor.reviewConversationRef !== delegation.reviewConversationRef ||
        !('requestId' in successor) ||
        successor.requestId !== delegation.requestId ||
        !('inputRevision' in successor) ||
        successor.inputRevision !== delegation.inputRevision
      )
        throw workItemNotFound();
      if (
        // The Overall attempt executes as the existing service actor. The
        // engineer remains bound through the persisted turn and source grant.
        row.actorUserId !== 'service:openclaw-main' ||
        row.documentVersionId !== delegation.documentVersionId ||
        row.inputRevision !== delegation.inputRevision ||
        (row.leaseOwner !== null && row.leaseOwner !== input.principalId)
      )
        throw workItemNotFound();
      return delegation;
    }
    if (row.actionType !== 'OPENCLAW_INTERACTIVE_REVIEW') return null;
    const task = parseCanonicalHostOpenClawAttemptTask(row);
    const contract = parseReviewTurnTaskContract(task.modelInput);
    const delegation = await this.authorizeReviewDelegation({
      ...input,
      reviewConversationRef: contract.reviewConversationRef,
      requestId: contract.requestId,
    });
    if (
      delegation.reviewTurnRef !== contract.reviewTurnRef ||
      row.actorUserId !== delegation.actorUserId ||
      row.inputRevision !== delegation.inputRevision ||
      row.documentVersionId !== delegation.documentVersionId ||
      contract.matterContext ||
      (row.leaseOwner !== null && row.leaseOwner !== input.principalId)
    )
      throw workItemNotFound();
    return delegation;
  }

  async authorizeActiveLease(
    input: AutomaticWorkItemLeaseAuthorizationInput,
  ): Promise<AuthorizedAutomaticWorkItemLease> {
    assertInput(input);
    const now = new Date();
    const binding = await this.workItems.loadActiveAutoProcessingLease({
      tenantId: input.tenantId,
      workItemId: input.workItemId,
      leaseOwner: input.principalId,
      now,
    });
    if (!binding) throw workItemNotFound();

    const { authorization, workItem: row } = binding;
    if (
      authorization.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST' ||
      authorization.status !== 'LEASED' ||
      authorization.tenantId !== input.tenantId ||
      authorization.workItemId !== input.workItemId ||
      authorization.leaseOwner !== input.principalId ||
      !authorization.leaseToken ||
      !authorization.leaseExpiresAt ||
      authorization.leaseExpiresAt <= now ||
      (input.leaseToken !== undefined &&
        authorization.leaseToken !== input.leaseToken) ||
      (input.leaseGeneration !== undefined &&
        authorization.leaseGeneration !== input.leaseGeneration) ||
      row.tenantId !== authorization.tenantId ||
      row.workItemId !== authorization.workItemId ||
      row.requestId !== authorization.requestId ||
      row.requestedByUserId !== authorization.actorUserId ||
      row.documentId !== authorization.documentId ||
      row.documentVersionId !== authorization.documentVersionId ||
      row.sourceArtifactId !== authorization.sourceArtifactId ||
      row.sourceFileSha256 !== authorization.sourceFileSha256 ||
      Number(row.sourceByteLength) !== Number(authorization.sourceByteLength) ||
      row.actionType !== 'PARSE_PDF' ||
      row.status !== 'CANDIDATE_READBACK_VERIFIED' ||
      !row.packageId
    ) {
      throw workItemNotFound();
    }

    const owner = await this.workItems.loadAuthorizationBinding({
      workItemId: authorization.workItemId,
      tenantId: authorization.tenantId,
      actorUserId: authorization.actorUserId,
    });
    if (
      !owner ||
      owner.workItemId !== authorization.workItemId ||
      owner.tenantId !== authorization.tenantId ||
      owner.requestId !== authorization.requestId ||
      owner.documentId !== authorization.documentId ||
      owner.documentVersionId !== authorization.documentVersionId ||
      owner.requestedByUserId !== authorization.actorUserId
    ) {
      throw workItemNotFound();
    }

    const permission = await this.sourceAuthorization.authorizeSourceRead({
      tenantId: authorization.tenantId,
      actorUserId: authorization.actorUserId,
      workItemId: authorization.workItemId,
      requestId: authorization.requestId,
      documentId: authorization.documentId,
      documentVersionId: authorization.documentVersionId,
      sourceArtifactId: authorization.sourceArtifactId,
      sourceFileSha256: authorization.sourceFileSha256,
      sourceByteLength: Number(authorization.sourceByteLength),
    });
    if (
      !permission.allowed ||
      permission.action !== 'DOCUMENT_READ' ||
      permission.authorizationPolicy !== 'MIAODA_HOST_DOCUMENT_READ' ||
      permission.tenantId !== authorization.tenantId ||
      permission.actorUserId !== authorization.actorUserId ||
      permission.documentId !== authorization.documentId ||
      permission.documentVersionId !== authorization.documentVersionId ||
      permission.sourceArtifactId !== authorization.sourceArtifactId ||
      permission.sourceFileSha256 !== authorization.sourceFileSha256 ||
      permission.sourceByteLength !== Number(authorization.sourceByteLength)
    ) {
      throw workItemNotFound();
    }

    let source: Awaited<
      ReturnType<MiaodaDocumentVersionSourceResolver['resolve']>
    >;
    try {
      source = await this.sourceResolver.resolve(
        authorization.documentVersionId,
        {
          requireCurrent: true,
          expectedCreatorUserId: authorization.actorUserId,
        },
      );
    } catch (error) {
      if (isObjectLocalSourceFailure(error)) throw workItemNotFound();
      throw error;
    }
    if (
      source.version.documentId !== authorization.documentId ||
      source.version.documentVersionId !== authorization.documentVersionId ||
      source.version.sourceArtifactId !== authorization.sourceArtifactId ||
      source.artifact.sourceArtifactId !== authorization.sourceArtifactId ||
      source.version.pdfSha256 !== authorization.sourceFileSha256 ||
      source.artifact.sha256 !== authorization.sourceFileSha256 ||
      Number(source.version.byteLength) !==
        Number(authorization.sourceByteLength) ||
      Number(source.artifact.byteLength) !==
        Number(authorization.sourceByteLength)
    ) {
      throw workItemNotFound();
    }

    const current = await this.workItems.loadAutoProcessingProjection(
      authorization.workItemId,
      authorization.tenantId,
    );
    if (
      !current ||
      !current.projection ||
      current.row.workItemId !== authorization.workItemId ||
      current.row.requestedByUserId !== authorization.actorUserId ||
      current.row.revision !== row.revision ||
      current.row.packageId !== row.packageId ||
      current.projection.workItemId !== authorization.workItemId ||
      current.projection.requestId !== authorization.requestId ||
      current.projection.revision !== current.row.revision ||
      current.projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      current.projection.source.documentVersionId !==
        authorization.documentVersionId ||
      current.projection.package?.packageId !== row.packageId
    ) {
      throw workItemNotFound();
    }

    return {
      tenantId: authorization.tenantId,
      principalId: input.principalId,
      workItemId: authorization.workItemId,
      requestId: authorization.requestId,
      actorUserId: authorization.actorUserId,
      documentId: authorization.documentId,
      documentVersionId: authorization.documentVersionId,
      sourceArtifactId: authorization.sourceArtifactId,
      sourceFileSha256: authorization.sourceFileSha256,
      sourceByteLength: Number(authorization.sourceByteLength),
      leaseGeneration: authorization.leaseGeneration,
      leaseExpiresAt: authorization.leaseExpiresAt.toISOString(),
    };
  }
}
