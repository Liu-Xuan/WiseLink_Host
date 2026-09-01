import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import type {
  ReviewTurnAssistantCandidate,
  ReviewTurnResponseType,
} from '@shared/api.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

import {
  engineerSuppliedInput,
  identitySubjectMapping,
  reviewConversation,
  reviewTurn,
} from '../../database/schema';
import type {
  ReviewAttachmentBinding,
  ReviewEngineerInputPayload,
} from './review-attachment.types';

const OPENCLAW_AGENT_ID = 'wiselink-engineering';
const ACTIVE_STATUS = 'ACTIVE';
const CLOSED_STATUS = 'CLOSED';
const ENGINEER_TEXT = 'ENGINEER_TEXT';
const CANDIDATE_UNADOPTED = 'CANDIDATE_UNADOPTED';
const OFFICIAL_CLIENT_ID = 'cli_aadde8b579f95bc9';
const ENGINEER_INPUT_PREFIX = 'WLR7:';

type DatabaseExecutor = PostgresJsDatabase;

export interface PersistedReviewConversation {
  reviewConversationId: string;
  tenantId: string;
  actorId: string;
  workItemId: string;
  openClawAgentId: string;
  openClawSessionKey: string;
  startedAtRevision: number;
  lastSyncedRevision: number;
  status: string;
  createdAt: Date;
  lastActiveAt: Date;
  closedAt: Date | null;
}

export interface PersistedReviewTurn {
  reviewTurnId: string;
  reviewConversationId: string;
  engineerSuppliedInputId: string;
  turnNo: number;
  requestId: string;
  inputRevision: number;
  userMessage: string;
  inputType: string;
  adoptionStatus: string;
  candidateText: string;
  attachmentBindings: ReviewAttachmentBinding[];
  assistantCandidate: ReviewTurnAssistantCandidate | null;
  createdAt: Date;
}

export interface PersistedReviewConversationAggregate {
  conversation: PersistedReviewConversation;
  turns: PersistedReviewTurn[];
}

@Injectable()
export class ReviewConversationRepository {
  private readonly logger = new Logger(ReviewConversationRepository.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async createOrResume(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    currentRevision: number;
  }): Promise<{
    aggregate: PersistedReviewConversationAggregate;
    created: boolean;
  }> {
    for (let attempt: number = 0; attempt < 2; attempt += 1) {
      const now: Date = new Date();
      const reviewConversationId: string = `RC-${randomUUID()}`;
      const openClawSessionKey: string = [
        'review',
        input.tenantId,
        input.actorId,
        input.workItemId,
        reviewConversationId,
      ].join(':');
      const inserted: Array<{ reviewConversationId: string }> = await this.db
        .insert(reviewConversation)
        .values({
          reviewConversationId,
          tenantId: input.tenantId,
          actorId: input.actorId,
          workItemId: input.workItemId,
          openClawAgentId: OPENCLAW_AGENT_ID,
          openClawSessionKey,
          startedAtRevision: input.currentRevision,
          lastSyncedRevision: input.currentRevision,
          status: ACTIVE_STATUS,
          createdAt: now,
          lastActiveAt: now,
        })
        .onConflictDoNothing()
        .returning({
          reviewConversationId: reviewConversation.reviewConversationId,
        });

      const active: PersistedReviewConversation | null =
        await this.loadActiveInternal(input);
      if (!active) continue;

      const synced: PersistedReviewConversation | null =
        await this.syncActiveConversation({
          ...input,
          reviewConversationId: active.reviewConversationId,
          now,
        });
      if (!synced) continue;

      const aggregate: PersistedReviewConversationAggregate =
        await this.requiredAggregate(synced.reviewConversationId);
      return { aggregate, created: inserted.length === 1 };
    }
    throw reviewPersistenceConflict('REVIEW_CONVERSATION_CREATE_CONFLICT');
  }

