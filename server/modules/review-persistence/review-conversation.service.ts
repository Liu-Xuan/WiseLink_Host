import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Request } from 'express';

import type {
  AppendReviewTextTurnRequest,
  CanonicalExecutionModelSelection,
  AppendReviewTextTurnResponse,
  CloseReviewConversationResponse,
  CreateOrResumeReviewConversationResponse,
  CurrentReviewConversationResponse,
  ReviewConversationReadModel,
  ReviewTurnReadModel,
  ReviewScopeSelection,
  AppendMatterReviewScope,
} from '@shared/api.interface';
import { SessionResolver } from '../identity/session-resolver.service';
import { ReviewAttemptDispatchService } from '../action-attempt/review-attempt-dispatch.service';
import { CanonicalModelSettingsService } from '../model-settings/canonical-model-settings.service';
import { taskModelSelection } from '../model-settings/canonical-model-catalog';
import { readStoredExecutionModel } from '../model-settings/canonical-execution-model';
import { isOpenClawAutomaticReviewConfigured } from '../canonical-host/configured-development-service-scope.authorization';
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
import { EngineeringMatterWorkingService } from '../canonical-host/engineering-matter-working.service';
import type { CanonicalHostActor } from '../canonical-host/canonical-host.types';
import {
  assertReviewScopeReplay,
  reviewScopeSelection,
  sameReviewBusinessScope,
  type PersistedMatterReviewScope,
} from './review-business-scope';

@Injectable()
export class ReviewConversationService {
  constructor(
    private readonly sessions: SessionResolver,
    @Inject(CANONICAL_OBJECT_ACCESS)
    private readonly objectAccess: CanonicalObjectAccessPort,
    private readonly conversations: ReviewConversationRepository,
    private readonly attachments: ReviewAttachmentService,
    private readonly dispatch: ReviewAttemptDispatchService,
    private readonly modelSettings: CanonicalModelSettingsService,
    @Optional()
    private readonly matterWorking?: EngineeringMatterWorkingService,
  ) {}

  async createOrResume(
    workItemId: string,
    request: Request,
    reviewScope: ReviewScopeSelection = { kind: 'WORK_ITEM' },
  ): Promise<CreateOrResumeReviewConversationResponse> {
    const authorized: AuthorizedReviewAccess = await this.authorize(
      request,
      workItemId,
      'RECORD_ENGINEER_REVIEW',
    );
    await this.authorizeMatterSelection(authorized, reviewScope);
    const result = await this.conversations.createOrResume({
      tenantId: authorized.grant.tenantId,
      actorId: authorized.grant.actorUserId,
      workItemId: authorized.grant.workItemId,
      currentRevision: authorized.grant.workItemRevision,
    });
    return {
      conversation: await this.projectConversation(
        result.aggregate,
        authorized.grant.workItemRevision,
        reviewScope,
        authorized,
      ),
      resumed: !result.created,
    };
  }

