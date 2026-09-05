import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import type {
  AppendReviewTextTurnRequest,
  AppendReviewTextTurnResponse,
  CloseReviewConversationResponse,
  CreateOrResumeReviewConversationResponse,
  CurrentReviewConversationResponse,
  ReviewConversationReadModel,
  ReviewTurnReadModel,
} from '@shared/api.interface';
import { SessionResolver } from '../identity/session-resolver.service';
import type { ResolvedSession } from '../identity/session-resolver.service';
import {
  CANONICAL_OBJECT_ACCESS,
  type CanonicalObjectAccessGrant,
  type CanonicalObjectAccessPort,
} from '../work-item/canonical-object-access.port';
import {
  ReviewConversationRepository,
  type PersistedReviewConversation,
  type PersistedReviewConversationAggregate,
  type PersistedReviewTurn,
} from './review-conversation.repository';
import { ReviewAttachmentService } from './review-attachment.service';
import type { ReviewAttachmentBinding } from './review-attachment.types';

@Injectable()
export class ReviewConversationService {
  constructor(
    private readonly sessions: SessionResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
    private readonly conversations: ReviewConversationRepository,
    private readonly attachments: ReviewAttachmentService,
  ) {}

  async createOrResume(
    workItemId: string,
    request: Request,
  ): Promise<CreateOrResumeReviewConversationResponse> {
    const authorized: AuthorizedReviewAccess = await this.authorize(
      request,
      workItemId,
      'RECORD_ENGINEER_REVIEW',
    );
    const result = await this.conversations.createOrResume({
      tenantId: authorized.grant.tenantId,
      actorId: authorized.grant.actorUserId,
      workItemId: authorized.grant.workItemId,
      currentRevision: authorized.grant.workItemRevision,
    });
    return {
      conversation: reviewConversationReadModel(
        result.aggregate,
        authorized.grant.workItemRevision,
      ),
      resumed: !result.created,
    };
  }

  async current(
    workItemId: string,
    request: Request,
  ): Promise<CurrentReviewConversationResponse> {
    const authorized: AuthorizedReviewAccess = await this.authorize(
      request,
      workItemId,
      'READ_WORK_ITEM',
    );
    const aggregate: PersistedReviewConversationAggregate | null =
      await this.conversations.loadCurrent({
        tenantId: authorized.grant.tenantId,
        actorId: authorized.grant.actorUserId,
        workItemId: authorized.grant.workItemId,
      });
    return {
      conversation: aggregate
        ? reviewConversationReadModel(
            aggregate,
            authorized.grant.workItemRevision,
          )
        : null,
      currentWorkItemRevision: authorized.grant.workItemRevision,
    };
  }

  async appendTextTurn(
    workItemId: string,
    reviewConversationId: string,
    input: AppendReviewTextTurnRequest,
    request: Request,
  ): Promise<AppendReviewTextTurnResponse> {
    const authorized: AuthorizedReviewAccess = await this.authorize(
      request,
      workItemId,
      'RECORD_ENGINEER_REVIEW',
    );
    const existing: PersistedReviewConversationAggregate =
      await this.requiredConversation(reviewConversationId);
    assertConversationBinding(existing.conversation, authorized);
    if (existing.conversation.status !== 'ACTIVE') {
      throw reviewConflict('REVIEW_CONVERSATION_CLOSED');
    }

    const replay: PersistedReviewTurn | undefined = existing.turns.find(
      (turn: PersistedReviewTurn) => turn.requestId === input.requestId,
    );
    if (replay) {
      assertAttachmentReplay(replay, input.attachmentSelection);
      return this.appendAndReadback({
        authorized,
        conversation: existing.conversation,
        requestId: input.requestId,
        userMessage: input.userMessage,
        selectedEvaluationItemId: input.selectedEvaluationItemId ?? null,
        attachmentBindings: replay.attachmentBindings,
      });
    }

    let attachmentBindings: ReviewAttachmentBinding[] = [];
    if (input.attachmentSelection) {
      const attachmentGrant: AuthorizedReviewAccess =
        await this.authorizeAttachment(
          authorized.session,
          workItemId,
          authorized.grant.workItemRevision,
        );
      assertSameGrant(authorized, attachmentGrant);
      const attachment: ReviewAttachmentBinding = await this.attachments.ingest(
        {
          selection: input.attachmentSelection,
          requestId: input.requestId,
          conversation: existing.conversation,
          session: authorized.session,
          grant: attachmentGrant.grant,
        },
      );
      const afterIngest: AuthorizedReviewAccess = await this.authorize(
        request,
        workItemId,
        'RECORD_ENGINEER_REVIEW',
      );
      assertSameGrant(authorized, afterIngest);
      if (
        afterIngest.grant.workItemRevision !== authorized.grant.workItemRevision
      ) {
        throw reviewConflict('REVIEW_ATTACHMENT_WORK_ITEM_STALE');
      }
      attachmentBindings = [attachment];
    }
    return this.appendAndReadback({
      authorized,
      conversation: existing.conversation,
      requestId: input.requestId,
      userMessage: input.userMessage,
      selectedEvaluationItemId: input.selectedEvaluationItemId ?? null,
      attachmentBindings,
    });
  }