  async loadCurrent(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
  }): Promise<PersistedReviewConversationAggregate | null> {
    const conversation: PersistedReviewConversation | null =
      await this.loadActiveInternal(input);
    if (!conversation) return null;
    return this.requiredAggregate(conversation.reviewConversationId);
  }

  async loadById(
    reviewConversationId: string,
  ): Promise<PersistedReviewConversationAggregate | null> {
    const conversation: PersistedReviewConversation | null =
      await this.loadConversationInternal(reviewConversationId);
    if (!conversation) return null;
    const turns: PersistedReviewTurn[] =
      await this.loadTurns(reviewConversationId);
    return { conversation, turns };
  }

  async loadOpenClawTurnBinding(input: {
    reviewConversationId: string;
    requestId: string;
    tenantId: string;
    actorId: string;
    workItemId: string;
  }): Promise<{
    conversation: PersistedReviewConversation;
    turn: PersistedReviewTurn;
  } | null> {
    return this.withAuthenticatedActor(input.actorId, async (executor) => {
      const conversation = await this.loadConversationInternal(
        input.reviewConversationId,
        executor,
      );
      if (!conversation) {
        this.warnOpenClawBinding('CONVERSATION_NOT_VISIBLE');
        return null;
      }
      if (
        conversation.status !== ACTIVE_STATUS ||
        conversation.tenantId !== input.tenantId ||
        conversation.actorId !== input.actorId ||
        conversation.workItemId !== input.workItemId
      ) {
        this.warnOpenClawBinding('CONVERSATION_SCOPE_MISMATCH');
        return null;
      }
      if (!(await this.hasActiveOfficialActorMappingInternal(input, executor))) {
        this.warnOpenClawBinding('OFFICIAL_ACTOR_MAPPING_NOT_VISIBLE');
        return null;
      }
      const turn = await this.loadTurnByRequest(
        input.reviewConversationId,
        input.requestId,
        executor,
      );
      if (!turn) {
        this.warnOpenClawBinding('TURN_NOT_VISIBLE');
        return null;
      }
      return { conversation, turn };
    });
  }

  async loadOpenClawTurnByIdBinding(input: {
    reviewConversationId: string;
    reviewTurnId: string;
    tenantId: string;
    actorId: string;
    workItemId: string;
  }): Promise<{
    conversation: PersistedReviewConversation;
    turn: PersistedReviewTurn;
  } | null> {
    return this.withAuthenticatedActor(input.actorId, async (executor) => {
      const conversation = await this.loadConversationInternal(
        input.reviewConversationId,
        executor,
      );
      if (
        !conversation ||
        conversation.status !== ACTIVE_STATUS ||
        conversation.tenantId !== input.tenantId ||
        conversation.actorId !== input.actorId ||
        conversation.workItemId !== input.workItemId ||
        !(await this.hasActiveOfficialActorMappingInternal(input, executor))
      ) {
        return null;
      }
      const turn = await this.loadTurnByIdInternal(
        input.reviewConversationId,
        input.reviewTurnId,
        executor,
      );
      return turn ? { conversation, turn } : null;
    });
  }

  async loadTurnById(
    reviewConversationId: string,
    reviewTurnId: string,
  ): Promise<PersistedReviewTurn | null> {
    return this.loadTurnByIdInternal(
      reviewConversationId,
      reviewTurnId,
      this.db,
    );
  }

  private async loadTurnByIdInternal(
    reviewConversationId: string,
    reviewTurnId: string,
    executor: DatabaseExecutor,
  ): Promise<PersistedReviewTurn | null> {
    const [row] = await executor
      .select(turnSelection())
      .from(reviewTurn)
      .innerJoin(
        engineerSuppliedInput,
        eq(
          reviewTurn.engineerSuppliedInputId,
          engineerSuppliedInput.engineerSuppliedInputId,
        ),
      )
      .where(
        and(
          eq(reviewTurn.reviewConversationId, reviewConversationId),
          eq(reviewTurn.reviewTurnId, reviewTurnId),
        ),
      )
      .limit(1);
    return row ? persistedTurn(row) : null;
  }

  async hasActiveOfficialActorMapping(input: {
    tenantId: string;
    actorId: string;
  }): Promise<boolean> {
    return this.hasActiveOfficialActorMappingInternal(input, this.db);
  }

  private async hasActiveOfficialActorMappingInternal(
    input: { tenantId: string; actorId: string },
    executor: DatabaseExecutor,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ id: identitySubjectMapping.id })
      .from(identitySubjectMapping)
      .where(
        and(
          eq(identitySubjectMapping.miaodaTenantId, input.tenantId),
          eq(identitySubjectMapping.miaodaUserId, input.actorId),
          eq(identitySubjectMapping.expectedClientId, OFFICIAL_CLIENT_ID),
          eq(identitySubjectMapping.status, ACTIVE_STATUS),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async persistAssistantCandidate(input: {
    conversation: PersistedReviewConversation;
    turn: PersistedReviewTurn;
    actionAttemptId: string;
    candidate: Omit<
      ReviewTurnAssistantCandidate,
      'actionAttemptRef' | 'completedAt'
    > & { actionAttemptRef: string };
    completedAt: Date;
  }): Promise<{ turn: PersistedReviewTurn; replayed: boolean }> {
    return this.persistAssistantCandidateWithExecutor(this.db, input);
  }

  async persistOpenClawAssistantCandidate(input: {
    conversation: PersistedReviewConversation;
    turn: PersistedReviewTurn;
    actionAttemptId: string;
    candidate: Omit<
      ReviewTurnAssistantCandidate,
      'actionAttemptRef' | 'completedAt'
    > & { actionAttemptRef: string };
    completedAt: Date;
  }): Promise<{ turn: PersistedReviewTurn; replayed: boolean }> {
    return this.withAuthenticatedActor(input.conversation.actorId, (executor) =>
      this.persistAssistantCandidateWithExecutor(executor, input),
    );
  }

  private async persistAssistantCandidateWithExecutor(
    executor: DatabaseExecutor,
    input: {
      conversation: PersistedReviewConversation;
      turn: PersistedReviewTurn;
      actionAttemptId: string;
      candidate: Omit<
        ReviewTurnAssistantCandidate,
        'actionAttemptRef' | 'completedAt'
      > & { actionAttemptRef: string };
      completedAt: Date;
    },
  ): Promise<{ turn: PersistedReviewTurn; replayed: boolean }> {
    const candidate = input.candidate;
    const updated = await executor
      .update(reviewTurn)
      .set({
        responseType: candidate.responseType,
        assistantResponse: candidate.answer,
        sourceRefsJson: canonicalJson(candidate.sourceRefs),
        missingInputsJson: canonicalJson(candidate.missingInputs),
        candidateEvidenceRefsJson: canonicalJson(
          candidate.candidateEvidenceRefs,
        ),
        reviewActionDraftJson: canonicalJson(candidate.reviewActionDraft),
        affectedItemIdsJson: canonicalJson(candidate.affectedItemIds),
        warningsJson: canonicalJson(candidate.warnings),
        resultProvenanceJson: canonicalJson({
          ...candidate.provenance,
          actionAttemptRef: candidate.actionAttemptRef,
        }),
        resultContentHash: candidate.provenance.resultContentHash,
        actionAttemptId: input.actionAttemptId,
        assistantCompletedAt: input.completedAt,
      })
      .where(
        and(
          eq(reviewTurn.reviewTurnId, input.turn.reviewTurnId),
          eq(
            reviewTurn.reviewConversationId,
            input.conversation.reviewConversationId,
          ),
          eq(reviewTurn.tenantId, input.conversation.tenantId),
          eq(reviewTurn.actorId, input.conversation.actorId),
          eq(reviewTurn.workItemId, input.conversation.workItemId),
          eq(reviewTurn.inputRevision, input.turn.inputRevision),
          isNull(reviewTurn.assistantResponse),
        ),
      )
      .returning({ reviewTurnId: reviewTurn.reviewTurnId });
    const stored = await this.loadTurnByIdInternal(
      input.conversation.reviewConversationId,
      input.turn.reviewTurnId,
      executor,
    );
    if (!stored) throw new Error('REVIEW_TURN_CANDIDATE_READBACK_FAILED');
    assertCandidateReplay(stored, candidate);
    return { turn: stored, replayed: updated.length === 0 };
  }

  async appendTextTurn(input: {
    conversation: PersistedReviewConversation;
    requestId: string;
    userMessage: string;
    currentRevision: number;
    attachmentBindings?: ReviewAttachmentBinding[];
  }): Promise<{ turn: PersistedReviewTurn; replayed: boolean }> {
    const existing: PersistedReviewTurn | null = await this.loadTurnByRequest(
      input.conversation.reviewConversationId,
      input.requestId,
    );
    if (existing) {
      assertIdempotentReplay(
        existing,
        input.userMessage,
        input.attachmentBindings ?? [],
      );
      return { turn: existing, replayed: true };
    }

    const now: Date = new Date();
    const reviewTurnId: string = `RT-${randomUUID()}`;
    const engineerSuppliedInputId: string = `ESI-${randomUUID()}`;
    const storedInput: string = encodeEngineerInput({
      schemaVersion: 'wiselink.3_1.review_engineer_input.v1.c7',
      userMessage: input.userMessage,
      attachments: structuredClone(input.attachmentBindings ?? []),
    });
    try {
      await this.db.insert(reviewTurn).values({
        reviewTurnId,
        reviewConversationId: input.conversation.reviewConversationId,
        engineerSuppliedInputId,
        tenantId: input.conversation.tenantId,
        actorId: input.conversation.actorId,
        workItemId: input.conversation.workItemId,
        turnNo: 0,
        requestId: input.requestId,
        inputRevision: input.currentRevision,
        userMessage: storedInput,
        inputType: ENGINEER_TEXT,
        adoptionStatus: CANDIDATE_UNADOPTED,
        createdAt: now,
      });
    } catch (cause: unknown) {
      if (databaseErrorMatches(cause, 'P0001')) {
        throw reviewPersistenceConflict('REVIEW_CONVERSATION_CLOSED');
      }
      if (!databaseErrorMatches(cause, '23505')) throw cause;
      const replay: PersistedReviewTurn | null = await this.loadTurnByRequest(
        input.conversation.reviewConversationId,
        input.requestId,
      );
      if (!replay) throw cause;
      assertIdempotentReplay(
        replay,
        input.userMessage,
        input.attachmentBindings ?? [],
      );
      return { turn: replay, replayed: true };
    }

    const created: PersistedReviewTurn | null = await this.loadTurnByRequest(
      input.conversation.reviewConversationId,
      input.requestId,
    );
    if (!created) {
      throw new Error('REVIEW_TURN_CREATE_READBACK_FAILED');
    }
    return { turn: created, replayed: false };
  }

  async syncAfterReviewAction(input: {
    conversation: PersistedReviewConversation;
    expectedRevision: number;
    currentRevision: number;
  }): Promise<PersistedReviewConversationAggregate> {
    const [updated] = await this.db
      .update(reviewConversation)
      .set({
        lastSyncedRevision: input.currentRevision,
        lastActiveAt: new Date(),
      })
      .where(
        and(
          eq(
            reviewConversation.reviewConversationId,
            input.conversation.reviewConversationId,
          ),
          eq(reviewConversation.tenantId, input.conversation.tenantId),
          eq(reviewConversation.actorId, input.conversation.actorId),
          eq(reviewConversation.workItemId, input.conversation.workItemId),
          eq(reviewConversation.status, ACTIVE_STATUS),
          eq(reviewConversation.lastSyncedRevision, input.expectedRevision),
        ),
      )
      .returning({
        reviewConversationId: reviewConversation.reviewConversationId,
      });
    if (!updated) {
      throw reviewPersistenceConflict(
        'REVIEW_CONVERSATION_REVISION_SYNC_CONFLICT',
      );
    }
    return this.requiredAggregate(input.conversation.reviewConversationId);
  }

  async close(input: {
    conversation: PersistedReviewConversation;
    currentRevision: number;
  }): Promise<{
    aggregate: PersistedReviewConversationAggregate;
    alreadyClosed: boolean;
  }> {
    const now: Date = new Date();
    const updated: Array<{ reviewConversationId: string }> = await this.db
      .update(reviewConversation)
      .set({
        status: CLOSED_STATUS,
        lastSyncedRevision: input.currentRevision,
        lastActiveAt: now,
        closedAt: now,
      })
      .where(
        and(
          eq(
            reviewConversation.reviewConversationId,
            input.conversation.reviewConversationId,
          ),
          eq(reviewConversation.tenantId, input.conversation.tenantId),
          eq(reviewConversation.actorId, input.conversation.actorId),
          eq(reviewConversation.workItemId, input.conversation.workItemId),
          eq(reviewConversation.status, ACTIVE_STATUS),
        ),
      )
      .returning({
        reviewConversationId: reviewConversation.reviewConversationId,
      });
    const aggregate: PersistedReviewConversationAggregate | null =
      await this.loadById(input.conversation.reviewConversationId);
    if (
      !aggregate ||
      !sameConversation(aggregate.conversation, input.conversation)
    ) {
      throw reviewPersistenceNotFound();
    }
    if (aggregate.conversation.status !== CLOSED_STATUS) {
      throw reviewPersistenceConflict('REVIEW_CONVERSATION_CLOSE_CONFLICT');
    }
    return { aggregate, alreadyClosed: updated.length === 0 };
  }

  private async syncActiveConversation(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    reviewConversationId: string;
    currentRevision: number;
    now: Date;
  }): Promise<PersistedReviewConversation | null> {
    const [row] = await this.db
      .update(reviewConversation)
      .set({
        lastSyncedRevision: input.currentRevision,
        lastActiveAt: input.now,
      })
      .where(
        and(
          eq(
            reviewConversation.reviewConversationId,
            input.reviewConversationId,
          ),
          eq(reviewConversation.tenantId, input.tenantId),
          eq(reviewConversation.actorId, input.actorId),
          eq(reviewConversation.workItemId, input.workItemId),
          eq(reviewConversation.status, ACTIVE_STATUS),
        ),
      )
      .returning(conversationSelection());
    return row ?? null;
  }

  private async loadActiveInternal(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
  }): Promise<PersistedReviewConversation | null> {
    const [row] = await this.db
      .select(conversationSelection())
      .from(reviewConversation)
      .where(
        and(
          eq(reviewConversation.tenantId, input.tenantId),
          eq(reviewConversation.actorId, input.actorId),
          eq(reviewConversation.workItemId, input.workItemId),
          eq(reviewConversation.status, ACTIVE_STATUS),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async loadConversationInternal(
    reviewConversationId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<PersistedReviewConversation | null> {
    const [row] = await executor
      .select(conversationSelection())
      .from(reviewConversation)
      .where(eq(reviewConversation.reviewConversationId, reviewConversationId))
      .limit(1);
    return row ?? null;
  }

  private async loadTurns(
    reviewConversationId: string,
  ): Promise<PersistedReviewTurn[]> {
    const rows = await this.db
      .select(turnSelection())
      .from(reviewTurn)
      .innerJoin(
        engineerSuppliedInput,
        eq(
          reviewTurn.engineerSuppliedInputId,
          engineerSuppliedInput.engineerSuppliedInputId,
        ),
      )
      .where(eq(reviewTurn.reviewConversationId, reviewConversationId))
      .orderBy(asc(reviewTurn.turnNo));
    return rows.map(persistedTurn);
  }

  private async loadTurnByRequest(
    reviewConversationId: string,
    requestId: string,
    executor: DatabaseExecutor = this.db,
  ): Promise<PersistedReviewTurn | null> {
    const [row] = await executor
      .select(turnSelection())
      .from(reviewTurn)
      .innerJoin(
        engineerSuppliedInput,
        eq(
          reviewTurn.engineerSuppliedInputId,
          engineerSuppliedInput.engineerSuppliedInputId,
        ),
      )
      .where(
        and(
          eq(reviewTurn.reviewConversationId, reviewConversationId),
          eq(reviewTurn.requestId, requestId),
        ),
      )
      .limit(1);
    return row ? persistedTurn(row) : null;
  }

  private async requiredAggregate(
    reviewConversationId: string,
  ): Promise<PersistedReviewConversationAggregate> {
    const aggregate: PersistedReviewConversationAggregate | null =
      await this.loadById(reviewConversationId);
    if (!aggregate) throw new Error('REVIEW_CONVERSATION_READBACK_FAILED');
    return aggregate;
  }

  private async withAuthenticatedActor<T>(
    actorId: string,
    operation: (executor: DatabaseExecutor) => Promise<T>,
  ): Promise<T> {
    if (!actorId.trim() || actorId === '-1' || actorId.startsWith('service:')) {
      throw new Error('REVIEW_OPENCLAW_ACTOR_CONTEXT_UNAVAILABLE');
    }
    return this.db.transaction(async (transaction) => {
      const executor = transaction as DatabaseExecutor;
      const rows = await executor.execute<{ actorId: string | null }>(
        sql`SELECT set_config('app.user_id', ${actorId}, TRUE) AS "actorId"`,
      );
      if (rows[0]?.actorId !== actorId) {
        throw new Error('REVIEW_OPENCLAW_ACTOR_CONTEXT_UNAVAILABLE');
      }
      return operation(executor);
    });
  }

  private warnOpenClawBinding(
    reason:
      | 'CONVERSATION_NOT_VISIBLE'
      | 'CONVERSATION_SCOPE_MISMATCH'
      | 'OFFICIAL_ACTOR_MAPPING_NOT_VISIBLE'
      | 'TURN_NOT_VISIBLE',
  ): void {
    this.logger.warn(
      JSON.stringify({
        event: 'OPENCLAW_REVIEW_BINDING_NOT_FOUND',
        reason,
      }),
    );
  }
}

function conversationSelection() {
  return {
    reviewConversationId: reviewConversation.reviewConversationId,
    tenantId: reviewConversation.tenantId,
    actorId: reviewConversation.actorId,
    workItemId: reviewConversation.workItemId,
    openClawAgentId: reviewConversation.openClawAgentId,
    openClawSessionKey: reviewConversation.openClawSessionKey,
    startedAtRevision: reviewConversation.startedAtRevision,
    lastSyncedRevision: reviewConversation.lastSyncedRevision,
    status: reviewConversation.status,
    createdAt: reviewConversation.createdAt,
    lastActiveAt: reviewConversation.lastActiveAt,
    closedAt: reviewConversation.closedAt,
  };
}

function turnSelection() {
  return {
    reviewTurnId: reviewTurn.reviewTurnId,
    reviewConversationId: reviewTurn.reviewConversationId,
    engineerSuppliedInputId: reviewTurn.engineerSuppliedInputId,
    turnNo: reviewTurn.turnNo,
    requestId: reviewTurn.requestId,
    inputRevision: reviewTurn.inputRevision,
    userMessage: reviewTurn.userMessage,
    inputType: engineerSuppliedInput.inputType,
    adoptionStatus: engineerSuppliedInput.adoptionStatus,
    candidateText: engineerSuppliedInput.candidateText,
    responseType: reviewTurn.responseType,
    assistantResponse: reviewTurn.assistantResponse,
    sourceRefsJson: reviewTurn.sourceRefsJson,
    missingInputsJson: reviewTurn.missingInputsJson,
    candidateEvidenceRefsJson: reviewTurn.candidateEvidenceRefsJson,
    reviewActionDraftJson: reviewTurn.reviewActionDraftJson,
    affectedItemIdsJson: reviewTurn.affectedItemIdsJson,
    warningsJson: reviewTurn.warningsJson,
    resultProvenanceJson: reviewTurn.resultProvenanceJson,
    resultContentHash: reviewTurn.resultContentHash,
    actionAttemptId: reviewTurn.actionAttemptId,
    assistantCompletedAt: reviewTurn.assistantCompletedAt,
    createdAt: reviewTurn.createdAt,
  };
}

interface SelectedReviewTurn {
  reviewTurnId: string;
  reviewConversationId: string;
  engineerSuppliedInputId: string;
  turnNo: number;
  requestId: string;
  inputRevision: number;
  userMessage: string;
  inputType: string;
  adoptionStatus: string;
  candidateText: string;
  responseType: string | null;
  assistantResponse: string | null;
  sourceRefsJson: string | null;
  missingInputsJson: string | null;
  candidateEvidenceRefsJson: string | null;
  reviewActionDraftJson: string | null;
  affectedItemIdsJson: string | null;
  warningsJson: string | null;
  resultProvenanceJson: string | null;
  resultContentHash: string | null;
  actionAttemptId: string | null;
  assistantCompletedAt: Date | null;
  createdAt: Date;
}

function persistedTurn(row: SelectedReviewTurn): PersistedReviewTurn {
  const turnInput: ReviewEngineerInputPayload = decodeEngineerInput(
    row.userMessage,
  );
  const suppliedInput: ReviewEngineerInputPayload = decodeEngineerInput(
    row.candidateText,
  );
  if (canonicalJson(turnInput) !== canonicalJson(suppliedInput)) {
    throw new Error('REVIEW_ENGINEER_INPUT_BINDING_DRIFT');
  }
  const empty = row.assistantResponse === null;
  return {
    reviewTurnId: row.reviewTurnId,
    reviewConversationId: row.reviewConversationId,
    engineerSuppliedInputId: row.engineerSuppliedInputId,
    turnNo: row.turnNo,
    requestId: row.requestId,
    inputRevision: row.inputRevision,
    userMessage: turnInput.userMessage,
    inputType: row.inputType,
    adoptionStatus: row.adoptionStatus,
    candidateText: suppliedInput.userMessage,
    attachmentBindings: structuredClone(suppliedInput.attachments),
    assistantCandidate: empty ? null : parseAssistantCandidate(row),
    createdAt: row.createdAt,
  };
}

function parseAssistantCandidate(
  row: SelectedReviewTurn,
): ReviewTurnAssistantCandidate {
  if (
    !row.responseType ||
    !row.assistantResponse ||
    !row.sourceRefsJson ||
    !row.missingInputsJson ||
    !row.candidateEvidenceRefsJson ||
    !row.reviewActionDraftJson ||
    !row.affectedItemIdsJson ||
    !row.warningsJson ||
    !row.resultProvenanceJson ||
    !row.resultContentHash ||
    !row.actionAttemptId ||
    !row.assistantCompletedAt
  ) {
    throw new Error('REVIEW_TURN_CANDIDATE_PARTIAL_STATE');
  }
  const provenance = parseJsonRecord(row.resultProvenanceJson);
  if (provenance.resultContentHash !== row.resultContentHash) {
    throw new Error('REVIEW_TURN_CANDIDATE_PROVENANCE_MISMATCH');
  }
  const actionAttemptRef = requiredJsonText(provenance.actionAttemptRef);
  const { actionAttemptRef: _actionAttemptRef, ...resultProvenance } =
    provenance;
  return {
    responseType: row.responseType as ReviewTurnResponseType,
    answer: row.assistantResponse,
    sourceRefs: parseJsonStringArray(row.sourceRefsJson),
    missingInputs: parseJsonStringArray(row.missingInputsJson),
    candidateEvidenceRefs: parseJsonStringArray(row.candidateEvidenceRefsJson),
    reviewActionDraft: JSON.parse(
      row.reviewActionDraftJson,
    ) as ReviewTurnAssistantCandidate['reviewActionDraft'],
    affectedItemIds: parseJsonStringArray(row.affectedItemIdsJson),
    warnings: parseJsonStringArray(row.warningsJson),
    actionAttemptRef,
    provenance:
      resultProvenance as unknown as ReviewTurnAssistantCandidate['provenance'],
    completedAt: row.assistantCompletedAt.toISOString(),
  };
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('REVIEW_TURN_CANDIDATE_JSON_INVALID');
  }
  return parsed as Record<string, unknown>;
}

function parseJsonStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    throw new Error('REVIEW_TURN_CANDIDATE_JSON_INVALID');
  }
  return [...parsed];
}

