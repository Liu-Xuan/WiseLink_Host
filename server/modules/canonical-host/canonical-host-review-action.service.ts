import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type {
  CanonicalEngineerReviewDecision,
  ConfirmReviewActionDraftRequest,
  ConfirmReviewActionDraftResponse,
  ReviewActionDraftCandidate,
} from '@shared/api.interface';
import { SessionResolver } from '../identity/session-resolver.service';
import type { ResolvedSession } from '../identity/session-resolver.service';
import {
  parseReviewAttachmentParsedArtifact,
  reviewAttachmentEvidenceStatement,
} from '../review-persistence/review-attachment-artifact';
import type { ReviewAttachmentBinding } from '../review-persistence/review-attachment.types';
import {
  ReviewConversationRepository,
  type PersistedReviewConversation,
  type PersistedReviewConversationAggregate,
  type PersistedReviewTurn,
} from '../review-persistence/review-conversation.repository';
import {
  reviewConversationReadModel,
  reviewTurnReadModel,
} from '../review-persistence/review-conversation.service';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessGrant,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';
import { CanonicalHostEngineerReviewService } from './canonical-host-engineer-review.service';
import type { CanonicalHostActor } from './canonical-host.types';
import type { CanonicalReviewEvidenceInput } from './selective-overall-resynthesis';

@Injectable()
export class CanonicalHostReviewActionService {
  constructor(
    private readonly sessions: SessionResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
    private readonly conversations: ReviewConversationRepository,
    private readonly engineerReviews: CanonicalHostEngineerReviewService,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
  ) {}

  async confirmDraft(
    workItemId: string,
    reviewConversationId: string,
    reviewTurnId: string,
    input: ConfirmReviewActionDraftRequest,
    request: Request,
  ): Promise<ConfirmReviewActionDraftResponse> {
    const session: ResolvedSession | null =
      await this.sessions.resolve(request);
    if (!session) throw sessionRequired();
    const grant = await this.authorize(session, workItemId);
    const aggregate = await this.conversations.loadById(reviewConversationId);
    if (!aggregate) throw reviewNotFound();
    const conversation = aggregate.conversation;
    const turn = aggregate.turns.find(
      (candidate: PersistedReviewTurn) =>
        candidate.reviewTurnId === reviewTurnId,
    );
    if (!turn) throw reviewNotFound();
    assertConfirmBinding({ conversation, turn, session, grant });

    const candidate = turn.assistantCandidate;
    const draft = candidate?.reviewActionDraft;
    if (
      !candidate ||
      candidate.responseType !== 'REVIEW_ACTION_DRAFT' ||
      !draft
    ) {
      throw reviewConflict('REVIEW_ACTION_DRAFT_REQUIRED');
    }
    assertCurrentDraft(draft, turn, conversation, grant, input);
    const draftResolvedGapRefs = draft.resolvedGapRefs ?? [];
    const resolvedGaps =
      draftResolvedGapRefs.length > 0
        ? await this.engineerReviews.resolveReviewActionGaps(
            {
              workItemId: conversation.workItemId,
              expectedRevision: draft.baseRevision,
              gapRefs: [...draftResolvedGapRefs],
              affectedCriterionIds: [...draft.affectedItemIds],
            },
            hostActor(session),
          )
        : {
            gapRefs: [] as string[],
            resolvedMissingInputs: [] as string[],
            affectedCriterionIds: [...draft.affectedItemIds],
          };
    const action = await this.deriveReviewAction(draft, turn, conversation);
    if (resolvedGaps.gapRefs.length > 0 && !action.evidence) {
      throw reviewConflict('REVIEW_ACTION_GAP_EVIDENCE_REQUIRED');
    }
    const updated = await this.engineerReviews.recordReviewAction(
      {
        workItemId: conversation.workItemId,
        expectedRevision: draft.baseRevision,
        criterionId: draft.evaluationItemId,
        affectedCriterionIds: [...resolvedGaps.affectedCriterionIds],
        comment: action.comment,
        ...(action.evidence
          ? {
              actionType: 'SUPPLEMENT_EVIDENCE' as const,
              evidence: action.evidence,
              resolvedMissingInputs: [...resolvedGaps.resolvedMissingInputs],
              uncertaintyDispositions: structuredClone(
                draft.uncertaintyDispositions,
              ),
              ...(draft.decisionSnapshot
                ? { decisionSnapshot: structuredClone(draft.decisionSnapshot) }
                : {}),
            }
          : {
              actionType: 'REVISE_JUDGMENT' as const,
              decision: decisionFor(draft.proposedStatus),
              uncertaintyDispositions: structuredClone(
                draft.uncertaintyDispositions,
              ),
              ...(draft.decisionSnapshot
                ? { decisionSnapshot: structuredClone(draft.decisionSnapshot) }
                : {}),
            }),
      },
      hostActor(session),
    );
    if (updated.revision !== draft.baseRevision + 1) {
      throw new Error('REVIEW_ACTION_REVISION_READBACK_INVALID');
    }
    const synced: PersistedReviewConversationAggregate =
      await this.conversations.syncAfterReviewAction({
        conversation,
        expectedRevision: draft.baseRevision,
        currentRevision: updated.revision,
      });
    const syncedTurn = synced.turns.find(
      (value: PersistedReviewTurn) => value.reviewTurnId === reviewTurnId,
    );
    if (!syncedTurn) throw new Error('REVIEW_ACTION_TURN_READBACK_FAILED');
    const overall = updated.integratedAssessment?.overallSynthesis ?? null;
    if (overall && overall.status !== 'STALE') {
      throw new Error('REVIEW_ACTION_OVERALL_STALE_READBACK_INVALID');
    }
    const engineerReview = updated.integratedAssessment?.engineerReviews;
    if (!engineerReview) {
      throw new Error('REVIEW_ACTION_LEDGER_READBACK_REQUIRED');
    }
    return {
      conversation: reviewConversationReadModel(synced, updated.revision),
      turn: reviewTurnReadModel(syncedTurn),
      reviewAction: {
        reviewActionDraftRef: draft.reviewActionDraftRef,
        evaluationItemId: draft.evaluationItemId,
        affectedItemIds: [...resolvedGaps.affectedCriterionIds],
        resolvedGapRefs: [...resolvedGaps.gapRefs],
        resolvedMissingInputs: [...resolvedGaps.resolvedMissingInputs],
        workItemRevision: updated.revision,
        engineerReviewRevision: engineerReview.revision,
        overallStatus: overall ? 'STALE' : 'NOT_AVAILABLE',
        overallRevision: overall?.revision ?? null,
        selectiveResynthesis: 'AFFECTED_ONLY_PENDING',
        uncertaintyDispositions: structuredClone(
          draft.uncertaintyDispositions,
        ),
        decisionSnapshot: draft.decisionSnapshot
          ? {
              ...structuredClone(draft.decisionSnapshot),
              revision: updated.revision,
              engineerConfirmationRef: engineerReview.actionAttemptId,
            }
          : null,
      },
    };
  }

