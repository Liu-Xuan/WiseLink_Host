import { checklistTaskSelection } from '../canonical-host/jobaid-checklist-reading';
import { isProgramAssessmentMode } from '../canonical-host/program-agent-policy';
import { parseAilyExecutorRun, serializeAilyExecutorRun, sameAilyPendingOperation, type AilyExecutorRun, type AilyFinalCommitGuard } from '../canonical-host/aily-executor-run';
import { InitialExpiredAttemptRepository, initialAttemptConflict } from './initial-expired-attempt.repository';
import { JOBAID_ACTIVITY_WINDOW, projectJobAidActivity } from '../canonical-host/jobaid-activity';
import { isReviewAssessmentReadActivity } from './review-evidence-activity';
import { ailyStageOveralls } from '../canonical-host/program-controlled-assessment';
import { assertAutomaticWorkItemAttemptLeaseBinding, automaticWorkItemTaskLease } from './automatic-work-item-attempt-lease';
import { assertCancelledInitialContinuation, cancelledContinuationConflict, type CancelledInitialContinuationGuard } from './cancelled-initial-continuation';
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  and,
  getTableColumns,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  max,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { actionAttempt, assessmentWorkRevision, workItem } from '../../database/schema';
import type {
  CanonicalWorkItemProjection,
  ReviewEvidenceActivity,
  ReviewRuntimeActivity,
} from '@shared/api.interface';
import { canonicalJson, parseTaskEnvelope, parseStoredResultEnvelope } from './action-attempt-envelope';
import { INITIAL_ANALYSIS_REQUEST_SCHEMA } from './initial-analysis-request';
import { autoWorkItemAuthorization } from '../../database/auto-work-item-authorization.schema';
import { readStoredExecutionModel } from '../model-settings/canonical-execution-model';
import type {
  OpenClawActionTaskType,
  OpenClawResultEnvelope,
  AnyOpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from './action-attempt-envelope.types';
import { ACTION_ATTEMPT_REQUEST_ORIGIN } from './action-attempt.types';
import type {
  ActionAttemptRow,
  ActionAttemptControlRow,
  MatterActionAttemptRow,
  ActionAttemptWorkItemBinding,
  ReserveActionAttemptInput,
} from './action-attempt.types';

const ACTIVE_STATUSES = [
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'COMMITTING',
] as const;
const CLAIMABLE_STATUSES = ['QUEUED', 'RETRY_SCHEDULED'] as const;
const CANCELLABLE_STATUSES = ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED'] as const;

export interface ActionAttemptReservation {
  row: ActionAttemptRow;
  created: boolean;
}

@Injectable()
export class ActionAttemptRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** New mode only. Old readers never select an unapplied migration column. */
  async assertAilyExecutorStorage(): Promise<void> {
    try {
      await this.db.execute(sql`SELECT executor_run_json FROM action_attempt WHERE FALSE`);
    } catch (cause) {
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '42703')
        throw new Error('INITIAL_CONTINUATION_AILY_STORAGE_UNAVAILABLE');
      throw cause;
    }
  }

  async readAilyExecutorRun(input: {tenantId: string; workItemId: string; attemptId: string}): Promise<AilyExecutorRun | null> {
    const rows = await this.db.execute<{value: unknown}>(sql`
      SELECT executor_run_json AS value FROM action_attempt
      WHERE attempt_id=${input.attemptId} AND tenant_id=${input.tenantId} AND work_item_id=${input.workItemId}
        AND task_envelope_json::jsonb #>> '{modelInput,executionMode}'='AILY_AGENT_V1'`);
    if (!rows[0]) throw new Error('ACTION_ATTEMPT_NOT_FOUND');
    return parseAilyExecutorRun(rows[0].value);
  }

  /** The existing plaintext UUID lease stays only in this trusted SQL fence. */
  async compareAndSetAilyExecutorRun(input: {
    row: ActionAttemptRow; principalId: string; expected: AilyExecutorRun | null; next: AilyExecutorRun;
  }): Promise<boolean> {
    const { row } = input;
    if (!row.leaseToken || row.leaseOwner !== input.principalId ||
        input.next.leaseGeneration !== row.leaseGeneration || input.next.scope.tenantId !== row.tenantId ||
        input.next.scope.workItemId !== row.workItemId || input.next.scope.principalId !== input.principalId)
      throw new Error('ACTION_ATTEMPT_LEASE_FENCE_REJECTED');
    if (input.expected === null ? input.next.post.state !== 'STARTED' :
        input.expected.post.state !== 'STARTED' || input.next.post.state === 'STARTED' ||
        canonicalJson({...input.expected, post: undefined, observation: undefined}) !==
          canonicalJson({...input.next, post: undefined, observation: undefined}) ||
        input.expected.post.startedAt !== input.next.post.startedAt ||
        input.expected.post.requestBody !== input.next.post.requestBody)
      throw new Error('AILY_EXECUTOR_RUN_TRANSITION_INVALID');
    const expected = input.expected === null ? null : serializeAilyExecutorRun(input.expected);
    const next = serializeAilyExecutorRun(input.next);
    const nextValue = input.expected === null ? sql`${next}::jsonb`
      : sql`jsonb_set(executor_run_json,'{post}',${canonicalJson(input.next.post)}::jsonb,false)`;
    const expectedValue = input.expected === null
      ? sql`executor_run_json IS NOT DISTINCT FROM ${expected}::jsonb`
      : sql`(executor_run_json-'pending') IS NOT DISTINCT FROM (${expected}::jsonb-'pending')`;
    const changed = await this.db.execute(sql`
      UPDATE action_attempt SET executor_run_json=${nextValue},updated_at=clock_timestamp()
      WHERE attempt_id=${row.attemptId} AND tenant_id=${row.tenantId} AND work_item_id=${row.workItemId}
        AND operation_ref=${row.operationRef} AND task_input_hash=${row.taskInputHash}
        AND task_envelope_json::jsonb #>> '{modelInput,executionMode}'='AILY_AGENT_V1'
        AND lease_owner=${input.principalId} AND lease_token=${row.leaseToken} AND lease_generation=${row.leaseGeneration}
        AND status='RUNNING' AND cancel_requested_at IS NULL
        AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp()
        AND ${expectedValue}
      RETURNING attempt_id`);
    return changed.length === 1;
  }

  /** Observation is independent of the concurrent SAVE slot and never replaces it. */
  async compareAndSetAilyObservation(input: {row: ActionAttemptRow; principalId: string;
    expected: AilyExecutorRun; observation: NonNullable<AilyExecutorRun['observation']>}): Promise<boolean> {
    const {row, expected} = input;
    if (!row.leaseToken || row.leaseOwner !== input.principalId || expected.post.state !== 'ACCEPTED' ||
        expected.leaseGeneration !== row.leaseGeneration || expected.scope.principalId !== input.principalId ||
        expected.scope.tenantId !== row.tenantId || expected.scope.workItemId !== row.workItemId)
      throw new Error('AILY_OBSERVATION_BINDING_CHANGED');
    const checked = serializeAilyExecutorRun({...expected, observation: input.observation});
    return this.withAutomaticAttemptLease(row.attemptId, true, async database => {
      const changed = await database.execute(sql`
        UPDATE action_attempt SET executor_run_json=jsonb_set(executor_run_json,'{observation}',
          ${checked}::jsonb->'observation',true),updated_at=clock_timestamp()
        WHERE attempt_id=${row.attemptId} AND tenant_id=${row.tenantId} AND work_item_id=${row.workItemId}
          AND operation_ref=${row.operationRef} AND task_input_hash=${row.taskInputHash}
          AND task_envelope_json::jsonb#>>'{modelInput,executionMode}'='AILY_AGENT_V1'
          AND lease_owner=${input.principalId} AND lease_token=${row.leaseToken} AND lease_generation=${row.leaseGeneration}
          AND status='RUNNING' AND cancel_requested_at IS NULL
          AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp()
          AND (executor_run_json-'pending') IS NOT DISTINCT FROM
            (${serializeAilyExecutorRun(expected)}::jsonb-'pending')
        RETURNING attempt_id`);
      return changed.length === 1;
    });
  }

  /** Only the current candidate/SAVE slot changes; original dispatch facts stay sealed. */
  async compareAndSetAilyDomainRun(input: {row: ActionAttemptRow; principalId: string;
    expected: AilyExecutorRun; next: AilyExecutorRun; writePredicate: SQL}): Promise<boolean> {
    const {row} = input;
    if (!row.leaseToken || row.leaseOwner !== input.principalId || input.expected.leaseGeneration !== row.leaseGeneration ||
        canonicalJson({...input.expected, pending: undefined}) !== canonicalJson({...input.next, pending: undefined}))
      throw new Error('AILY_DOMAIN_RUN_BINDING_CHANGED');
    const previous = input.expected.pending;
    const next = input.next.pending;
    if (!next || !previous&&next.phase!=='VALIDATED' || previous && !sameAilyPendingOperation(previous,next) &&
        (previous.phase!=='READ'||next.phase!=='VALIDATED'||previous.candidateRef===next.candidateRef||
          previous.saveRequestId===next.saveRequestId||next.expectedWorkRevision!==previous.workRevision||
          next.previousWorkRevisionRef!==previous.workRevisionRef))
      throw new Error('AILY_PENDING_SAVE_CONFLICT');
    const phases = ['VALIDATED', 'SAVE_STARTED', 'SAVED', 'READ'];
    if (previous?.candidateRef === next.candidateRef && phases.indexOf(next.phase) < phases.indexOf(previous.phase))
      throw new Error('AILY_PENDING_SAVE_CONFLICT');
    if(previous&&sameAilyPendingOperation(previous,next)&&previous.workRevisionRef&&
        (next.workRevisionRef!==previous.workRevisionRef||next.workRevision!==previous.workRevision))
      throw new Error('AILY_PENDING_SAVE_CONFLICT');
    const changed = await this.db.execute(sql`
      UPDATE action_attempt SET executor_run_json=${serializeAilyExecutorRun(input.next)}::jsonb,updated_at=clock_timestamp()
      WHERE attempt_id=${row.attemptId} AND tenant_id=${row.tenantId} AND work_item_id=${row.workItemId}
        AND task_input_hash=${row.taskInputHash} AND lease_owner=${input.principalId} AND lease_token=${row.leaseToken}
        AND lease_generation=${row.leaseGeneration} AND status='RUNNING' AND cancel_requested_at IS NULL
        AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp()
        AND executor_run_json IS NOT DISTINCT FROM ${serializeAilyExecutorRun(input.expected)}::jsonb
        AND (${input.writePredicate}) RETURNING attempt_id`);
    return changed.length === 1;
  }

  async readWorkItemBinding(input: {
    workItemId: string;
    tenantId: string;
  }): Promise<ActionAttemptWorkItemBinding | null> {
    const [row] = await this.db
      .select({
        workItemId: workItem.workItemId,
        tenantId: workItem.tenantId,
        documentVersionId: workItem.documentVersionId,
        revision: workItem.revision,
        projectionJson: workItem.projectionJson,
      })
      .from(workItem)
      .where(
        and(
          eq(workItem.workItemId, input.workItemId),
          eq(workItem.tenantId, input.tenantId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async nextAttemptNo(input: {
    workItemId: string;
    actionType: string;
  }): Promise<number> {
    const [row] = await this.db
      .select({ maximum: max(actionAttempt.attemptNo) })
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.workItemId, input.workItemId),
          eq(actionAttempt.actionType, input.actionType),
        ),
      );
    return Number(row?.maximum ?? 0) + 1;
  }

  async readByIdempotency(input: {
    tenantId: string;
    idempotencyKey: string;
  }): Promise<ActionAttemptRow | null> {
    const [row] = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.tenantId, input.tenantId),
          eq(actionAttempt.idempotencyKey, input.idempotencyKey),
          inArray(actionAttempt.status, [...ACTIVE_STATUSES]),
        ),
      )
      .orderBy(actionAttempt.createdAt)
      .limit(1);
    return (row as ActionAttemptRow | undefined) ?? null;
  }

  async readByOperationRef(
    operationRef: string,
  ): Promise<ActionAttemptRow | null> {
    const [row] = await this.db
      .select()
      .from(actionAttempt)
      .where(eq(actionAttempt.operationRef, operationRef))
      .limit(1);
    return (row as ActionAttemptRow | undefined) ?? null;
  }

  async readControlByOperationRef(operationRef:string):Promise<ActionAttemptControlRow|null> {
    const [row]=await this.db.select(attemptControlColumns()).from(actionAttempt)
      .where(eq(actionAttempt.operationRef,operationRef)).limit(1);
    return row??null;
  }
  async readControlByAttemptId(attemptId:string):Promise<ActionAttemptControlRow|null> {
    const [row]=await this.db.select(attemptControlColumns()).from(actionAttempt)
      .where(eq(actionAttempt.attemptId,attemptId)).limit(1);
    return row??null;
  }

  /** Locate the exact existing execution before Source admission opens bodies. */
  async readRequestIdentity(input:{tenantId:string;workItemId:string;taskType:OpenClawActionTaskType;
    documentVersionId:string;idempotencyKey:string}) {
    const [row]=await this.db.select({operationRef:actionAttempt.operationRef,status:actionAttempt.status})
      .from(actionAttempt).where(and(eq(actionAttempt.tenantId,input.tenantId),eq(actionAttempt.workItemId,input.workItemId),
        eq(actionAttempt.actionType,input.taskType),eq(actionAttempt.documentVersionId,input.documentVersionId),
        eq(actionAttempt.requestOrigin,ACTION_ATTEMPT_REQUEST_ORIGIN),eq(actionAttempt.idempotencyKey,input.idempotencyKey)))
      .orderBy(desc(actionAttempt.createdAt)).limit(1);
    return row??null;
  }

  /** Review authorization must not decode a model task or a result journal
   * before the current native Source/own-approval metadata gate. */
  async readReviewScopeMetadata(operationRef: string) {
    const [row] = await this.db.select({
      attemptId: actionAttempt.attemptId, operationRef: actionAttempt.operationRef,
      tenantId: actionAttempt.tenantId, workItemId: actionAttempt.workItemId,
      actionType: actionAttempt.actionType, actorUserId: actionAttempt.actorUserId,
      status: actionAttempt.status, baseRevision: actionAttempt.baseRevision,
      requestOrigin: actionAttempt.requestOrigin,
      documentVersionId: actionAttempt.documentVersionId, inputRevision: actionAttempt.inputRevision,
      leaseOwner: actionAttempt.leaseOwner, taskInputHash: actionAttempt.taskInputHash,
      inputHash: sql<string>`${actionAttempt.taskEnvelopeJson}::jsonb->>'inputHash'`,
      taskType: sql<string>`${actionAttempt.taskEnvelopeJson}::jsonb->>'taskType'`,
      taskOperationRef: sql<string>`${actionAttempt.taskEnvelopeJson}::jsonb->>'operationRef'`,
      taskWorkItemId: sql<string>`${actionAttempt.taskEnvelopeJson}::jsonb->>'workItemId'`,
      conversation: sql<string>`${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,reviewConversationRef}'`,
      turn: sql<string>`${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,reviewTurnRef}'`,
      requestId: sql<string>`${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,requestId}'`,
      hasTdmsReviewContext: sql<boolean>`${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext}' IS NOT NULL`,
      hasTdmsSuccessorObligation: sql<boolean>`
        ${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,tdmsContext}' IS NOT NULL OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(
            ${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,previousWork,content,evidence}')='array'
            THEN ${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,previousWork,content,evidence}'
            ELSE '[]'::jsonb END) AS evidence WHERE evidence->>'kind'='TDMS_NATIVE_RECORD')`,
      successorReviewTurnRef: sql<string | null>`${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,successorReviewTurnRef}'`,
      hasSuccessorBinding: sql<boolean>`${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,successorOverallBinding}' IS NOT NULL`,
      successorBinding: sql<unknown>`jsonb_build_object(
        'reviewConversationRef',${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,successorOverallBinding,reviewConversationRef}',
        'requestId',${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,successorOverallBinding,requestId}',
        'inputRevision',${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,successorOverallBinding,inputRevision}',
        'workRevisionRef',${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,successorOverallBinding,workRevisionRef}')`,
      sealedSuccess: sql<boolean>`${actionAttempt.resultContentHash} IS NOT NULL AND
        ${actionAttempt.resultEnvelopeJson}::jsonb->>'contentHash'=${actionAttempt.resultContentHash} AND
        ${actionAttempt.resultEnvelopeJson}::jsonb->>'status'='SUCCEEDED'`,
      matterScope: sql<unknown>`${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,matterContext,scope}'`,
    }).from(actionAttempt).where(eq(actionAttempt.operationRef, operationRef)).limit(1);
    return row ?? null;
  }

  /** Exact existing successor identity; no task, result or native journal body. */
  async readSuccessorRecoveryMetadata(input:{tenantId:string;workItemId:string;idempotencyKey:string}) {
    const [row]=await this.db.select({operationRef:actionAttempt.operationRef,
      projectionMatches:sql<boolean>`
        ${workItem.revision}=${actionAttempt.inputRevision}+1 AND
        ${workItem.projectionJson}::jsonb->>'revision'=${workItem.revision}::text AND
        ${workItem.projectionJson}::jsonb#>>'{integratedAssessment,overallSynthesis,actionAttemptId}'=${actionAttempt.attemptId} AND
        ${workItem.projectionJson}::jsonb#>>'{integratedAssessment,overallSynthesis,basedOnJobAidWorkRevisionRef}'=
          ${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,successorOverallBinding,workRevisionRef}'`,
      currentRevision:workItem.revision,owner:workItem.requestedByUserId,
    }).from(actionAttempt).innerJoin(workItem,and(eq(workItem.tenantId,actionAttempt.tenantId),
      eq(workItem.workItemId,actionAttempt.workItemId))).where(and(eq(actionAttempt.tenantId,input.tenantId),
      eq(actionAttempt.workItemId,input.workItemId),eq(actionAttempt.idempotencyKey,input.idempotencyKey),
      eq(actionAttempt.actionType,'OPENCLAW_OVERALL_SYNTHESIS'))).orderBy(desc(actionAttempt.createdAt)).limit(1);
    if(!row?.operationRef) return null;
    const attempt=await this.readReviewScopeMetadata(row.operationRef);
    return attempt?{...row,attempt}:null;
  }

  async readMatterByOperationRef(
    operationRef: string,
  ): Promise<MatterActionAttemptRow | null> {
    const [row] = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.operationRef, operationRef),
          eq(actionAttempt.subjectKind, 'ENGINEERING_MATTER'),
          isNull(actionAttempt.workItemId),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (
      !row.matterId ||
      !row.matterRevisionId ||
      row.documentVersionId !== null
    )
      throw new Error('ACTION_ATTEMPT_SUBJECT_INVALID');
    return { ...row, subjectKind: 'ENGINEERING_MATTER', workItemId: null };
  }

  async readByAttemptId(attemptId: string): Promise<ActionAttemptRow | null> {
    const [row] = await this.db
      .select()
      .from(actionAttempt)
      .where(eq(actionAttempt.attemptId, attemptId))
      .limit(1);
    return (row as ActionAttemptRow | undefined) ?? null;
  }

  async readLatestByExactIdempotency(input: {
    tenantId: string;
    idempotencyKey: string;
  }, metadataOnly=false): Promise<(ActionAttemptRow & { checklistContext?: unknown }) | null> {
    const [row] = await this.db
      .select(metadataOnly ? {...getTableColumns(actionAttempt),
        taskEnvelopeJson:sql<string|null>`NULL`,resultEnvelopeJson:sql<string|null>`NULL`,
        reviewActivityJson:reviewActivityMetadata(),
        checklistContext: checklistTaskSelection(),
      } : getTableColumns(actionAttempt))
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.tenantId, input.tenantId),
          eq(actionAttempt.idempotencyKey, input.idempotencyKey),
        ),
      )
      .orderBy(desc(actionAttempt.attemptNo))
      .limit(1);
    return (row as ActionAttemptRow | undefined) ?? null;
  }

  async terminalizeExpiredActiveForSuccessor(input: {
    workItemId: string;
    actionType: string;
    tenantId: string;
    now: Date;
  }): Promise<boolean> {
    const expiredByDeadline = await this.db
      .update(actionAttempt)
      .set({
        status: 'TIMED_OUT',
        terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED',
        completedAt: input.now,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        leaseSlot: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(actionAttempt.workItemId, input.workItemId),
          eq(actionAttempt.actionType, input.actionType),
          eq(actionAttempt.tenantId, input.tenantId),
          inArray(actionAttempt.status, [...CANCELLABLE_STATUSES]),
          lte(actionAttempt.deadlineAt, input.now),
          isNull(actionAttempt.cancelRequestedAt),
          isNull(actionAttempt.commitStartedAt),
          isNull(actionAttempt.resultEnvelopeJson),
          isNull(actionAttempt.resultContentHash),
          eq(actionAttempt.projectionApplied, false),
          isNull(actionAttempt.completedAt),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    if (expiredByDeadline.length === 1) return true;

    const supersededAfterLeaseExpiry = await this.db
      .update(actionAttempt)
      .set({
        status: 'OBSOLETE',
        terminalReason: 'ACTION_ATTEMPT_SUPERSEDED_AFTER_LEASE_EXPIRY',
        completedAt: input.now,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        leaseSlot: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(actionAttempt.workItemId, input.workItemId),
          eq(actionAttempt.actionType, input.actionType),
          eq(actionAttempt.tenantId, input.tenantId),
          eq(actionAttempt.status, 'RUNNING'),
          lte(actionAttempt.leaseExpiresAt, input.now),
          or(
            isNull(actionAttempt.deadlineAt),
            gt(actionAttempt.deadlineAt, input.now),
          ),
          isNull(actionAttempt.cancelRequestedAt),
          isNull(actionAttempt.commitStartedAt),
          isNull(actionAttempt.resultEnvelopeJson),
          isNull(actionAttempt.resultContentHash),
          eq(actionAttempt.projectionApplied, false),
          isNull(actionAttempt.completedAt),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    return supersededAfterLeaseExpiry.length === 1;
  }

  async reserve(
    attempt: typeof actionAttempt.$inferInsert,
    knowledge?: ReserveActionAttemptInput['initialKnowledgeSession'],
    cancelled?: CancelledInitialContinuationGuard,
    aily?: ReserveActionAttemptInput['ailyExecution'],
  ): Promise<ActionAttemptReservation> {
    const hasInitialModel =
      [
        'OPENCLAW_TRANSLATE',
        'OPENCLAW_APPLICABILITY_EVALUATION',
        'OPENCLAW_DYNAMIC_EVALUATION',
        'OPENCLAW_OVERALL_SYNTHESIS',
      ].includes(String(attempt.actionType)) &&
      attempt.executionModelJson != null;
    if (
      attempt.idempotencyKey?.startsWith('openclaw-v2:') ||
      attempt.actionType === 'OPENCLAW_APPLICABILITY_EVALUATION' ||
      hasInitialModel
    ) {
      // Serialize explicit requests and applicability admission against the WI row. The legacy
      // partial unique index alone does not cover a response lost after commit.
      return this.db.transaction(async (transaction) => {
        const [owner] = await transaction
          .select({
            id: workItem.workItemId,
            revision: workItem.revision,
            documentVersionId: workItem.documentVersionId,
            initialAilySessionId: workItem.initialAilySessionId,
            requestedByUserId: workItem.requestedByUserId,
            analysisModelJson: workItem.analysisModelJson,
            requestId: workItem.requestId, documentId: workItem.documentId,
            sourceArtifactId: workItem.sourceArtifactId, sourceFileSha256: workItem.sourceFileSha256,
            sourceByteLength: workItem.sourceByteLength, actionType: workItem.actionType,
            status: workItem.status, packageId: workItem.packageId,
            projectionJson: workItem.projectionJson,
          })
          .from(workItem)
          .where(
            and(
              eq(workItem.workItemId, String(attempt.workItemId)),
              eq(workItem.tenantId, String(attempt.tenantId)),
            ),
          )
          .limit(1)
          .for('update');
        if (!owner) throw new Error('ACTION_ATTEMPT_WORK_ITEM_NOT_FOUND');
        const [existing] = await transaction
          .select()
          .from(actionAttempt)
          .where(
            and(
              eq(actionAttempt.tenantId, String(attempt.tenantId)),
              eq(actionAttempt.idempotencyKey, String(attempt.idempotencyKey)),
            ),
          )
          .orderBy(desc(actionAttempt.attemptNo))
          .limit(1);
        if (existing)
          return { row: existing as ActionAttemptRow, created: false };
        if (
          owner.revision !== attempt.baseRevision ||
          owner.documentVersionId !== attempt.documentVersionId
        )
          throw new Error('ACTION_ATTEMPT_WORK_ITEM_BINDING_CHANGED');
        // captureForWorkItem precedes asynchronous input preparation. A late
        // prepared request must not insert its old model after a pending model
        // selection changed while it was awaiting that preparation.
        const requestTask = JSON.parse(String(attempt.taskEnvelopeJson)) as OpenClawTaskEnvelope;
        const explicitProgram = isProgramAssessmentMode(requestTask.modelInput?.executionMode);
        const explicitAily = requestTask.modelInput?.executionMode === 'AILY_AGENT_V1';
        if (explicitProgram && (attempt.actionType !== 'OPENCLAW_DYNAMIC_EVALUATION' ||
            requestTask.modelInput.schemaVersion !== 'wiselink.3_1.initial_analysis_request.v1' ||
            requestTask.executionModel?.modelRef !== requestTask.modelInput.modelRef ||
            canonicalJson(requestTask.executionModel) !== canonicalJson(readStoredExecutionModel(attempt.executionModelJson))))
          throw new Error('ACTION_ATTEMPT_PROGRAM_MODEL_BINDING_INVALID');
        if (explicitAily && (attempt.actionType !== 'OPENCLAW_DYNAMIC_EVALUATION' ||
            requestTask.modelInput.schemaVersion !== INITIAL_ANALYSIS_REQUEST_SCHEMA ||
            requestTask.executionModel?.modelRef !== requestTask.modelInput.modelRef ||
            canonicalJson(requestTask.executionModel) !== canonicalJson(readStoredExecutionModel(attempt.executionModelJson))))
          throw new Error('ACTION_ATTEMPT_AILY_MODEL_BINDING_INVALID');
        if (explicitAily) {
          if (!aily || aily.model.modelRef !== requestTask.executionModel?.modelRef)
            throw new Error('INITIAL_CONTINUATION_AILY_SCOPE_CHANGED');
          await this.guardAilyPredecessors(transaction as PostgresJsDatabase, attempt, owner, aily);
        } else if (aily) throw new Error('INITIAL_CONTINUATION_AILY_SCOPE_CHANGED');
        if (hasInitialModel && !explicitProgram && !explicitAily) {
          const current = readStoredExecutionModel(owner.analysisModelJson);
          const captured = readStoredExecutionModel(attempt.executionModelJson);
          if (
            !current ||
            !captured ||
            canonicalJson(current) !== canonicalJson(captured)
          )
            throw new Error('ACTION_ATTEMPT_MODEL_BINDING_CHANGED');
        }
        const [active] = await transaction
          .select({ id: actionAttempt.attemptId })
          .from(actionAttempt)
          .where(
            and(
              eq(actionAttempt.workItemId, String(attempt.workItemId)),
              eq(actionAttempt.tenantId, String(attempt.tenantId)),
              inArray(
                actionAttempt.actionType,
                attempt.actionType === 'OPENCLAW_APPLICABILITY_EVALUATION'
                  ? ['OPENCLAW_APPLICABILITY_EVALUATION']
                  : [
                      'OPENCLAW_TRANSLATE',
                      'OPENCLAW_APPLICABILITY_EVALUATION',
                      'OPENCLAW_DYNAMIC_EVALUATION',
                      'OPENCLAW_OVERALL_SYNTHESIS',
                    ],
              ),
              inArray(actionAttempt.status, [
                'QUEUED',
                'RUNNING',
                'RETRY_SCHEDULED',
                'COMMITTING',
              ]),
            ),
          )
          .limit(1);
        if (active) throw activeAttemptConflict();
        const task = JSON.parse(
          String(attempt.taskEnvelopeJson),
        ) as OpenClawTaskEnvelope;
        const usesKnowledge =
          task.allowedConnectors.includes('feishu-aily-user');
        const initialAssessment = [
          'OPENCLAW_DYNAMIC_EVALUATION',
          'OPENCLAW_OVERALL_SYNTHESIS',
        ].includes(String(attempt.actionType));
        if (
          ((usesKnowledge ||
            (initialAssessment && owner.initialAilySessionId !== null)) &&
            !knowledge) ||
          (knowledge && !initialAssessment) ||
          (knowledge &&
            knowledge.expectedSessionId !== owner.initialAilySessionId)
        )
          throw new Error('ACTION_ATTEMPT_KNOWLEDGE_BINDING_CHANGED');
        if (knowledge?.replacement) {
          const replacement = knowledge.replacement;
          if (
            !usesKnowledge ||
            replacement.actorId !== owner.requestedByUserId ||
            replacement.tenantId !== attempt.tenantId
          )
            throw new Error('ACTION_ATTEMPT_KNOWLEDGE_BINDING_CHANGED');
          await transaction
            .update(workItem)
            .set({
              initialAilySessionId: replacement.sessionId,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(workItem.workItemId, String(attempt.workItemId)),
                eq(workItem.tenantId, String(attempt.tenantId)),
              ),
            );
        }
        if (cancelled && (attempt.actionType !== 'OPENCLAW_DYNAMIC_EVALUATION' ||
            attempt.tenantId !== cancelled.binding.tenantId || attempt.workItemId !== cancelled.binding.workItem.workItemId ||
            attempt.baseRevision !== cancelled.binding.workItem.revision || attempt.inputRevision !== cancelled.binding.workItem.revision ||
            attempt.documentVersionId !== cancelled.binding.workItem.source.documentVersionId))
          throw new Error('INITIAL_CONTINUATION_CANCELLED_BINDING_CHANGED');
        const release = cancelled
          ? await assertCancelledInitialContinuation(transaction as PostgresJsDatabase, cancelled) : undefined;
        const reservation = await this.insertReservation(attempt, transaction);
        if (release && reservation.created) await release();
        return reservation;
      });
    }
    return this.insertReservation(attempt, this.db);
  }

  /** WI is already locked. Grant then attempts share the SAVE/reconcile order. */
  private async guardAilyPredecessors(database: PostgresJsDatabase, attempt: typeof actionAttempt.$inferInsert,
    owner: Pick<typeof workItem.$inferSelect, 'revision' | 'documentVersionId' | 'requestedByUserId' |
      'requestId' | 'documentId' | 'sourceArtifactId' | 'sourceFileSha256' | 'sourceByteLength' | 'actionType' | 'status' | 'packageId' | 'projectionJson'>,
    aily: NonNullable<ReserveActionAttemptInput['ailyExecution']>): Promise<void> {
    const tenantId = String(attempt.tenantId);
    const workItemId = String(attempt.workItemId);
    const actorUserId = String(attempt.actorUserId);
    const requestTask = parseTaskEnvelope(String(attempt.taskEnvelopeJson));
    const [grant] = await database.select().from(autoWorkItemAuthorization).where(and(
      eq(autoWorkItemAuthorization.tenantId, tenantId), eq(autoWorkItemAuthorization.workItemId, workItemId),
    )).limit(1).for('update');
    if (!grant || grant.tenantId !== tenantId || grant.workItemId !== workItemId ||
        owner.requestedByUserId !== actorUserId || owner.requestId !== aily.intakeRequestId ||
        !/^service:[A-Za-z0-9:_-]{1,140}$/u.test(aily.principalId) ||
        grant.actorUserId !== actorUserId || grant.requestId !== owner.requestId ||
        grant.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST' || !['WAITING', 'LEASED'].includes(grant.status) ||
        grant.documentId !== owner.documentId || grant.documentVersionId !== owner.documentVersionId ||
        grant.sourceArtifactId !== owner.sourceArtifactId || grant.sourceFileSha256 !== owner.sourceFileSha256 ||
        Number(grant.sourceByteLength) !== Number(owner.sourceByteLength) ||
        owner.actionType !== 'PARSE_PDF' || owner.status !== 'CANDIDATE_READBACK_VERIFIED' || !owner.packageId ||
        !requestTask.sourceRefs.some(source => source.ref === owner.sourceArtifactId && source.sha256 === owner.sourceFileSha256))
      throw new Error('INITIAL_CONTINUATION_AILY_SCOPE_CHANGED');
    const prior = await database.select().from(actionAttempt).where(and(
      eq(actionAttempt.tenantId, tenantId), eq(actionAttempt.workItemId, workItemId),
      eq(actionAttempt.documentVersionId, owner.documentVersionId!),
      eq(actionAttempt.requestOrigin, 'OPENCLAW_MCP_V1'), eq(actionAttempt.actionType, 'OPENCLAW_DYNAMIC_EVALUATION'),
      sql`${actionAttempt.taskEnvelopeJson}::jsonb #>> '{modelInput,executionMode}'='AILY_AGENT_V1'`,
    )).orderBy(actionAttempt.attemptNo).for('update');
    const scope = {tenantId, workItemId, actorUserId};
    const controls = new InitialExpiredAttemptRepository(database);
    const authorize = async (_database: PostgresJsDatabase, sources: readonly (typeof workItem.$inferSelect)[]): Promise<void> => {
      if (!sources.length || sources.some(source => source.tenantId !== tenantId || source.requestedByUserId !== actorUserId) ||
          !sources.some(source => source.workItemId === workItemId && source.requestId === aily.intakeRequestId &&
            source.revision === owner.revision && source.documentVersionId === owner.documentVersionId &&
            source.sourceArtifactId === owner.sourceArtifactId && source.sourceFileSha256 === owner.sourceFileSha256 &&
            Number(source.sourceByteLength) === Number(owner.sourceByteLength)))
        throw new Error('INITIAL_CONTINUATION_AILY_SCOPE_CHANGED');
    };
    for (const row of prior) {
      if (row.status === 'COMMITTING') throw activeAttemptConflict();
      const run = await new ActionAttemptRepository(database).readAilyExecutorRun({tenantId, workItemId, attemptId: row.attemptId});
      if (!run || run.scope.intakeRequestId !== owner.requestId ||
          (!['STARTED', 'UNKNOWN'].includes(run.post.state) && !run.pending)) continue;
      const task = parseTaskEnvelope(row.taskEnvelopeJson);
      const prefix = `openclaw-v2:dynamic:${workItemId}:${row.documentVersionId}:`;
      if (run.scope.tenantId !== tenantId || run.scope.workItemId !== workItemId ||
          (row.leaseOwner !== null && run.scope.principalId !== row.leaseOwner) ||
          run.leaseGeneration !== row.leaseGeneration || task.inputHash !== row.taskInputHash || row.actorUserId !== actorUserId ||
          run.modelEvidence.selectedModelRef !== task.executionModel?.modelRef ||
          !row.idempotencyKey?.startsWith(prefix) || run.requestId !== row.idempotencyKey.slice(prefix.length))
        throw initialAttemptConflict('BINDING_CHANGED');
      const target = {attemptId: row.attemptId, attemptRef: row.operationRef!};
      // The control helper merges known SAVE, unknown activity and projection
      // references into one protection code. Prove the latter two separately.
      let records: unknown;
      try { records = JSON.parse(row.reviewActivityJson ?? '[]'); }
      catch { throw initialAttemptConflict('ACTIVITY_UNKNOWN'); }
      if (!Array.isArray(records)) throw initialAttemptConflict('ACTIVITY_UNKNOWN');
      for (let offset = 0; offset < records.length; offset += JOBAID_ACTIVITY_WINDOW) {
        const portion: unknown[] = records.slice(offset, offset + JOBAID_ACTIVITY_WINDOW);
        const activity = projectJobAidActivity({attemptId: row.attemptId, attemptRef: row.operationRef,
          status: row.status, activityJson: JSON.stringify(portion)}, []);
        if (activity.error || activity.unknownRecordCount || activity.malformedRecordCount ||
            portion.some(value => !value || typeof value !== 'object' || Array.isArray(value) || !('observedAt' in value) ||
              typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt)) ||
              ('kind' in value && value.kind === 'ASSESSMENT_SOURCES_READ' && !isReviewAssessmentReadActivity(value))))
          throw initialAttemptConflict('ACTIVITY_UNKNOWN');
      }
      let projection: CanonicalWorkItemProjection;
      try {
        const parsed: unknown = JSON.parse(owner.projectionJson ?? 'null');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        projection = parsed as CanonicalWorkItemProjection;
      } catch { throw initialAttemptConflict('PROJECTION_UNKNOWN'); }
      const integrated = projection.integratedAssessment;
      const projectionReferencesAttempt = integrated?.baseRules?.actionAttemptId === row.attemptId ||
          integrated?.overallSynthesis?.actionAttemptId === row.attemptId ||
          integrated?.overallSynthesis?.sourceAssessment?.actionAttemptId === row.attemptId;
      let facts = await controls.read(scope, target, authorize);
      if (facts.reconciliation === 'ELIGIBLE') {
        const reconciled = await controls.reconcile(scope, {...target, operation: 'RECONCILE_EXPIRED', expectedRevision: owner.revision,
          stageRequestId: facts.stageRequestId, expectedLeaseGeneration: facts.leaseGeneration}, authorize);
        facts = reconciled.attempt;
      }
      const [closed] = await database.select().from(actionAttempt).where(and(
        eq(actionAttempt.attemptId, row.attemptId), eq(actionAttempt.tenantId, tenantId), eq(actionAttempt.workItemId, workItemId),
      )).limit(1);
      if (run.pending) {
        const known = facts.savedWorks.find(item => item.saveRequestId === run.pending!.saveRequestId);
        if (known) {
          const [saved] = await database.select().from(assessmentWorkRevision).where(and(
            eq(assessmentWorkRevision.tenantId,tenantId),eq(assessmentWorkRevision.workItemId,workItemId),
            eq(assessmentWorkRevision.assessmentWorkRevisionId,known.workRevisionRef),
          )).limit(1);
          if (!saved || saved.actionAttemptId !== row.attemptId || saved.requestId !== run.pending.saveRequestId ||
              saved.basedOnWorkItemRevision !== row.baseRevision || saved.workRevision !== run.pending.expectedWorkRevision+1 ||
              saved.previousWorkRevisionId !== run.pending.previousWorkRevisionRef ||
              saved.commandJson !== canonicalJson({expectedWorkRevision:run.pending.expectedWorkRevision,work:JSON.parse(run.pending.workJson) as unknown}))
            throw initialAttemptConflict('SAVE_COVERAGE_UNKNOWN');
        } else if (run.pending.phase === 'SAVED' || run.pending.phase === 'READ') throw initialAttemptConflict('SAVE_COVERAGE_UNKNOWN');
      }
      if (closed?.status === 'SUCCEEDED' && closed.projectionApplied && closed.completedAt && closed.commitStartedAt &&
          closed.leaseOwner === null && closed.leaseToken === null && closed.leaseExpiresAt === null && closed.leaseSlot === null &&
          closed.resultEnvelopeJson && closed.resultContentHash && owner.revision > task.baseRevision) {
        const result = parseStoredResultEnvelope({value:closed.resultEnvelopeJson,task});
        const output: unknown = JSON.parse(result.modelOutput ?? 'null');
        const ref = output && typeof output === 'object' && !Array.isArray(output) && 'workRevisionRef' in output
          ? output.workRevisionRef : null;
        const stage = ailyStageOveralls(closed.reviewActivityJson).find(item => item.workRevisionRef === ref);
        const saved = facts.savedWorks.find(item => item.workRevisionRef === ref);
        const read = stage && (records as Record<string,unknown>[]).some(item => item.kind === 'ASSESSMENT_WORK_READ' &&
          item.workRevisionRef === ref && item.workRevision === stage.workRevision &&
          item.saveRequestId === stage.sourceAssessment.saveRequestId && item.observedAt === stage.sourceAssessment.readObservedAt);
        if (result.status === 'SUCCEEDED' && result.contentHash === closed.resultContentHash && 'producer' in result &&
            result.producer?.kind === 'AILY_AGENT_V1' && result.producer.agentId === run.agentId &&
            result.producer.publicationRef === run.publicationRef && result.producer.selectedModelRef === run.modelEvidence.selectedModelRef &&
            stage && saved && read && saved.workRevision === stage.workRevision && saved.saveRequestId === stage.sourceAssessment.saveRequestId &&
            stage.sourceAssessment.actionAttemptId === closed.attemptId && result.outputArtifactRefs.some(artifact =>
              artifact.ref === stage.artifact.ref && artifact.sha256 === stage.artifact.sha256) &&
            run.pending?.phase === 'READ' && run.pending.workRevisionRef === ref &&
            (!projectionReferencesAttempt || (integrated?.baseRules?.actionAttemptId === closed.attemptId &&
              integrated.overallSynthesis?.sourceAssessment?.actionAttemptId === closed.attemptId &&
              integrated.overallSynthesis.basedOnJobAidWorkRevisionRef === ref))) continue;
        throw initialAttemptConflict('UNRECONCILED_AILY_DISPATCH');
      }
      if (projectionReferencesAttempt) throw initialAttemptConflict('UNRECONCILED_AILY_PROJECTION');
      // A WAITING_INPUT result is not produced by this enterprise final path.
      if (!closed || !['TIMED_OUT', 'CANCELLED', 'FAILED', 'CONFLICT', 'OBSOLETE'].includes(closed.status) ||
          !closed.completedAt || closed.leaseOwner !== null || closed.leaseToken !== null || closed.leaseExpiresAt !== null ||
          closed.leaseSlot !== null || closed.commitStartedAt !== null || closed.resultEnvelopeJson !== null || closed.resultContentHash !== null ||
          facts.hasPersistedResult || facts.projectionApplied || facts.protectionCode === 'ACTIVITY_UNKNOWN')
        throw initialAttemptConflict('UNRECONCILED_AILY_DISPATCH');
      // Preserve remote UNKNOWN and every known saved revision. Exact coverage
      // plus a closed Host fence permits the normal successor to read that work.
    }
  }

  private async insertReservation(
    attempt: typeof actionAttempt.$inferInsert,
    database: Pick<PostgresJsDatabase, 'select' | 'insert'>,
  ): Promise<ActionAttemptReservation> {
    const inserted = await database
      .insert(actionAttempt)
      .values(attempt)
      .onConflictDoNothing()
      .returning({ attemptId: actionAttempt.attemptId });
    const [storedByIdempotency] = await database
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.tenantId, String(attempt.tenantId)),
          eq(actionAttempt.idempotencyKey, String(attempt.idempotencyKey)),
          inArray(actionAttempt.status, [...ACTIVE_STATUSES]),
        ),
      )
      .orderBy(actionAttempt.createdAt)
      .limit(1);
    if (storedByIdempotency) {
      return {
        row: storedByIdempotency as ActionAttemptRow,
        created: inserted.length === 1,
      };
    }
    const [active] = await database
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.workItemId, String(attempt.workItemId)),
          eq(actionAttempt.actionType, String(attempt.actionType)),
          inArray(actionAttempt.status, [...ACTIVE_STATUSES]),
        ),
      )
      .limit(1);
    if (active) throw activeAttemptConflict();
    throw new Error('ACTION_ATTEMPT_RESERVATION_READBACK_FAILED');
  }

  async appendReviewActivity(
    row: ActionAttemptRow,
    activity: ReviewEvidenceActivity,
  ): Promise<void> {
    // Atomic append on the existing attempt; never rewrite its task/result or
    // create another execution record. The caller has freshly authorized it.
    const saved = await this.db
      .update(actionAttempt)
      .set({
        reviewActivityJson: sql`(COALESCE(${actionAttempt.reviewActivityJson}::jsonb, '[]'::jsonb) || ${JSON.stringify([activity])}::jsonb)::text`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actionAttempt.attemptId, row.attemptId),
          eq(actionAttempt.tenantId, row.tenantId),
          eq(actionAttempt.workItemId, row.workItemId),
          eq(actionAttempt.actorUserId, row.actorUserId),
          eq(actionAttempt.actionType, 'OPENCLAW_INTERACTIVE_REVIEW'),
          eq(actionAttempt.requestOrigin, row.requestOrigin),
          eq(actionAttempt.leaseGeneration, row.leaseGeneration),
          // The new bounded Review seals every decision activity at COMMITTING,
          // including ordinary refs resolved in parallel with a native READ.
          sql`((${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,jobAidContext,tdmsReviewContext,mode}')
            IS DISTINCT FROM 'BOUNDED_NATIVE_READ' OR (
              ${actionAttempt.status}='RUNNING' AND ${actionAttempt.leaseOwner}=${row.leaseOwner}
              AND ${actionAttempt.leaseToken}=${row.leaseToken} AND ${actionAttempt.leaseExpiresAt}>clock_timestamp()
              AND ${actionAttempt.deadlineAt}>clock_timestamp() AND ${actionAttempt.cancelRequestedAt} IS NULL))`,
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    if (saved.length !== 1) throw new Error('REVIEW_ACTIVITY_BINDING_CHANGED');
  }

  async prepareReviewInput(
    attemptId: string,
    task: OpenClawTaskEnvelope,
  ): Promise<void> {
    await this.db
      .update(actionAttempt)
      .set({
        taskEnvelopeJson: canonicalJson(task),
        taskInputHash: task.inputHash,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actionAttempt.attemptId, attemptId),
          eq(actionAttempt.actionType, 'OPENCLAW_INTERACTIVE_REVIEW'),
          eq(actionAttempt.status, 'QUEUED'),
          eq(actionAttempt.claimCount, 0),
          isNull(actionAttempt.taskEnvelopeJson),
        ),
      );
  }

  async prepareInitialRequestInput(
    row: ActionAttemptRow,
    task: OpenClawTaskEnvelope,
  ): Promise<ActionAttemptRow | null> {
    const [prepared] = await this.db
      .update(actionAttempt)
      .set({
        taskEnvelopeJson: canonicalJson(task),
        taskInputHash: task.inputHash,
        updatedAt: new Date(),
      })
      .where(
        and(
          unclaimedInitialRequest(row),
          gt(actionAttempt.deadlineAt, new Date()),
        ),
      )
      .returning();
    return (prepared as ActionAttemptRow | undefined) ?? null;
  }

  async failInitialRequestPreparation(
    row: ActionAttemptRow,
    errorCode: string,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(actionAttempt)
      .set({
        status: 'FAILED',
        errorCode,
        errorMessage: '本次分析请求的上下文准备失败，原请求和已保存成果保留。',
        terminalReason: 'ACTION_ATTEMPT_INITIAL_PREPARATION_FAILED',
        completedAt: now,
        updatedAt: now,
      })
      .where(unclaimedInitialRequest(row));
  }

  async readActiveReviewForWorkItem(input: {
    tenantId: string;
    workItemId: string;
  }): Promise<Pick<ActionAttemptRow,'status'|'idempotencyKey'|'deadlineAt'|'leaseExpiresAt'> | null> {
    const [row] = await this.db
      .select({status:actionAttempt.status,idempotencyKey:actionAttempt.idempotencyKey,
        deadlineAt:actionAttempt.deadlineAt,leaseExpiresAt:actionAttempt.leaseExpiresAt})
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.tenantId, input.tenantId),
          eq(actionAttempt.workItemId, input.workItemId),
          eq(actionAttempt.actionType, 'OPENCLAW_INTERACTIVE_REVIEW'),
          inArray(actionAttempt.status, [...ACTIVE_STATUSES]),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async failReviewPreparation(
    attemptId: string,
    errorCode: string,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(actionAttempt)
      .set({
        status: 'FAILED',
        errorCode,
        errorMessage:
          '本轮上下文准备失败，问题和材料已保留。请查看错误原因后继续提问。',
        terminalReason: 'REVIEW_CONTEXT_PREPARATION_FAILED',
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(actionAttempt.attemptId, attemptId),
          eq(actionAttempt.actionType, 'OPENCLAW_INTERACTIVE_REVIEW'),
          eq(actionAttempt.status, 'QUEUED'),
          eq(actionAttempt.claimCount, 0),
          isNull(actionAttempt.taskEnvelopeJson),
        ),
      );
  }

  async claimExact(input: {
    attemptId: string;
    expectedStatus: 'QUEUED' | 'RETRY_SCHEDULED';
    expectedClaimCount: number;
    expectedLeaseGeneration: number;
    operationRef: string;
    startedAt: Date | null;
    leaseOwner: string;
    leaseSlot: number;
    now: Date;
    leaseMs: number;
    ailyExecution?: true;
    /** Actor-bound callers use a savepoint to recover a slot collision. */
    propagateSlotConflict?: boolean;
  }): Promise<ActionAttemptRow | null> {
    try {
      const [claimed] = await this.db
        .update(actionAttempt)
        .set({
          status: 'RUNNING',
          claimCount: input.expectedClaimCount + 1,
          leaseOwner: input.leaseOwner,
          leaseToken: randomUUID(),
          leaseGeneration: input.expectedLeaseGeneration + 1,
          leaseSlot: input.leaseSlot,
          executorSessionKey: `g2-action-attempt:${input.operationRef}`,
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
          lastHeartbeatAt: input.now,
          nextAttemptAt: null,
          startedAt: input.startedAt ?? input.now,
          errorCode: null,
          errorMessage: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(actionAttempt.attemptId, input.attemptId),
            eq(actionAttempt.status, input.expectedStatus),
            eq(actionAttempt.claimCount, input.expectedClaimCount),
            eq(actionAttempt.leaseGeneration, input.expectedLeaseGeneration),
            eq(actionAttempt.operationRef, input.operationRef),
            isNull(actionAttempt.leaseToken),
            or(
              isNull(actionAttempt.nextAttemptAt),
              lte(actionAttempt.nextAttemptAt, input.now),
            ),
            or(
              isNull(actionAttempt.deadlineAt),
              gt(actionAttempt.deadlineAt, input.now),
            ),
            isNull(actionAttempt.cancelRequestedAt),
            input.ailyExecution
              ? sql`${actionAttempt.taskEnvelopeJson}::jsonb #>> '{modelInput,executionMode}'='AILY_AGENT_V1'`
              : sql`COALESCE(${actionAttempt.taskEnvelopeJson}::jsonb #>> '{modelInput,executionMode}','')<>'AILY_AGENT_V1'`,
          ),
        )
        .returning();
      return (claimed as ActionAttemptRow | undefined) ?? null;
    } catch (cause) {
      if (isLeaseSlotConflict(cause) && !input.propagateSlotConflict)
        return null;
      throw cause;
    }
  }

  async claimExpiredUnstartedExact(input: {
    attemptId: string;
    attemptNo: number;
    triggerRequestId: string;
    tenantId: string;
    baseRevision: number;
    documentVersionId: string;
    idempotencyKey: string;
    expectedTaskInputHash: string;
    expectedClaimCount: number;
    expectedRetryCount: number;
    expectedLeaseGeneration: number;
    operationRef: string;
    leaseOwner: string;
    leaseSlot: number;
    now: Date;
    leaseMs: number;
    refreshedDeadlineAt: Date;
    taskEnvelopeJson: string;
    taskInputHash: string;
  }): Promise<ActionAttemptRow | null> {
    try {
      const [claimed] = await this.db
        .update(actionAttempt)
        .set({
          status: 'RUNNING',
          claimCount: input.expectedClaimCount + 1,
          leaseOwner: input.leaseOwner,
          leaseToken: randomUUID(),
          leaseGeneration: input.expectedLeaseGeneration + 1,
          leaseSlot: input.leaseSlot,
          executorSessionKey: `g2-action-attempt:${input.operationRef}`,
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
          lastHeartbeatAt: input.now,
          nextAttemptAt: null,
          startedAt: input.now,
          deadlineAt: input.refreshedDeadlineAt,
          taskEnvelopeJson: input.taskEnvelopeJson,
          taskInputHash: input.taskInputHash,
          errorCode: null,
          errorMessage: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(actionAttempt.attemptId, input.attemptId),
            eq(actionAttempt.attemptNo, input.attemptNo),
            eq(actionAttempt.triggerRequestId, input.triggerRequestId),
            eq(actionAttempt.tenantId, input.tenantId),
            eq(actionAttempt.baseRevision, input.baseRevision),
            eq(actionAttempt.inputRevision, input.baseRevision),
            eq(actionAttempt.documentVersionId, input.documentVersionId),
            eq(actionAttempt.status, 'QUEUED'),
            eq(actionAttempt.actionType, 'OPENCLAW_OVERALL_SYNTHESIS'),
            eq(actionAttempt.claimCount, input.expectedClaimCount),
            eq(actionAttempt.retryCount, input.expectedRetryCount),
            eq(actionAttempt.leaseGeneration, input.expectedLeaseGeneration),
            eq(actionAttempt.operationRef, input.operationRef),
            eq(actionAttempt.idempotencyKey, input.idempotencyKey),
            eq(actionAttempt.taskInputHash, input.expectedTaskInputHash),
            isNull(actionAttempt.startedAt),
            isNull(actionAttempt.leaseOwner),
            isNull(actionAttempt.leaseToken),
            isNull(actionAttempt.leaseExpiresAt),
            isNull(actionAttempt.lastHeartbeatAt),
            isNull(actionAttempt.leaseSlot),
            isNull(actionAttempt.executorSessionKey),
            isNull(actionAttempt.commitStartedAt),
            isNull(actionAttempt.resultEnvelopeJson),
            isNull(actionAttempt.resultContentHash),
            isNull(actionAttempt.completedAt),
            isNull(actionAttempt.terminalReason),
            isNull(actionAttempt.errorCode),
            isNull(actionAttempt.errorMessage),
            eq(actionAttempt.projectionApplied, false),
            lte(actionAttempt.deadlineAt, input.now),
            or(
              isNull(actionAttempt.nextAttemptAt),
              lte(actionAttempt.nextAttemptAt, input.now),
            ),
            isNull(actionAttempt.cancelRequestedAt),
            isNull(actionAttempt.cancelReason),
            sql`EXISTS (
              SELECT 1
              FROM ${workItem}
              WHERE ${workItem.workItemId} = ${actionAttempt.workItemId}
                AND ${workItem.tenantId} = ${input.tenantId}
                AND ${workItem.revision} = ${input.baseRevision}
                AND ${workItem.documentVersionId} = ${input.documentVersionId}
            )`,
          ),
        )
        .returning();
      return (claimed as ActionAttemptRow | undefined) ?? null;
    } catch (cause) {
      if (isLeaseSlotConflict(cause)) return null;
      throw cause;
    }
  }

  async heartbeat(input: {
    attemptId: string;
    automaticLeaseRequired?: boolean;
    leaseToken: string;
    leaseGeneration: number;
    now: Date;
    leaseMs: number;
    reviewActivity?: ReviewRuntimeActivity;
    writePredicate?: SQL;
  }): Promise<boolean> {
    return this.withAutomaticAttemptLease(input.attemptId, input.automaticLeaseRequired, async (database) => {
    const updated = await database
      .update(actionAttempt)
      .set({
        lastHeartbeatAt: input.now,
        leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
        updatedAt: input.now,
        ...(input.reviewActivity
          ? {
              reviewActivityJson: sql`(COALESCE(${actionAttempt.reviewActivityJson}::jsonb, '[]'::jsonb) || ${JSON.stringify([input.reviewActivity])}::jsonb)::text`,
            }
          : {}),
      })
      .where(
        and(
          eq(actionAttempt.attemptId, input.attemptId),
          eq(actionAttempt.status, 'RUNNING'),
          eq(actionAttempt.leaseToken, input.leaseToken),
          eq(actionAttempt.leaseGeneration, input.leaseGeneration),
          ...(input.writePredicate ? [input.writePredicate] : []),
          gt(actionAttempt.leaseExpiresAt, input.now),
          or(
            isNull(actionAttempt.deadlineAt),
            gt(actionAttempt.deadlineAt, input.now),
          ),
          isNull(actionAttempt.cancelRequestedAt),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    return updated.length === 1;
    });
  }

  async markCommitting(input: {
    attemptId: string;
    automaticLeaseRequired?: boolean;
    leaseToken: string;
    leaseGeneration: number;
    result: AnyOpenClawResultEnvelope;
    now: Date;
    recoveryLeaseMs: number;
    expectedReviewActivityJson?: string | null;
    writePredicate?: SQL;
    ailyFinal?: AilyFinalCommitGuard;
  }): Promise<ActionAttemptRow | null> {
    if ('executionKind' in input.result&&input.result.executionKind==='AILY_AGENT'&&!input.ailyFinal)throw new Error('AILY_FINAL_PENDING_REQUIRED');
    if(input.ailyFinal) {
      const selected:unknown=JSON.parse(input.result.modelOutput??'null');
      if(input.ailyFinal.pending.phase!=='READ'||!selected||typeof selected!=='object'||!('workRevisionRef'in selected)||
          selected.workRevisionRef!==input.ailyFinal.pending.workRevisionRef)
        throw new Error('AILY_FINAL_PENDING_BINDING_CHANGED');
    }
    return this.withAutomaticAttemptLease(input.attemptId, input.automaticLeaseRequired, async (database) => {
    const pending=input.ailyFinal?.pending;
    const finalPredicate=pending?sql`
      ${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,executionMode}'='AILY_AGENT_V1'
      AND ${actionAttempt.actorUserId}=${input.ailyFinal!.actorUserId}
      AND executor_run_json->'pending'=${canonicalJson(pending)}::jsonb
      AND COALESCE(${actionAttempt.reviewActivityJson}::jsonb,'[]'::jsonb) @> ${canonicalJson([{kind:'ASSESSMENT_WORK_READ',
        workRevisionRef:pending.workRevisionRef,workRevision:pending.workRevision,saveRequestId:pending.saveRequestId,observedAt:pending.readObservedAt}])}::jsonb
      AND EXISTS (SELECT 1 FROM ${workItem} AS final_owner WHERE final_owner.tenant_id=${actionAttempt.tenantId}
        AND final_owner.work_item_id=${actionAttempt.workItemId} AND final_owner.revision=${actionAttempt.baseRevision}
        AND final_owner.document_version_id=${actionAttempt.documentVersionId} AND final_owner.requested_by_user_id=${input.ailyFinal!.actorUserId})
      AND EXISTS (SELECT 1 FROM ${assessmentWorkRevision} AS final_work WHERE final_work.tenant_id=${actionAttempt.tenantId}
        AND final_work.work_item_id=${actionAttempt.workItemId} AND final_work.action_attempt_id=${actionAttempt.attemptId}
        AND final_work.assessment_work_revision_id=${pending.workRevisionRef} AND final_work.work_revision=${pending.workRevision}
        AND final_work.request_id=${pending.saveRequestId} AND final_work.based_on_work_item_revision=${actionAttempt.baseRevision}
        AND final_work.document_version_id=${actionAttempt.documentVersionId} AND final_work.created_by_user_id=${input.ailyFinal!.actorUserId}
        AND final_work.previous_work_revision_id IS NOT DISTINCT FROM ${pending.previousWorkRevisionRef}::varchar
        AND final_work.command_json=${canonicalJson({expectedWorkRevision:pending.expectedWorkRevision,work:JSON.parse(pending.workJson) as unknown})}
        AND NOT EXISTS (SELECT 1 FROM ${assessmentWorkRevision} AS later_work WHERE later_work.tenant_id=final_work.tenant_id
          AND later_work.work_item_id=final_work.work_item_id AND later_work.work_revision>final_work.work_revision))`:undefined;
    const [updated] = await database
      .update(actionAttempt)
      .set({
        status: 'COMMITTING',
        resultEnvelopeJson: canonicalJson(input.result),
        resultContentHash: input.result.contentHash,
        commitStartedAt: input.now,
        // This persisted, Host-validated bounded Review already owns a live
        // lease. Preserve its remaining authority; never renew it at cutoff.
        leaseExpiresAt: sql`CASE WHEN ${actionAttempt.actionType}='OPENCLAW_INTERACTIVE_REVIEW' AND
          ${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,jobAidContext,tdmsReviewContext,mode}'='BOUNDED_NATIVE_READ'
          THEN LEAST(${actionAttempt.leaseExpiresAt},${actionAttempt.deadlineAt})
          ELSE ${new Date(input.now.getTime()+input.recoveryLeaseMs).toISOString()}::timestamptz END`,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(actionAttempt.attemptId, input.attemptId),
          eq(actionAttempt.status, 'RUNNING'),
          ...(input.expectedReviewActivityJson===undefined?[]:[sql`COALESCE(${actionAttempt.reviewActivityJson}::jsonb,'[]'::jsonb)
            = COALESCE(${input.expectedReviewActivityJson}::jsonb,'[]'::jsonb)`]),
          ...(input.writePredicate ? [input.writePredicate] : []),
          ...(finalPredicate ? [finalPredicate] : []),
          eq(actionAttempt.leaseToken, input.leaseToken),
          eq(actionAttempt.leaseGeneration, input.leaseGeneration),
          gt(actionAttempt.leaseExpiresAt, input.now),
          or(
            isNull(actionAttempt.deadlineAt),
            gt(actionAttempt.deadlineAt, input.now),
          ),
          isNull(actionAttempt.cancelRequestedAt),
        ),
      )
      .returning();
    return (updated as ActionAttemptRow | undefined) ?? null;
    });
  }

  async finishTerminal(input: {
    attemptId: string;
    fromStatus: string;
    status:
      | 'SUCCEEDED'
      | 'WAITING_INPUT'
      | 'FAILED'
      | 'TIMED_OUT'
      | 'CANCELLED'
      | 'CONFLICT'
      | 'OBSOLETE';
    terminalReason: string;
    now: Date;
    leaseToken?: string;
    leaseGeneration?: number;
    result?: AnyOpenClawResultEnvelope;
    projectionApplied?: boolean;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<boolean> {
    return this.withAutomaticAttemptLease(input.attemptId, false, async (database) => {
    const predicates = [
      eq(actionAttempt.attemptId, input.attemptId),
      eq(actionAttempt.status, input.fromStatus),
    ];
    if (input.leaseToken !== undefined) {
      predicates.push(eq(actionAttempt.leaseToken, input.leaseToken));
    }
    if (input.leaseGeneration !== undefined) {
      predicates.push(eq(actionAttempt.leaseGeneration, input.leaseGeneration));
    }
    const updated = await database
      .update(actionAttempt)
      .set({
        status: input.status,
        terminalReason: input.terminalReason.slice(0, 160),
        resultEnvelopeJson: input.result
          ? canonicalJson(input.result)
          : undefined,
        resultContentHash: input.result?.contentHash,
        projectionApplied: input.projectionApplied ?? false,
        errorCode: input.errorCode?.slice(0, 160),
        errorMessage: input.errorMessage,
        completedAt: input.now,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        leaseSlot: null,
        updatedAt: input.now,
      })
      .where(and(...predicates))
      .returning({ attemptId: actionAttempt.attemptId });
    return updated.length === 1;
    });
  }

  async recoverExpiredRunning(input: {
    attemptId: string;
    now: Date;
  }): Promise<boolean> {
    const row = await this.readByAttemptId(input.attemptId);
    if (
      !row ||
      row.status !== 'RUNNING' ||
      !row.leaseToken ||
      !row.leaseExpiresAt ||
      row.leaseExpiresAt > input.now
    ) {
      return false;
    }
    if (row.cancelRequestedAt) {
      return this.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: 'RUNNING',
        status: 'CANCELLED',
        terminalReason: 'CANCELLED_BEFORE_COMMIT',
        leaseToken: row.leaseToken,
        leaseGeneration: row.leaseGeneration,
        now: input.now,
      });
    }
    if (row.deadlineAt && row.deadlineAt <= input.now) {
      return this.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: 'RUNNING',
        status: 'TIMED_OUT',
        terminalReason: 'DEADLINE_EXCEEDED_DURING_LEASE',
        leaseToken: row.leaseToken,
        leaseGeneration: row.leaseGeneration,
        now: input.now,
      });
    }
    if (row.claimCount >= row.maxAttempts) {
      return this.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: 'RUNNING',
        status: 'FAILED',
        terminalReason: 'LEASE_EXPIRED_MAX_ATTEMPTS',
        leaseToken: row.leaseToken,
        leaseGeneration: row.leaseGeneration,
        now: input.now,
      });
    }
    const updated = await this.db
      .update(actionAttempt)
      .set({
        status: 'RETRY_SCHEDULED',
        retryCount: row.retryCount + 1,
        nextAttemptAt: input.now,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        leaseSlot: null,
        errorCode: 'LEASE_EXPIRED_RECOVERED',
        errorMessage:
          'Executor lease expired before the durable commit boundary.',
        updatedAt: input.now,
      })
      .where(
        and(
          eq(actionAttempt.attemptId, row.attemptId),
          eq(actionAttempt.status, 'RUNNING'),
          eq(actionAttempt.leaseToken, row.leaseToken),
          eq(actionAttempt.leaseGeneration, row.leaseGeneration),
          eq(actionAttempt.retryCount, row.retryCount),
          lte(actionAttempt.leaseExpiresAt, input.now),
          lt(actionAttempt.claimCount, actionAttempt.maxAttempts),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    return updated.length === 1;
  }

  async releaseQueuedInitialContinuation(guard: CancelledInitialContinuationGuard): Promise<boolean> {
    if (!guard.binding.queuedRequest) throw cancelledContinuationConflict();
    return this.db.transaction(async transaction => {
      const [owner] = await transaction.select({workItemId:workItem.workItemId}).from(workItem).where(and(
        eq(workItem.tenantId,guard.binding.tenantId),eq(workItem.workItemId,guard.binding.workItem.workItemId),
      )).limit(1).for('update');
      if (!owner) throw cancelledContinuationConflict();
      const [grant] = await transaction.select({status:autoWorkItemAuthorization.status}).from(autoWorkItemAuthorization)
        .where(and(eq(autoWorkItemAuthorization.tenantId,guard.binding.tenantId),
          eq(autoWorkItemAuthorization.workItemId,owner.workItemId))).limit(1).for('update');
      // A read-after-release replay is handled before this transaction. A
      // changed or missing locked grant needs a fresh read, never a success.
      if (grant?.status !== 'BLOCKED') throw cancelledContinuationConflict();
      const release = await assertCancelledInitialContinuation(transaction as PostgresJsDatabase,guard);
      await release();
      return true;
    });
  }

  async requestCancel(input: {
    attemptId: string;
    automaticLeaseRequired?: boolean;
    reason: string;
    now: Date;
  }): Promise<'CANCELLED' | 'TOO_LATE' | 'NOT_ACTIVE'> {
    return this.withAutomaticAttemptLease(input.attemptId, input.automaticLeaseRequired, async (database) => {
    const updated = await database
      .update(actionAttempt)
      .set({
        status: 'CANCELLED',
        cancelRequestedAt: input.now,
        cancelReason: input.reason.slice(0, 4000),
        terminalReason: 'CANCELLED_BY_REQUEST',
        completedAt: input.now,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        leaseSlot: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(actionAttempt.attemptId, input.attemptId),
          inArray(actionAttempt.status, [...CANCELLABLE_STATUSES]),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    if (updated.length === 1) return 'CANCELLED';
    const row = await new ActionAttemptRepository(database).readControlByAttemptId(input.attemptId);
    if (row?.status === 'COMMITTING' || row?.commitStartedAt) return 'TOO_LATE';
    return 'NOT_ACTIVE';
    });
  }

  async finishResultGateFailure(input: {
    attemptId: string;
    leaseToken: string;
    leaseGeneration: number;
    result: OpenClawResultEnvelope;
    errorCode: string;
    errorMessage: string;
    now: Date;
  }): Promise<boolean> {
    return this.finishTerminal({
      attemptId: input.attemptId,
      fromStatus: 'COMMITTING',
      status: 'FAILED',
      terminalReason: 'HOST_RESULT_GATE_REJECTED',
      leaseToken: input.leaseToken,
      leaseGeneration: input.leaseGeneration,
      result: input.result,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      now: input.now,
    });
  }
  private async withAutomaticAttemptLease<T>(
    attemptId: string,
    required: boolean | undefined,
    apply: (database: PostgresJsDatabase) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (database) => {
      const [row]=await database.select({...attemptControlColumns(),
        automaticLease:sql<string|null>`(${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,automaticWorkItemLease}')::text`,
      }).from(actionAttempt).where(eq(actionAttempt.attemptId,attemptId)).limit(1);
      if(row) await assertAutomaticWorkItemAttemptLeaseBinding(database,row,row.leaseOwner??'',required??false,
        automaticWorkItemTaskLease(row.automaticLease===null?undefined:JSON.parse(row.automaticLease)));
      return apply(database);
    });
  }

}

function attemptControlColumns() {
  return {attemptId:actionAttempt.attemptId,operationRef:actionAttempt.operationRef,
    tenantId:actionAttempt.tenantId,workItemId:actionAttempt.workItemId,actionType:actionAttempt.actionType,
    requestOrigin:actionAttempt.requestOrigin,documentVersionId:actionAttempt.documentVersionId,
    leaseOwner:actionAttempt.leaseOwner,leaseToken:actionAttempt.leaseToken,leaseGeneration:actionAttempt.leaseGeneration,
    leaseExpiresAt:actionAttempt.leaseExpiresAt,deadlineAt:actionAttempt.deadlineAt,status:actionAttempt.status,
    cancelRequestedAt:actionAttempt.cancelRequestedAt,cancelReason:actionAttempt.cancelReason,
    commitStartedAt:actionAttempt.commitStartedAt,projectionApplied:actionAttempt.projectionApplied,
    terminalReason:actionAttempt.terminalReason};
}

function unclaimedInitialRequest(row: ActionAttemptRow) {
  return and(
    eq(actionAttempt.attemptId, row.attemptId),
    eq(actionAttempt.tenantId, row.tenantId),
    eq(actionAttempt.workItemId, row.workItemId),
    eq(actionAttempt.actionType, row.actionType),
    eq(actionAttempt.requestOrigin, row.requestOrigin),
    eq(actionAttempt.taskInputHash, String(row.taskInputHash)),
    sql`${actionAttempt.taskEnvelopeJson}::jsonb #>> '{modelInput,schemaVersion}' = ${INITIAL_ANALYSIS_REQUEST_SCHEMA}`,
    eq(actionAttempt.status, 'QUEUED'),
    eq(actionAttempt.claimCount, 0),
    eq(actionAttempt.retryCount, 0),
    eq(actionAttempt.leaseGeneration, 0),
    eq(actionAttempt.projectionApplied, false),
    isNull(actionAttempt.startedAt),
    isNull(actionAttempt.completedAt),
    isNull(actionAttempt.cancelRequestedAt),
    isNull(actionAttempt.leaseOwner),
    isNull(actionAttempt.leaseToken),
    isNull(actionAttempt.leaseExpiresAt),
    isNull(actionAttempt.leaseSlot),
    isNull(actionAttempt.commitStartedAt),
    isNull(actionAttempt.resultEnvelopeJson),
    isNull(actionAttempt.resultContentHash),
  );
}

export function isLeaseSlotConflict(cause: unknown): boolean {
  let current = cause;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object') return false;
    const value = current as Record<string, unknown>;
    if (
      value.code === '23505' &&
      (value.constraint === 'uk_action_attempt_lease_slot' ||
        value.constraint_name === 'uk_action_attempt_lease_slot')
    ) {
      return true;
    }
    current = value.cause;
  }
  return false;
}