function requiredJsonText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('REVIEW_TURN_CANDIDATE_JSON_INVALID');
  }
  return value;
}

function assertCandidateReplay(
  stored: PersistedReviewTurn,
  incoming: Omit<
    ReviewTurnAssistantCandidate,
    'actionAttemptRef' | 'completedAt'
  > & { actionAttemptRef: string },
): void {
  if (!stored.assistantCandidate) {
    throw new Error('REVIEW_TURN_CANDIDATE_PERSISTENCE_REJECTED');
  }
  const { completedAt: _completedAt, ...actual } = stored.assistantCandidate;
  if (canonicalJson(actual) !== canonicalJson(incoming)) {
    throw reviewPersistenceConflict('REVIEW_TURN_CANDIDATE_REPLAY_CONFLICT');
  }
}

function assertIdempotentReplay(
  turn: PersistedReviewTurn,
  userMessage: string,
  attachmentBindings: ReviewAttachmentBinding[],
): void {
  if (
    turn.userMessage !== userMessage ||
    turn.candidateText !== userMessage ||
    canonicalJson(turn.attachmentBindings) !==
      canonicalJson(attachmentBindings) ||
    turn.inputType !== ENGINEER_TEXT ||
    turn.adoptionStatus !== CANDIDATE_UNADOPTED
  ) {
    throw reviewPersistenceConflict('REVIEW_TURN_IDEMPOTENCY_CONFLICT');
  }
}