  async current(
    workItemId: string,
    request: Request,
    reviewScope: ReviewScopeSelection = { kind: 'WORK_ITEM' },
  ): Promise<CurrentReviewConversationResponse> {
    const authorized: AuthorizedReviewAccess = await this.authorize(
      request,
      workItemId,
      'READ_WORK_ITEM',
    );
    await this.authorizeMatterSelection(authorized, reviewScope);
    const aggregate: PersistedReviewConversationAggregate | null =
      await this.conversations.loadCurrent({
        tenantId: authorized.grant.tenantId,
        actorId: authorized.grant.actorUserId,
        workItemId: authorized.grant.workItemId,
      });
    return {
      conversation: aggregate
        ? await this.projectConversation(
            aggregate,
            authorized.grant.workItemRevision,
            reviewScope,
            authorized,
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
    if (input.reviewScope && input.selectedEvaluationItemId != null)
      throw reviewConflict('REVIEW_MATTER_EVALUATION_SCOPE_INVALID');
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
      assertReviewScopeReplay(replay.reviewScope, input.reviewScope);
      await this.authorizeMatterSelection(
        authorized,
        reviewScopeSelection(replay.reviewScope),
      );
      await this.authorizeTurnMatterInputs(authorized, [replay]);
      assertAttachmentReplay(replay, input.attachmentSelection);
      if (
        input.modelRef !== undefined &&
        input.modelRef !== replay.requestedModel?.modelRef
      ) {
        throw reviewConflict('REVIEW_TURN_IDEMPOTENCY_CONFLICT');
      }
      return this.appendAndReadback({
        authorized,
        conversation: existing.conversation,
        requestId: input.requestId,
        userMessage: input.userMessage,
        selectedEvaluationItemId: input.selectedEvaluationItemId ?? null,
        executionRequested: input.executionMode === 'AUTOMATIC',
        attachmentBindings: replay.attachmentBindings,
        requestedModel: replay.requestedModel,
        reviewScope: replay.reviewScope ?? null,
      });
    }

    if (
      input.executionMode === 'AUTOMATIC' &&
      !isOpenClawAutomaticReviewConfigured(existing.conversation)
    ) {
      throw Object.assign(
        new Error('Automatic review is not available for this work item.'),
        {
          code: 'REVIEW_AUTOMATIC_EXECUTION_UNAVAILABLE',
          statusCode: 503,
        },
      );
    }

    const inherited =
      input.modelRef === undefined
        ? await this.inheritedModel({
            ...existing,
            turns: existing.turns.filter((turn) =>
              sameReviewBusinessScope(turn.reviewScope, input.reviewScope),
            ),
          })
        : null;
    const requestedModel = taskModelSelection(
      input.modelRef ?? inherited?.modelRef,
    );
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
      executionRequested: input.executionMode === 'AUTOMATIC',
      attachmentBindings,
      requestedModel,
      reviewScope: input.reviewScope
        ? await this.freezeMatterScope(authorized, input.reviewScope)
        : null,
    });
  }

  private async appendAndReadback(input: {
    authorized: AuthorizedReviewAccess;
    conversation: PersistedReviewConversation;
    requestId: string;
    userMessage: string;
    selectedEvaluationItemId: string | null;
    executionRequested: boolean;
    attachmentBindings: ReviewAttachmentBinding[];
    requestedModel?: CanonicalExecutionModelSelection;
    reviewScope?: PersistedMatterReviewScope | null;
  }): Promise<AppendReviewTextTurnResponse> {
    const appended = await this.conversations.appendTextTurn({
      conversation: input.conversation,
      requestId: input.requestId,
      userMessage: input.userMessage,
      selectedEvaluationItemId: input.selectedEvaluationItemId,
      executionRequested: input.executionRequested,
      currentRevision: input.authorized.grant.workItemRevision,
      attachmentBindings: input.attachmentBindings,
      requestedModel: input.requestedModel,
      reviewScope: input.reviewScope,
    });
    const aggregate: PersistedReviewConversationAggregate =
      await this.requiredConversation(input.conversation.reviewConversationId);
    const conversation = await this.projectConversation(
      aggregate,
      input.authorized.grant.workItemRevision,
      reviewScopeSelection(input.reviewScope),
      input.authorized,
    );
    return {
      conversation,
      turn: conversation.turns.find(
        (turn) => turn.reviewTurnId === appended.turn.reviewTurnId,
      )!,
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
      conversation: await this.projectConversation(
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

  private async projectConversation(
    aggregate: PersistedReviewConversationAggregate,
    currentRevision: number,
    selected: ReviewScopeSelection = { kind: 'WORK_ITEM' },
    authorized?: AuthorizedReviewAccess,
  ): Promise<ReviewConversationReadModel> {
    aggregate = {
      ...aggregate,
      turns: aggregate.turns.filter((turn) =>
        sameReviewBusinessScope(turn.reviewScope, selected),
      ),
    };
    if (authorized)
      await this.authorizeTurnMatterInputs(authorized, aggregate.turns);
    const model = reviewConversationReadModel(aggregate, currentRevision);
    model.reviewScope = selected;
    const conversation = aggregate.conversation;
    model.automaticExecutionAvailable =
      conversation.status === 'ACTIVE' &&
      isOpenClawAutomaticReviewConfigured(conversation);
    model.turns = await Promise.all(
      aggregate.turns.map(async (turn) => ({
        ...reviewTurnReadModel(turn),
        execution: await this.dispatch.executionProjection({
          tenantId: conversation.tenantId,
          actorId: conversation.actorId,
          workItemId: conversation.workItemId,
          reviewConversationId: conversation.reviewConversationId,
          reviewTurnId: turn.reviewTurnId,
          inputRevision: turn.inputRevision,
          executionRequested: turn.executionRequested,
          createdAt: turn.createdAt,
        }),
      })),
    );
    model.defaultModel =
      [...model.turns]
        .reverse()
        .map((turn) => turn.requestedModel ?? turn.execution?.executionModel)
        .find((choice) => choice != null) ??
      (await this.modelSettings.readWorkItemModel(
        conversation.tenantId,
        conversation.workItemId,
      ));
    return model;
  }

  private async authorizeMatterSelection(
    authorized: AuthorizedReviewAccess,
    selected: ReviewScopeSelection,
  ) {
    if (selected.kind === 'WORK_ITEM') return null;
    if (!this.matterWorking)
      throw reviewConflict('REVIEW_MATTER_RUNTIME_UNAVAILABLE');
    const basis = await this.matterWorking.resolveWorkingBasis(
      selected.matterId,
      matterActor(authorized.session),
    );
    const primary = basis.snapshot.links.find(
      (link) => link.relationRole === 'PRIMARY',
    );
    if (primary?.workItemId !== authorized.grant.workItemId)
      throw reviewNotFound();
    return basis;
  }

  private async freezeMatterScope(
    authorized: AuthorizedReviewAccess,
    requested: AppendMatterReviewScope,
  ): Promise<PersistedMatterReviewScope> {
    const basis = await this.authorizeMatterSelection(authorized, requested);
    if (
      !basis ||
      (basis.working?.workingRevision ?? 0) !==
        requested.expectedWorkingRevision
    ) {
      throw reviewConflict('REVIEW_MATTER_WORKING_REVISION_CHANGED');
    }
    if (
      requested.targetClaimId &&
      !basis.working?.state.substantiveResult?.content.claims.some(
        (claim) => claim.claimId === requested.targetClaimId,
      )
    )
      throw reviewConflict('REVIEW_TARGET_CLAIM_NOT_FOUND');
    return {
      schemaVersion: 'wiselink.3_1.matter_review_scope.v1',
      kind: 'ENGINEERING_MATTER',
      matterId: requested.matterId,
      basedOnMatterRevisionId: basis.snapshot.currentMatterRevisionId,
      expectedWorkingRevision: requested.expectedWorkingRevision,
      targetClaimId: requested.targetClaimId ?? null,
      inputs: structuredClone(basis.currentInputs),
    };
  }

  private async authorizeTurnMatterInputs(
    authorized: AuthorizedReviewAccess,
    turns: PersistedReviewTurn[],
  ): Promise<void> {
    const memberIds = new Set(
      turns.flatMap(
        (turn) =>
          turn.reviewScope?.inputs.map((input) => input.workItemId) ?? [],
      ),
    );
    for (const workItemId of memberIds) {
      const access = await this.objectAccess.freshRead({
        actor: authorized.session.actor,
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: workItemId },
      });
      if (
        !access.allowed ||
        access.tenantId !== authorized.grant.tenantId ||
        access.actorUserId !== authorized.grant.actorUserId ||
        access.workItemId !== workItemId
      )
        throw reviewNotFound();
    }
  }

  private async inheritedModel(
    aggregate: PersistedReviewConversationAggregate,
  ) {
    const conversation = aggregate.conversation;
    for (const turn of [...aggregate.turns].reverse()) {
      if (turn.requestedModel) return turn.requestedModel;
      const execution = await this.dispatch.readExecution({
        tenantId: conversation.tenantId,
        actorId: conversation.actorId,
        workItemId: conversation.workItemId,
        reviewConversationId: conversation.reviewConversationId,
        reviewTurnId: turn.reviewTurnId,
        inputRevision: turn.inputRevision,
      });
      const previous = readStoredExecutionModel(execution?.executionModelJson);
      if (previous) return previous;
    }
    return this.modelSettings.captureForWorkItem(
      conversation.tenantId,
      conversation.workItemId,
      new Date(),
    );
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
    reviewScope: reviewScopeSelection(turn.reviewScope),
    selectedEvaluationItemId: turn.selectedEvaluationItemId ?? null,
    requestedModel: turn.requestedModel
      ? structuredClone(turn.requestedModel)
      : null,
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

function matterActor(session: ResolvedSession): CanonicalHostActor {
  return {
    userId: session.actor.canonicalSubject.id,
    tenantId: session.actor.tenantId,
    appId: session.actor.applicationScopeId,
    roles: [...session.actor.platformRoles],
    env: session.actor.env,
    objectAccessActor: session.actor,
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