function activeAttemptConflict(): Error & { code: string; statusCode: number } {
  return Object.assign(
    new Error('An active attempt already exists for this WorkItem and task.'),
    { code: 'ACTION_ATTEMPT_ACTIVE_CONFLICT', statusCode: 409 },
  );


}

/** A status/model-selection consumer never loads the new native journal bodies.
 * Old tasks retain their pre-existing optional-activity error projection. The
 * bounded journal is written through JSONB append, and unknown kinds stay visible
 * as unreadable metadata rather than disappearing. */
function reviewActivityMetadata() {
  return sql<string|null>`CASE WHEN ${actionAttempt.taskEnvelopeJson}::jsonb#>>
    '{modelInput,jobAidContext,tdmsReviewContext,mode}'='BOUNDED_NATIVE_READ' THEN
    (SELECT coalesce(jsonb_agg(CASE WHEN entry->>'kind' IN ('CONTEXT_PREPARED','SOURCE_REFS_RESOLVED') THEN
      jsonb_build_object('kind',entry->'kind','observedAt',entry->'observedAt',
        'sourceRefIds',entry->'sourceRefIds','sourceCatalogCount',entry->'sourceCatalogCount')
      WHEN entry->>'kind'='ASSESSMENT_SOURCES_READ' THEN
      jsonb_build_object('kind',entry->'kind','observedAt',entry->'observedAt',
        'sourceRefs',entry->'sourceRefs','purpose',entry->'purpose')
      WHEN entry->>'kind' IN ('MODEL_REQUEST','MODEL_RETRY') THEN
      jsonb_build_object('kind',entry->'kind','observedAt',entry->'observedAt',
        'requestNo',entry->'requestNo','retryNo',entry->'retryNo','delayMs',entry->'delayMs','errorCode',entry->'errorCode')
      ELSE jsonb_build_object('kind','UNKNOWN_ACTIVITY') END),'[]'::jsonb)::text
      FROM jsonb_array_elements(coalesce(${actionAttempt.reviewActivityJson}::jsonb,'[]'::jsonb)) AS entry)
    ELSE ${actionAttempt.reviewActivityJson} END`;
}