  private async appendAndReadback(input: {
    authorized: AuthorizedReviewAccess;
    conversation: PersistedReviewConversation;
    requestId: string;
    userMessage: string;
    selectedEvaluationItemId: string | null;
    attachmentBindings: ReviewAttachmentBinding[];
  }): Promise<AppendReviewTextTurnResponse> {
    const appended = await this.conversations.appendTextTurn({
      conversation: input.conversation,
      requestId: input.requestId,
      userMessage: input.userMessage,
      selectedEvaluationItemId: input.selectedEvaluationItemId,
      currentRevision: input.authorized.grant.workItemRevision,
      attachmentBindings: input.attachmentBindings,
    });
    const aggregate: PersistedReviewConversationAggregate =
      await this.requiredConversation(input.conversation.reviewConversationId);
    return {
      conversation: reviewConversationReadModel(
        aggregate,
        input.authorized.grant.workItemRevision,
      ),
      turn: reviewTurnReadModel(appended.turn),
      replayed: appended.replayed,
    };
  }

  async close(
    workItemId: string,
    reviewConversationId: string,
    request: Request,
  ): Promise<CloseReviewConversationResponse> {
    const authorized: AuthorizedReviewAccess = await this.authorize(
      request,
      workItemId,
      'RECORD_ENGINEER_REVIEW',
    );
    const existing: PersistedReviewConversationAggregate =
      await this.requiredConversation(reviewConversationId);
    assertConversationBinding(existing.conversation, authorized);
    const closed = await this.conversations.close({
      conversation: existing.conversation,
      currentRevision: authorized.grant.workItemRevision,
    });
    return {
      conversation: reviewConversationReadModel(
        closed.aggregate,
        authorized.grant.workItemRevision,
      ),
      alreadyClosed: closed.alreadyClosed,
    };
  }

  private async requiredConversation(
    reviewConversationId: string,
  ): Promise<PersistedReviewConversationAggregate> {
    const aggregate: PersistedReviewConversationAggregate | null =
      await this.conversations.loadById(reviewConversationId);
    if (!aggregate) throw reviewNotFound();
    return aggregate;
  }

  private async authorize(
    request: Request,
    workItemId: string,
    action: 'READ_WORK_ITEM' | 'RECORD_ENGINEER_REVIEW',
  ): Promise<AuthorizedReviewAccess> {
    const session: ResolvedSession | null =
      await this.sessions.resolve(request);
    if (!session) throw sessionRequired();
    const result = await this.objectAccess.freshRead({
      actor: session.actor,
      action,
      accessRoot: { kind: 'WORK_ITEM', id: workItemId },
    });
    if (result.allowed === false) {
      throw Object.assign(new Error(result.code), {
        code: result.code,
        statusCode: result.statusCode,
      });
    }
    if (
      result.action !== action ||
      result.workItemId !== workItemId ||
      result.tenantId !== session.actor.tenantId ||
      result.actorUserId !== session.actor.canonicalSubject.id ||
      !Number.isSafeInteger(result.workItemRevision) ||
      result.workItemRevision < 0
    ) {
      throw reviewNotFound();
    }
    return { session, grant: result };
  }

  private async authorizeAttachment(
    session: ResolvedSession,
    workItemId: string,
    expectedWorkItemRevision: number,
  ): Promise<AuthorizedReviewAccess> {
    const result = await this.objectAccess.freshRead({
      actor: session.actor,
      action: 'INGEST_ATTACHMENT_SINGLE_REQUEST',
      accessRoot: { kind: 'WORK_ITEM', id: workItemId },
      expectedWorkItemRevision,
    });
    if (result.allowed === false) {
      throw Object.assign(new Error(result.code), {
        code: result.code,
        statusCode: result.statusCode,
      });
    }
    if (
      result.action !== 'INGEST_ATTACHMENT_SINGLE_REQUEST' ||
      result.workItemId !== workItemId ||
      result.tenantId !== session.actor.tenantId ||
      result.actorUserId !== session.actor.canonicalSubject.id ||
      result.workItemRevision !== expectedWorkItemRevision
    ) {
      throw reviewNotFound();
    }
    return { session, grant: result };
  }
}