function encodeEngineerInput(value: ReviewEngineerInputPayload): string {
  validateEngineerInput(value);
  return `${ENGINEER_INPUT_PREFIX}${canonicalJson(value)}`;
}

function decodeEngineerInput(value: string): ReviewEngineerInputPayload {
  if (!value.startsWith(ENGINEER_INPUT_PREFIX)) {
    return {
      schemaVersion: 'wiselink.3_1.review_engineer_input.v1.c7',
      userMessage: value,
      attachments: [],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.slice(ENGINEER_INPUT_PREFIX.length)) as unknown;
  } catch {
    throw new Error('REVIEW_ENGINEER_INPUT_JSON_INVALID');
  }
  validateEngineerInput(parsed);
  return structuredClone(parsed) as ReviewEngineerInputPayload;
}

function validateEngineerInput(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('REVIEW_ENGINEER_INPUT_JSON_INVALID');
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 'wiselink.3_1.review_engineer_input.v1.c7' ||
    typeof record.userMessage !== 'string' ||
    !record.userMessage.trim() ||
    !Array.isArray(record.attachments) ||
    record.attachments.length > 1
  ) {
    throw new Error('REVIEW_ENGINEER_INPUT_JSON_INVALID');
  }
  const refs = new Set<string>();
  for (const attachment of record.attachments) {
    validateAttachmentBinding(attachment);
    refs.add((attachment as ReviewAttachmentBinding).attachmentRef);
  }
  if (refs.size !== record.attachments.length) {
    throw new Error('REVIEW_ENGINEER_INPUT_JSON_INVALID');
  }
}

