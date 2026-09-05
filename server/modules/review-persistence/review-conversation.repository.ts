import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq, inArray, isNull, like, notExists, sql } from 'drizzle-orm';

import type {
  ReviewActionDraftCandidate,
  ReviewTurnAssistantCandidate,
  ReviewTurnResponseType,
} from '@shared/api.interface';
import {
  canonicalJson,
  canonicalSha256,
} from '../action-attempt/action-attempt-envelope';

import {
  actionAttempt,
  engineerSuppliedInput,
  identitySubjectMapping,
  reviewConversation,
  reviewTurn,
  workItem,
} from '../../database/schema';
import { REVIEW_ACTIVE_EXECUTION_STATUSES } from '../action-attempt/review-attempt-dispatch.service';
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

function assertOpenClawActorContext(actorId: string): void {
  if (!actorId.trim() || actorId === '-1' || actorId.startsWith('service:')) {
    throw new Error('REVIEW_OPENCLAW_ACTOR_CONTEXT_UNAVAILABLE');
  }
}

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
  selectedEvaluationItemId?: string | null;
  executionRequested?: boolean;
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
          openclawAgentId: OPENCLAW_AGENT_ID,
          openclawSessionKey: openClawSessionKey,
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

  /** Only explicit automatic requests are eligible; old unanswered turns stay untouched. */
  async loadPendingOpenClawTurn(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
  }): Promise<{
    reviewConversationId: string;
    reviewTurnId: string;
    requestId: string;
    turnNo: number;
    inputRevision: number;
  } | null> {
    assertOpenClawActorContext(input.actorId);
    // set_config and the RLS-protected read must use the same statement/connection.
    // Its volatile expression makes PostgreSQL materialize this CTE.
    const actorContext = this.db.$with('review_actor_context').as(
      this.db.select({
        // Drizzle references SQL aliases without a table qualifier. Keep this
        // distinct from the joined conversation/turn columns named actor_id.
        actorId: sql<string>`set_config('app.user_id', ${input.actorId}, true)`.as('pending_review_actor_id'),
      }).from(workItem).where(and(
        eq(workItem.workItemId, input.workItemId),
        eq(workItem.tenantId, input.tenantId),
        eq(workItem.requestedByUserId, input.actorId),
      )),
    );
    const finishedAttempt = this.db.select({ attemptId: actionAttempt.attemptId })
      .from(actionAttempt).where(and(
        eq(actionAttempt.tenantId, input.tenantId),
        eq(actionAttempt.workItemId, input.workItemId),
        eq(actionAttempt.actorUserId, actorContext.actorId),
        eq(actionAttempt.actionType, 'OPENCLAW_INTERACTIVE_REVIEW'),
        eq(actionAttempt.idempotencyKey,
          sql`concat('openclaw-v1:review:', ${reviewTurn.reviewConversationId}, ':', ${reviewTurn.reviewTurnId}, ':', ${reviewTurn.inputRevision})`),
        sql`not ${inArray(actionAttempt.status, [...REVIEW_ACTIVE_EXECUTION_STATUSES])}`,
      ));
    const pendingTurn = this.db.select({
      reviewConversationId: reviewTurn.reviewConversationId,
      reviewTurnId: reviewTurn.reviewTurnId,
      requestId: reviewTurn.requestId,
      turnNo: reviewTurn.turnNo,
      inputRevision: reviewTurn.inputRevision,
    }).from(reviewConversation)
      .innerJoin(identitySubjectMapping, and(
        eq(identitySubjectMapping.miaodaTenantId, input.tenantId),
        eq(identitySubjectMapping.miaodaUserId, actorContext.actorId),
        eq(identitySubjectMapping.expectedClientId, OFFICIAL_CLIENT_ID),
        eq(identitySubjectMapping.status, ACTIVE_STATUS),
      ))
      .innerJoin(reviewTurn, and(
        eq(reviewTurn.reviewConversationId, reviewConversation.reviewConversationId),
        eq(reviewTurn.tenantId, input.tenantId),
        eq(reviewTurn.actorId, actorContext.actorId),
        eq(reviewTurn.workItemId, input.workItemId),
      ))
      .where(and(
        eq(reviewConversation.tenantId, input.tenantId),
        eq(reviewConversation.actorId, actorContext.actorId),
        eq(reviewConversation.workItemId, input.workItemId),
        eq(reviewConversation.status, ACTIVE_STATUS),
        like(reviewTurn.userMessage, 'WLR7:%'),
        like(reviewTurn.userMessage, '%"executionRequested":true%'),
        notExists(finishedAttempt),
      ))
      .orderBy(asc(reviewTurn.createdAt), asc(reviewTurn.turnNo)).limit(1)
      .as('pending_review_turn');
    // Keep the RLS read dependent on the actor CTE, as in the existing begin path.
    const [turn] = await this.db.with(actorContext).select({
      reviewConversationId: pendingTurn.reviewConversationId,
      reviewTurnId: pendingTurn.reviewTurnId,
      requestId: pendingTurn.requestId,
      turnNo: pendingTurn.turnNo,
      inputRevision: pendingTurn.inputRevision,
    }).from(actorContext).innerJoinLateral(pendingTurn, sql`true`);
    return turn ?? null;
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
    return this.loadActorBoundOpenClawTurn({
      ...input,
      requestId: input.requestId,
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
    return this.loadActorBoundOpenClawTurn({
      ...input,
      reviewTurnId: input.reviewTurnId,
    });
  }

  private async loadActorBoundOpenClawTurn(
    input: {
      reviewConversationId: string;
      tenantId: string;
      actorId: string;
      workItemId: string;
    } & ({ requestId: string } | { reviewTurnId: string }),
  ): Promise<{
    conversation: PersistedReviewConversation;
    turn: PersistedReviewTurn;
  } | null> {
    assertOpenClawActorContext(input.actorId);
    // The hosted APaaS adapter may route a raw execute and a subsequent ORM
    // builder through different pooled connections. Establish the local RLS
    // actor and read every bound row in one PostgreSQL statement instead.
    const turnIdentity =
      'requestId' in input
        ? sql`candidate_turn.request_id = ${input.requestId}`
        : sql`candidate_turn.review_turn_id = ${input.reviewTurnId}`;
    const rows = await this.db
      .execute<ActorBoundReviewTurnRow>(
        sql`
      WITH actor_context AS MATERIALIZED (
        SELECT set_config('app.user_id', ${input.actorId}, TRUE) AS actor_id
      )
      SELECT
        actor_context.actor_id AS "actorContext",
        runtime_diagnostics.authenticated_role_member AS
          "authenticatedRoleMember",
        runtime_diagnostics.service_role_member AS "serviceRoleMember",
        runtime_diagnostics.row_security_active AS "rowSecurityActive",
        runtime_diagnostics.expected_schema_resolved AS
          "expectedSchemaResolved",
        runtime_diagnostics.review_select_policy_present AS
          "reviewSelectPolicyPresent",
        runtime_diagnostics.review_candidate_update_policy_present AS
          "reviewCandidateUpdatePolicyPresent",
        runtime_diagnostics.review_rls_enabled AS "reviewRlsEnabled",
        bound_conversation.review_conversation_id AS "reviewConversationId",
        bound_conversation.tenant_id AS "conversationTenantId",
        bound_conversation.actor_id AS "conversationActorId",
        bound_conversation.work_item_id AS "conversationWorkItemId",
        bound_conversation.openclaw_agent_id AS "openClawAgentId",
        bound_conversation.openclaw_session_key AS "openClawSessionKey",
        bound_conversation.started_at_revision AS "startedAtRevision",
        bound_conversation.last_synced_revision AS "lastSyncedRevision",
        bound_conversation.status AS "conversationStatus",
        bound_conversation.created_at AS "conversationCreatedAt",
        bound_conversation.last_active_at AS "lastActiveAt",
        bound_conversation.closed_at AS "closedAt",
        official_mapping.mapping_id AS "officialMappingId",
        bound_turn.review_turn_id AS "reviewTurnId",
        bound_turn.review_conversation_id AS "turnReviewConversationId",
        bound_turn.engineer_supplied_input_id AS "engineerSuppliedInputId",
        bound_turn.turn_no AS "turnNo",
        bound_turn.request_id AS "requestId",
        bound_turn.input_revision AS "inputRevision",
        bound_turn.user_message AS "userMessage",
        bound_turn.supplied_input_type AS "inputType",
        bound_turn.supplied_adoption_status AS "adoptionStatus",
        bound_turn.supplied_candidate_text AS "candidateText",
        bound_turn.response_type AS "responseType",
        bound_turn.assistant_response AS "assistantResponse",
        bound_turn.source_refs_json AS "sourceRefsJson",
        bound_turn.missing_inputs_json AS "missingInputsJson",
        bound_turn.candidate_evidence_refs_json AS "candidateEvidenceRefsJson",
        bound_turn.review_action_draft_json AS "reviewActionDraftJson",
        bound_turn.affected_item_ids_json AS "affectedItemIdsJson",
        bound_turn.warnings_json AS "warningsJson",
        bound_turn.result_provenance_json AS "resultProvenanceJson",
        bound_turn.result_content_hash AS "resultContentHash",
        bound_turn.action_attempt_id AS "actionAttemptId",
        bound_turn.assistant_completed_at AS "assistantCompletedAt",
        bound_turn.created_at AS "turnCreatedAt"
      FROM actor_context
      CROSS JOIN LATERAL (
        SELECT
          CASE
            WHEN current_user = 'authenticated'
              OR current_user LIKE 'authenticated#_%' ESCAPE '#'
            THEN TRUE
            WHEN EXISTS (
              SELECT 1 FROM pg_catalog.pg_roles
              WHERE rolname = 'authenticated'
            ) THEN pg_catalog.pg_has_role(
              current_user, 'authenticated', 'MEMBER'
            )
            ELSE FALSE
          END AS authenticated_role_member,
          CASE
            WHEN current_user = 'service_role'
              OR current_user LIKE 'service_role#_%' ESCAPE '#'
              OR current_user LIKE
                'service#_role#_workspace#_%' ESCAPE '#'
            THEN TRUE
            WHEN EXISTS (
              SELECT 1 FROM pg_catalog.pg_roles
              WHERE rolname = 'service_role'
            ) THEN pg_catalog.pg_has_role(
              current_user, 'service_role', 'MEMBER'
            )
            ELSE FALSE
          END AS service_role_member,
          current_setting('row_security', TRUE) IN ('on', 'true', '1') AS
            row_security_active,
          COALESCE(
            to_regclass('review_conversation') IS NOT NULL
            AND to_regclass('review_turn') IS NOT NULL
            AND to_regclass('engineer_supplied_input') IS NOT NULL
            AND to_regclass('identity_subject_mapping') IS NOT NULL
            AND to_regclass('work_item') IS NOT NULL
            AND to_regprocedure(
              'review_turn_hosted_runtime_persist_candidate(text,text,text,text,text,integer,text,text,text,text,text,text,text,text,text,text,text,timestamp with time zone)'
            ) IS NOT NULL,
            FALSE
          ) AS expected_schema_resolved,
          NOT EXISTS (
            SELECT 1
            FROM (
              VALUES
                (
                  'identity_subject_mapping',
                  ARRAY[
                    'identity_subject_mapping_authenticated_oauth_read',
                    'identity_subject_mapping_hosted_runtime_actor_select'
                  ]::text[]
                ),
                (
                  'work_item',
                  ARRAY[
                    '查看全部数据',
                    'work_item_hosted_runtime_actor_select'
                  ]::text[]
                ),
                (
                  'review_conversation',
                  ARRAY[
                    'review_conversation_authenticated_select',
                    'review_conversation_hosted_runtime_actor_select'
                  ]::text[]
                ),
                (
                  'review_turn',
                  ARRAY[
                    'review_turn_authenticated_select',
                    'review_turn_hosted_runtime_actor_select'
                  ]::text[]
                ),
                (
                  'engineer_supplied_input',
                  ARRAY[
                    'engineer_supplied_input_authenticated_select',
                    'engineer_supplied_input_hosted_runtime_actor_select'
                  ]::text[]
                )
            ) AS expected_policy(table_name, policy_names)
            WHERE NOT EXISTS (
              SELECT 1
              FROM pg_catalog.pg_class AS expected_table
              WHERE expected_table.oid =
                to_regclass(expected_policy.table_name)
                AND (
                  expected_table.relrowsecurity = FALSE
                  OR EXISTS (
                    SELECT 1
                    FROM pg_catalog.pg_policies AS candidate_policy
                    WHERE candidate_policy.tablename =
                      expected_policy.table_name
                      AND candidate_policy.policyname =
                        ANY(expected_policy.policy_names)
                      AND candidate_policy.cmd = 'SELECT'
                      AND candidate_policy.permissive = 'PERMISSIVE'
                      AND to_regclass(
                        format(
                          '%I.%I',
                          candidate_policy.schemaname,
                          candidate_policy.tablename
                        )
                      ) = expected_table.oid
                      AND EXISTS (
                        SELECT 1
                        FROM unnest(candidate_policy.roles) AS candidate_role(
                          role_name
                        )
                        LEFT JOIN pg_catalog.pg_roles AS concrete_role
                          ON concrete_role.rolname = candidate_role.role_name
                        WHERE candidate_role.role_name = 'public'
                          OR (
                            concrete_role.oid IS NOT NULL
                            AND pg_catalog.pg_has_role(
                              current_user,
                              concrete_role.oid,
                              'USAGE'
                            )
                          )
                      )
                  )
                )
            )
          ) AS review_select_policy_present,
          EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policies AS candidate_policy
            WHERE candidate_policy.tablename = 'review_turn'
              AND candidate_policy.policyname = ANY(
                ARRAY[
                  'review_turn_authenticated_candidate_update',
                  'review_turn_hosted_runtime_actor_candidate_update'
                ]::text[]
              )
              AND candidate_policy.cmd = 'UPDATE'
              AND candidate_policy.permissive = 'PERMISSIVE'
              AND to_regclass(
                format(
                  '%I.%I',
                  candidate_policy.schemaname,
                  candidate_policy.tablename
                )
              ) = to_regclass('review_turn')
              AND EXISTS (
                SELECT 1
                FROM unnest(candidate_policy.roles) AS candidate_role(
                  role_name
                )
                LEFT JOIN pg_catalog.pg_roles AS concrete_role
                  ON concrete_role.rolname = candidate_role.role_name
                WHERE candidate_role.role_name = 'public'
                  OR (
                    concrete_role.oid IS NOT NULL
                    AND pg_catalog.pg_has_role(
                      current_user,
                      concrete_role.oid,
                      'USAGE'
                    )
                  )
              )
          ) AS review_candidate_update_policy_present,
          COALESCE(
            (
              SELECT candidate_table.relrowsecurity
              FROM pg_catalog.pg_class AS candidate_table
              WHERE candidate_table.oid =
                to_regclass('review_conversation')
            ),
            FALSE
          ) AS review_rls_enabled
      ) AS runtime_diagnostics
      LEFT JOIN LATERAL (
        SELECT candidate_conversation.*
        FROM review_conversation AS candidate_conversation
        WHERE candidate_conversation.review_conversation_id =
          ${input.reviewConversationId}
          AND candidate_conversation.actor_id = actor_context.actor_id
        LIMIT 1
      ) AS bound_conversation ON TRUE
      LEFT JOIN LATERAL (
        SELECT candidate_mapping.id AS mapping_id
        FROM identity_subject_mapping AS candidate_mapping
        WHERE candidate_mapping.miaoda_tenant_id = ${input.tenantId}
          AND candidate_mapping.miaoda_user_id = actor_context.actor_id
          AND candidate_mapping.expected_client_id = ${OFFICIAL_CLIENT_ID}
          AND candidate_mapping.status = ${ACTIVE_STATUS}
        LIMIT 1
      ) AS official_mapping ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          candidate_turn.*,
          supplied_input.input_type AS supplied_input_type,
          supplied_input.adoption_status AS supplied_adoption_status,
          supplied_input.candidate_text AS supplied_candidate_text
        FROM review_turn AS candidate_turn
        INNER JOIN engineer_supplied_input AS supplied_input
          ON supplied_input.engineer_supplied_input_id =
            candidate_turn.engineer_supplied_input_id
          AND supplied_input.actor_id = actor_context.actor_id
        WHERE candidate_turn.review_conversation_id =
          ${input.reviewConversationId}
          AND candidate_turn.actor_id = actor_context.actor_id
          AND ${turnIdentity}
        LIMIT 1
      ) AS bound_turn ON TRUE
    `,
      )
      .catch((cause: unknown) => {
        if (databaseErrorMatches(cause, '42P01')) {
          throw reviewSchemaNotReady();
        }
        throw cause;
      });
    const row = rows[0];
    if (row?.actorContext !== input.actorId) {
      this.warnOpenClawBinding(
        'ACTOR_CONTEXT_NOT_RETAINED',
        openClawBindingDiagnostic(row, input.actorId),
      );
      throw new Error('REVIEW_OPENCLAW_ACTOR_CONTEXT_UNAVAILABLE');
    }
    if (
      !row.expectedSchemaResolved ||
      (row.reviewRlsEnabled === true &&
        (row.reviewSelectPolicyPresent !== true ||
          row.reviewCandidateUpdatePolicyPresent !== true))
    ) {
      this.warnOpenClawBinding(
        'REVIEW_SCHEMA_NOT_READY',
        openClawBindingDiagnostic(row, input.actorId),
      );
      throw reviewSchemaNotReady();
    }
    if (!row.reviewConversationId) {
      this.warnOpenClawBinding(
        'CONVERSATION_NOT_VISIBLE',
        openClawBindingDiagnostic(row, input.actorId),
      );
      return null;
    }
    const conversation = actorBoundConversation(row);
    if (
      conversation.status !== ACTIVE_STATUS ||
      conversation.tenantId !== input.tenantId ||
      conversation.actorId !== input.actorId ||
      conversation.workItemId !== input.workItemId
    ) {
      this.warnOpenClawBinding(
        'CONVERSATION_SCOPE_MISMATCH',
        openClawBindingDiagnostic(row, input.actorId),
      );
      return null;
    }
    if (!row.officialMappingId) {
      this.warnOpenClawBinding(
        'OFFICIAL_ACTOR_MAPPING_NOT_VISIBLE',
        openClawBindingDiagnostic(row, input.actorId),
      );
      return null;
    }
    if (!row.reviewTurnId) {
      this.warnOpenClawBinding(
        'TURN_NOT_VISIBLE',
        openClawBindingDiagnostic(row, input.actorId),
      );
      return null;
    }
    return { conversation, turn: persistedTurn(actorBoundTurn(row)) };
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
    assertOpenClawActorContext(input.conversation.actorId);
    const candidate = input.candidate;
    const rows = await this.db.execute<ActorPersistedReviewTurnRow>(sql`
      SELECT
        persisted_candidate.actor_context AS "actorContext",
        persisted_candidate.candidate_inserted AS "candidateInserted",
        persisted_candidate.turn_row ->> 'review_turn_id' AS "reviewTurnId",
        persisted_candidate.turn_row ->> 'review_conversation_id' AS
          "reviewConversationId",
        persisted_candidate.turn_row ->> 'engineer_supplied_input_id' AS
          "engineerSuppliedInputId",
        (persisted_candidate.turn_row ->> 'turn_no')::integer AS "turnNo",
        persisted_candidate.turn_row ->> 'request_id' AS "requestId",
        (persisted_candidate.turn_row ->> 'input_revision')::integer AS
          "inputRevision",
        persisted_candidate.turn_row ->> 'user_message' AS "userMessage",
        persisted_candidate.input_row ->> 'input_type' AS "inputType",
        persisted_candidate.input_row ->> 'adoption_status' AS
          "adoptionStatus",
        persisted_candidate.input_row ->> 'candidate_text' AS "candidateText",
        persisted_candidate.turn_row ->> 'response_type' AS "responseType",
        persisted_candidate.turn_row ->> 'assistant_response' AS
          "assistantResponse",
        persisted_candidate.turn_row ->> 'source_refs_json' AS
          "sourceRefsJson",
        persisted_candidate.turn_row ->> 'missing_inputs_json' AS
          "missingInputsJson",
        persisted_candidate.turn_row ->> 'candidate_evidence_refs_json' AS
          "candidateEvidenceRefsJson",
        persisted_candidate.turn_row ->> 'review_action_draft_json' AS
          "reviewActionDraftJson",
        persisted_candidate.turn_row ->> 'affected_item_ids_json' AS
          "affectedItemIdsJson",
        persisted_candidate.turn_row ->> 'warnings_json' AS "warningsJson",
        persisted_candidate.turn_row ->> 'result_provenance_json' AS
          "resultProvenanceJson",
        persisted_candidate.turn_row ->> 'result_content_hash' AS
          "resultContentHash",
        persisted_candidate.turn_row ->> 'action_attempt_id' AS
          "actionAttemptId",
        persisted_candidate.turn_row ->> 'assistant_completed_at' AS
          "assistantCompletedAt",
        persisted_candidate.turn_row ->> 'created_at' AS "createdAt"
      FROM review_turn_hosted_runtime_persist_candidate(
        ${input.conversation.actorId},
        ${input.turn.reviewTurnId},
        ${input.conversation.reviewConversationId},
        ${input.conversation.tenantId},
        ${input.conversation.workItemId},
        ${input.turn.inputRevision},
        ${candidate.responseType},
        ${candidate.answer},
        ${canonicalJson(candidate.sourceRefs)},
        ${canonicalJson(candidate.missingInputs)},
        ${canonicalJson(candidate.candidateEvidenceRefs)},
        ${canonicalJson(candidate.reviewActionDraft)},
        ${canonicalJson(candidate.affectedItemIds)},
        ${canonicalJson(candidate.warnings)},
        ${canonicalJson({
          ...candidate.provenance,
          actionAttemptRef: candidate.actionAttemptRef,
        })},
        ${candidate.provenance.resultContentHash},
        ${input.actionAttemptId},
        ${input.completedAt.toISOString()}::timestamptz
      ) AS persisted_candidate
    `);
    const row = rows[0];
    if (row?.actorContext !== input.conversation.actorId) {
      throw new Error('REVIEW_OPENCLAW_ACTOR_CONTEXT_UNAVAILABLE');
    }
    const stored = row ? persistedTurn(actorPersistedTurn(row)) : null;
    if (!stored) throw new Error('REVIEW_TURN_CANDIDATE_READBACK_FAILED');
    assertCandidateReplay(stored, candidate);
    return { turn: stored, replayed: !row.candidateInserted };
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
    selectedEvaluationItemId?: string | null;
    executionRequested?: boolean;
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
        input.selectedEvaluationItemId ?? null,
        input.executionRequested === true,
      );
      return { turn: existing, replayed: true };
    }

    const now: Date = new Date();
    const reviewTurnId: string = `RT-${randomUUID()}`;
    const engineerSuppliedInputId: string = `ESI-${randomUUID()}`;
    const storedInput: string = encodeEngineerInput({
      schemaVersion: 'wiselink.3_1.review_engineer_input.v1.c7',
      userMessage: input.userMessage,
      selectedEvaluationItemId: input.selectedEvaluationItemId ?? null,
      executionRequested: input.executionRequested === true,
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
        input.selectedEvaluationItemId ?? null,
        input.executionRequested === true,
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

  private warnOpenClawBinding(
    reason:
      | 'ACTOR_CONTEXT_NOT_RETAINED'
      | 'REVIEW_SCHEMA_NOT_READY'
      | 'CONVERSATION_NOT_VISIBLE'
      | 'CONVERSATION_SCOPE_MISMATCH'
      | 'OFFICIAL_ACTOR_MAPPING_NOT_VISIBLE'
      | 'TURN_NOT_VISIBLE',
    diagnostic: OpenClawBindingDiagnostic,
  ): void {
    this.logger.warn(
      JSON.stringify({
        event: 'OPENCLAW_REVIEW_BINDING_NOT_FOUND',
        reason,
        diagnostic,
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
    openClawAgentId: reviewConversation.openclawAgentId,
    openClawSessionKey: reviewConversation.openclawSessionKey,
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

interface ActorPersistedReviewTurnRow extends Record<string, unknown> {
  actorContext: string | null;
  candidateInserted: boolean;
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
  assistantCompletedAt: RawDatabaseTimestamp | null;
  createdAt: RawDatabaseTimestamp;
}

type RawDatabaseTimestamp = Date | string;

interface ActorBoundReviewTurnRow extends Record<string, unknown> {
  actorContext: string | null;
  authenticatedRoleMember: boolean | null;
  serviceRoleMember: boolean | null;
  rowSecurityActive: boolean | null;
  expectedSchemaResolved: boolean;
  reviewSelectPolicyPresent: boolean | null;
  reviewCandidateUpdatePolicyPresent: boolean | null;
  reviewRlsEnabled: boolean | null;
  reviewConversationId: string | null;
  conversationTenantId: string | null;
  conversationActorId: string | null;
  conversationWorkItemId: string | null;
  openClawAgentId: string | null;
  openClawSessionKey: string | null;
  startedAtRevision: number | null;
  lastSyncedRevision: number | null;
  conversationStatus: string | null;
  conversationCreatedAt: RawDatabaseTimestamp | null;
  lastActiveAt: RawDatabaseTimestamp | null;
  closedAt: RawDatabaseTimestamp | null;
  officialMappingId: string | null;
  reviewTurnId: string | null;
  turnReviewConversationId: string | null;
  engineerSuppliedInputId: string | null;
  turnNo: number | null;
  requestId: string | null;
  inputRevision: number | null;
  userMessage: string | null;
  inputType: string | null;
  adoptionStatus: string | null;
  candidateText: string | null;
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
  assistantCompletedAt: RawDatabaseTimestamp | null;
  turnCreatedAt: RawDatabaseTimestamp | null;
}

type RuntimeRoleClass =
  | 'AUTHENTICATED_MEMBER'
  | 'SERVICE_ROLE_MEMBER'
  | 'NEITHER'
  | 'UNKNOWN';

interface OpenClawBindingDiagnostic {
  actorContextApplied: boolean;
  runtimeRoleClass: RuntimeRoleClass;
  authenticatedRoleMember: boolean | null;
  serviceRoleMember: boolean | null;
  rowSecurityActive: boolean | null;
  expectedSchemaResolved: boolean;
  sameConnectionContextSupported: boolean;
  reviewSelectPolicyPresent: boolean | null;
  reviewCandidateUpdatePolicyPresent: boolean | null;
  reviewRlsEnabled: boolean | null;
  rlsPolicyApplicable: boolean;
  exactActiveConversationVisible: boolean;
}

function openClawBindingDiagnostic(
  row: ActorBoundReviewTurnRow | undefined,
  actorId: string,
): OpenClawBindingDiagnostic {
  const actorContextApplied = row?.actorContext === actorId;
  const authenticatedRoleMember = row?.authenticatedRoleMember ?? null;
  const serviceRoleMember = row?.serviceRoleMember ?? null;
  const reviewSelectPolicyPresent = row?.reviewSelectPolicyPresent ?? null;
  const reviewCandidateUpdatePolicyPresent =
    row?.reviewCandidateUpdatePolicyPresent ?? null;
  const reviewRlsEnabled = row?.reviewRlsEnabled ?? null;
  return {
    actorContextApplied,
    runtimeRoleClass: runtimeRoleClass(
      authenticatedRoleMember,
      serviceRoleMember,
    ),
    authenticatedRoleMember,
    serviceRoleMember,
    rowSecurityActive: row?.rowSecurityActive ?? null,
    expectedSchemaResolved: row?.expectedSchemaResolved ?? false,
    sameConnectionContextSupported: actorContextApplied,
    reviewSelectPolicyPresent,
    reviewCandidateUpdatePolicyPresent,
    reviewRlsEnabled,
    rlsPolicyApplicable:
      reviewSelectPolicyPresent === true &&
      reviewCandidateUpdatePolicyPresent === true &&
      reviewRlsEnabled === true,
    exactActiveConversationVisible: Boolean(row?.reviewConversationId),
  };
}

function runtimeRoleClass(
  authenticatedRoleMember: boolean | null,
  serviceRoleMember: boolean | null,
): RuntimeRoleClass {
  if (serviceRoleMember === true) return 'SERVICE_ROLE_MEMBER';
  if (authenticatedRoleMember === true) return 'AUTHENTICATED_MEMBER';
  if (authenticatedRoleMember === false && serviceRoleMember === false) {
    return 'NEITHER';
  }
  return 'UNKNOWN';
}

function actorBoundConversation(
  row: ActorBoundReviewTurnRow,
): PersistedReviewConversation {
  if (
    !row.reviewConversationId ||
    !row.conversationTenantId ||
    !row.conversationActorId ||
    !row.conversationWorkItemId ||
    !row.openClawAgentId ||
    !row.openClawSessionKey ||
    row.startedAtRevision === null ||
    row.lastSyncedRevision === null ||
    !row.conversationStatus ||
    !row.conversationCreatedAt ||
    !row.lastActiveAt
  ) {
    throw new Error('REVIEW_OPENCLAW_CONVERSATION_BINDING_PARTIAL');
  }
  return {
    reviewConversationId: row.reviewConversationId,
    tenantId: row.conversationTenantId,
    actorId: row.conversationActorId,
    workItemId: row.conversationWorkItemId,
    openClawAgentId: row.openClawAgentId,
    openClawSessionKey: row.openClawSessionKey,
    startedAtRevision: row.startedAtRevision,
    lastSyncedRevision: row.lastSyncedRevision,
    status: row.conversationStatus,
    createdAt: persistedTimestamp(
      row.conversationCreatedAt,
      'reviewConversation.createdAt',
    ),
    lastActiveAt: persistedTimestamp(
      row.lastActiveAt,
      'reviewConversation.lastActiveAt',
    ),
    closedAt:
      row.closedAt !== null
        ? persistedTimestamp(row.closedAt, 'reviewConversation.closedAt')
        : null,
  };
}

function actorBoundTurn(row: ActorBoundReviewTurnRow): SelectedReviewTurn {
  if (
    !row.reviewTurnId ||
    !row.turnReviewConversationId ||
    !row.engineerSuppliedInputId ||
    row.turnNo === null ||
    !row.requestId ||
    row.inputRevision === null ||
    !row.userMessage ||
    !row.inputType ||
    !row.adoptionStatus ||
    !row.candidateText ||
    !row.turnCreatedAt
  ) {
    throw new Error('REVIEW_OPENCLAW_TURN_BINDING_PARTIAL');
  }
  return {
    reviewTurnId: row.reviewTurnId,
    reviewConversationId: row.turnReviewConversationId,
    engineerSuppliedInputId: row.engineerSuppliedInputId,
    turnNo: row.turnNo,
    requestId: row.requestId,
    inputRevision: row.inputRevision,
    userMessage: row.userMessage,
    inputType: row.inputType,
    adoptionStatus: row.adoptionStatus,
    candidateText: row.candidateText,
    responseType: row.responseType,
    assistantResponse: row.assistantResponse,
    sourceRefsJson: row.sourceRefsJson,
    missingInputsJson: row.missingInputsJson,
    candidateEvidenceRefsJson: row.candidateEvidenceRefsJson,
    reviewActionDraftJson: row.reviewActionDraftJson,
    affectedItemIdsJson: row.affectedItemIdsJson,
    warningsJson: row.warningsJson,
    resultProvenanceJson: row.resultProvenanceJson,
    resultContentHash: row.resultContentHash,
    actionAttemptId: row.actionAttemptId,
    assistantCompletedAt:
      row.assistantCompletedAt !== null
        ? persistedTimestamp(
            row.assistantCompletedAt,
            'reviewTurn.assistantCompletedAt',
          )
        : null,
    createdAt: persistedTimestamp(row.turnCreatedAt, 'reviewTurn.createdAt'),
  };
}

function persistedTimestamp(value: RawDatabaseTimestamp, field: string): Date {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`REVIEW_PERSISTED_TIMESTAMP_INVALID:${field}`);
  }
  return timestamp;
}

function actorPersistedTurn(
  row: ActorPersistedReviewTurnRow,
): SelectedReviewTurn {
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
    responseType: row.responseType,
    assistantResponse: row.assistantResponse,
    sourceRefsJson: row.sourceRefsJson,
    missingInputsJson: row.missingInputsJson,
    candidateEvidenceRefsJson: row.candidateEvidenceRefsJson,
    reviewActionDraftJson: row.reviewActionDraftJson,
    affectedItemIdsJson: row.affectedItemIdsJson,
    warningsJson: row.warningsJson,
    resultProvenanceJson: row.resultProvenanceJson,
    resultContentHash: row.resultContentHash,
    actionAttemptId: row.actionAttemptId,
    assistantCompletedAt:
      row.assistantCompletedAt === null
        ? null
        : persistedTimestamp(
            row.assistantCompletedAt,
            'reviewTurn.assistantCompletedAt',
          ),
    createdAt: persistedTimestamp(row.createdAt, 'reviewTurn.createdAt'),
  };
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
    selectedEvaluationItemId: turnInput.selectedEvaluationItemId ?? null,
    executionRequested: turnInput.executionRequested === true,
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
  const reviewActionDraft = parseStoredReviewActionDraft({
    value: row.reviewActionDraftJson,
    actionAttemptRef,
    reviewConversationRef: row.reviewConversationId,
    reviewTurnRef: row.reviewTurnId,
    resultContentHash: row.resultContentHash,
  });
  return {
    responseType: row.responseType as ReviewTurnResponseType,
    answer: row.assistantResponse,
    sourceRefs: parseJsonStringArray(row.sourceRefsJson),
    missingInputs: parseJsonStringArray(row.missingInputsJson),
    candidateEvidenceRefs: parseJsonStringArray(row.candidateEvidenceRefsJson),
    reviewActionDraft,
    affectedItemIds: parseJsonStringArray(row.affectedItemIdsJson),
    warnings: parseJsonStringArray(row.warningsJson),
    actionAttemptRef,
    provenance:
      resultProvenance as unknown as ReviewTurnAssistantCandidate['provenance'],
    completedAt: row.assistantCompletedAt.toISOString(),
  };
}

function parseStoredReviewActionDraft(input: {
  value: string;
  actionAttemptRef: string;
  reviewConversationRef: string;
  reviewTurnRef: string;
  resultContentHash: string;
}): ReviewActionDraftCandidate | null {
  const parsed: unknown = JSON.parse(input.value) as unknown;
  if (parsed === null) return null;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('REVIEW_TURN_CANDIDATE_JSON_INVALID');
  }
  const record: Record<string, unknown> = parsed as Record<string, unknown>;
  const { reviewActionDraftRef: storedRef, ...proposal } = record;
  const normalizedDraft = {
    ...proposal,
    uncertaintyDispositions: Array.isArray(proposal.uncertaintyDispositions)
      ? proposal.uncertaintyDispositions
      : [],
    decisionSnapshot: proposal.decisionSnapshot ?? null,
  };
  const expectedRef = `RAD-${canonicalSha256({
    schemaVersion: 'wiselink.3_1.review_action_draft_ref.v1',
    attemptRef: input.actionAttemptRef,
    reviewConversationRef: input.reviewConversationRef,
    reviewTurnRef: input.reviewTurnRef,
    resultContentHash: input.resultContentHash,
    draft: normalizedDraft,
  })}`;
  if (storedRef !== undefined && storedRef !== expectedRef) {
    throw new Error('REVIEW_ACTION_DRAFT_REF_BINDING_DRIFT');
  }
  return structuredClone({
    ...normalizedDraft,
    reviewActionDraftRef: expectedRef,
  }) as unknown as ReviewActionDraftCandidate;
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
  selectedEvaluationItemId: string | null,
  executionRequested: boolean,
): void {
  if (
    turn.userMessage !== userMessage ||
    turn.candidateText !== userMessage ||
    (turn.selectedEvaluationItemId ?? null) !== selectedEvaluationItemId ||
    (turn.executionRequested === true) !== executionRequested ||
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
    (record.executionRequested !== undefined &&
      typeof record.executionRequested !== 'boolean') ||
    (record.selectedEvaluationItemId !== undefined &&
      record.selectedEvaluationItemId !== null &&
      (typeof record.selectedEvaluationItemId !== 'string' ||
        !record.selectedEvaluationItemId.trim())) ||
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

function reviewSchemaNotReady(): Error & {
  code: 'REVIEW_SCHEMA_NOT_READY';
  statusCode: 503;
  retryable: false;
  operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS';
  details: {
    retryable: false;
    operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS';
  };
} {
  const details = {
    retryable: false,
    operatorAction: 'APPLY_REQUIRED_SCHEMA_MIGRATIONS',
  } as const;
  return Object.assign(
    new Error('Required Review database schema is not ready.'),
    {
      code: 'REVIEW_SCHEMA_NOT_READY' as const,
      statusCode: 503 as const,
      ...details,
      details,
    },
  );
}