interface AuthorizedReviewAccess {
  session: ResolvedSession;
  grant: CanonicalObjectAccessGrant;
}

function assertConversationBinding(
  conversation: PersistedReviewConversation,
  authorized: AuthorizedReviewAccess,
): void {
  if (
    conversation.workItemId !== authorized.grant.workItemId ||
    conversation.tenantId !== authorized.grant.tenantId ||
    conversation.actorId !== authorized.grant.actorUserId ||
    conversation.actorId !== authorized.session.actor.canonicalSubject.id
  ) {
    throw reviewNotFound();
  }
}

export function reviewConversationReadModel(
  aggregate: PersistedReviewConversationAggregate,
  currentWorkItemRevision: number,
): ReviewConversationReadModel {
  const conversation: PersistedReviewConversation = aggregate.conversation;
  return {
    schemaVersion: 'wiselink.3_1.review_conversation.v1.c1',
    reviewConversationId: conversation.reviewConversationId,
    workItemId: conversation.workItemId,
    startedAtRevision: conversation.startedAtRevision,
    lastSyncedRevision: conversation.lastSyncedRevision,
    currentWorkItemRevision,
    currentRevisionSynced:
      conversation.lastSyncedRevision === currentWorkItemRevision,
    status:
      conversation.status === 'CLOSED'
        ? 'CLOSED'
        : conversation.lastSyncedRevision === currentWorkItemRevision
          ? 'ACTIVE'
          : 'STALE_CONTEXT',
    createdAt: conversation.createdAt.toISOString(),
    lastActiveAt: conversation.lastActiveAt.toISOString(),
    closedAt: conversation.closedAt?.toISOString() ?? null,
    turns: aggregate.turns.map((turn: PersistedReviewTurn) =>
      reviewTurnReadModel(turn),
    ),
  };
}

export function reviewTurnReadModel(
  turn: PersistedReviewTurn,
): ReviewTurnReadModel {
  const attachmentRefs: string[] = (turn.attachmentBindings ?? []).map(
    (attachment: ReviewAttachmentBinding) => attachment.attachmentRef,
  );
  return {
    reviewTurnId: turn.reviewTurnId,
    turnNo: turn.turnNo,
    requestId: turn.requestId,
    inputRevision: turn.inputRevision,
    userMessage: turn.userMessage,
    selectedEvaluationItemId: turn.selectedEvaluationItemId ?? null,
    engineerSuppliedInput: {
      engineerSuppliedInputId: turn.engineerSuppliedInputId,
      inputType: 'ENGINEER_TEXT',
      adoptionStatus: 'CANDIDATE_UNADOPTED',
      text: turn.candidateText,
      attachmentRefs: [...attachmentRefs],
    },
    attachmentRefs,
    assistantCandidate: turn.assistantCandidate
      ? structuredClone(turn.assistantCandidate)
      : null,
    createdAt: turn.createdAt.toISOString(),
  };
}

function assertAttachmentReplay(
  turn: PersistedReviewTurn,
  selection: AppendReviewTextTurnRequest['attachmentSelection'],
): void {
  const selectedKeys: string[] = selection
    ? [`${selection.bucketId}\n${selection.filePath}`]
    : [];
  const storedKeys: string[] = turn.attachmentBindings.map(
    (attachment: ReviewAttachmentBinding) => attachment.selectionKey,
  );
  if (JSON.stringify(selectedKeys) !== JSON.stringify(storedKeys)) {
    throw reviewConflict('REVIEW_TURN_IDEMPOTENCY_CONFLICT');
  }
}

function assertSameGrant(
  expected: AuthorizedReviewAccess,
  actual: AuthorizedReviewAccess,
): void {
  if (
    expected.grant.workItemId !== actual.grant.workItemId ||
    expected.grant.tenantId !== actual.grant.tenantId ||
    expected.grant.actorUserId !== actual.grant.actorUserId ||
    expected.session.session.id !== actual.session.session.id
  ) {
    throw reviewNotFound();
  }
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