function validateAttachmentBinding(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('REVIEW_ENGINEER_INPUT_JSON_INVALID');
  }
  const binding: Record<string, unknown> = value as Record<string, unknown>;
  const artifact: unknown = binding.parsedArtifact;
  if (
    typeof binding.attachmentRef !== 'string' ||
    !binding.attachmentRef.trim() ||
    typeof binding.documentVersionId !== 'string' ||
    !binding.documentVersionId.trim() ||
    typeof binding.fileName !== 'string' ||
    !binding.fileName.trim() ||
    binding.mediaType !== 'application/pdf' ||
    !Number.isSafeInteger(binding.byteLength) ||
    Number(binding.byteLength) < 1 ||
    typeof binding.selectionKey !== 'string' ||
    !binding.selectionKey.trim() ||
    !artifact ||
    typeof artifact !== 'object' ||
    Array.isArray(artifact)
  ) {
    throw new Error('REVIEW_ENGINEER_INPUT_JSON_INVALID');
  }
  const descriptor: Record<string, unknown> = artifact as Record<
    string,
    unknown
  >;
  if (
    descriptor.storeRole !== 'UnifiedArtifactStoreCandidate' ||
    typeof descriptor.ref !== 'string' ||
    !descriptor.ref.trim() ||
    typeof descriptor.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(descriptor.sha256) ||
    !Number.isSafeInteger(descriptor.byteLength) ||
    Number(descriptor.byteLength) < 1 ||
    descriptor.mediaType !== 'application/json'
  ) {
    throw new Error('REVIEW_ENGINEER_INPUT_JSON_INVALID');
  }
}

function sameConversation(
  left: PersistedReviewConversation,
  right: PersistedReviewConversation,
): boolean {
  return (
    left.reviewConversationId === right.reviewConversationId &&
    left.tenantId === right.tenantId &&
    left.actorId === right.actorId &&
    left.workItemId === right.workItemId
  );
}

function databaseErrorMatches(cause: unknown, code: string): boolean {
  let current: unknown = cause;
  for (let depth: number = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== 'object') return false;
    const value: Record<string, unknown> = current as Record<string, unknown>;
    if (value.code === code) return true;
    current = value.cause;
  }
  return false;
}

function reviewPersistenceNotFound(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error('Review conversation was not found.'), {
    code: 'REVIEW_CONVERSATION_NOT_FOUND',
    statusCode: 404,
  });
}

function reviewPersistenceConflict(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
