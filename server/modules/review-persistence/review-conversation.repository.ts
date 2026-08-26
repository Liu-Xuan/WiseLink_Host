import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq, isNull } from 'drizzle-orm';

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

const OPENCLAW_AGENT_ID = 'wiselink-engineering';
const ACTIVE_STATUS = 'ACTIVE';
const CLOSED_STATUS = 'CLOSED';
const ENGINEER_TEXT = 'ENGINEER_TEXT';
const CANDIDATE_UNADOPTED = 'CANDIDATE_UNADOPTED';
const OFFICIAL_CLIENT_ID = 'cli_aadde8b579f95bc9';

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
  assistantCandidate: ReviewTurnAssistantCandidate | null;
  createdAt: Date;
}

export interface PersistedReviewConversationAggregate {
  conversation: PersistedReviewConversation;
  turns: PersistedReviewTurn[];
}

@Injectable()
export class ReviewConversationRepository {
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

  async loadTurnById(
    reviewConversationId: string,
    reviewTurnId: string,
  ): Promise<PersistedReviewTurn | null> {
    const [row] = await this.db
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
    const [row] = await this.db
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
    const candidate = input.candidate;
    const updated = await this.db
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
    const stored = await this.loadTurnById(
      input.conversation.reviewConversationId,
      input.turn.reviewTurnId,
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
  }): Promise<{ turn: PersistedReviewTurn; replayed: boolean }> {
    const existing: PersistedReviewTurn | null = await this.loadTurnByRequest(
      input.conversation.reviewConversationId,
      input.requestId,
    );
    if (existing) {
      assertIdempotentReplay(existing, input.userMessage);
      return { turn: existing, replayed: true };
    }

    const now: Date = new Date();
    const reviewTurnId: string = `RT-${randomUUID()}`;
    const engineerSuppliedInputId: string = `ESI-${randomUUID()}`;
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
        userMessage: input.userMessage,
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
      assertIdempotentReplay(replay, input.userMessage);
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
  ): Promise<PersistedReviewConversation | null> {
    const [row] = await this.db
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
  ): Promise<PersistedReviewTurn | null> {
    const [row] = await this.db
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
  const empty = row.assistantResponse === null;
  return {
    reviewTurnId: row.reviewTurnId,
    reviewConversationId: row.reviewConversationId,
    engineerSuppliedInputId: row.engineerSuppliedInputId,
    turnNo: row.turnNo,
    requestId: row.requestId,
    inputRevision: row.inputRevision,
    userMessage: row.userMessage,
    inputType: row.inputType,
    adoptionStatus: row.adoptionStatus,
    candidateText: row.candidateText,
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
): void {
  if (
    turn.userMessage !== userMessage ||
    turn.candidateText !== userMessage ||
    turn.inputType !== ENGINEER_TEXT ||
    turn.adoptionStatus !== CANDIDATE_UNADOPTED
  ) {
    throw reviewPersistenceConflict('REVIEW_TURN_IDEMPOTENCY_CONFLICT');
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