  private async authorize(
    session: ResolvedSession,
    workItemId: string,
  ): Promise<CanonicalObjectAccessGrant> {
    const result = await this.objectAccess.freshRead({
      actor: session.actor,
      action: 'RECORD_ENGINEER_REVIEW',
      accessRoot: { kind: 'WORK_ITEM', id: workItemId },
    });
    if (result.allowed === false) {
      throw Object.assign(new Error(result.code), {
        code: result.code,
        statusCode: result.statusCode,
      });
    }
    if (
      result.action !== 'RECORD_ENGINEER_REVIEW' ||
      result.workItemId !== workItemId ||
      result.tenantId !== session.actor.tenantId ||
      result.actorUserId !== session.actor.canonicalSubject.id
    ) {
      throw reviewNotFound();
    }
    return result;
  }

  private async deriveReviewAction(
    draft: ReviewActionDraftCandidate,
    turn: PersistedReviewTurn,
    conversation: PersistedReviewConversation,
  ): Promise<{ comment: string; evidence?: CanonicalReviewEvidenceInput[] }> {
    const engineerInputRef = `engineer-input:${turn.engineerSuppliedInputId}`;
    const attachments = new Map(
      turn.attachmentBindings.map((attachment: ReviewAttachmentBinding) => [
        attachment.attachmentRef,
        attachment,
      ]),
    );
    const allowedAdopted = new Set([engineerInputRef, ...attachments.keys()]);
    for (const inputRef of draft.adoptedInputRefs) {
      if (
        !allowedAdopted.has(inputRef) &&
        !/^engineer-review:\d+$/.test(inputRef)
      ) {
        throw reviewConflict('REVIEW_ACTION_ADOPTED_INPUT_INVALID');
      }
    }
    const selectedAttachmentRefs = new Set(
      [...draft.adoptedInputRefs, ...draft.sourceRefs].filter((sourceRef) =>
        attachments.has(sourceRef),
      ),
    );
    const evidence: CanonicalReviewEvidenceInput[] = [];
    if (draft.adoptedInputRefs.includes(engineerInputRef)) {
      evidence.push({
        kind: 'ENGINEER_TEXT',
        statement: turn.candidateText,
        locator: engineerInputRef,
      });
    }
    for (const attachmentRef of selectedAttachmentRefs) {
      const attachment = attachments.get(attachmentRef)!;
      const parsed = parseReviewAttachmentParsedArtifact(
        await this.artifactStore.readActualBytes(attachment.parsedArtifact),
      );
      if (
        parsed.attachmentRef !== attachment.attachmentRef ||
        parsed.workItemId !== conversation.workItemId ||
        parsed.reviewConversationId !== conversation.reviewConversationId ||
        parsed.documentVersionId !== attachment.documentVersionId
      ) {
        throw reviewConflict('REVIEW_ACTION_ATTACHMENT_BINDING_INVALID');
      }
      evidence.push({
        kind: 'ATTACHMENT',
        statement: reviewAttachmentEvidenceStatement(parsed),
        locator: attachment.attachmentRef,
        artifact: structuredClone(attachment.parsedArtifact),
      });
    }
    return {
      comment: reviewActionComment(draft, turn),
      ...(evidence.length > 0 ? { evidence } : {}),
    };
  }
}

function assertConfirmBinding(input: {
  conversation: PersistedReviewConversation;
  turn: PersistedReviewTurn;
  session: ResolvedSession;
  grant: CanonicalObjectAccessGrant;
}): void {
  if (
    input.conversation.status !== 'ACTIVE' ||
    input.conversation.workItemId !== input.grant.workItemId ||
    input.conversation.tenantId !== input.grant.tenantId ||
    input.conversation.actorId !== input.grant.actorUserId ||
    input.conversation.actorId !== input.session.actor.canonicalSubject.id
  ) {
    throw reviewNotFound();
  }
}

function assertCurrentDraft(
  draft: ReviewActionDraftCandidate,
  turn: PersistedReviewTurn,
  conversation: PersistedReviewConversation,
  grant: CanonicalObjectAccessGrant,
  input: ConfirmReviewActionDraftRequest,
): void {
  if (
    input.reviewActionDraftRef !== draft.reviewActionDraftRef ||
    input.expectedRevision !== draft.baseRevision ||
    (draft.decisionSnapshot &&
      (draft.decisionSnapshot.workItemId !== conversation.workItemId ||
        draft.decisionSnapshot.revision !== draft.baseRevision ||
        draft.decisionSnapshot.engineerConfirmationRef !== null)) ||
    draft.baseRevision !== turn.inputRevision ||
    draft.baseRevision !== conversation.lastSyncedRevision ||
    draft.baseRevision !== grant.workItemRevision ||
    !draft.affectedItemIds.includes(draft.evaluationItemId)
  ) {
    throw reviewConflict('REVIEW_ACTION_DRAFT_STALE');
  }
}

function decisionFor(proposedStatus: string): CanonicalEngineerReviewDecision {
  const normalized = proposedStatus
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (['pass', 'satisfied', 'confirmed_pass'].includes(normalized)) {
    return 'confirmed_pass';
  }
  if (['fail', 'not_satisfied', 'confirmed_fail'].includes(normalized)) {
    return 'confirmed_fail';
  }
  if (
    [
      'conditionally_satisfied',
      'review_required',
      'returned_for_rework',
    ].includes(normalized)
  ) {
    return 'returned_for_rework';
  }
  if (['waiting_input', 'unknown', 'deferred'].includes(normalized)) {
    return 'deferred';
  }
  throw reviewConflict('REVIEW_ACTION_PROPOSED_STATUS_UNSUPPORTED');
}

function reviewActionComment(
  draft: ReviewActionDraftCandidate,
  turn: PersistedReviewTurn,
): string {
  const answer = turn.assistantCandidate?.answer.trim();
  const assumptions = draft.assumptions.length
    ? ` Assumptions: ${draft.assumptions.join('; ')}`
    : '';
  return `${answer || 'Confirmed assistant review draft'} Proposed status: ${
    draft.proposedStatus
  }.${assumptions}`;
}

function hostActor(session: ResolvedSession): CanonicalHostActor {
  return {
    userId: session.actor.canonicalSubject.id,
    tenantId: session.actor.tenantId,
    appId: session.actor.applicationScopeId,
    roles: [...session.actor.platformRoles],
    env: session.actor.env,
    objectAccessActor: session.actor,
  };
}

function sessionRequired(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('A valid OAuth session is required.'), {
    code: 'SESSION_REQUIRED',
    statusCode: 401,
  });
}

function reviewNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Review conversation was not found.'), {
    code: 'REVIEW_CONVERSATION_NOT_FOUND',
    statusCode: 404,
  });
}

function reviewConflict(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
