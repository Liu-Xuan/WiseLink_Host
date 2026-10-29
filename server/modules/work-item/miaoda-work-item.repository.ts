import { taskAutomaticWorkItemLease } from '../action-attempt/automatic-work-item-attempt-lease';
import { readBrowserInitialContinuationClaim, matchesInitialContinuationOwner, matchesFailedAttempt } from '../action-attempt/cancelled-initial-continuation';
import { InitialExpiredAttemptRepository, type InitialAttemptAuthorize } from '../action-attempt/initial-expired-attempt.repository';
import { readInitialAnalysisRequestInput } from '../action-attempt/initial-analysis-request';
import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';
import { projectJobAidActivity, JOBAID_ACTIVITY_WINDOW } from '../canonical-host/jobaid-activity';
import { isReviewAssessmentReadActivity } from '../action-attempt/review-evidence-activity';
import { parseJobAidProblemTask } from '../canonical-host/jobaid-problem-task';
import { dmDocumentParseRun } from '../../database/document-parsing.schema';
import { ACTION_ATTEMPT_COMMIT_RECOVERY_MS } from '../action-attempt/action-attempt.types';
import { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type {
  CanonicalAutoProcessingCompletionReceipt,
  CanonicalParseAuthorizationProjection,
  CanonicalPdfVerticalRunRequest,
  CanonicalWorkItemProjection,
  CanonicalExecutionModelSelection,
  DocumentDeliverySelection,
} from '@shared/api.interface';
import {
  isRetryableParseFailureCode,
  isRetryableReaderPreviewFailure,
} from '@shared/parse-retry-policy';
import {
  sourceIdentityBatchQuery,
  sourceIdentityQuery,
} from './document-version-source-identity';
import { autoWorkItemAuthorization } from '../../database/auto-work-item-authorization.schema';
import { dmDocumentReadingRun } from '../../database/document-reading.schema';
import {
  actionAttempt,
  assessmentWorkRevision,
  canonicalModelSetting,
  translationBlockRevision,
  translationWorkspace,
  workItem,
} from '../../database/schema';
import { readStoredExecutionModel } from '../model-settings/canonical-execution-model';
import { canonicalModelError, taskModelSelection } from '../model-settings/canonical-model-catalog';
import { canonicalJson, parseTaskEnvelope, parseStoredResultEnvelope } from '../action-attempt/action-attempt-envelope';
import { documentDeliveryRequestId } from '../canonical-host/document-delivery-ref';
import { preserveWorkItemModelConfigurationAudit } from './model-configuration-audit';
import { MiaodaDocumentVersionSourceResolver } from './miaoda-document-version-source.resolver';
import type { CanonicalJobAidWorkRevisionGuard } from '../canonical-host/canonical-host.types';
import { canonicalHostBareSha256 } from '../canonical-host/canonical-host-sha256';
import {
  parkCancelledAutoProcessingLease,
  type CancelledAutoProcessingLeaseInput,
} from './cancelled-auto-processing-lease';

const ACTION_TYPE = 'PARSE_PDF';
const DELIVERY_INTENT_ACTION_TYPE = 'DOCUMENT_DELIVERY_INTENT';

export interface WorkItemReservationInput {
  /** Records the caller's intake choice without scheduling document work. */
  developmentIntake?: boolean;
  documentDelivery?: DocumentDeliverySelection;
  autoProcessingGrant?: 'MIAODA_CANONICAL_PARSE_REQUEST';
  analysisModel?: CanonicalExecutionModelSelection;
  /** Server-resolved session from this task's creation request; never client JSON. */
  initialAilySessionId?: string;
  modelChoiceExplicit?: boolean;
  tenantId: string;
  actorUserId: string;
  documentId: string;
  documentVersionId: string;
  sourceArtifactId: string;
  sourceFileSha256: string;
  sourceByteLength: number;
  normalizedFamily: string;
  requestOrigin: 'MIAODA' | 'AILY';
  runKey: string;
}

export interface WorkItemReservation {
  workItemId: string;
  requestId: string;
  attemptId: string;
  created: boolean;
}

/** Server-only explicit browser intent plus its original transaction authorization. */
export interface AilyInitialSuccessorAuthorizationInput {
  tenantId:string;actorUserId:string;workItem:CanonicalWorkItemProjection;stageRequestId:string;
  request:Pick<ActionAttemptRow,'attemptId'|'operationRef'|'idempotencyKey'|'taskInputHash'>;
  principalId:string;leaseToken:string;leaseMs:number;authorize:InitialAttemptAuthorize;
}

export interface ParseRetryReservation {
  attemptId: string;
  attemptNo: number;
}

export interface WorkItemAuthorizationBinding {
  workItemId: string;
  revision: number;
  tenantId: string;
  requestId: string;
  documentId: string;
  documentVersionId: string;
  requestedByUserId: string;
  runKey: string;
}

export interface OwnedWorkItemSummary extends WorkItemAuthorizationBinding {
  status: string;
  actionType: string;
  createdAt: Date;
  updatedAt: Date;
}

export type AssessmentActionType =
  | 'EVALUATE_JOB_AID'
  | 'RESYNTHESIZE_ASSESSMENT'
  | 'PERSIST_BASE_RULE_RESULT'
  | 'PERSIST_OPENCLAW_OVERALL'
  | 'CONFIRM_OPENCLAW_OVERALL_FOR_AEO'
  | 'OPENCLAW_DYNAMIC_EVALUATION'
  | 'OPENCLAW_OVERALL_SYNTHESIS'
  | 'RECORD_ENGINEER_REVIEW'
  | 'RUN_AEO_CANDIDATE_LOOP'
  | 'CREATE_AEO_EDITING_DRAFT'
  | 'RECORD_AEO_DRAFT_FEEDBACK';

export interface AssessmentActionAttemptReservation {
  attemptId: string;
  created: boolean;
}

export interface DynamicEvaluationActionAttempt {
  attemptId: string;
  workItemId: string;
  actionType: 'OPENCLAW_DYNAMIC_EVALUATION';
  attemptNo: number;
  triggerRequestId: string;
  requestOrigin: 'OPENCLAW';
  status: string;
  actorUserId: string;
  tenantId: string;
  createdAt: Date;
}

export interface OverallSynthesisActionAttempt {
  attemptId: string;
  workItemId: string;
  actionType: 'OPENCLAW_OVERALL_SYNTHESIS';
  attemptNo: number;
  triggerRequestId: string;
  requestOrigin: string;
  status: string;
  actorUserId: string;
  tenantId: string;
  packageArtifactRef: string | null;
  packageArtifactSha256: string | null;
  failureArtifactRef: string | null;
  failureArtifactSha256: string | null;
  createdAt: Date;
}

export interface AutoWorkItemQueueCandidate {
  authorization: AutoWorkItemAuthorizationBinding;
  workItem: AutoWorkItemQueueWorkItem;
}

export type AutoWorkItemAuthorizationBinding = Pick<
  typeof autoWorkItemAuthorization.$inferSelect,
  | 'tenantId'
  | 'workItemId'
  | 'requestId'
  | 'actorUserId'
  | 'documentId'
  | 'documentVersionId'
  | 'sourceArtifactId'
  | 'sourceFileSha256'
  | 'sourceByteLength'
  | 'grantKind'
  | 'status'
>;

export type AutoWorkItemQueueWorkItem = Pick<
  typeof workItem.$inferSelect,
  | 'tenantId'
  | 'workItemId'
  | 'requestId'
  | 'requestedByUserId'
  | 'documentId'
  | 'documentVersionId'
  | 'sourceArtifactId'
  | 'sourceFileSha256'
  | 'sourceByteLength'
  | 'actionType'
  | 'runKey'
  | 'status'
  | 'revision'
  | 'packageId'
>;

export type AutoWorkItemBlockedSourceBinding = Pick<AutoWorkItemAuthorizationBinding,
  'workItemId' | 'requestId' | 'actorUserId' | 'documentId' | 'documentVersionId' |
  'sourceArtifactId' | 'sourceFileSha256' | 'sourceByteLength'>;

export interface AutoWorkItemProjectionSnapshot {
  row: Pick<
    typeof workItem.$inferSelect,
    'workItemId' | 'requestedByUserId' | 'revision' | 'packageId'
  >;
  projection: CanonicalWorkItemProjection | null;
}

export interface AutoWorkItemLease {
  leaseExpiresAt?: Date;
  leaseGeneration: number;
  leaseToken: string;
}

export type AutoWorkItemLeaseBinding = {
  authorization: Pick<
    typeof autoWorkItemAuthorization.$inferSelect,
    | 'tenantId'
    | 'workItemId'
    | 'requestId'
    | 'actorUserId'
    | 'documentId'
    | 'documentVersionId'
    | 'sourceArtifactId'
    | 'sourceFileSha256'
    | 'sourceByteLength'
    | 'grantKind'
    | 'status'
    | 'leaseOwner'
    | 'leaseToken'
    | 'leaseGeneration'
    | 'leaseExpiresAt'
  >;
  workItem: Pick<
    typeof workItem.$inferSelect,
    | 'tenantId'
    | 'workItemId'
    | 'requestId'
    | 'requestedByUserId'
    | 'documentId'
    | 'documentVersionId'
    | 'sourceArtifactId'
    | 'sourceFileSha256'
    | 'sourceByteLength'
    | 'actionType'
    | 'status'
    | 'revision'
    | 'packageId'
  >;
};

@Injectable()
export class MiaodaWorkItemRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** An intake choice is authority only for its original actor and exact version. */
  async readDocumentDeliveryIntents(input: {
    tenantId: string;
    documentVersionId: string;
  }): Promise<Array<{
    workItemId: string;
    requestId: string;
    actorUserId: string;
    documentVersionId: string;
    sourceArtifactId: string;
    sourceFileSha256: string;
    sourceByteLength: number;
    delivery: DocumentDeliverySelection;
    executionModel: CanonicalExecutionModelSelection | null;
  }>> {
    const rows = await this.db.select({
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      actorUserId: workItem.requestedByUserId,
      documentVersionId: workItem.documentVersionId,
      sourceArtifactId: workItem.sourceArtifactId,
      sourceFileSha256: workItem.sourceFileSha256,
      sourceByteLength: workItem.sourceByteLength,
      envelope: actionAttempt.taskEnvelopeJson,
      analysisModelJson: workItem.analysisModelJson,
    }).from(workItem).innerJoin(actionAttempt, and(
      eq(actionAttempt.workItemId, workItem.workItemId),
      eq(actionAttempt.tenantId, workItem.tenantId),
      eq(actionAttempt.actorUserId, workItem.requestedByUserId),
      eq(actionAttempt.documentVersionId, workItem.documentVersionId),
      eq(actionAttempt.triggerRequestId, workItem.requestId),
      eq(actionAttempt.actionType, DELIVERY_INTENT_ACTION_TYPE),
      eq(actionAttempt.status, 'RECORDED'),
    )).where(and(
      eq(workItem.tenantId, input.tenantId),
      eq(workItem.documentVersionId, input.documentVersionId),
      eq(workItem.actionType, ACTION_TYPE),
    ));
    return rows.flatMap((row) => {
      let envelope: unknown;
      try { envelope = JSON.parse(row.envelope ?? ''); }
      catch { throw new Error('DOCUMENT_DELIVERY_INTENT_CORRUPT'); }
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope))
        throw new Error('DOCUMENT_DELIVERY_INTENT_CORRUPT');
      const stored = envelope as Record<string, unknown>;
      if (stored.schemaVersion !== 'wiselink.document_delivery_intent.v1' ||
          stored.documentVersionId !== row.documentVersionId)
        throw new Error('DOCUMENT_DELIVERY_INTENT_CORRUPT');
      if (stored.documentDelivery === null) return [];
      const delivery = stored.documentDelivery;
      if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery))
        throw new Error('DOCUMENT_DELIVERY_INTENT_CORRUPT');
      const choice = delivery as Record<string, unknown>;
      if (Object.keys(choice).length !== 2 || typeof choice.reading !== 'boolean' ||
          (choice.translation !== 'NONE' && choice.translation !== 'ZH_FULL'))
        throw new Error('DOCUMENT_DELIVERY_INTENT_CORRUPT');
      return [{ workItemId: row.workItemId, requestId: row.requestId,
        actorUserId: row.actorUserId, documentVersionId: row.documentVersionId,
        sourceArtifactId: row.sourceArtifactId, sourceFileSha256: row.sourceFileSha256,
        sourceByteLength: row.sourceByteLength,
        executionModel: readStoredExecutionModel(row.analysisModelJson),
        delivery: { reading: choice.reading, translation: choice.translation } }];
    });
  }

  /** Enumerate persisted intake identities; pending producer state is checked in actor scope. */
  async listDocumentDeliveryCandidates(input: { tenantId: string; afterAttemptId?: string;
    limit: number }): Promise<Array<{
    attemptId: string; workItemId: string; documentVersionId: string; actorUserId: string;
  }>> {
    const rows = await this.db.execute<{ attemptId: string; workItemId: string;
      documentVersionId: string; actorUserId: string }>(sql`
      SELECT i.attempt_id AS "attemptId",i.work_item_id AS "workItemId",
        i.document_version_id AS "documentVersionId",
        i.actor_user_id AS "actorUserId"
      FROM ${actionAttempt} i JOIN ${workItem} w
        ON w.work_item_id=i.work_item_id AND w.tenant_id=i.tenant_id
        AND w.document_version_id=i.document_version_id
        AND w.request_id=i.trigger_request_id
        AND w.requested_by_user_id=i.actor_user_id
      WHERE i.tenant_id=${input.tenantId}
        AND i.action_type=${DELIVERY_INTENT_ACTION_TYPE}
        AND i.status='RECORDED'
        AND (i.task_envelope_json::jsonb->'documentDelivery'->>'reading'='true'
          OR i.task_envelope_json::jsonb->'documentDelivery'->>'translation'='ZH_FULL')
        AND (${input.afterAttemptId ?? null}::text IS NULL OR
          (i.created_at,i.attempt_id) > (SELECT cursor.created_at,cursor.attempt_id
            FROM ${actionAttempt} cursor WHERE cursor.attempt_id=${input.afterAttemptId ?? null}
              AND cursor.tenant_id=${input.tenantId}))
      ORDER BY i.created_at,i.attempt_id LIMIT ${input.limit}`);
    return rows;
  }

  /** Called only after binding the verified actor to the Hosted SQL context. */
  async documentDeliveryDispatchState(input: {
    tenantId: string; documentVersionId: string; actorUserId: string;
    readingRequestId: string; translationRequestId: string;
    readingSelected: boolean; translationSelected: boolean;
  }): Promise<{ pending: boolean; missing: boolean }> {
    const rows = await this.db.execute<{ pending: boolean; missing: boolean }>(sql`
      SELECT (
        EXISTS (SELECT 1 FROM ${dmDocumentReadingRun} r
          WHERE r.tenant_id=${input.tenantId} AND r.actor_user_id=${input.actorUserId}
            AND r.document_version_id=${input.documentVersionId}
            AND r.request_id=${input.readingRequestId}
            AND r.status IN ('QUEUED','RUNNING') AND r.deadline_at>CURRENT_TIMESTAMP
            AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=CURRENT_TIMESTAMP))
        OR EXISTS (SELECT 1 FROM ${actionAttempt} t
          WHERE t.tenant_id=${input.tenantId} AND t.actor_user_id=${input.actorUserId}
            AND t.document_version_id=${input.documentVersionId}
            AND (t.trigger_request_id=${`${input.translationRequestId}:resume-`} || t.attempt_no::text
              OR t.trigger_request_id IN (${input.translationRequestId},${`${input.translationRequestId}:hosted-m3`},
              ${`${input.translationRequestId}:partial-repair`},${`${input.translationRequestId}:partial-repair-v2`},
              ${`${input.translationRequestId}:known-failure`},${`${input.translationRequestId}:expired-resume`}))
            AND t.subject_kind='DOCUMENT_VERSION' AND t.action_type='DOCUMENT_TRANSLATE'
            AND t.status IN ('QUEUED','RUNNING','RETRY_SCHEDULED')
            AND (t.trigger_request_id<>${`${input.translationRequestId}:partial-repair`}
              OR jsonb_exists(t.task_envelope_json::jsonb->'modelInput','retranslateBlockIds'))
            AND t.deadline_at>CURRENT_TIMESTAMP
            AND (t.lease_expires_at IS NULL OR t.lease_expires_at<=CURRENT_TIMESTAMP))
        OR EXISTS (SELECT 1 FROM ${actionAttempt} t JOIN ${translationWorkspace} ws
          ON ws.tenant_id=t.tenant_id AND ws.workspace_id=t.task_envelope_json::jsonb->>'workspaceId'
          WHERE t.tenant_id=${input.tenantId} AND t.actor_user_id=${input.actorUserId}
            AND t.document_version_id=${input.documentVersionId}
            AND (t.trigger_request_id=${`${input.translationRequestId}:resume-`} || t.attempt_no::text
              OR t.trigger_request_id IN (${input.translationRequestId},
                ${`${input.translationRequestId}:hosted-m3`},${`${input.translationRequestId}:known-failure`},
                ${`${input.translationRequestId}:partial-repair`},${`${input.translationRequestId}:partial-repair-v2`}))
            AND t.subject_kind='DOCUMENT_VERSION' AND t.action_type='DOCUMENT_TRANSLATE'
            AND (t.status IN ('QUEUED','RUNNING','RETRY_SCHEDULED') OR
              (t.status='FAILED' AND t.error_code='DOCUMENT_TRANSLATION_DEADLINE_EXPIRED'))
            AND t.deadline_at<=CURRENT_TIMESTAMP AND t.claim_count=0 AND t.started_at IS NULL
            AND t.lease_owner IS NULL AND t.lease_token IS NULL AND t.lease_expires_at IS NULL
            AND t.result_envelope_json IS NULL AND t.result_content_hash IS NULL
            AND t.projection_applied=false AND t.commit_started_at IS NULL
            AND t.cancel_requested_at IS NULL AND t.execution_model_json IS NOT NULL
            AND t.task_envelope_json::jsonb->'modelInput'->>'documentProducer'='HOSTED_M3'
            AND ws.document_version_id=t.document_version_id AND ws.work_item_id IS NULL
            AND (ws.active_attempt_id IS NULL OR ws.active_attempt_id=t.attempt_id OR
              EXISTS (SELECT 1 FROM ${actionAttempt} coordinator
                WHERE coordinator.tenant_id=t.tenant_id AND coordinator.actor_user_id=t.actor_user_id
                  AND coordinator.document_version_id=t.document_version_id
                  AND coordinator.attempt_id=ws.active_attempt_id
                  AND coordinator.attempt_no<t.attempt_no
                  AND coordinator.status IN ('FAILED','SUCCEEDED','CANCELLED')))
            AND ws.result_artifact_json IS NULL
            AND ws.result_manifest_json IS NULL
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ws.generation_requests_json::jsonb) g
              WHERE g->>'attemptId'=t.attempt_id OR g->>'status'='REGISTERED'
                OR g->'error'->>'outcome'='GENERATION_UNKNOWN')
            AND NOT EXISTS (SELECT 1 FROM ${translationBlockRevision} b
              WHERE b.tenant_id=t.tenant_id AND b.workspace_id=ws.workspace_id
                AND b.origin_attempt_id=t.attempt_id)
            AND NOT EXISTS (SELECT 1 FROM ${actionAttempt} newer
              WHERE newer.tenant_id=t.tenant_id AND newer.document_version_id=t.document_version_id
                AND newer.subject_kind='DOCUMENT_VERSION' AND newer.action_type='DOCUMENT_TRANSLATE'
                AND newer.attempt_no>t.attempt_no)
            AND NOT EXISTS (SELECT 1 FROM ${actionAttempt} successor
              WHERE successor.tenant_id=t.tenant_id AND successor.actor_user_id=t.actor_user_id
                AND successor.document_version_id=t.document_version_id
                AND successor.subject_kind='DOCUMENT_VERSION' AND successor.action_type='DOCUMENT_TRANSLATE'
                AND successor.trigger_request_id=${`${input.translationRequestId}:expired-resume`}))
        OR EXISTS (SELECT 1 FROM ${actionAttempt} t
          WHERE t.tenant_id=${input.tenantId} AND t.actor_user_id=${input.actorUserId}
            AND t.document_version_id=${input.documentVersionId}
            AND t.trigger_request_id=${input.translationRequestId}
            AND t.subject_kind='DOCUMENT_VERSION' AND t.action_type='DOCUMENT_TRANSLATE'
            AND t.status='FAILED' AND t.error_code='DOCUMENT_PLUGIN_QUOTA_EXHAUSTED'
            AND t.started_at IS NULL AND t.projection_applied=false
            AND t.result_envelope_json IS NULL
            AND t.task_envelope_json::jsonb->'modelInput'->>'documentProducer'='OFFICIAL_PLUGIN'
            AND NOT EXISTS (SELECT 1 FROM ${actionAttempt} successor
              WHERE successor.tenant_id=t.tenant_id AND successor.actor_user_id=t.actor_user_id
                AND successor.document_version_id=t.document_version_id
                AND successor.subject_kind='DOCUMENT_VERSION' AND successor.action_type='DOCUMENT_TRANSLATE'
                AND successor.trigger_request_id=${`${input.translationRequestId}:hosted-m3`}))
        OR EXISTS (SELECT 1 FROM ${actionAttempt} t
          WHERE t.tenant_id=${input.tenantId} AND t.actor_user_id=${input.actorUserId}
            AND t.document_version_id=${input.documentVersionId}
            AND (t.trigger_request_id=${`${input.translationRequestId}:resume-`} || t.attempt_no::text
              OR t.trigger_request_id IN (${input.translationRequestId},
                ${`${input.translationRequestId}:hosted-m3`},${`${input.translationRequestId}:known-failure`},
                ${`${input.translationRequestId}:expired-resume`}))
            AND t.subject_kind='DOCUMENT_VERSION' AND t.action_type='DOCUMENT_TRANSLATE'
            AND t.status='SUCCEEDED' AND t.terminal_reason='REMAINING_LIMITATIONS'
            AND t.result_envelope_json::jsonb->'artifact'->>'completeness'='PARTIAL'
            AND NOT EXISTS (SELECT 1 FROM ${actionAttempt} successor
              WHERE successor.tenant_id=t.tenant_id AND successor.actor_user_id=t.actor_user_id
                AND successor.document_version_id=t.document_version_id
                AND successor.subject_kind='DOCUMENT_VERSION' AND successor.action_type='DOCUMENT_TRANSLATE'
                AND successor.trigger_request_id=${`${input.translationRequestId}:partial-repair`})
            AND EXISTS (SELECT 1 FROM ${translationBlockRevision} r
              WHERE r.tenant_id=t.tenant_id
                AND r.workspace_id=t.task_envelope_json::jsonb->>'workspaceId'
                AND r.selected_for_reading=false AND r.check_json IS NOT NULL
                AND r.content_revision=(SELECT max(newer.content_revision) FROM ${translationBlockRevision} newer
                  WHERE newer.tenant_id=r.tenant_id AND newer.workspace_id=r.workspace_id
                    AND newer.block_id=r.block_id)
                AND jsonb_path_exists(r.check_json::jsonb,
                  '$.issues[*] ? (@.severity == "BLOCK" && @.origin != "SOURCE")')
                AND NOT jsonb_path_exists(r.check_json::jsonb,
                  '$.issues[*] ? (@.severity == "BLOCK" && @.origin == "SOURCE")')))
      ) AS pending,
      (
        (${input.readingSelected} AND NOT EXISTS (SELECT 1 FROM ${dmDocumentReadingRun} r
          WHERE r.tenant_id=${input.tenantId} AND r.actor_user_id=${input.actorUserId}
            AND r.document_version_id=${input.documentVersionId}
            AND r.request_id=${input.readingRequestId}))
        OR (${input.translationSelected} AND NOT EXISTS (SELECT 1 FROM ${actionAttempt} t
          WHERE t.tenant_id=${input.tenantId} AND t.actor_user_id=${input.actorUserId}
            AND t.document_version_id=${input.documentVersionId}
            AND (t.trigger_request_id=${`${input.translationRequestId}:resume-`} || t.attempt_no::text
              OR t.trigger_request_id IN (${input.translationRequestId},${`${input.translationRequestId}:hosted-m3`},
              ${`${input.translationRequestId}:partial-repair`},${`${input.translationRequestId}:partial-repair-v2`},
              ${`${input.translationRequestId}:known-failure`},${`${input.translationRequestId}:expired-resume`}))
            AND t.subject_kind='DOCUMENT_VERSION' AND t.action_type='DOCUMENT_TRANSLATE'))
      ) AS missing`);
    return { pending: rows[0]?.pending === true, missing: rows[0]?.missing === true };
  }

  async reserve(input: WorkItemReservationInput): Promise<WorkItemReservation> {
    return this.db.transaction(async (transaction) => {
      if (input.developmentIntake) {
        // The request token identifies one actor and one source version, even
        // when two submissions race for different DocumentVersions.
        // Keep the blocking transaction lock, but project only an integer:
        // the Hosted SQL result decoder must not receive the void value.
        await transaction.execute(sql`select 1 AS acquired from pg_advisory_xact_lock(
          hashtext(${input.tenantId}), hashtext(${input.runKey})
        )`);
        const [existingRun] = await transaction.select().from(workItem)
          .where(and(
            eq(workItem.tenantId, input.tenantId),
            eq(workItem.runKey, input.runKey),
          )).limit(1);
        if (existingRun && (
          existingRun.documentVersionId !== input.documentVersionId ||
          existingRun.requestedByUserId !== input.actorUserId
        )) {
          throw canonicalModelError('DEVELOPMENT_RUN_REQUEST_IDENTITY_CONFLICT', 409);
        }
      }
      const now = new Date();
      const candidate = {
        workItemId: `WI-${randomUUID()}`,
        requestId: `REQ-${randomUUID()}`,
        attemptId: `ATT-${randomUUID()}`,
      };
      const inserted = await transaction
        .insert(workItem)
        .values({
          workItemId: candidate.workItemId,
          tenantId: input.tenantId,
          actionType: ACTION_TYPE,
          documentId: input.documentId,
          documentVersionId: input.documentVersionId,
          sourceArtifactId: input.sourceArtifactId,
          sourceFileSha256: rawHash(input.sourceFileSha256),
          sourceByteLength: input.sourceByteLength,
          normalizedFamily: input.normalizedFamily,
          runKey: input.runKey,
          analysisModelJson: input.analysisModel
            ? JSON.stringify(input.analysisModel)
            : null,
          initialAilySessionId: input.initialAilySessionId ?? null,
          requestId: candidate.requestId,
          status: 'RESERVED',
          revision: 0,
          requestedByUserId: input.actorUserId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [
            workItem.tenantId,
            workItem.actionType,
            workItem.documentVersionId,
            workItem.runKey,
          ],
        })
        .returning({ workItemId: workItem.workItemId });

      const [stored] = await transaction
        .select()
        .from(workItem)
        .where(
          and(
            eq(workItem.tenantId, input.tenantId),
            eq(workItem.actionType, ACTION_TYPE),
            eq(workItem.documentVersionId, input.documentVersionId),
            eq(workItem.runKey, input.runKey),
          ),
        )
        .limit(1);
      if (!stored) throw new Error('WORK_ITEM_RESERVATION_READBACK_FAILED');
      assertReservationIdentity(stored, input);

      const created = inserted.length === 1;
      if (created) {
        if (input.autoProcessingGrant) {
          await transaction.insert(autoWorkItemAuthorization).values({
            tenantId: stored.tenantId,
            workItemId: stored.workItemId,
            requestId: stored.requestId,
            actorUserId: input.actorUserId,
            documentId: stored.documentId,
            documentVersionId: stored.documentVersionId,
            sourceArtifactId: stored.sourceArtifactId,
            sourceFileSha256: stored.sourceFileSha256,
            sourceByteLength: stored.sourceByteLength,
            grantKind: input.autoProcessingGrant,
            status: 'WAITING',
            leaseGeneration: 0,
            createdAt: now,
            updatedAt: now,
          });
        }
        await transaction
          .insert(actionAttempt)
          .values({
            attemptId: candidate.attemptId,
            workItemId: stored.workItemId,
            actionType: ACTION_TYPE,
            attemptNo: 1,
            triggerRequestId: stored.requestId,
            requestOrigin: input.requestOrigin,
            status: 'PENDING',
            actorUserId: input.actorUserId,
            tenantId: input.tenantId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [
              actionAttempt.workItemId,
              actionAttempt.actionType,
              actionAttempt.attemptNo,
            ],
          });
      }
      const [attempt] = await transaction
        .select()
        .from(actionAttempt)
        .where(
          and(
            eq(actionAttempt.workItemId, stored.workItemId),
            eq(actionAttempt.actionType, ACTION_TYPE),
            eq(actionAttempt.attemptNo, 1),
          ),
        )
        .limit(1);
      if (!attempt) throw new Error('ACTION_ATTEMPT_READBACK_FAILED');
      if (input.developmentIntake) {
        const intent = {
          schemaVersion: 'wiselink.document_delivery_intent.v1',
          documentVersionId: stored.documentVersionId,
          documentDelivery: input.documentDelivery ?? null,
        };
        if (created) {
          await transaction.insert(actionAttempt).values({
            attemptId: `ATT-${randomUUID()}`,
            workItemId: stored.workItemId,
            subjectKind: 'WORK_ITEM',
            documentVersionId: stored.documentVersionId,
            actionType: DELIVERY_INTENT_ACTION_TYPE,
            attemptNo: 1,
            triggerRequestId: stored.requestId,
            requestOrigin: input.requestOrigin,
            status: 'RECORDED',
            actorUserId: input.actorUserId,
            tenantId: input.tenantId,
            taskEnvelopeJson: JSON.stringify(intent),
            idempotencyKey: `document-delivery-intent:${stored.workItemId}`,
            createdAt: now,
            updatedAt: now,
          });
        }
        const [savedIntent] = await transaction.select().from(actionAttempt)
          .where(and(
            eq(actionAttempt.workItemId, stored.workItemId),
            eq(actionAttempt.actionType, DELIVERY_INTENT_ACTION_TYPE),
            eq(actionAttempt.attemptNo, 1),
          )).limit(1);
        if (!savedIntent) {
          if (input.documentDelivery) {
            throw canonicalModelError('DOCUMENT_DELIVERY_LEGACY_REPLAY_CONFLICT', 409);
          }
        } else if (
          savedIntent.tenantId !== input.tenantId ||
          savedIntent.actorUserId !== input.actorUserId ||
          savedIntent.documentVersionId !== stored.documentVersionId ||
          savedIntent.triggerRequestId !== stored.requestId ||
          savedIntent.taskEnvelopeJson !== JSON.stringify(intent)
        ) {
          throw canonicalModelError('DOCUMENT_DELIVERY_IDEMPOTENCY_CONFLICT', 409);
        }
      }
      return {
        workItemId: stored.workItemId,
        requestId: stored.requestId,
        attemptId: attempt.attemptId,
        created,
      };
    });
  }

  /**
   * Reads only explicitly enrolled, parse-complete WorkItems for one tenant.
   * Legacy WorkItems and in-progress parser rows cannot enter this queue.
   */
  async listAutoProcessingCandidates(input: {
    tenantId: string;
    now: Date;
    limit?: number;
    workItemId?: string;
    /** Explicit configuration replay discovery only; normal dispatch never sets this. */
    includeActiveLeaseForConfiguration?: boolean;
  }): Promise<AutoWorkItemQueueCandidate[]> {
    const limit = Math.min(Math.max(input.limit ?? 32, 1), 100);
    return this.db
      .select({
        authorization: autoWorkItemAuthorization,
        workItem,
      })
      .from(autoWorkItemAuthorization)
      .innerJoin(
        workItem,
        and(
          eq(workItem.tenantId, autoWorkItemAuthorization.tenantId),
          eq(workItem.workItemId, autoWorkItemAuthorization.workItemId),
        ),
      )
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          ...(input.workItemId
            ? [eq(autoWorkItemAuthorization.workItemId, input.workItemId)]
            : []),
          or(
            eq(autoWorkItemAuthorization.status, 'WAITING'),
            and(
              eq(autoWorkItemAuthorization.status, 'LEASED'),
              ...(input.includeActiveLeaseForConfiguration ? [] : [lt(autoWorkItemAuthorization.leaseExpiresAt, input.now)]),
            ),
          ),
          eq(workItem.actionType, ACTION_TYPE),
          eq(workItem.status, 'CANDIDATE_READBACK_VERIFIED'),
          isNotNull(workItem.packageId),
        ),
      )
      .orderBy(autoWorkItemAuthorization.createdAt)
      .limit(limit);
  }

  /** Browser path uses only WorkItem's own read policy, never the service-only grant table. */
  async hasReadableAutoProcessingCompletion(input: {
    tenantId: string;
    actorUserId: string;
    workItemId: string;
    revision: number;
  }): Promise<boolean> {
    return Boolean(await this.readReadableAutoProcessingCompletion(input));
  }

  /** Returns the receipt validated by this single tenant-scoped WorkItem read. */
  async readReadableAutoProcessingCompletion(input: {
    tenantId: string;
    actorUserId: string;
    workItemId: string;
    revision: number;
  }): Promise<CanonicalAutoProcessingCompletionReceipt | null> {
    const loaded = await this.loadTenantScopedProjection(
      input.workItemId,
      input.tenantId,
    );
    const receipt = loaded?.projection?.autoProcessingCompletionReceipt;
    const row = loaded?.row;
    return (
      receipt &&
      row &&
      row.tenantId === input.tenantId &&
      row.workItemId === input.workItemId &&
      row.requestedByUserId === input.actorUserId &&
      row.revision === input.revision &&
      loaded?.projection?.revision === input.revision &&
      row.actionType === ACTION_TYPE &&
      row.status === 'CANDIDATE_READBACK_VERIFIED' &&
      row.packageId &&
      receipt.tenantId === row.tenantId &&
      receipt.workItemId === row.workItemId &&
      receipt.actorUserId === row.requestedByUserId &&
      receipt.requestId === row.requestId &&
      receipt.documentId === row.documentId &&
      receipt.documentVersionId === row.documentVersionId &&
      receipt.sourceArtifactId === row.sourceArtifactId &&
      receipt.sourceFileSha256 === row.sourceFileSha256 &&
      receipt.sourceByteLength === Number(row.sourceByteLength) &&
      /^[0-9a-f]{64}$/u.test(receipt.sourceFileSha256) &&
      receipt.sourceByteLength > 0 &&
      Number.isFinite(Date.parse(receipt.completedAt))
    ) ? receipt : null;
  }

  /** Discovery only: completion is not a successor execution delegation. */
  async listCompletedAutoProcessingReviewSubjects(input: {
    tenantId: string;
    afterWorkItemId?: string;
    workItemId?: string;
    limit?: number;
  }): Promise<AutoWorkItemLeaseBinding[]> {
    return this.db
      .select({
        authorization: {
          tenantId: autoWorkItemAuthorization.tenantId,
          workItemId: autoWorkItemAuthorization.workItemId,
          requestId: autoWorkItemAuthorization.requestId,
          actorUserId: autoWorkItemAuthorization.actorUserId,
          documentId: autoWorkItemAuthorization.documentId,
          documentVersionId: autoWorkItemAuthorization.documentVersionId,
          sourceArtifactId: autoWorkItemAuthorization.sourceArtifactId,
          sourceFileSha256: autoWorkItemAuthorization.sourceFileSha256,
          sourceByteLength: autoWorkItemAuthorization.sourceByteLength,
          grantKind: autoWorkItemAuthorization.grantKind,
          status: autoWorkItemAuthorization.status,
          leaseOwner: autoWorkItemAuthorization.leaseOwner,
          leaseToken: autoWorkItemAuthorization.leaseToken,
          leaseGeneration: autoWorkItemAuthorization.leaseGeneration,
          leaseExpiresAt: autoWorkItemAuthorization.leaseExpiresAt
        },
        workItem: {
          tenantId: workItem.tenantId,
          workItemId: workItem.workItemId,
          requestId: workItem.requestId,
          requestedByUserId: workItem.requestedByUserId,
          documentId: workItem.documentId,
          documentVersionId: workItem.documentVersionId,
          sourceArtifactId: workItem.sourceArtifactId,
          sourceFileSha256: workItem.sourceFileSha256,
          sourceByteLength: workItem.sourceByteLength,
          actionType: workItem.actionType,
          status: workItem.status,
          revision: workItem.revision,
          packageId: workItem.packageId
        }
      })
      .from(autoWorkItemAuthorization)
      .innerJoin(
        workItem,
        and(
          eq(workItem.tenantId, autoWorkItemAuthorization.tenantId),
          eq(workItem.workItemId, autoWorkItemAuthorization.workItemId),
          eq(workItem.requestId, autoWorkItemAuthorization.requestId),
          eq(workItem.requestedByUserId, autoWorkItemAuthorization.actorUserId),
          eq(workItem.documentId, autoWorkItemAuthorization.documentId),
          eq(
            workItem.documentVersionId,
            autoWorkItemAuthorization.documentVersionId,
          ),
          eq(
            workItem.sourceArtifactId,
            autoWorkItemAuthorization.sourceArtifactId,
          ),
          eq(
            workItem.sourceFileSha256,
            autoWorkItemAuthorization.sourceFileSha256,
          ),
          eq(
            workItem.sourceByteLength,
            autoWorkItemAuthorization.sourceByteLength,
          ),
        ),
      )
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          eq(
            autoWorkItemAuthorization.grantKind,
            'MIAODA_CANONICAL_PARSE_REQUEST',
          ),
          eq(autoWorkItemAuthorization.status, 'COMPLETED'),
          isNotNull(autoWorkItemAuthorization.completedAt),
          eq(workItem.actionType, ACTION_TYPE),
          eq(workItem.status, 'CANDIDATE_READBACK_VERIFIED'),
          isNotNull(workItem.packageId),
          ...(input.afterWorkItemId
            ? [gt(workItem.workItemId, input.afterWorkItemId)]
            : []),
          ...(input.workItemId
            ? [eq(workItem.workItemId, input.workItemId)]
            : []),
        ),
      )
      .orderBy(workItem.workItemId)
      .limit(Math.min(Math.max(input.limit ?? 32, 1), 100));
  }

  /** Applies only the current saved default to an exact, never-claimed task. */
  async applyPendingModelConfiguration(input: import('@shared/pending-model-configuration.interface').ApplyPendingModelConfigurationRequest & {
    tenantId: string; principalId: string;
  }): Promise<import('@shared/pending-model-configuration.interface').ApplyPendingModelConfigurationResponse> {
    return this.db.transaction(async tx => {
      // Match claim, SAVE and ACK: WorkItem -> grant. An exact configuration
      // replay can arrive after claim, so it must share their lock order too.
      const [owner] = await tx.select().from(workItem).where(and(
        eq(workItem.tenantId, input.tenantId), eq(workItem.workItemId, input.workItemId),
      )).limit(1).for('update');
      const [grant] = await tx.select().from(autoWorkItemAuthorization).where(and(
        eq(autoWorkItemAuthorization.tenantId, input.tenantId),
        eq(autoWorkItemAuthorization.workItemId, input.workItemId),
      )).limit(1).for('update');
      if (!grant || !owner || grant.requestId !== input.requestId ||
          owner.requestId !== input.requestId || owner.requestedByUserId !== grant.actorUserId ||
          owner.documentId !== grant.documentId || owner.documentVersionId !== input.documentVersionId ||
          grant.documentVersionId !== input.documentVersionId || owner.sourceArtifactId !== input.sourceArtifactId ||
          grant.sourceArtifactId !== input.sourceArtifactId || owner.sourceFileSha256 !== input.sourceFileSha256 ||
          grant.sourceFileSha256 !== input.sourceFileSha256 || Number(owner.sourceByteLength) !== input.sourceByteLength ||
          Number(grant.sourceByteLength) !== input.sourceByteLength || owner.revision !== input.expectedWorkItemRevision ||
          owner.actionType !== 'PARSE_PDF' || grant.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST')
        throw canonicalModelError('PENDING_MODEL_SOURCE_BINDING_CHANGED', 409);
      const projection = parseProjection(owner.projectionJson);
      if (!projection || projection.workItemId !== input.workItemId || projection.requestId !== input.requestId ||
          projection.revision !== input.expectedWorkItemRevision || projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
          projection.source.documentVersionId !== input.documentVersionId || projection.package?.packageId !== owner.packageId)
        throw canonicalModelError('PENDING_MODEL_SOURCE_BINDING_CHANGED', 409);
      const current = readStoredExecutionModel(owner.analysisModelJson);
      const history = projection.modelConfigurationApplications ?? [];
      const prior = history.find(receipt => receipt.configurationRequestId === input.configurationRequestId);
      if (prior) {
        if (prior.executorPrincipalId !== input.principalId || prior.actorUserId !== grant.actorUserId ||
            prior.workItemId !== input.workItemId || prior.requestId !== input.requestId ||
            prior.documentVersionId !== input.documentVersionId || prior.sourceArtifactId !== input.sourceArtifactId ||
            prior.sourceFileSha256 !== input.sourceFileSha256 || prior.sourceByteLength !== input.sourceByteLength ||
            prior.workItemRevision !== input.expectedWorkItemRevision ||
            canonicalJson(prior.previousModel) !== canonicalJson(input.expectedExecutionModel) ||
            prior.executionModel.settingsRevision !== input.expectedSettingsRevision ||
            canonicalJson(prior.executionModel) !== canonicalJson(current))
          throw canonicalModelError('PENDING_MODEL_CONFIGURATION_REPLAY_CONFLICT', 409);
        return { status: 'MODEL_CONFIGURATION_APPLIED', replayed: true, application: prior };
      }
      if (grant.status !== 'WAITING' || grant.leaseGeneration !== 0 || grant.leaseToken !== null ||
          grant.leaseOwner !== null || grant.leaseExpiresAt !== null)
        throw canonicalModelError('PENDING_MODEL_ALREADY_CLAIMED', 409);
      if (canonicalJson(current) !== canonicalJson(input.expectedExecutionModel))
        throw canonicalModelError('PENDING_MODEL_SNAPSHOT_CHANGED', 409);
      if (projection.assessment || projection.integratedAssessment || projection.translation || projection.applicability)
        throw canonicalModelError('PENDING_MODEL_EXECUTION_STARTED', 409);
      const translationRoot = documentDeliveryRequestId('translation', `work-item:${input.workItemId}`);
      const [frozen] = await tx.select({ attemptId: actionAttempt.attemptId }).from(actionAttempt).where(and(
        eq(actionAttempt.tenantId, input.tenantId),
        or(and(eq(actionAttempt.workItemId, input.workItemId),
          or(isNotNull(actionAttempt.executionModelJson), inArray(actionAttempt.actionType, [
            'OPENCLAW_TRANSLATE', 'OPENCLAW_APPLICABILITY_EVALUATION',
            'OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS',
          ]))), and(
          eq(actionAttempt.subjectKind, 'DOCUMENT_VERSION'), eq(actionAttempt.documentVersionId, input.documentVersionId),
          eq(actionAttempt.actorUserId, grant.actorUserId), eq(actionAttempt.actionType, 'DOCUMENT_TRANSLATE'),
          or(eq(actionAttempt.triggerRequestId, translationRoot), sql`${actionAttempt.triggerRequestId} LIKE ${`${translationRoot}:%`}`),
        )),
      )).limit(1);
      const [reading] = await tx.select({ runRef: dmDocumentReadingRun.runRef }).from(dmDocumentReadingRun).where(and(
        eq(dmDocumentReadingRun.tenantId, input.tenantId), eq(dmDocumentReadingRun.actorUserId, grant.actorUserId),
        eq(dmDocumentReadingRun.documentVersionId, input.documentVersionId),
        eq(dmDocumentReadingRun.requestId, documentDeliveryRequestId('reading', `work-item:${input.workItemId}`)),
      )).limit(1);
      if (frozen || reading) throw canonicalModelError('PENDING_MODEL_EXECUTION_STARTED', 409);
      // Share-lock the exact configuration revision so a concurrent save cannot
      // change which authoritative default this application acknowledges.
      const [saved] = await tx.select().from(canonicalModelSetting).where(
        eq(canonicalModelSetting.tenantId, input.tenantId)).limit(1).for('share');
      if (!saved || saved.revision !== input.expectedSettingsRevision)
        throw canonicalModelError('MODEL_SETTINGS_REVISION_CONFLICT', 409);
      const now = new Date();
      const executionModel = { ...taskModelSelection(saved.modelRef, now), settingsRevision: saved.revision };
      const application = { configurationRequestId: input.configurationRequestId, appliedAt: now.toISOString(),
        executorPrincipalId: input.principalId, actorUserId: grant.actorUserId,
        workItemId: input.workItemId, requestId: input.requestId, documentVersionId: input.documentVersionId,
        sourceArtifactId: input.sourceArtifactId, sourceFileSha256: input.sourceFileSha256,
        sourceByteLength: input.sourceByteLength, workItemRevision: owner.revision,
        previousModel: current, executionModel };
      const updated = await tx.update(workItem).set({
        analysisModelJson: JSON.stringify(executionModel),
        projectionJson: JSON.stringify({ ...projection, modelConfigurationApplications: [...history, application] }),
        updatedAt: now,
      }).where(and(eq(workItem.tenantId, input.tenantId), eq(workItem.workItemId, input.workItemId),
        eq(workItem.revision, input.expectedWorkItemRevision))).returning({ workItemId: workItem.workItemId });
      if (updated.length !== 1) throw canonicalModelError('PENDING_MODEL_SOURCE_BINDING_CHANGED', 409);
      return { status: 'MODEL_CONFIGURATION_APPLIED', replayed: false, application };
    });
  }

  /** One conditional UPDATE elects a single queue consumer for each lease. */
  /** A normal owner action may authorize one new intent after a closed legacy
   * execution. This never discovers/enrolls work or changes a former attempt. */
  async authorizeAilyInitialSuccessor(input:AilyInitialSuccessorAuthorizationInput) {
    const conflict=()=>canonicalModelError('AILY_INITIAL_SUCCESSOR_AUTHORIZATION_REJECTED',409);
    if(typeof input.authorize!=='function'||!Number.isSafeInteger(input.leaseMs)||input.leaseMs<=0||
        !/^service:[A-Za-z0-9:_-]{1,140}$/u.test(input.principalId)||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(input.stageRequestId)||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(input.leaseToken))throw conflict();
    return this.db.transaction(async database=>{
      const [owner]=await database.select().from(workItem).where(and(eq(workItem.tenantId,input.tenantId),
        eq(workItem.workItemId,input.workItem.workItemId))).limit(1).for('update');
      const [grant]=await database.select().from(autoWorkItemAuthorization).where(and(
        eq(autoWorkItemAuthorization.tenantId,input.tenantId),eq(autoWorkItemAuthorization.workItemId,input.workItem.workItemId)))
        .limit(1).for('update');
      if(!owner||!grant||!matchesInitialContinuationOwner(owner,input)||grant.grantKind!=='MIAODA_CANONICAL_PARSE_REQUEST'||
          grant.tenantId!==owner.tenantId||grant.workItemId!==owner.workItemId||grant.actorUserId!==owner.requestedByUserId||
          grant.requestId!==owner.requestId||grant.documentId!==owner.documentId||grant.documentVersionId!==owner.documentVersionId||
          grant.sourceArtifactId!==owner.sourceArtifactId||grant.sourceFileSha256!==owner.sourceFileSha256||
          Number(grant.sourceByteLength)!==Number(owner.sourceByteLength))throw conflict();
      const rows=await database.select().from(actionAttempt).where(and(eq(actionAttempt.tenantId,input.tenantId),
        eq(actionAttempt.workItemId,owner.workItemId),inArray(actionAttempt.actionType,
          ['OPENCLAW_TRANSLATE','OPENCLAW_APPLICABILITY_EVALUATION','OPENCLAW_DYNAMIC_EVALUATION','OPENCLAW_OVERALL_SYNTHESIS'])))
        .for('update');
      const queued=rows.find(row=>row.attemptId===input.request.attemptId);
      const [clock]=await database.execute<{now:Date|string}>(sql`SELECT clock_timestamp() AS now`);
      const clockValue:unknown=clock?.now;
      const now=clockValue instanceof Date?new Date(clockValue.getTime()):typeof clockValue==='string'?new Date(clockValue):null;
      if(!now||!Number.isFinite(now.getTime())||!queued||queued.operationRef!==input.request.operationRef||
          queued.idempotencyKey!==input.request.idempotencyKey||queued.taskInputHash!==input.request.taskInputHash||
          queued.actorUserId!==input.actorUserId||queued.subjectKind!=='WORK_ITEM'||queued.requestOrigin!=='OPENCLAW_MCP_V1'||
          queued.documentVersionId!==owner.documentVersionId||queued.actionType!=='OPENCLAW_DYNAMIC_EVALUATION'||
          queued.status!=='QUEUED'||queued.baseRevision!==owner.revision||queued.inputRevision!==owner.revision||
          queued.claimCount!==0||queued.retryCount!==0||queued.leaseGeneration!==0||queued.leaseOwner!==null||
          queued.leaseToken!==null||queued.leaseExpiresAt!==null||queued.leaseSlot!==null||queued.startedAt!==null||
          queued.lastHeartbeatAt!==null||queued.executorSessionKey!==null||queued.completedAt!==null||
          queued.commitStartedAt!==null||queued.resultEnvelopeJson!==null||queued.resultContentHash!==null||
          queued.projectionApplied||queued.cancelRequestedAt!==null||queued.cancelReason!==null||queued.terminalReason!==null||
          !queued.triggerRequestId?.trim()||
          !queued.deadlineAt||queued.deadlineAt<=now||
          rows.some(row=>row.attemptId!==queued.attemptId&&(['QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING'].includes(row.status)||
            row.idempotencyKey===queued.idempotencyKey||row.actionType===queued.actionType&&row.attemptNo>=queued.attemptNo)))throw conflict();
      const task=parseTaskEnvelope(String(queued.taskEnvelopeJson));
      const model=readStoredExecutionModel(queued.executionModelJson);
      const request=readInitialAnalysisRequestInput(task);
      const prepared=request?null:parseJobAidProblemTask(task);
      const originalParseRunId=request?.originalParseRunId??prepared?.modelInput.documentOverview.original?.binding.parseRunId;
      if(task.modelInput.executionMode!=='AILY_AGENT_V1'||!model||task.executionModel?.modelRef!==model.modelRef||
          !['aily/glm-5.3','aily/deepseek-v4-pro'].includes(model.modelRef)||
          canonicalJson(task.executionModel)!==canonicalJson(model)||task.actionAttemptId!==queued.attemptId||
          task.operationRef!==queued.operationRef||task.tenantId!==owner.tenantId||task.workItemId!==owner.workItemId||
          task.documentVersionId!==owner.documentVersionId||task.taskType!==queued.actionType||
          task.baseRevision!==owner.revision||task.inputRevision!==owner.revision||task.inputHash!==queued.taskInputHash||
          task.deadline!==queued.deadlineAt.toISOString()||task.idempotencyKey!==
            `openclaw-v2:dynamic:${owner.workItemId}:${owner.documentVersionId}:${input.stageRequestId}`||
          !task.sourceRefs.some(source=>source.ref===owner.sourceArtifactId&&source.sha256===owner.sourceFileSha256)||
          !originalParseRunId||request&&request.requestId!==input.stageRequestId||
          prepared&&(prepared.actorUserId!==owner.requestedByUserId||prepared.executionMode!=='AILY_AGENT_V1'))throw conflict();
      const [run]=await database.execute<{value:unknown}>(sql`SELECT executor_run_json AS value FROM action_attempt
        WHERE attempt_id=${queued.attemptId} AND tenant_id=${owner.tenantId} AND work_item_id=${owner.workItemId}`);
      if(!run||run.value!==null)throw conflict();
      const fresh=async()=>{
        const source=await new MiaodaDocumentVersionSourceResolver(database).resolve(owner.documentVersionId,
          {requireCurrent:true,expectedCreatorUserId:input.actorUserId});
        if(source.version.documentId!==owner.documentId||source.version.sourceArtifactId!==owner.sourceArtifactId||
            source.version.pdfSha256!==owner.sourceFileSha256||Number(source.version.byteLength)!==Number(owner.sourceByteLength))throw conflict();
        await input.authorize(database,[owner]);
      };
      await fresh();
      // These cases mint no new authority. The ordinary strict claim remains
      // responsible for consuming an untouched grant or the existing own lease.
      if(grant.status==='WAITING'&&grant.leaseGeneration===0&&grant.leaseOwner===null&&grant.leaseToken===null&&
          grant.leaseExpiresAt===null&&request)return {status:'UNCHANGED' as const,leaseGeneration:0};
      if(grant.status==='LEASED'&&grant.leaseOwner===input.principalId&&grant.leaseToken&&
          Number.isSafeInteger(grant.leaseGeneration)&&grant.leaseGeneration>0&&grant.leaseExpiresAt&&grant.leaseExpiresAt>now) {
        const bound=prepared&&taskAutomaticWorkItemLease(queued);
        if(prepared&&(!bound||bound.requestId!==owner.requestId||bound.leaseGeneration!==grant.leaseGeneration))throw conflict();
        return {status:'UNCHANGED' as const,leaseGeneration:grant.leaseGeneration};
      }
      if(!request||grant.status!=='LEASED'||!grant.leaseOwner?.trim()||!grant.leaseToken||
          grant.leaseToken===input.leaseToken||!Number.isSafeInteger(grant.leaseGeneration)||grant.leaseGeneration<1||
          grant.leaseGeneration>=2147483647||!grant.leaseExpiresAt||grant.leaseExpiresAt>now||
          !Number.isFinite(grant.leaseExpiresAt.getTime())||grant.completedAt!==null||grant.completedLeaseGeneration!==null||
          grant.completedLeaseTokenHash!==null||grant.blockedAt!==null||grant.blockedCode!==null||
          grant.blockedLeaseGeneration!==null||grant.blockedLeaseTokenHash!==null)throw conflict();
      const [original]=await database.select({id:dmDocumentParseRun.parseRunId}).from(dmDocumentParseRun).where(and(
        eq(dmDocumentParseRun.tenantId,owner.tenantId),eq(dmDocumentParseRun.documentVersionId,owner.documentVersionId),
        eq(dmDocumentParseRun.status,'PUBLISHED'))).orderBy(desc(dmDocumentParseRun.parseRevision)).limit(1);
      if(original?.id!==originalParseRunId)throw conflict();
      await this.assertAilyInitialSuccessorHistory(database,input,owner,rows.filter(row=>row.attemptId!==queued.attemptId),now);
      const previousGeneration=grant.leaseGeneration;
      await fresh();
      const [updated]=await database.update(autoWorkItemAuthorization).set({leaseOwner:input.principalId,leaseToken:input.leaseToken,
        leaseGeneration:sql`${autoWorkItemAuthorization.leaseGeneration}+1`,
        leaseExpiresAt:sql`clock_timestamp()+(${input.leaseMs}*interval '1 millisecond')`,updatedAt:sql`clock_timestamp()`})
        .where(and(eq(autoWorkItemAuthorization.tenantId,owner.tenantId),eq(autoWorkItemAuthorization.workItemId,owner.workItemId),
          eq(autoWorkItemAuthorization.status,'LEASED'),eq(autoWorkItemAuthorization.leaseGeneration,grant.leaseGeneration),
          eq(autoWorkItemAuthorization.leaseOwner,grant.leaseOwner),eq(autoWorkItemAuthorization.leaseToken,grant.leaseToken),
          sql`${autoWorkItemAuthorization.leaseExpiresAt}<=clock_timestamp()`,
          sql`EXISTS(SELECT 1 FROM work_item wi WHERE wi.tenant_id=${owner.tenantId} AND wi.work_item_id=${owner.workItemId}
            AND wi.requested_by_user_id=${input.actorUserId} AND wi.request_id=${owner.requestId} AND wi.revision=${owner.revision}
            AND wi.document_id=${owner.documentId} AND wi.document_version_id=${owner.documentVersionId}
            AND wi.source_artifact_id=${owner.sourceArtifactId} AND wi.source_file_sha256=${owner.sourceFileSha256}
            AND wi.source_byte_length=${owner.sourceByteLength} AND wi.projection_json=${owner.projectionJson})`,
          sql`EXISTS(SELECT 1 FROM action_attempt a WHERE a.tenant_id=${owner.tenantId} AND a.work_item_id=${owner.workItemId}
            AND a.attempt_id=${queued.attemptId} AND a.operation_ref=${queued.operationRef} AND a.idempotency_key=${queued.idempotencyKey}
            AND a.task_input_hash=${queued.taskInputHash} AND a.actor_user_id=${input.actorUserId}
            AND a.base_revision=${owner.revision} AND a.input_revision=${owner.revision} AND a.document_version_id=${owner.documentVersionId}
            AND a.status='QUEUED' AND a.claim_count=0 AND a.retry_count=0 AND a.lease_generation=0
            AND a.lease_owner IS NULL AND a.lease_token IS NULL AND a.lease_expires_at IS NULL AND a.lease_slot IS NULL
            AND a.started_at IS NULL AND a.last_heartbeat_at IS NULL AND a.completed_at IS NULL AND a.commit_started_at IS NULL
            AND a.result_envelope_json IS NULL AND a.result_content_hash IS NULL AND a.projection_applied=false
            AND a.cancel_requested_at IS NULL AND a.cancel_reason IS NULL AND a.executor_session_key IS NULL
            AND a.executor_run_json IS NULL AND a.deadline_at>clock_timestamp()
            AND a.task_envelope_json::jsonb#>>'{modelInput,originalParseRunId}'=${originalParseRunId})`,
          sql`${originalParseRunId}=(SELECT ${dmDocumentParseRun.parseRunId} FROM ${dmDocumentParseRun}
            WHERE ${dmDocumentParseRun.tenantId}=${owner.tenantId} AND ${dmDocumentParseRun.documentVersionId}=${owner.documentVersionId}
              AND ${dmDocumentParseRun.status}='PUBLISHED' ORDER BY ${dmDocumentParseRun.parseRevision} DESC LIMIT 1)`,
          sql`NOT EXISTS(SELECT 1 FROM action_attempt active WHERE active.tenant_id=${owner.tenantId} AND active.work_item_id=${owner.workItemId}
            AND active.attempt_id<>${queued.attemptId} AND active.action_type IN
              ('OPENCLAW_TRANSLATE','OPENCLAW_APPLICABILITY_EVALUATION','OPENCLAW_DYNAMIC_EVALUATION','OPENCLAW_OVERALL_SYNTHESIS')
            AND active.status IN ('QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING'))`))
        .returning({leaseGeneration:autoWorkItemAuthorization.leaseGeneration});
      if(!updated||updated.leaseGeneration!==previousGeneration+1)throw conflict();
      await fresh();
      return {status:'AUTHORIZED' as const,leaseGeneration:updated.leaseGeneration};
    });
  }

  private async assertAilyInitialSuccessorHistory(database:PostgresJsDatabase,input:AilyInitialSuccessorAuthorizationInput,
    owner:typeof workItem.$inferSelect,history:readonly (typeof actionAttempt.$inferSelect)[],now:Date):Promise<void> {
    const conflict=()=>canonicalModelError('AILY_INITIAL_SUCCESSOR_HISTORY_PROTECTED',409);
    const controls=new InitialExpiredAttemptRepository(database);
    // Same existing owner SELECT-policy proof, now covering the whole WI so an
    // orphan/other attempt's SAVE cannot disappear behind the selected history.
    const [coverage]=await database.execute<{covered:boolean;hasSavedWork:boolean}>(sql`
      SELECT current_setting('app.user_id',true)=${input.actorUserId}
        AND engineering_matter_actor_has_tenant(${owner.tenantId})
        AND engineering_matter_work_item_owned_by_actor(${owner.tenantId},${owner.workItemId}) AS covered,
        EXISTS(SELECT 1 FROM ${assessmentWorkRevision} r WHERE r.tenant_id=${owner.tenantId}
          AND r.work_item_id=${owner.workItemId}) AS "hasSavedWork"`);
    if(coverage?.covered!==true||coverage.hasSavedWork!==false)throw conflict();
    for(const row of history) {
      if(row.actionType!=='OPENCLAW_DYNAMIC_EVALUATION'||!['TIMED_OUT','FAILED'].includes(row.status)||
          !row.completedAt||row.completedAt>now||row.leaseOwner!==null||row.leaseToken!==null||row.leaseExpiresAt!==null||
          row.leaseSlot!==null||row.commitStartedAt!==null||row.projectionApplied||row.cancelRequestedAt!==null||row.cancelReason!==null||
          !matchesFailedAttempt(row,owner,now))throw conflict();
      const task=parseTaskEnvelope(String(row.taskEnvelopeJson));
      const sources:unknown=task.modelInput.sourceBindings;
      if(!Array.isArray(sources)||sources.length!==1)throw conflict();
      const binding:unknown=sources[0];
      if(!binding||typeof binding!=='object'||Array.isArray(binding)||!('workItemId'in binding)||binding.workItemId!==owner.workItemId||
          !('documentVersionId'in binding)||binding.documentVersionId!==owner.documentVersionId||!('artifactRef'in binding)||
          binding.artifactRef!==owner.sourceArtifactId||!('artifactSha256'in binding)||typeof binding.artifactSha256!=='string'||
          canonicalHostBareSha256(binding.artifactSha256)!==owner.sourceFileSha256)throw conflict();
      let records:unknown;
      try{records=JSON.parse(row.reviewActivityJson??'[]');}catch{throw conflict();}
      if(!Array.isArray(records))throw conflict();
      for(let offset=0;offset<records.length;offset+=JOBAID_ACTIVITY_WINDOW) {
        const portion:unknown[]=records.slice(offset,offset+JOBAID_ACTIVITY_WINDOW);
        const activity=projectJobAidActivity({attemptId:row.attemptId,attemptRef:row.operationRef,status:row.status,activityJson:JSON.stringify(portion)},[]);
        if(activity.error||activity.unknownRecordCount||activity.malformedRecordCount||portion.some(value=>!value||typeof value!=='object'||
            Array.isArray(value)||!('observedAt'in value)||typeof value.observedAt!=='string'||!Number.isFinite(Date.parse(value.observedAt))||
            !('kind'in value)||['ASSESSMENT_WORK_READ','AILY_STAGE_OVERALL'].includes(String(value.kind))||
            value.kind==='ASSESSMENT_SOURCES_READ'&&!isReviewAssessmentReadActivity(value)))throw conflict();
      }
      const projected=input.workItem.integratedAssessment;
      if(projected?.baseRules?.actionAttemptId===row.attemptId||projected?.overallSynthesis?.actionAttemptId===row.attemptId||
          projected?.overallSynthesis?.sourceAssessment?.actionAttemptId===row.attemptId)throw conflict();
      if(task.modelInput.executionMode==='AILY_AGENT_V1') {
        const run=await new ActionAttemptRepository(database).readAilyExecutorRun({tenantId:owner.tenantId,workItemId:owner.workItemId,attemptId:row.attemptId});
        if(run&&(run.pending||run.scope.intakeRequestId!==owner.requestId||run.leaseGeneration!==row.leaseGeneration))throw conflict();
      }
      const facts=await controls.read({tenantId:owner.tenantId,actorUserId:input.actorUserId,workItemId:owner.workItemId},
        {attemptId:row.attemptId,attemptRef:row.operationRef!},async(tx,owners)=>{
          if(owners.length!==1||!matchesInitialContinuationOwner(owners[0],input))throw conflict();
          await input.authorize(tx,owners);
        });
      if(facts.savedWorks.length||row.status==='TIMED_OUT'&&facts.reconciliation!=='ALREADY_TIMED_OUT')throw conflict();
      // coverage.otherActive includes the exact new QUEUED intent. Every other
      // active row was independently rejected from the full locked collection.
    }
  }

  async claimAutoProcessingCandidate(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
    actorUserId: string;
    documentId: string;
    documentVersionId: string;
    sourceArtifactId: string;
    sourceFileSha256: string;
    sourceByteLength: number;
    expectedWorkItemRevision: number;
    leaseOwner: string;
    leaseToken: string;
    now: Date;
    leaseExpiresAt: Date;
    preserveExecutorOwnership?: boolean;
    /** Enterprise admission never takes over an expired or foreign executor. */
    ailyWaitingOnly?: boolean;
    assertCommittingRecoveryAuthorized?: (row: import('../action-attempt/action-attempt.types').ActionAttemptRow, database: PostgresJsDatabase) => Promise<void>;
  }): Promise<AutoWorkItemLease | null> {
    return this.db.transaction(async (database) => {
      // SAVE/CAS and queue takeover share WorkItem -> grant -> attempt order.
      const [owner] = await database.select().from(workItem)
        .where(and(eq(workItem.tenantId, input.tenantId), eq(workItem.workItemId, input.workItemId)))
        .limit(1).for('update');
      if (!owner || owner.revision !== input.expectedWorkItemRevision) return null;
      const [grant] = await database.select().from(autoWorkItemAuthorization)
        .where(and(eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          eq(autoWorkItemAuthorization.workItemId, input.workItemId)))
        .limit(1).for('update');
      if (!grant || (grant.status !== 'WAITING' &&
          !(grant.status === 'LEASED' && grant.leaseExpiresAt && grant.leaseExpiresAt <= input.now))) return null;
      if (input.ailyWaitingOnly) {
        if (grant.status !== 'WAITING' || grant.leaseGeneration !== 0 || grant.leaseOwner || grant.leaseToken || grant.leaseExpiresAt) return null;
        const active = await database.select().from(actionAttempt).where(and(
          eq(actionAttempt.tenantId,input.tenantId),eq(actionAttempt.workItemId,input.workItemId),
          inArray(actionAttempt.status,['QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING']),
        )).for('update');
        if (active.some(row => row.status !== 'QUEUED' || row.leaseOwner || row.leaseToken ||
            parseTaskEnvelope(row.taskEnvelopeJson).modelInput.executionMode !== 'AILY_AGENT_V1')) return null;
      }
      const browserContinuation = input.preserveExecutorOwnership && grant.status === 'WAITING' && grant.leaseGeneration > 0
        ? await readBrowserInitialContinuationClaim(database,owner,grant,input) : null;
      if (input.preserveExecutorOwnership && !browserContinuation && !(
        (grant.status === 'WAITING' && grant.leaseOwner === null && grant.leaseGeneration === 0) ||
        (grant.status === 'LEASED' && grant.leaseOwner === input.leaseOwner)
      )) {
        // Reject legacy adoption while both rows are locked, before any attempt
        // can be terminalized or an expired lease can be transferred.
        throw canonicalModelError('CANONICAL_CODEX_LEGACY_WORK_NOT_ADOPTABLE', 409);
      }
      if (input.preserveExecutorOwnership && grant.status === 'WAITING' && !browserContinuation) {
        // An untouched queue grant may still have work from the former static
        // scope. Inspect history under the same locks before any takeover can
        // terminalize an expired attempt. Parsing belongs to a different flow.
        const [priorExecution] = await database.select({ attemptId: actionAttempt.attemptId })
          .from(actionAttempt).where(and(
            eq(actionAttempt.tenantId, input.tenantId),
            eq(actionAttempt.workItemId, input.workItemId),
            inArray(actionAttempt.actionType, ['OPENCLAW_TRANSLATE', 'OPENCLAW_APPLICABILITY_EVALUATION',
              'OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS']),
            or(gt(actionAttempt.claimCount, 0), gt(actionAttempt.leaseGeneration, 0),
              ne(actionAttempt.status, 'QUEUED')),
          )).limit(1).for('update');
        if (priorExecution)
          throw canonicalModelError('CANONICAL_CODEX_LEGACY_WORK_NOT_ADOPTABLE', 409);
      }
      const attempts = new ActionAttemptRepository(database);
      for (const actionType of input.ailyWaitingOnly ? [] : ['OPENCLAW_TRANSLATE', 'OPENCLAW_APPLICABILITY_EVALUATION',
        'OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS']) {
        await attempts.terminalizeExpiredActiveForSuccessor({tenantId:input.tenantId,
          workItemId:input.workItemId,actionType,now:input.now});
      }
      // A live worker retains ownership. A departed COMMITTING worker may
      // resume only its exact immutable result under the original owner/fences.
      const [active] = await database.select().from(actionAttempt)
        .where(and(eq(actionAttempt.tenantId,input.tenantId),eq(actionAttempt.workItemId,input.workItemId),
          inArray(actionAttempt.status,['RUNNING','COMMITTING']))).limit(1).for('update');
      if (active) {
        if (active.status !== 'COMMITTING' || !active.leaseExpiresAt || active.leaseExpiresAt > input.now ||
            active.leaseOwner !== input.leaseOwner ||
            grant.leaseOwner !== input.leaseOwner || !grant.leaseToken ||
            grant.requestId !== input.requestId || grant.actorUserId !== input.actorUserId ||
            grant.documentId !== input.documentId || grant.documentVersionId !== input.documentVersionId ||
            grant.sourceArtifactId !== input.sourceArtifactId || grant.sourceFileSha256 !== input.sourceFileSha256 ||
            Number(grant.sourceByteLength) !== input.sourceByteLength ||
            !active.taskEnvelopeJson || !active.resultEnvelopeJson || !active.resultContentHash ||
            active.cancelRequestedAt || !active.commitStartedAt || !active.leaseToken) return null;
        let committedProjection=false;
        try {
          const task=parseTaskEnvelope(active.taskEnvelopeJson);
          const result=parseStoredResultEnvelope({value:active.resultEnvelopeJson,task});
          const binding=taskAutomaticWorkItemLease(active);
          if (!binding || binding.requestId !== grant.requestId || binding.leaseGeneration !== grant.leaseGeneration ||
              task.actionAttemptId !== active.attemptId || task.operationRef !== active.operationRef ||
              task.inputHash !== active.taskInputHash || task.tenantId !== input.tenantId ||
              task.workItemId !== input.workItemId || task.documentVersionId !== input.documentVersionId ||
              result.contentHash !== active.resultContentHash || result.status !== 'SUCCEEDED') return null;
          const projection=JSON.parse(owner.projectionJson ?? 'null') as CanonicalWorkItemProjection | null;
          const saved=active.actionType === 'OPENCLAW_DYNAMIC_EVALUATION' ? projection?.integratedAssessment?.baseRules :
            active.actionType === 'OPENCLAW_OVERALL_SYNTHESIS' ? projection?.integratedAssessment?.overallSynthesis : null;
          const output:unknown=JSON.parse(result.modelOutput ?? 'null');
          const savedWorkRef=saved && 'workRevisionRef' in saved ? saved.workRevisionRef :
            saved && 'basedOnJobAidWorkRevisionRef' in saved ? saved.basedOnJobAidWorkRevisionRef : null;
          committedProjection=!!saved && saved.actionAttemptId===active.attemptId &&
            projection?.source.documentVersionId===task.documentVersionId && owner.revision===task.baseRevision+1 &&
            !!output && typeof output==='object' && 'workRevisionRef' in output && output.workRevisionRef===savedWorkRef;
        } catch { return null; }
        if (!input.assertCommittingRecoveryAuthorized) return null;
        await input.assertCommittingRecoveryAuthorized(active,database);
        if (committedProjection) {
          // This is Host reconciliation of an already committed exact result,
          // not a departed worker releasing a successor's execution slot.
          await database.update(actionAttempt).set({status:'SUCCEEDED',projectionApplied:true,
            terminalReason:'COMMIT_RECONCILED_FROM_PROJECTION',completedAt:input.now,updatedAt:input.now,
            leaseOwner:null,leaseToken:null,leaseExpiresAt:null,leaseSlot:null})
            .where(and(eq(actionAttempt.attemptId,active.attemptId),eq(actionAttempt.status,'COMMITTING'),
              eq(actionAttempt.resultContentHash,active.resultContentHash)));
        } else {
        const recoveryExpiresAt=new Date(input.now.getTime()+ACTION_ATTEMPT_COMMIT_RECOVERY_MS);
        await database.update(actionAttempt).set({leaseExpiresAt:recoveryExpiresAt,updatedAt:input.now})
          .where(and(eq(actionAttempt.attemptId,active.attemptId),eq(actionAttempt.status,'COMMITTING'),
            eq(actionAttempt.resultContentHash,active.resultContentHash)));
        await database.update(autoWorkItemAuthorization).set({leaseExpiresAt:recoveryExpiresAt,updatedAt:input.now})
          .where(and(eq(autoWorkItemAuthorization.tenantId,input.tenantId),eq(autoWorkItemAuthorization.workItemId,input.workItemId)));
        return {leaseGeneration:grant.leaseGeneration,leaseToken:grant.leaseToken,leaseExpiresAt:recoveryExpiresAt};
        }
      }
    const [claimed] = await database
      .update(autoWorkItemAuthorization)
      .set({
        status: 'LEASED',
        leaseOwner: input.leaseOwner,
        leaseToken: input.leaseToken,
        leaseGeneration: sql`${autoWorkItemAuthorization.leaseGeneration} + 1`,
        leaseExpiresAt: input.leaseExpiresAt,
        blockedCode: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          eq(autoWorkItemAuthorization.workItemId, input.workItemId),
          eq(autoWorkItemAuthorization.requestId, input.requestId),
          eq(autoWorkItemAuthorization.actorUserId, input.actorUserId),
          eq(autoWorkItemAuthorization.documentId, input.documentId),
          eq(
            autoWorkItemAuthorization.documentVersionId,
            input.documentVersionId,
          ),
          eq(
            autoWorkItemAuthorization.sourceArtifactId,
            input.sourceArtifactId,
          ),
          eq(
            autoWorkItemAuthorization.sourceFileSha256,
            input.sourceFileSha256,
          ),
          eq(
            autoWorkItemAuthorization.sourceByteLength,
            input.sourceByteLength,
          ),
          input.ailyWaitingOnly ? eq(autoWorkItemAuthorization.status, 'WAITING') : or(
            eq(autoWorkItemAuthorization.status, 'WAITING'),
            and(
              eq(autoWorkItemAuthorization.status, 'LEASED'),
              lt(autoWorkItemAuthorization.leaseExpiresAt, input.now),
            ),
          ),
          sql`EXISTS (
            SELECT 1 FROM work_item wi
            WHERE wi.tenant_id = ${input.tenantId}
              AND wi.work_item_id = ${input.workItemId}
              AND wi.request_id = ${input.requestId}
              AND wi.requested_by_user_id = ${input.actorUserId}
              AND wi.document_id = ${input.documentId}
              AND wi.document_version_id = ${input.documentVersionId}
              AND wi.source_artifact_id = ${input.sourceArtifactId}
              AND wi.source_file_sha256 = ${input.sourceFileSha256}
              AND wi.source_byte_length = ${input.sourceByteLength}
              AND wi.action_type = 'PARSE_PDF'
              AND wi.status = 'CANDIDATE_READBACK_VERIFIED'
              AND wi.package_id IS NOT NULL
              AND wi.revision = ${input.expectedWorkItemRevision}
          )`,
        ),
      )
      .returning({
        leaseGeneration: autoWorkItemAuthorization.leaseGeneration,
        leaseToken: autoWorkItemAuthorization.leaseToken,
      });
    if (!claimed?.leaseToken) return null;
    return {
      leaseGeneration: claimed.leaseGeneration,
      leaseToken: claimed.leaseToken,
    };
    });
  }

  /** Service-readable grant discovery only. WorkItem and parse rows are rechecked under its actor. */
  async listActiveLocalWorkerDelegations(input: {
    tenantId: string;
    principalId: string;
    documentVersionId?: string;
    limit?: number;
  }) {
    return this.db
      .select()
      .from(autoWorkItemAuthorization)
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          eq(
            autoWorkItemAuthorization.grantKind,
            'MIAODA_CANONICAL_PARSE_REQUEST',
          ),
          eq(autoWorkItemAuthorization.status, 'LEASED'),
          eq(autoWorkItemAuthorization.leaseOwner, input.principalId),
          gt(autoWorkItemAuthorization.leaseExpiresAt, new Date()),
          ...(input.documentVersionId
            ? [
                eq(
                  autoWorkItemAuthorization.documentVersionId,
                  input.documentVersionId,
                ),
              ]
            : []),
        ),
      )
      .orderBy(autoWorkItemAuthorization.createdAt)
      .limit(Math.min(Math.max(input.limit ?? 50, 1), 100));
  }

  /** Discovery seed for a browser-admitted parse only. A completed WorkItem grant
   * does not authorize a new automatic execution or revive its old lease. */
  async listCompletedLocalWorkerDiscovery(input: {
    tenantId: string; documentVersionId?: string; beforeWorkItemId?: string; limit?: number;
  }) {
    return this.db.select().from(autoWorkItemAuthorization).where(and(
        eq(autoWorkItemAuthorization.tenantId, input.tenantId),
        eq(autoWorkItemAuthorization.grantKind, 'MIAODA_CANONICAL_PARSE_REQUEST'),
        eq(autoWorkItemAuthorization.status, 'COMPLETED'),
        isNotNull(autoWorkItemAuthorization.completedAt),
        ...(input.documentVersionId ? [eq(autoWorkItemAuthorization.documentVersionId, input.documentVersionId)] : []),
        ...(input.beforeWorkItemId ? [lt(autoWorkItemAuthorization.workItemId, input.beforeWorkItemId)] : []),
      )).orderBy(desc(autoWorkItemAuthorization.workItemId)).limit(Math.min(Math.max(input.limit ?? 50, 1), 100));
  }

  /** Recheck the WorkItem join only after entering the actor's ordinary RLS scope. */
  async loadCompletedLocalWorkerDiscovery(input: {
    tenantId: string; workItemId: string; actorUserId: string; documentVersionId: string;
  }) {
    const [row] = await this.db.select({ authorization: autoWorkItemAuthorization }).from(autoWorkItemAuthorization)
      .innerJoin(workItem, and(
        eq(workItem.tenantId, autoWorkItemAuthorization.tenantId),
        eq(workItem.workItemId, autoWorkItemAuthorization.workItemId),
        eq(workItem.requestId, autoWorkItemAuthorization.requestId),
        eq(workItem.requestedByUserId, autoWorkItemAuthorization.actorUserId),
        eq(workItem.documentId, autoWorkItemAuthorization.documentId),
        eq(workItem.documentVersionId, autoWorkItemAuthorization.documentVersionId),
        eq(workItem.sourceArtifactId, autoWorkItemAuthorization.sourceArtifactId),
        eq(workItem.sourceFileSha256, autoWorkItemAuthorization.sourceFileSha256),
        eq(workItem.sourceByteLength, autoWorkItemAuthorization.sourceByteLength),
      )).where(and(
        eq(autoWorkItemAuthorization.tenantId, input.tenantId),
        eq(autoWorkItemAuthorization.workItemId, input.workItemId),
        eq(autoWorkItemAuthorization.actorUserId, input.actorUserId),
        eq(autoWorkItemAuthorization.documentVersionId, input.documentVersionId),
        eq(autoWorkItemAuthorization.grantKind, 'MIAODA_CANONICAL_PARSE_REQUEST'),
        eq(autoWorkItemAuthorization.status, 'COMPLETED'),
        isNotNull(autoWorkItemAuthorization.completedAt),
        eq(workItem.actionType, ACTION_TYPE),
        eq(workItem.status, 'CANDIDATE_READBACK_VERIFIED'),
        isNotNull(workItem.packageId),
      )).limit(1);
    return row?.authorization ?? null;
  }

  /** Loads the exact active, service-owned lease that gates downstream tools. */
  async loadActiveAutoProcessingLease(input: {
    tenantId: string;
    workItemId: string;
    leaseOwner: string;
    now: Date;
  }): Promise<AutoWorkItemLeaseBinding | null> {
    const [value] = await this.db
      .select({
        authorization: autoWorkItemAuthorization,
        workItem: {
          tenantId: workItem.tenantId,
          workItemId: workItem.workItemId,
          requestId: workItem.requestId,
          requestedByUserId: workItem.requestedByUserId,
          documentId: workItem.documentId,
          documentVersionId: workItem.documentVersionId,
          sourceArtifactId: workItem.sourceArtifactId,
          sourceFileSha256: workItem.sourceFileSha256,
          sourceByteLength: workItem.sourceByteLength,
          actionType: workItem.actionType,
          status: workItem.status,
          revision: workItem.revision,
          packageId: workItem.packageId,
        },
      })
      .from(autoWorkItemAuthorization)
      .innerJoin(
        workItem,
        and(
          eq(workItem.tenantId, autoWorkItemAuthorization.tenantId),
          eq(workItem.workItemId, autoWorkItemAuthorization.workItemId),
        ),
      )
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          eq(autoWorkItemAuthorization.workItemId, input.workItemId),
          eq(
            autoWorkItemAuthorization.grantKind,
            'MIAODA_CANONICAL_PARSE_REQUEST',
          ),
          eq(autoWorkItemAuthorization.status, 'LEASED'),
          eq(autoWorkItemAuthorization.leaseOwner, input.leaseOwner),
          gt(autoWorkItemAuthorization.leaseExpiresAt, input.now),
          eq(workItem.requestId, autoWorkItemAuthorization.requestId),
          eq(workItem.requestedByUserId, autoWorkItemAuthorization.actorUserId),
          eq(workItem.documentId, autoWorkItemAuthorization.documentId),
          eq(
            workItem.documentVersionId,
            autoWorkItemAuthorization.documentVersionId,
          ),
          eq(
            workItem.sourceArtifactId,
            autoWorkItemAuthorization.sourceArtifactId,
          ),
          eq(
            workItem.sourceFileSha256,
            autoWorkItemAuthorization.sourceFileSha256,
          ),
          eq(
            workItem.sourceByteLength,
            autoWorkItemAuthorization.sourceByteLength,
          ),
          eq(workItem.actionType, ACTION_TYPE),
          eq(workItem.status, 'CANDIDATE_READBACK_VERIFIED'),
          isNotNull(workItem.packageId),
        ),
      )
      .limit(1);
    return value ?? null;
  }

  /** Completes the queue lease with token/generation CAS; replay is idempotent. */
  async acknowledgeAutoProcessingLease(input: {
    tenantId: string;
    workItemId: string;
    leaseOwner: string;
    leaseToken: string;
    leaseGeneration: number;
    expectedWorkItemRevision: number;
    now: Date;
    expectedRequestId?: string;
    assertHostFinal?: (database: PostgresJsDatabase) => Promise<void>;
    writePredicate?: SQL;
  }): Promise<{ acknowledgedAt: Date; replayed: boolean } | null> {
    return this.db.transaction(async (transaction) => {
      // Match SAVE and queue takeover: WorkItem -> grant. Otherwise ACK can
      // hold the grant while its receipt waits on a writer holding WorkItem.
      await transaction
        .select({ workItemId: workItem.workItemId })
        .from(workItem)
        .where(and(
          eq(workItem.tenantId, input.tenantId),
          eq(workItem.workItemId, input.workItemId),
        ))
        .for('update');
      if (input.assertHostFinal) {
        await transaction.select().from(autoWorkItemAuthorization).where(and(
          eq(autoWorkItemAuthorization.tenantId,input.tenantId),eq(autoWorkItemAuthorization.workItemId,input.workItemId),
        )).for('update');
        await input.assertHostFinal(transaction);
      }
      const leaseTokenHash = createHash('sha256')
        .update(input.leaseToken)
        .digest('hex');
      const [updated] = await transaction
        .update(autoWorkItemAuthorization)
        .set({
          status: 'COMPLETED',
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          completedLeaseTokenHash: leaseTokenHash,
          completedLeaseGeneration: input.leaseGeneration,
          completedAt: input.now,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(autoWorkItemAuthorization.tenantId, input.tenantId),
            eq(autoWorkItemAuthorization.workItemId, input.workItemId),
            eq(
              autoWorkItemAuthorization.grantKind,
              'MIAODA_CANONICAL_PARSE_REQUEST',
            ),
            eq(autoWorkItemAuthorization.status, 'LEASED'),
            eq(autoWorkItemAuthorization.leaseOwner, input.leaseOwner),
            eq(autoWorkItemAuthorization.leaseToken, input.leaseToken),
            ...(input.expectedRequestId ? [eq(autoWorkItemAuthorization.requestId,input.expectedRequestId)] : []),
            ...(input.writePredicate ? [input.writePredicate] : []),
            eq(
              autoWorkItemAuthorization.leaseGeneration,
              input.leaseGeneration,
            ),
            input.assertHostFinal ? sql`${autoWorkItemAuthorization.leaseExpiresAt}>clock_timestamp()` : gt(autoWorkItemAuthorization.leaseExpiresAt, input.now),
            sql`EXISTS (
            SELECT 1 FROM work_item wi
            WHERE wi.tenant_id = ${input.tenantId}
              AND wi.work_item_id = ${input.workItemId}
              AND wi.request_id = ${autoWorkItemAuthorization.requestId}
              AND wi.requested_by_user_id = ${autoWorkItemAuthorization.actorUserId}
              AND wi.document_id = ${autoWorkItemAuthorization.documentId}
              AND wi.document_version_id = ${autoWorkItemAuthorization.documentVersionId}
              AND wi.source_artifact_id = ${autoWorkItemAuthorization.sourceArtifactId}
              AND wi.source_file_sha256 = ${autoWorkItemAuthorization.sourceFileSha256}
              AND wi.source_byte_length = ${autoWorkItemAuthorization.sourceByteLength}
              AND wi.action_type = 'PARSE_PDF'
              AND wi.status = 'CANDIDATE_READBACK_VERIFIED'
              AND wi.package_id IS NOT NULL
              AND wi.revision = ${input.expectedWorkItemRevision}
              AND NOT EXISTS (
                SELECT 1 FROM action_attempt aa
                WHERE aa.tenant_id = ${input.tenantId}
                  AND aa.work_item_id = ${input.workItemId}
                  AND aa.document_version_id = ${autoWorkItemAuthorization.documentVersionId}
                  AND aa.request_origin = 'OPENCLAW_MCP_V1'
                  AND aa.action_type IN (
                    'OPENCLAW_TRANSLATE',
                    'OPENCLAW_APPLICABILITY_EVALUATION',
                    'OPENCLAW_DYNAMIC_EVALUATION',
                    'OPENCLAW_OVERALL_SYNTHESIS'
                  )
                  AND aa.status IN (
                    'QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'
                  )
              )
          )`,
          ),
        )
        .returning();
      if (updated?.completedAt) {
        const receipt = {
          tenantId: updated.tenantId,
          workItemId: updated.workItemId,
          requestId: updated.requestId,
          actorUserId: updated.actorUserId,
          documentId: updated.documentId,
          documentVersionId: updated.documentVersionId,
          sourceArtifactId: updated.sourceArtifactId,
          sourceFileSha256: updated.sourceFileSha256,
          sourceByteLength: Number(updated.sourceByteLength),
          completedAt: updated.completedAt.toISOString(),
        };
        const readableReceipt = await transaction
          .update(workItem)
          .set({
            projectionJson: sql`jsonb_set(${workItem.projectionJson}::jsonb, '{autoProcessingCompletionReceipt}', ${JSON.stringify(receipt)}::jsonb)::text`,
          })
          .where(
            and(
              eq(workItem.tenantId, input.tenantId),
              eq(workItem.workItemId, input.workItemId),
              eq(workItem.revision, input.expectedWorkItemRevision),
              isNotNull(workItem.projectionJson),
            ),
          )
          .returning({ workItemId: workItem.workItemId });
        if (readableReceipt.length !== 1)
          throw new Error('AUTO_PROCESSING_COMPLETION_RECEIPT_WRITE_FAILED');
        return { acknowledgedAt: updated.completedAt, replayed: false };
      }

      const [completed] = await transaction
        .select({ completedAt: autoWorkItemAuthorization.completedAt })
        .from(autoWorkItemAuthorization)
        .where(
          and(
            eq(autoWorkItemAuthorization.tenantId, input.tenantId),
            eq(autoWorkItemAuthorization.workItemId, input.workItemId),
            eq(autoWorkItemAuthorization.status, 'COMPLETED'),
            ...(input.writePredicate ? [input.writePredicate] : []),
            eq(
              autoWorkItemAuthorization.completedLeaseTokenHash,
              leaseTokenHash,
            ),
            eq(
              autoWorkItemAuthorization.completedLeaseGeneration,
              input.leaseGeneration,
            ),
          ),
        )
        .limit(1);
      if (!completed?.completedAt) return null;
      return { acknowledgedAt: completed.completedAt, replayed: true };
    });
  }

  async readCompletedAutoProcessingLeaseReceipt(input: {
    tenantId: string;
    workItemId: string;
    leaseToken: string;
    leaseGeneration: number;
  }): Promise<{ acknowledgedAt: Date; replayed: true } | null> {
    const leaseTokenHash = createHash('sha256')
      .update(input.leaseToken)
      .digest('hex');
    const [completed] = await this.db
      .select({ completedAt: autoWorkItemAuthorization.completedAt })
      .from(autoWorkItemAuthorization)
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          eq(autoWorkItemAuthorization.workItemId, input.workItemId),
          eq(autoWorkItemAuthorization.status, 'COMPLETED'),
          eq(autoWorkItemAuthorization.completedLeaseTokenHash, leaseTokenHash),
          eq(
            autoWorkItemAuthorization.completedLeaseGeneration,
            input.leaseGeneration,
          ),
        ),
      )
      .limit(1);
    return completed?.completedAt
      ? { acknowledgedAt: completed.completedAt, replayed: true }
      : null;
  }

  /** Read-only replay after enterprise ACK cleared the original active token. */
  async readCompletedAilyAutoProcessingReceipt(input: {
    tenantId: string; workItemId: string; requestId: string; actorUserId: string; leaseGeneration: number;
    readPredicate: SQL; assertHostFinal: (database: PostgresJsDatabase) => Promise<void>;
  }): Promise<{acknowledgedAt: Date; replayed: true} | null> {
    return this.db.transaction(async database => {
      const [value] = await database.select({grant: autoWorkItemAuthorization, projection: workItem.projectionJson})
        .from(autoWorkItemAuthorization).innerJoin(workItem,and(
          eq(workItem.tenantId,autoWorkItemAuthorization.tenantId),eq(workItem.workItemId,autoWorkItemAuthorization.workItemId)))
        .where(and(eq(autoWorkItemAuthorization.tenantId,input.tenantId),eq(autoWorkItemAuthorization.workItemId,input.workItemId),
          eq(autoWorkItemAuthorization.requestId,input.requestId),eq(autoWorkItemAuthorization.actorUserId,input.actorUserId),
          eq(autoWorkItemAuthorization.status,'COMPLETED'),eq(autoWorkItemAuthorization.grantKind,'MIAODA_CANONICAL_PARSE_REQUEST'),
          eq(autoWorkItemAuthorization.completedLeaseGeneration,input.leaseGeneration),
          eq(workItem.requestId,input.requestId),eq(workItem.requestedByUserId,input.actorUserId),
          eq(workItem.documentId,autoWorkItemAuthorization.documentId),eq(workItem.documentVersionId,autoWorkItemAuthorization.documentVersionId),
          eq(workItem.sourceArtifactId,autoWorkItemAuthorization.sourceArtifactId),eq(workItem.sourceFileSha256,autoWorkItemAuthorization.sourceFileSha256),
          eq(workItem.sourceByteLength,autoWorkItemAuthorization.sourceByteLength),input.readPredicate)).limit(1);
      if (!value?.grant.completedAt || !value.projection) return null;
      const projection = JSON.parse(value.projection) as CanonicalWorkItemProjection;
      const receipt = projection.autoProcessingCompletionReceipt;
      const grant = value.grant;
      if (grant.completedLeaseGeneration !== input.leaseGeneration || grant.requestId !== input.requestId ||
          grant.actorUserId !== input.actorUserId || !receipt || receipt.tenantId !== input.tenantId || receipt.workItemId !== input.workItemId ||
          receipt.requestId !== input.requestId || receipt.actorUserId !== input.actorUserId ||
          receipt.documentId !== grant.documentId || receipt.documentVersionId !== grant.documentVersionId ||
          receipt.sourceArtifactId !== grant.sourceArtifactId || receipt.sourceFileSha256 !== grant.sourceFileSha256 ||
          receipt.sourceByteLength !== Number(grant.sourceByteLength) || receipt.completedAt !== grant.completedAt!.toISOString()) return null;
      await input.assertHostFinal(database);
      return {acknowledgedAt: grant.completedAt!, replayed: true as const};
    });
  }

  /** Explicit cancelled-claim parking uses the shared WI reservation fence. */
  async parkCancelledAutoProcessingLease(input: CancelledAutoProcessingLeaseInput) {
    return parkCancelledAutoProcessingLease(this.db, input);
  }

  /** Blocks only the exact active lease after Host verifies terminal failure. */
  async blockAutoProcessingLease(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
    actorUserId: string;
    documentId: string;
    documentVersionId: string;
    sourceArtifactId: string;
    sourceFileSha256: string;
    sourceByteLength: number;
    expectedWorkItemRevision: number;
    leaseOwner: string;
    leaseToken: string;
    leaseGeneration: number;
    blockedCode: string;
    now: Date;
  }): Promise<{
    blockedAt: Date;
    blockedCode: string;
    replayed: boolean;
  } | null> {
    const leaseTokenHash = createHash('sha256')
      .update(input.leaseToken)
      .digest('hex');
    const [updated] = await this.db
      .update(autoWorkItemAuthorization)
      .set({
        status: 'BLOCKED',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        blockedCode: input.blockedCode,
        blockedLeaseTokenHash: leaseTokenHash,
        blockedLeaseGeneration: input.leaseGeneration,
        blockedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          eq(autoWorkItemAuthorization.workItemId, input.workItemId),
          eq(autoWorkItemAuthorization.requestId, input.requestId),
          eq(autoWorkItemAuthorization.actorUserId, input.actorUserId),
          eq(autoWorkItemAuthorization.documentId, input.documentId),
          eq(
            autoWorkItemAuthorization.documentVersionId,
            input.documentVersionId,
          ),
          eq(
            autoWorkItemAuthorization.sourceArtifactId,
            input.sourceArtifactId,
          ),
          eq(
            autoWorkItemAuthorization.sourceFileSha256,
            input.sourceFileSha256,
          ),
          eq(
            autoWorkItemAuthorization.sourceByteLength,
            input.sourceByteLength,
          ),
          eq(autoWorkItemAuthorization.status, 'LEASED'),
          eq(autoWorkItemAuthorization.leaseOwner, input.leaseOwner),
          eq(autoWorkItemAuthorization.leaseToken, input.leaseToken),
          eq(autoWorkItemAuthorization.leaseGeneration, input.leaseGeneration),
          gt(autoWorkItemAuthorization.leaseExpiresAt, input.now),
          sql`EXISTS (
            SELECT 1 FROM work_item wi
            WHERE wi.tenant_id = ${input.tenantId}
              AND wi.work_item_id = ${input.workItemId}
              AND wi.request_id = ${input.requestId}
              AND wi.requested_by_user_id = ${input.actorUserId}
              AND wi.document_id = ${input.documentId}
              AND wi.document_version_id = ${input.documentVersionId}
              AND wi.source_artifact_id = ${input.sourceArtifactId}
              AND wi.source_file_sha256 = ${input.sourceFileSha256}
              AND wi.source_byte_length = ${input.sourceByteLength}
              AND wi.action_type = 'PARSE_PDF'
              AND wi.status = 'CANDIDATE_READBACK_VERIFIED'
              AND wi.package_id IS NOT NULL
              AND wi.revision = ${input.expectedWorkItemRevision}
              AND NOT EXISTS (
                SELECT 1 FROM action_attempt aa
                WHERE aa.tenant_id = ${input.tenantId}
                  AND aa.work_item_id = ${input.workItemId}
                  AND aa.document_version_id = ${autoWorkItemAuthorization.documentVersionId}
                  AND aa.request_origin = 'OPENCLAW_MCP_V1'
                  AND aa.action_type IN (
                    'OPENCLAW_TRANSLATE',
                    'OPENCLAW_APPLICABILITY_EVALUATION',
                    'OPENCLAW_DYNAMIC_EVALUATION',
                    'OPENCLAW_OVERALL_SYNTHESIS'
                  )
                  AND aa.status IN (
                    'QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'
                  )
              )
          )`,
        ),
      )
      .returning({
        blockedAt: autoWorkItemAuthorization.blockedAt,
        blockedCode: autoWorkItemAuthorization.blockedCode,
      });
    if (updated?.blockedAt && updated.blockedCode) {
      return {
        blockedAt: updated.blockedAt,
        blockedCode: updated.blockedCode,
        replayed: false,
      };
    }

    const [blocked] = await this.db
      .select({
        blockedAt: autoWorkItemAuthorization.blockedAt,
        blockedCode: autoWorkItemAuthorization.blockedCode,
      })
      .from(autoWorkItemAuthorization)
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          eq(autoWorkItemAuthorization.workItemId, input.workItemId),
          eq(autoWorkItemAuthorization.status, 'BLOCKED'),
          eq(autoWorkItemAuthorization.blockedLeaseTokenHash, leaseTokenHash),
          eq(
            autoWorkItemAuthorization.blockedLeaseGeneration,
            input.leaseGeneration,
          ),
        ),
      )
      .limit(1);
    if (!blocked?.blockedAt || !blocked.blockedCode) return null;
    return {
      blockedAt: blocked.blockedAt,
      blockedCode: blocked.blockedCode,
      replayed: true,
    };
  }

  async readBlockedAutoProcessingLeaseReceipt(input: {
    tenantId: string;
    workItemId: string;
    leaseToken: string;
    leaseGeneration: number;
    sourceBinding?: AutoWorkItemBlockedSourceBinding;
  }): Promise<{ blockedAt: Date; blockedCode: string; sourceBinding: AutoWorkItemBlockedSourceBinding } | null> {
    const leaseTokenHash = createHash('sha256')
      .update(input.leaseToken)
      .digest('hex');
    const [blocked] = await this.db
      .select({
        blockedAt: autoWorkItemAuthorization.blockedAt,
        blockedCode: autoWorkItemAuthorization.blockedCode,
        sourceBinding: {
          workItemId: autoWorkItemAuthorization.workItemId,
          requestId: autoWorkItemAuthorization.requestId,
          actorUserId: autoWorkItemAuthorization.actorUserId,
          documentId: autoWorkItemAuthorization.documentId,
          documentVersionId: autoWorkItemAuthorization.documentVersionId,
          sourceArtifactId: autoWorkItemAuthorization.sourceArtifactId,
          sourceFileSha256: autoWorkItemAuthorization.sourceFileSha256,
          sourceByteLength: autoWorkItemAuthorization.sourceByteLength,
        },
      })
      .from(autoWorkItemAuthorization)
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          eq(autoWorkItemAuthorization.workItemId, input.workItemId),
          eq(autoWorkItemAuthorization.status, 'BLOCKED'),
          eq(autoWorkItemAuthorization.blockedLeaseTokenHash, leaseTokenHash),
          eq(
            autoWorkItemAuthorization.blockedLeaseGeneration,
            input.leaseGeneration,
          ),
          ...(input.sourceBinding ? [and(
            eq(autoWorkItemAuthorization.grantKind, 'MIAODA_CANONICAL_PARSE_REQUEST'),
            eq(autoWorkItemAuthorization.leaseGeneration, input.leaseGeneration),
            eq(autoWorkItemAuthorization.workItemId, input.sourceBinding.workItemId),
            eq(autoWorkItemAuthorization.requestId, input.sourceBinding.requestId),
            eq(autoWorkItemAuthorization.actorUserId, input.sourceBinding.actorUserId),
            eq(autoWorkItemAuthorization.documentId, input.sourceBinding.documentId),
            eq(autoWorkItemAuthorization.documentVersionId, input.sourceBinding.documentVersionId),
            eq(autoWorkItemAuthorization.sourceArtifactId, input.sourceBinding.sourceArtifactId),
            eq(autoWorkItemAuthorization.sourceFileSha256, input.sourceBinding.sourceFileSha256),
            eq(autoWorkItemAuthorization.sourceByteLength, input.sourceBinding.sourceByteLength),
            // The same official actor mapping required by JobAid SAVE must
            // still authorize this receipt; tenant document read is broader.
            sql`EXISTS (SELECT 1 FROM identity_subject_mapping actor_mapping
              WHERE actor_mapping.miaoda_user_id=${input.sourceBinding.actorUserId}
                AND actor_mapping.miaoda_tenant_id=${input.tenantId}
                AND actor_mapping.expected_client_id='cli_aadde8b579f95bc9'
                AND actor_mapping.status='ACTIVE')`,
            // The original grant tuple, never a tuple reconstructed from a
            // newer source, must still describe the current WI and projection.
            sql`EXISTS (SELECT 1 FROM work_item wi
              WHERE wi.tenant_id=${input.tenantId} AND wi.work_item_id=${input.sourceBinding.workItemId}
                AND wi.request_id=${input.sourceBinding.requestId}
                AND wi.requested_by_user_id=${input.sourceBinding.actorUserId}
                AND wi.document_id=${input.sourceBinding.documentId}
                AND wi.document_version_id=${input.sourceBinding.documentVersionId}
                AND wi.source_artifact_id=${input.sourceBinding.sourceArtifactId}
                AND wi.source_file_sha256=${input.sourceBinding.sourceFileSha256}
                AND wi.source_byte_length=${input.sourceBinding.sourceByteLength}
                AND wi.action_type='PARSE_PDF' AND wi.status='CANDIDATE_READBACK_VERIFIED'
                AND wi.package_id IS NOT NULL
                AND wi.projection_json::jsonb->>'workItemId'=${input.sourceBinding.workItemId}
                AND wi.projection_json::jsonb->>'requestId'=${input.sourceBinding.requestId}
                AND wi.projection_json::jsonb->'source'->>'documentId'=${input.sourceBinding.documentId}
                AND wi.projection_json::jsonb->'source'->>'documentVersionId'=${input.sourceBinding.documentVersionId}
                AND wi.projection_json::jsonb->'source'->>'sourceArtifactId'=${input.sourceBinding.sourceArtifactId}
                AND wi.projection_json::jsonb->'source'->>'sourceFileSha256' IN
                  (${input.sourceBinding.sourceFileSha256}, ${`sha256:${input.sourceBinding.sourceFileSha256}`})
                AND wi.projection_json::jsonb->'source'->>'sourceByteLength'=${String(input.sourceBinding.sourceByteLength)})`,
          )] : []),
        ),
      )
      .limit(1);
    return blocked?.blockedAt && blocked.blockedCode
      ? { blockedAt: blocked.blockedAt, blockedCode: blocked.blockedCode, sourceBinding: blocked.sourceBinding }
      : null;
  }

  /** Excludes one authorization whose current Host binding no longer matches. */
  async blockAutoProcessingCandidate(input: {
    tenantId: string;
    workItemId: string;
    requestId: string;
    actorUserId: string;
    blockedCode: string;
    now: Date;
  }): Promise<void> {
    await this.db
      .update(autoWorkItemAuthorization)
      .set({
        status: 'BLOCKED',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        blockedCode: normalizeAutoProcessingBlockCode(input.blockedCode),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, input.tenantId),
          eq(autoWorkItemAuthorization.workItemId, input.workItemId),
          eq(autoWorkItemAuthorization.requestId, input.requestId),
          eq(autoWorkItemAuthorization.actorUserId, input.actorUserId),
          or(
            eq(autoWorkItemAuthorization.status, 'WAITING'),
            and(
              eq(autoWorkItemAuthorization.status, 'LEASED'),
              lt(autoWorkItemAuthorization.leaseExpiresAt, input.now),
            ),
          ),
        ),
      );
  }

  async reopenRetryableParseFailure(
    input: WorkItemReservationInput & {
      workItemId: string;
      requestId: string;
      authorization?: CanonicalParseAuthorizationProjection;
    },
  ): Promise<ParseRetryReservation | null> {
    return this.db.transaction(async (transaction) => {
      const [stored] = await transaction
        .select()
        .from(workItem)
        .where(eq(workItem.workItemId, input.workItemId))
        .limit(1);
      if (!stored) throw new Error('WORK_ITEM_NOT_FOUND');
      assertRetryIdentity(stored, input);

      const projection = parseProjection(stored.projectionJson);
      const [latestAttempt] = await transaction
        .select()
        .from(actionAttempt)
        .where(
          and(
            eq(actionAttempt.workItemId, stored.workItemId),
            eq(actionAttempt.actionType, ACTION_TYPE),
          ),
        )
        .orderBy(desc(actionAttempt.attemptNo))
        .limit(1);
      if (!latestAttempt) throw new Error('ACTION_ATTEMPT_READBACK_FAILED');

      if (projection?.phase === 'PARSE_REQUESTED') {
        if (
          !input.authorization ||
          latestAttempt.attemptNo < 2 ||
          latestAttempt.status !== 'PENDING' ||
          latestAttempt.startedAt !== null ||
          latestAttempt.completedAt !== null ||
          latestAttempt.errorCode !== null
        ) {
          return null;
        }
        const rebound = withRetryAuthorization(
          projection,
          input.authorization,
          true,
        );
        if (rebound !== projection) {
          const updated = await transaction
            .update(workItem)
            .set({
              projectionJson: preserveWorkItemModelConfigurationAudit(rebound),
              status: rebound.phase,
              revision: rebound.revision,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(workItem.workItemId, stored.workItemId),
                eq(workItem.revision, projection.revision),
              ),
            )
            .returning({ workItemId: workItem.workItemId });
          if (updated.length !== 1) throw new Error('WORK_ITEM_CAS_CONFLICT');
        }
        return {
          attemptId: latestAttempt.attemptId,
          attemptNo: latestAttempt.attemptNo,
        };
      }

      const previewMiss = isRetryableReaderPreviewFailure(projection);
      if (previewMiss && (
        !input.authorization ||
        stored.revision !== projection?.revision ||
        latestAttempt.status !== 'FAILED' ||
        latestAttempt.completedAt === null ||
        latestAttempt.errorCode !== projection?.failure?.failureCode ||
        latestAttempt.failureArtifactRef !== projection?.failure?.artifact.ref ||
        latestAttempt.failureArtifactSha256 !== projection?.failure?.artifact.sha256
      )) {
        return null;
      }
      if (
        !projection ||
        !(
          previewMiss ||
          (projection.phase === 'FAILED' &&
            isRetryableParseFailureCode(projection.failure?.failureCode)) ||
          (projection.phase === 'RECORDING_FAILED' &&
            isRetryableParseFailureCode(
              projection.recordingFailure?.failureCode,
            ))
        )
      ) {
        return null;
      }

      const attemptNo = latestAttempt.attemptNo + 1;
      const attemptId = `ATT-${randomUUID()}`;
      const now = new Date();
      const reopened: CanonicalWorkItemProjection = {
        ...projection,
        revision: projection.revision + 1,
        phase: 'PARSE_REQUESTED',
        failure: null,
        recordingFailure: null,
      };
      const next = input.authorization
        ? withRetryAuthorization(reopened, input.authorization, false)
        : reopened;
      const updated = await transaction
        .update(workItem)
        .set({
          projectionJson: preserveWorkItemModelConfigurationAudit(next),
          status: next.phase,
          revision: next.revision,
          packageId: next.package?.packageId ?? null,
          packageArtifactRef: next.package?.artifact.ref ?? null,
          packageArtifactSha256: next.package?.artifact.sha256 ?? null,
          failureCode: null,
          failureArtifactRef: null,
          failureArtifactSha256: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(workItem.workItemId, stored.workItemId),
            eq(workItem.revision, projection.revision),
          ),
        )
        .returning({ workItemId: workItem.workItemId });
      if (updated.length !== 1) throw new Error('WORK_ITEM_CAS_CONFLICT');

      const inserted = await transaction
        .insert(actionAttempt)
        .values({
          attemptId,
          workItemId: stored.workItemId,
          actionType: ACTION_TYPE,
          attemptNo,
          triggerRequestId: stored.requestId,
          requestOrigin: input.requestOrigin,
          status: 'PENDING',
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ attemptId: actionAttempt.attemptId });
      if (inserted.length !== 1) {
        throw new Error('ACTION_ATTEMPT_RETRY_INSERT_FAILED');
      }
      return { attemptId, attemptNo };
    });
  }

  async reopenCompletedParse(
    input: WorkItemReservationInput & {
      workItemId: string;
      requestId: string;
      expectedRevision: number;
      authorization: CanonicalParseAuthorizationProjection;
    },
  ): Promise<ParseRetryReservation | null> {
    return this.db.transaction(async (transaction) => {
      const [stored] = await transaction
        .select()
        .from(workItem)
        .where(eq(workItem.workItemId, input.workItemId))
        .limit(1);
      if (!stored) throw new Error('WORK_ITEM_NOT_FOUND');
      assertRetryIdentity(stored, input);

      const projection = parseProjection(stored.projectionJson);
      if (
        stored.revision !== input.expectedRevision ||
        projection?.revision !== input.expectedRevision ||
        projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
        projection.package === null ||
        projection.source.documentVersionId !== input.documentVersionId
      ) {
        return null;
      }

      const [latestAttempt] = await transaction
        .select()
        .from(actionAttempt)
        .where(
          and(
            eq(actionAttempt.workItemId, stored.workItemId),
            eq(actionAttempt.actionType, ACTION_TYPE),
          ),
        )
        .orderBy(desc(actionAttempt.attemptNo))
        .limit(1);
      if (
        !latestAttempt ||
        latestAttempt.status !== 'SUCCEEDED' ||
        latestAttempt.completedAt === null ||
        latestAttempt.packageArtifactRef !== projection.package.artifact.ref ||
        latestAttempt.packageArtifactSha256 !==
          projection.package.artifact.sha256
      ) {
        return null;
      }

      const now = new Date();
      const attemptId = `ATT-${randomUUID()}`;
      const attemptNo = latestAttempt.attemptNo + 1;
      const reopened = withRetryAuthorization(
        {
          ...projection,
          revision: projection.revision + 1,
          phase: 'PARSE_REQUESTED',
          failure: null,
          recordingFailure: null,
        },
        input.authorization,
        false,
      );
      const updated = await transaction
        .update(workItem)
        .set({
          projectionJson: preserveWorkItemModelConfigurationAudit(reopened),
          status: reopened.phase,
          revision: reopened.revision,
          packageId: projection.package.packageId,
          packageArtifactRef: projection.package.artifact.ref,
          packageArtifactSha256: projection.package.artifact.sha256,
          failureCode: null,
          failureArtifactRef: null,
          failureArtifactSha256: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(workItem.workItemId, stored.workItemId),
            eq(workItem.revision, input.expectedRevision),
          ),
        )
        .returning({ workItemId: workItem.workItemId });
      if (updated.length !== 1) return null;

      const inserted = await transaction
        .insert(actionAttempt)
        .values({
          attemptId,
          workItemId: stored.workItemId,
          actionType: ACTION_TYPE,
          attemptNo,
          triggerRequestId: stored.requestId,
          requestOrigin: input.requestOrigin,
          status: 'PENDING',
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
          inputRevision: projection.revision,
          baseRevision: projection.revision,
          documentVersionId: input.documentVersionId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ attemptId: actionAttempt.attemptId });
      if (inserted.length !== 1) {
        throw new Error('ACTION_ATTEMPT_REPARSE_INSERT_FAILED');
      }
      return { attemptId, attemptNo };
    });
  }

  async loadProjection(
    workItemId: string,
  ): Promise<CanonicalWorkItemProjection | null> {
    const [row] = await this.db
      .select()
      .from(workItem)
      .where(eq(workItem.workItemId, workItemId))
      .limit(1);
    if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
    return parseProjection(row.projectionJson);
  }

  /**
   * Bind the WorkItem lookup to the authenticated tenant before exposing any
   * projection. A cross-tenant id is intentionally indistinguishable from a
   * missing id to the caller.
   */
  async loadTenantScopedProjection(
    workItemId: string,
    tenantId: string,
    database: PostgresJsDatabase = this.db,
  ): Promise<{
    row: typeof workItem.$inferSelect;
    projection: CanonicalWorkItemProjection | null;
  } | null> {
    const [row] = await database
      .select()
      .from(workItem)
      .where(
        and(
          eq(workItem.workItemId, workItemId),
          eq(workItem.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!row) return null;
    return { row, projection: parseProjection(row.projectionJson) };
  }

  async loadAutoProcessingProjection(
    workItemId: string,
    tenantId: string,
  ): Promise<AutoWorkItemProjectionSnapshot | null> {
    const [value] = await this.db
      .select({
        row: {
          workItemId: workItem.workItemId,
          requestedByUserId: workItem.requestedByUserId,
          revision: workItem.revision,
          packageId: workItem.packageId,
        },
        projectionJson: workItem.projectionJson,
      })
      .from(workItem)
      .where(
        and(
          eq(workItem.workItemId, workItemId),
          eq(workItem.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!value) return null;
    return {
      row: value.row,
      projection: parseProjection(value.projectionJson),
    };
  }

  /** One post-authorization read, retaining a missing source separately from a missing WorkItem. */
  async loadTenantScopedMemberIdentity(
    workItemId: string,
    tenantId: string,
    documentVersionId: string,
  ) {
    const identity = sourceIdentityQuery(this.db, documentVersionId).as(
      'member_source_identity',
    );
    const [value] = await this.db
      .select({
        row: workItem,
        sourceVersion: identity.version,
        sourceArtifact: identity.artifact,
      })
      .from(workItem)
      .leftJoin(identity, sql`true`)
      .where(
        and(
          eq(workItem.workItemId, workItemId),
          eq(workItem.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!value) return null;
    // Parse first: corrupt stored projection retains precedence over source errors.
    return {
      row: value.row,
      projection: parseProjection(value.row.projectionJson),
      sourceIdentity:
        value.sourceVersion && value.sourceArtifact
          ? { version: value.sourceVersion, artifact: value.sourceArtifact }
          : null,
    };
  }

  /** One tenant-scoped statement for the request members after fresh access grants. */
  async loadTenantScopedMemberIdentities(
    inputs: readonly { workItemId: string; documentVersionId: string }[],
    tenantId: string,
  ) {
    const output = new Map<
      string,
      NonNullable<
        Awaited<
          ReturnType<MiaodaWorkItemRepository['loadTenantScopedMemberIdentity']>
        >
      >
    >();
    if (inputs.length === 0) return output;
    const workItemIds = [...new Set(inputs.map((input) => input.workItemId))];
    const documentVersionIds = [
      ...new Set(inputs.map((input) => input.documentVersionId)),
    ];
    const identity = sourceIdentityBatchQuery(this.db, documentVersionIds).as(
      'member_source_identity_batch',
    );
    const rows = await this.db
      .select({
        row: workItem,
        sourceVersion: identity.version,
        sourceArtifact: identity.artifact,
      })
      .from(workItem)
      .leftJoin(
        identity,
        eq(identity.version.documentVersionId, workItem.documentVersionId),
      )
      .where(
        and(
          eq(workItem.tenantId, tenantId),
          inArray(workItem.workItemId, workItemIds),
        ),
      );
    const rowById = new Map(rows.map((value) => [value.row.workItemId, value]));
    for (const input of inputs) {
      const value = rowById.get(input.workItemId);
      if (!value || output.has(input.workItemId)) continue;
      // Parse in request order and before source validation, as the single reader does.
      output.set(input.workItemId, {
        row: value.row,
        projection: parseProjection(value.row.projectionJson),
        sourceIdentity:
          value.sourceVersion && value.sourceArtifact
            ? { version: value.sourceVersion, artifact: value.sourceArtifact }
            : null,
      });
    }
    return output;
  }

  async loadAuthorizationBinding(input: {
    workItemId: string;
    tenantId: string;
    actorUserId: string;
    readScope?: 'TENANT';
  }, database: PostgresJsDatabase = this.db): Promise<WorkItemAuthorizationBinding | null> {
    const [row] = await database
      .select({
        workItemId: workItem.workItemId,
        revision: workItem.revision,
        tenantId: workItem.tenantId,
        requestId: workItem.requestId,
        documentId: workItem.documentId,
        documentVersionId: workItem.documentVersionId,
        requestedByUserId: workItem.requestedByUserId,
        runKey: workItem.runKey,
      })
      .from(workItem)
      .where(
        and(
          eq(workItem.workItemId, input.workItemId),
          eq(workItem.tenantId, input.tenantId),
          input.readScope === 'TENANT' ? undefined : eq(workItem.requestedByUserId, input.actorUserId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** One fresh actor-scoped fact read for at most four catalogue members. */
  async loadAuthorizationBindings(
    inputs: readonly {
      workItemId: string;
      tenantId: string;
      actorUserId: string;
      readScope?: 'TENANT';
    }[],
  ): Promise<Map<string, WorkItemAuthorizationBinding>> {
    if (inputs.length < 2 || inputs.length > 4)
      throw new Error('WORK_ITEM_AUTHORIZATION_BATCH_SIZE_INVALID');
    const { tenantId, actorUserId, readScope } = inputs[0];
    if (
      inputs.some(
        (input) =>
          input.tenantId !== tenantId || input.actorUserId !== actorUserId || input.readScope !== readScope,
      )
    )
      throw new Error('WORK_ITEM_AUTHORIZATION_BATCH_SCOPE_INVALID');
    const rows = await this.db
      .select({
        workItemId: workItem.workItemId,
        revision: workItem.revision,
        tenantId: workItem.tenantId,
        requestId: workItem.requestId,
        documentId: workItem.documentId,
        documentVersionId: workItem.documentVersionId,
        requestedByUserId: workItem.requestedByUserId,
        runKey: workItem.runKey,
      })
      .from(workItem)
      .where(
        and(
          eq(workItem.tenantId, tenantId),
          readScope === 'TENANT' ? undefined : eq(workItem.requestedByUserId, actorUserId),
          inArray(workItem.workItemId, [
            ...new Set(inputs.map((input) => input.workItemId)),
          ]),
        ),
      );
    return new Map(rows.map((row) => [row.workItemId, row]));
  }

  /** Fresh creator-only list; tenant and actor are both server-session facts. */
  async listOwnedWorkItems(input: {
    tenantId: string;
    actorUserId: string;
    limit?: number;
  }): Promise<OwnedWorkItemSummary[]> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    return this.db
      .select({
        workItemId: workItem.workItemId,
        revision: workItem.revision,
        tenantId: workItem.tenantId,
        requestId: workItem.requestId,
        documentId: workItem.documentId,
        documentVersionId: workItem.documentVersionId,
        requestedByUserId: workItem.requestedByUserId,
        runKey: workItem.runKey,
        status: workItem.status,
        actionType: workItem.actionType,
        createdAt: workItem.createdAt,
        updatedAt: workItem.updatedAt,
      })
      .from(workItem)
      .where(
        and(
          eq(workItem.tenantId, input.tenantId),
          eq(workItem.requestedByUserId, input.actorUserId),
        ),
      )
      .orderBy(desc(workItem.updatedAt))
      .limit(limit);
  }

  async loadTenantRunAuthorizationBinding(input: {
    tenantId: string;
    documentVersionId: string;
    runKey: string;
  }): Promise<WorkItemAuthorizationBinding | null> {
    const [row] = await this.db
      .select({
        workItemId: workItem.workItemId,
        revision: workItem.revision,
        tenantId: workItem.tenantId,
        requestId: workItem.requestId,
        documentId: workItem.documentId,
        documentVersionId: workItem.documentVersionId,
        requestedByUserId: workItem.requestedByUserId,
        runKey: workItem.runKey,
      })
      .from(workItem)
      .where(
        and(
          eq(workItem.tenantId, input.tenantId),
          eq(workItem.documentVersionId, input.documentVersionId),
          eq(workItem.runKey, input.runKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async loadTenantDocumentAuthorizationBinding(input: {
    tenantId: string;
    documentVersionId: string;
    actorUserId?: string;
  }, database: PostgresJsDatabase = this.db): Promise<WorkItemAuthorizationBinding | null> {
    const conditions = [
      eq(workItem.tenantId, input.tenantId),
      eq(workItem.documentVersionId, input.documentVersionId),
    ];
    if (input.actorUserId) {
      conditions.push(eq(workItem.requestedByUserId, input.actorUserId));
    }
    const [row] = await database
      .select({
        workItemId: workItem.workItemId,
        revision: workItem.revision,
        tenantId: workItem.tenantId,
        requestId: workItem.requestId,
        documentId: workItem.documentId,
        documentVersionId: workItem.documentVersionId,
        requestedByUserId: workItem.requestedByUserId,
        runKey: workItem.runKey,
      })
      .from(workItem)
      .where(and(...conditions))
      .limit(1);
    return row ?? null;
  }

  async listTenantDocumentAuthorizationBindings(input: {
    tenantId: string;
    documentVersionId: string;
  }): Promise<WorkItemAuthorizationBinding[]> {
    return this.db
      .select({
        workItemId: workItem.workItemId,
        revision: workItem.revision,
        tenantId: workItem.tenantId,
        requestId: workItem.requestId,
        documentId: workItem.documentId,
        documentVersionId: workItem.documentVersionId,
        requestedByUserId: workItem.requestedByUserId,
        runKey: workItem.runKey,
      })
      .from(workItem)
      .where(
        and(
          eq(workItem.tenantId, input.tenantId),
          eq(workItem.actionType, ACTION_TYPE),
          eq(workItem.documentVersionId, input.documentVersionId),
        ),
      )
      .orderBy(desc(workItem.updatedAt));
  }

  /** Claim only a never-started initial projection left behind by a failed
   * first PARSING CAS. Existing attempts and later parse phases stay untouched. */
  async claimInitializedParseRequest(input: {
    request: CanonicalPdfVerticalRunRequest;
    tenantId: string;
    actorUserId: string;
    authorizeCurrent: (database: PostgresJsDatabase, binding: WorkItemAuthorizationBinding) => Promise<{
      current: CanonicalParseAuthorizationProjection;
      seed: CanonicalParseAuthorizationProjection;
    }>;
  }): Promise<CanonicalWorkItemProjection> {
    return this.db.transaction(async transaction => {
      const { request } = input;
      const [row] = await transaction.select().from(workItem).where(and(
        eq(workItem.workItemId, request.workItemId), eq(workItem.tenantId, input.tenantId),
        eq(workItem.requestedByUserId, input.actorUserId),
      )).limit(1).for('update');
      const projection = row && parseProjection(row.projectionJson);
      if (!row || !projection || row.revision !== 1 || projection.revision !== 1
        || row.actionType !== ACTION_TYPE || row.status !== 'PARSE_REQUESTED'
        || projection.phase !== 'PARSE_REQUESTED' || !row.runKey.startsWith('dev:')
        || row.requestId !== request.requestId || projection.requestId !== request.requestId
        || projection.workItemId !== request.workItemId
        || row.documentId !== request.source.documentId || row.documentVersionId !== request.source.documentVersionId
        || row.sourceArtifactId !== request.source.sourceArtifactId
        || row.sourceFileSha256 !== rawHash(request.source.sourceFileSha256)
        || Number(row.sourceByteLength) !== request.source.sourceByteLength
        || row.normalizedFamily !== request.classification.normalizedFamily
        || canonicalJson(projection.source) !== canonicalJson(request.source)
        || canonicalJson(projection.classification) !== canonicalJson(request.classification)
        || projection.package !== null || projection.failure !== null || projection.recordingFailure !== null
        || projection.integratedAssessment !== null
        || [row.analysisModelJson, row.packageId, row.packageArtifactRef, row.packageArtifactSha256,
          row.failureCode, row.failureArtifactRef, row.failureArtifactSha256].some(value => value !== null)) {
        throw new Error('WORK_ITEM_INITIAL_PARSE_RESUME_NOT_AVAILABLE');
      }
      const [attempt] = await transaction.select().from(actionAttempt).where(and(
        eq(actionAttempt.workItemId, row.workItemId), eq(actionAttempt.actionType, ACTION_TYPE),
      )).orderBy(desc(actionAttempt.attemptNo)).limit(1).for('update');
      if (!attempt || attempt.attemptNo !== 1 || attempt.status !== 'PENDING'
        || attempt.tenantId !== row.tenantId || attempt.actorUserId !== row.requestedByUserId
        || attempt.triggerRequestId !== row.requestId || attempt.requestOrigin !== 'MIAODA'
        || attempt.claimCount !== 0 || attempt.retryCount !== 0 || attempt.leaseGeneration !== 0
        || [attempt.startedAt, attempt.completedAt, attempt.producerRunId, attempt.packageArtifactRef,
          attempt.packageArtifactSha256, attempt.failureArtifactRef, attempt.failureArtifactSha256,
          attempt.errorCode, attempt.errorMessage, attempt.executionModelJson, attempt.taskEnvelopeJson,
          attempt.resultEnvelopeJson, attempt.leaseOwner, attempt.leaseToken, attempt.leaseExpiresAt,
          attempt.cancelRequestedAt, attempt.commitStartedAt].some(value => value !== null)) {
        throw new Error('WORK_ITEM_INITIAL_PARSE_RESUME_NOT_AVAILABLE');
      }
      const binding: WorkItemAuthorizationBinding = { workItemId: row.workItemId, revision: row.revision,
        tenantId: row.tenantId, requestId: row.requestId, documentId: row.documentId,
        documentVersionId: row.documentVersionId, requestedByUserId: row.requestedByUserId, runKey: row.runKey };
      const authorization = await input.authorizeCurrent(transaction, binding);
      if (canonicalJson(projection.parseAuthorization) !== canonicalJson(authorization.seed)
        || projection.permissionSnapshotVersion !== authorization.seed.permissionSnapshotVersion
        || authorization.current.actorFingerprint !== authorization.seed.actorFingerprint) {
        throw new Error('WORK_ITEM_AUTHORIZATION_IDEMPOTENCY_COLLISION');
      }
      const source = await new MiaodaDocumentVersionSourceResolver(transaction).resolve(row.documentVersionId,
        { requireCurrent: true, expectedCreatorUserId: input.actorUserId });
      if (source.version.documentId !== row.documentId || source.version.sourceArtifactId !== row.sourceArtifactId
        || source.version.pdfSha256 !== row.sourceFileSha256 || Number(source.version.byteLength) !== Number(row.sourceByteLength)
        || source.artifact.providerObjectId !== request.source.driveFileToken
        || source.artifact.providerVersionId !== request.source.driveSourceVersion) {
        throw new Error('WORK_ITEM_BUSINESS_KEY_COLLISION');
      }
      const { revision: _revision, ...previous } = projection;
      const claimed = await this.persistProjectionCas({ workItemId: row.workItemId, expectedRevision: 1,
        syncPrimaryAttempt: false, next: { ...previous, phase: 'PARSING',
          parseAuthorization: authorization.current, permissionSnapshotVersion: authorization.current.permissionSnapshotVersion } }, transaction);
      const now = new Date();
      const started = await transaction.update(actionAttempt).set({ status: 'PARSING', startedAt: now, updatedAt: now })
        .where(and(eq(actionAttempt.attemptId, attempt.attemptId), eq(actionAttempt.status, 'PENDING'),
          isNull(actionAttempt.startedAt))).returning({ attemptId: actionAttempt.attemptId });
      if (started.length !== 1) throw new Error('WORK_ITEM_CAS_CONFLICT');
      return claimed;
    });
  }

  async initializeProjection(
    workItemId: string,
    seed: Omit<CanonicalWorkItemProjection, 'revision'>,
  ): Promise<CanonicalWorkItemProjection> {
    const projection: CanonicalWorkItemProjection = { ...seed, revision: 1 };
    const updated = await this.db
      .update(workItem)
      .set({
        projectionJson: JSON.stringify(projection),
        status: projection.phase,
        revision: 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workItem.workItemId, workItemId),
          eq(workItem.revision, 0),
          isNull(workItem.projectionJson),
        ),
      )
      .returning({ workItemId: workItem.workItemId });
    if (updated.length === 1) return projection;
    const existing = await this.loadProjection(workItemId);
    if (!existing) throw new Error('WORK_ITEM_INITIALIZATION_CONFLICT');
    return existing;
  }

  async compareAndSet(input: {
    workItemId: string;
    expectedRevision: number;
    next: Omit<CanonicalWorkItemProjection, 'revision'>;
    syncPrimaryAttempt?: boolean;
    applicabilityInputGuard?: { tenantId: string };
    jobAidWorkRevisionGuard?: CanonicalJobAidWorkRevisionGuard;
    nativeEvidenceGuard?: (database: PostgresJsDatabase) => Promise<void>;
    writePredicate?: SQL;
  }): Promise<CanonicalWorkItemProjection> {
    this.requireNativeProjectionGuard(input);
    if (input.jobAidWorkRevisionGuard) {
      const guard = input.jobAidWorkRevisionGuard;
      if (
        !guard.tenantId.trim() ||
        !/^JAWR-[A-Za-z0-9-]{1,91}$/u.test(guard.workRevisionRef) ||
        input.syncPrimaryAttempt !== false ||
        input.applicabilityInputGuard
      )
        throw new Error('JOBAID_OVERALL_WORK_CAS_GUARD_INVALID');
      const sources = guard.sourceGuard;
      if (sources !== undefined && (!sources || !sources.actorUserId?.trim() ||
          !Array.isArray(sources.sourceBindings) || !sources.sourceBindings.length ||
          sources.sourceBindings.some((binding) => !binding || !binding.workItemId?.trim() ||
            !binding.documentVersionId?.trim() || !binding.artifactRef?.trim() ||
            !binding.artifactSha256?.trim() || (binding.kind !== undefined && binding.kind !== 'SOURCE_FILE')) ||
          new Set(sources.sourceBindings.map((binding) => binding.workItemId)).size !== sources.sourceBindings.length ||
          !sources.sourceBindings.some((binding) => binding.workItemId === input.workItemId)))
        throw new Error('JOBAID_SOURCE_CAS_GUARD_INVALID');
      return this.db.transaction(async (transaction) => {
        // SAVE takes the same bytewise WI order. No grant/attempt lock may
        // precede any of these source locks, including the primary WI.
        if (sources) for (const binding of [...sources.sourceBindings].sort((a, b) =>
          a.workItemId < b.workItemId ? -1 : a.workItemId > b.workItemId ? 1 : 0)) {
          const [source] = await transaction.select({
            documentVersionId: workItem.documentVersionId,
            projectionJson: workItem.projectionJson,
          }).from(workItem).where(and(
            eq(workItem.workItemId, binding.workItemId),
            eq(workItem.tenantId, guard.tenantId),
            eq(workItem.requestedByUserId, sources.actorUserId),
          )).limit(1).for('update');
          if (!source?.projectionJson || source.documentVersionId !== binding.documentVersionId)
            throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
          const projection = JSON.parse(source.projectionJson) as CanonicalWorkItemProjection;
          if (binding.kind === 'SOURCE_FILE'
            ? projection.source?.sourceArtifactId !== binding.artifactRef ||
              canonicalHostBareSha256(projection.source?.sourceFileSha256) !== binding.artifactSha256
            : projection.package?.artifact?.ref !== binding.artifactRef ||
              projection.package?.artifact?.sha256 !== binding.artifactSha256)
            throw new Error('JOBAID_SOURCE_VERSION_CHANGED');
        }
        const [owner] = await transaction
          .select({
            revision: workItem.revision,
            documentVersionId: workItem.documentVersionId,
            requestedByUserId: workItem.requestedByUserId,
          })
          .from(workItem)
          .where(
            and(
              eq(workItem.workItemId, input.workItemId),
              eq(workItem.tenantId, guard.tenantId),
            ),
          )
          .limit(1)
          .for('update');
        if (
          !owner ||
          owner.revision !== input.expectedRevision ||
          owner.documentVersionId !== input.next.source.documentVersionId
        )
          throw new Error('WORK_ITEM_CAS_CONFLICT');
        // The hosted SQL middleware reapplies identity before each query.
        // Keep actor binding and the RLS-protected latest-work read in one
        // statement; a preceding standalone set_config is overwritten.
        const [latest] = await transaction.execute<{
          workRevisionRef: string;
          documentVersionId: string;
        }>(sql`
          WITH actor_context AS MATERIALIZED (
            SELECT set_config('app.user_id', ${owner.requestedByUserId}, TRUE) AS actor_id
          )
          SELECT latest.assessment_work_revision_id AS "workRevisionRef",
            latest.document_version_id AS "documentVersionId"
          FROM actor_context CROSS JOIN LATERAL (
            SELECT revision.assessment_work_revision_id, revision.document_version_id
            FROM assessment_work_revision AS revision
            WHERE revision.tenant_id=${guard.tenantId}
              AND revision.work_item_id=${input.workItemId}
              AND revision.created_by_user_id=actor_context.actor_id
            ORDER BY revision.work_revision DESC LIMIT 1
          ) latest
        `);
        if (
          !latest ||
          latest.workRevisionRef !== guard.workRevisionRef ||
          latest.documentVersionId !== owner.documentVersionId
        )
          throw new Error('JOBAID_OVERALL_EXACT_WORK_CHANGED');
        await input.nativeEvidenceGuard?.(transaction as PostgresJsDatabase);
        const saved = await this.persistProjectionCas(input, transaction);
        await input.nativeEvidenceGuard?.(transaction as PostgresJsDatabase);
        return saved;
      });
    }
    if (input.applicabilityInputGuard) {
      if (
        !input.applicabilityInputGuard.tenantId.trim() ||
        input.syncPrimaryAttempt !== false
      )
        throw new Error('APPLICABILITY_INPUT_CAS_GUARD_INVALID');
      const tenantId = input.applicabilityInputGuard.tenantId;
      return this.db.transaction(async (transaction) => {
        const [owner] = await transaction
          .select({
            revision: workItem.revision,
            documentVersionId: workItem.documentVersionId,
          })
          .from(workItem)
          .where(
            and(
              eq(workItem.workItemId, input.workItemId),
              eq(workItem.tenantId, tenantId),
            ),
          )
          .limit(1)
          .for('update');
        if (
          !owner ||
          owner.revision !== input.expectedRevision ||
          owner.documentVersionId !== input.next.source.documentVersionId
        )
          throw new Error('WORK_ITEM_CAS_CONFLICT');
        const [active] = await transaction
          .select({ id: actionAttempt.attemptId })
          .from(actionAttempt)
          .where(
            and(
              eq(actionAttempt.tenantId, tenantId),
              eq(actionAttempt.workItemId, input.workItemId),
              eq(actionAttempt.actionType, 'OPENCLAW_APPLICABILITY_EVALUATION'),
              inArray(actionAttempt.status, [
                'QUEUED',
                'RUNNING',
                'RETRY_SCHEDULED',
                'COMMITTING',
              ]),
            ),
          )
          .limit(1);
        if (active) throw new Error('APPLICABILITY_INPUT_ACTIVE_ATTEMPT');
        return this.persistProjectionCas(input, transaction);
      });
    }
    return this.persistProjectionCas(input, this.db);
  }

  /** One browser actor transaction fences the exact Review work and commits
   * its Host execution row together with the WorkItem projection. */
  async withLockedReviewOverallProjection<T>(input: {
    tenantId: string;
    actorUserId: string;
    workItemId: string;
    expectedRevision: number;
    workRevisionRef: string;
    documentVersionId: string;
  }, operation: (database: PostgresJsDatabase,
    current: CanonicalWorkItemProjection) => Promise<{
      next: Omit<CanonicalWorkItemProjection, 'revision'>;
      value: T;
    }>): Promise<{ saved: CanonicalWorkItemProjection; value: T }> {
    return this.db.transaction(async (transaction) => {
      const database = transaction as PostgresJsDatabase;
      const [row] = await database.select({
        revision: workItem.revision,
        projectionJson: workItem.projectionJson,
        documentVersionId: workItem.documentVersionId,
        requestedByUserId: workItem.requestedByUserId,
      }).from(workItem).where(and(
        eq(workItem.tenantId, input.tenantId),
        eq(workItem.workItemId, input.workItemId),
      )).limit(1).for('update');
      if (!row || row.revision !== input.expectedRevision ||
        row.documentVersionId !== input.documentVersionId ||
        row.requestedByUserId !== input.actorUserId || !row.projectionJson)
        throw new Error('WORK_ITEM_CAS_CONFLICT');
      const current = JSON.parse(row.projectionJson) as CanonicalWorkItemProjection;
      if (current.revision !== row.revision || current.workItemId !== input.workItemId ||
        current.source.documentVersionId !== input.documentVersionId)
        throw new Error('WORK_ITEM_CAS_CONFLICT');
      const [latest] = await database.select({
        workRevisionRef: assessmentWorkRevision.assessmentWorkRevisionId,
      }).from(assessmentWorkRevision).where(and(
        eq(assessmentWorkRevision.tenantId, input.tenantId),
        eq(assessmentWorkRevision.workItemId, input.workItemId),
      )).orderBy(desc(assessmentWorkRevision.workRevision)).limit(1);
      if (latest?.workRevisionRef !== input.workRevisionRef)
        throw new Error('JOBAID_OVERALL_EXACT_WORK_CHANGED');
      const result = await operation(database, current);
      const saved = await this.persistProjectionCas({
        workItemId: input.workItemId,
        expectedRevision: input.expectedRevision,
        syncPrimaryAttempt: false,
        next: result.next,
      }, database);
      return { saved, value: result.value };
    });
  }

  private requireNativeProjectionGuard(input: Parameters<MiaodaWorkItemRepository['compareAndSet']>[0]): void {
    const reevaluation = input.next.configurationEvidenceReevaluation;
    const candidates = [input.next.integratedAssessment?.baseRules,
      input.next.integratedAssessment?.overallSynthesis,
      reevaluation && 'stagedBundle' in reevaluation ? reevaluation.stagedBundle?.baseRules : undefined];
    const nativeProjection = candidates.some(projection => projection && 'readingResult' in projection &&
      projection.readingResult?.evidence.some(evidence => evidence.kind === 'TDMS_NATIVE_RECORD'));
    if (nativeProjection && (!input.nativeEvidenceGuard || !input.jobAidWorkRevisionGuard))
      throw new Error('TDMS_NATIVE_PROJECTION_AUTHORIZATION_REQUIRED');
    if (input.nativeEvidenceGuard && !input.jobAidWorkRevisionGuard)
      throw new Error('TDMS_NATIVE_PROJECTION_CAS_GUARD_REQUIRED');
  }

  private async persistProjectionCas(
    input: Parameters<MiaodaWorkItemRepository['compareAndSet']>[0],
    db: Pick<PostgresJsDatabase, 'update'>,
  ): Promise<CanonicalWorkItemProjection> {
    // Internal browser projection writers cannot bypass the native admission boundary.
    this.requireNativeProjectionGuard(input);
    const next: CanonicalWorkItemProjection = {
      ...input.next,
      revision: input.expectedRevision + 1,
    };
    const now = new Date();
    const updated = await db
      .update(workItem)
      .set({
        projectionJson: preserveWorkItemModelConfigurationAudit(next),
        status: next.phase,
        revision: next.revision,
        packageId: next.package?.packageId ?? null,
        packageArtifactRef: next.package?.artifact.ref ?? null,
        packageArtifactSha256: next.package?.artifact.sha256 ?? null,
        failureCode:
          next.failure?.failureCode ??
          next.recordingFailure?.failureCode ??
          null,
        failureArtifactRef: next.failure?.artifact.ref ?? null,
        failureArtifactSha256: next.failure?.artifact.sha256 ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(workItem.workItemId, input.workItemId),
          eq(workItem.revision, input.expectedRevision),
          ...(input.writePredicate ? [input.writePredicate] : []),
        ),
      )
      .returning({ workItemId: workItem.workItemId });
    if (updated.length !== 1) throw new Error('WORK_ITEM_CAS_CONFLICT');
    if (input.syncPrimaryAttempt !== false) {
      await this.updatePrimaryAttempt(next, now);
    }
    return next;
  }

  async getRow(workItemId: string) {
    const [row] = await this.db
      .select()
      .from(workItem)
      .where(eq(workItem.workItemId, workItemId))
      .limit(1);
    if (!row) throw new Error('WORK_ITEM_NOT_FOUND');
    return row;
  }

  async reserveAssessmentAction(input: {
    workItemId: string;
    actionType: AssessmentActionType;
    triggerRequestId: string;
    requestOrigin: 'MIAODA' | 'AILY';
    actorUserId: string;
    tenantId: string;
    attemptNo: number;
  }): Promise<AssessmentActionAttemptReservation> {
    if (!Number.isSafeInteger(input.attemptNo) || input.attemptNo < 1) {
      throw new Error('ASSESSMENT_ACTION_ATTEMPT_NUMBER_INVALID');
    }
    const now = new Date();
    const attemptId = 'ATT-' + randomUUID();
    const inserted = await this.db
      .insert(actionAttempt)
      .values({
        attemptId,
        workItemId: input.workItemId,
        actionType: input.actionType,
        attemptNo: input.attemptNo,
        triggerRequestId: input.triggerRequestId,
        requestOrigin: input.requestOrigin,
        status: 'RUNNING',
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          actionAttempt.workItemId,
          actionAttempt.actionType,
          actionAttempt.attemptNo,
        ],
      })
      .returning({ attemptId: actionAttempt.attemptId });
    const [stored] = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.workItemId, input.workItemId),
          eq(actionAttempt.actionType, input.actionType),
          eq(actionAttempt.attemptNo, input.attemptNo),
        ),
      )
      .limit(1);
    if (!stored) throw new Error('ASSESSMENT_ACTION_ATTEMPT_READBACK_FAILED');
    if (
      stored.triggerRequestId !== input.triggerRequestId ||
      stored.actorUserId !== input.actorUserId ||
      stored.tenantId !== input.tenantId
    ) {
      throw new Error('ASSESSMENT_ACTION_ATTEMPT_IDENTITY_MISMATCH');
    }
    return {
      attemptId: stored.attemptId,
      created: inserted.length === 1,
    };
  }

  async reserveDynamicEvaluationAction(input: {
    workItemId: string;
    actorUserId: string;
    tenantId: string;
    attemptNo: number;
  }): Promise<DynamicEvaluationActionAttempt & { created: boolean }> {
    if (!Number.isSafeInteger(input.attemptNo) || input.attemptNo < 1) {
      throw new Error('DYNAMIC_EVALUATION_ATTEMPT_NUMBER_INVALID');
    }
    const now = new Date();
    const attemptId = `ATT-${randomUUID()}`;
    const callerCorrelationRef = `DYN-${randomUUID()}`;
    const inserted = await this.db
      .insert(actionAttempt)
      .values({
        attemptId,
        workItemId: input.workItemId,
        actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
        attemptNo: input.attemptNo,
        triggerRequestId: callerCorrelationRef,
        requestOrigin: 'OPENCLAW',
        status: 'RUNNING',
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          actionAttempt.workItemId,
          actionAttempt.actionType,
          actionAttempt.attemptNo,
        ],
      })
      .returning({ attemptId: actionAttempt.attemptId });
    const stored = await this.getDynamicEvaluationActionByIdentity(
      input.workItemId,
      input.attemptNo,
    );
    if (
      stored.actorUserId !== input.actorUserId ||
      stored.tenantId !== input.tenantId
    ) {
      throw new Error('DYNAMIC_EVALUATION_ATTEMPT_IDENTITY_MISMATCH');
    }
    return { ...stored, created: inserted.length === 1 };
  }

  async getDynamicEvaluationActionByCallerRef(
    callerCorrelationRef: string,
  ): Promise<DynamicEvaluationActionAttempt> {
    const storedRows = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.triggerRequestId, callerCorrelationRef),
          eq(actionAttempt.actionType, 'OPENCLAW_DYNAMIC_EVALUATION'),
        ),
      )
      .limit(2);
    if (storedRows.length !== 1) {
      throw new Error('DYNAMIC_EVALUATION_ATTEMPT_NOT_FOUND');
    }
    return dynamicEvaluationAttempt(storedRows[0]);
  }

  async getDynamicEvaluationActionByAttemptId(
    attemptId: string,
  ): Promise<DynamicEvaluationActionAttempt> {
    const storedRows = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.attemptId, attemptId),
          eq(actionAttempt.actionType, 'OPENCLAW_DYNAMIC_EVALUATION'),
        ),
      )
      .limit(2);
    if (storedRows.length !== 1) {
      throw new Error('DYNAMIC_EVALUATION_ATTEMPT_NOT_FOUND');
    }
    return dynamicEvaluationAttempt(storedRows[0]);
  }

  async claimDynamicEvaluationCommit(attemptId: string): Promise<void> {
    const updated = await this.db
      .update(actionAttempt)
      .set({ status: 'COMMITTING', updatedAt: new Date() })
      .where(
        and(
          eq(actionAttempt.attemptId, attemptId),
          eq(actionAttempt.status, 'RUNNING'),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    if (updated.length !== 1) {
      throw new Error('DYNAMIC_EVALUATION_COMMIT_ALREADY_CLAIMED');
    }
  }

  async reserveOverallSynthesisAction(input: {
    workItemId: string;
    actorUserId: string;
    tenantId: string;
    attemptNo: number;
    providerCodes: string[];
  }): Promise<OverallSynthesisActionAttempt & { created: boolean }> {
    const requestOrigin = overallRequestOrigin(input.providerCodes);
    const now = new Date();
    const attemptId = `ATT-${randomUUID()}`;
    const callerCorrelationRef = `OVR-${randomUUID()}`;
    const inserted = await this.db
      .insert(actionAttempt)
      .values({
        attemptId,
        workItemId: input.workItemId,
        actionType: 'OPENCLAW_OVERALL_SYNTHESIS',
        attemptNo: input.attemptNo,
        triggerRequestId: callerCorrelationRef,
        requestOrigin,
        status: 'RUNNING',
        actorUserId: input.actorUserId,
        tenantId: input.tenantId,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          actionAttempt.workItemId,
          actionAttempt.actionType,
          actionAttempt.attemptNo,
        ],
      })
      .returning({ attemptId: actionAttempt.attemptId });
    const stored = await this.getOverallSynthesisActionByIdentity(
      input.workItemId,
      input.attemptNo,
    );
    if (
      stored.actorUserId !== input.actorUserId ||
      stored.tenantId !== input.tenantId ||
      stored.requestOrigin !== requestOrigin
    ) {
      throw new Error('OPENCLAW_OVERALL_ATTEMPT_IDENTITY_MISMATCH');
    }
    return { ...stored, created: inserted.length === 1 };
  }

  async getOverallSynthesisActionByCallerRef(
    callerCorrelationRef: string,
  ): Promise<OverallSynthesisActionAttempt> {
    const rows = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.triggerRequestId, callerCorrelationRef),
          eq(actionAttempt.actionType, 'OPENCLAW_OVERALL_SYNTHESIS'),
        ),
      )
      .limit(2);
    if (rows.length !== 1)
      throw new Error('OPENCLAW_OVERALL_ATTEMPT_NOT_FOUND');
    return overallSynthesisAttempt(rows[0]);
  }

  async getOverallSynthesisActionByRef(
    reference: string,
  ): Promise<OverallSynthesisActionAttempt> {
    const rows = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.actionType, 'OPENCLAW_OVERALL_SYNTHESIS'),
          or(
            eq(actionAttempt.attemptId, reference),
            eq(actionAttempt.triggerRequestId, reference),
          ),
        ),
      )
      .limit(2);
    if (rows.length !== 1)
      throw new Error('OPENCLAW_OVERALL_ATTEMPT_NOT_FOUND');
    return overallSynthesisAttempt(rows[0]);
  }

  async claimOverallSynthesisCommit(attemptId: string): Promise<void> {
    const updated = await this.db
      .update(actionAttempt)
      .set({ status: 'COMMITTING', updatedAt: new Date() })
      .where(
        and(
          eq(actionAttempt.attemptId, attemptId),
          eq(actionAttempt.status, 'RUNNING'),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    if (updated.length !== 1) {
      throw new Error('OPENCLAW_OVERALL_COMMIT_ALREADY_CLAIMED');
    }
  }

  async recordOpenClawBeginFailure(input: {
    attemptId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const updated = await this.db
      .update(actionAttempt)
      .set({
        errorCode: input.errorCode.slice(0, 160),
        errorMessage: input.errorMessage,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actionAttempt.attemptId, input.attemptId),
          eq(actionAttempt.actionType, 'OPENCLAW_OVERALL_SYNTHESIS'),
          eq(actionAttempt.status, 'RUNNING'),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    if (updated.length !== 1) {
      throw new Error('OPENCLAW_OVERALL_BEGIN_FAILURE_RECORD_CONFLICT');
    }
  }

  async releaseOpenClawCommitForRetry(input: {
    attemptId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    const updated = await this.db
      .update(actionAttempt)
      .set({
        status: 'RUNNING',
        errorCode: input.errorCode.slice(0, 160),
        errorMessage: input.errorMessage,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actionAttempt.attemptId, input.attemptId),
          inArray(actionAttempt.actionType, [
            'OPENCLAW_DYNAMIC_EVALUATION',
            'OPENCLAW_OVERALL_SYNTHESIS',
          ]),
          eq(actionAttempt.status, 'COMMITTING'),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    if (updated.length !== 1) {
      throw new Error('OPENCLAW_COMMIT_RETRY_RELEASE_CONFLICT');
    }
  }

  async completeAssessmentAction(attemptId: string): Promise<void> {
    const now = new Date();
    const updated = await this.db
      .update(actionAttempt)
      .set({
        status: 'SUCCEEDED',
        errorCode: null,
        errorMessage: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(actionAttempt.attemptId, attemptId),
          inArray(actionAttempt.status, ['RUNNING', 'COMMITTING']),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    if (updated.length !== 1) {
      throw new Error('ASSESSMENT_ACTION_ATTEMPT_COMPLETION_CONFLICT');
    }
  }

  async failAssessmentAction(input: {
    attemptId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    await this.db
      .update(actionAttempt)
      .set({
        status: 'FAILED',
        errorCode: input.errorCode.slice(0, 160),
        errorMessage: input.errorMessage,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(actionAttempt.attemptId, input.attemptId),
          inArray(actionAttempt.status, ['RUNNING', 'COMMITTING']),
        ),
      );
  }

  private async getDynamicEvaluationActionByIdentity(
    workItemId: string,
    attemptNo: number,
  ): Promise<DynamicEvaluationActionAttempt> {
    const [stored] = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.workItemId, workItemId),
          eq(actionAttempt.actionType, 'OPENCLAW_DYNAMIC_EVALUATION'),
          eq(actionAttempt.attemptNo, attemptNo),
        ),
      )
      .limit(1);
    if (!stored) {
      throw new Error('DYNAMIC_EVALUATION_ATTEMPT_READBACK_FAILED');
    }
    return dynamicEvaluationAttempt(stored);
  }

  private async getOverallSynthesisActionByIdentity(
    workItemId: string,
    attemptNo: number,
  ): Promise<OverallSynthesisActionAttempt> {
    const [stored] = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.workItemId, workItemId),
          eq(actionAttempt.actionType, 'OPENCLAW_OVERALL_SYNTHESIS'),
          eq(actionAttempt.attemptNo, attemptNo),
        ),
      )
      .limit(1);
    if (!stored) throw new Error('OPENCLAW_OVERALL_ATTEMPT_READBACK_FAILED');
    return overallSynthesisAttempt(stored);
  }

  private async updatePrimaryAttempt(
    projection: CanonicalWorkItemProjection,
    now: Date,
  ): Promise<void> {
    const terminal = [
      'CANDIDATE_READBACK_VERIFIED',
      'FAILED',
      'RECORDING_FAILED',
    ].includes(projection.phase);
    const [latestAttempt] = await this.db
      .select({ attemptId: actionAttempt.attemptId })
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.workItemId, projection.workItemId),
          eq(actionAttempt.actionType, ACTION_TYPE),
        ),
      )
      .orderBy(desc(actionAttempt.attemptNo))
      .limit(1);
    if (!latestAttempt) throw new Error('ACTION_ATTEMPT_READBACK_FAILED');
    await this.db
      .update(actionAttempt)
      .set({
        status: terminal
          ? projection.phase === 'CANDIDATE_READBACK_VERIFIED'
            ? 'SUCCEEDED'
            : projection.phase
          : projection.phase,
        packageArtifactRef:
          projection.phase === 'CANDIDATE_READBACK_VERIFIED'
            ? (projection.package?.artifact.ref ?? null)
            : null,
        packageArtifactSha256:
          projection.phase === 'CANDIDATE_READBACK_VERIFIED'
            ? (projection.package?.artifact.sha256 ?? null)
            : null,
        failureArtifactRef: projection.failure?.artifact.ref ?? null,
        failureArtifactSha256: projection.failure?.artifact.sha256 ?? null,
        errorCode:
          projection.failure?.failureCode ??
          projection.recordingFailure?.failureCode ??
          null,
        startedAt: projection.phase === 'PARSING' ? now : undefined,
        completedAt: terminal ? now : undefined,
        updatedAt: now,
      })
      .where(eq(actionAttempt.attemptId, latestAttempt.attemptId));
  }
}

function withRetryAuthorization(
  projection: CanonicalWorkItemProjection,
  authorization: CanonicalParseAuthorizationProjection,
  incrementRevision: boolean,
): CanonicalWorkItemProjection {
  if (
    projection.parseAuthorization.actorFingerprint ===
      authorization.actorFingerprint &&
    projection.parseAuthorization.decisionHash === authorization.decisionHash &&
    projection.permissionSnapshotVersion ===
      authorization.permissionSnapshotVersion
  ) {
    return projection;
  }
  return {
    ...projection,
    revision: incrementRevision ? projection.revision + 1 : projection.revision,
    permissionSnapshotVersion: authorization.permissionSnapshotVersion,
    parseAuthorization: { ...authorization },
  };
}

function dynamicEvaluationAttempt(
  stored: typeof actionAttempt.$inferSelect,
): DynamicEvaluationActionAttempt {
  if (
    stored.actionType !== 'OPENCLAW_DYNAMIC_EVALUATION' ||
    !['OPENCLAW', 'OPENCLAW_MCP_V1'].includes(stored.requestOrigin) ||
    !(stored.createdAt instanceof Date)
  ) {
    throw new Error('DYNAMIC_EVALUATION_ATTEMPT_IDENTITY_INVALID');
  }
  return {
    attemptId: stored.attemptId,
    workItemId: stored.workItemId,
    actionType: stored.actionType,
    attemptNo: stored.attemptNo,
    triggerRequestId: stored.triggerRequestId,
    requestOrigin: 'OPENCLAW',
    status: stored.status,
    actorUserId: stored.actorUserId,
    tenantId: stored.tenantId,
    createdAt: stored.createdAt,
  };
}

function overallSynthesisAttempt(
  stored: typeof actionAttempt.$inferSelect,
): OverallSynthesisActionAttempt {
  if (
    stored.actionType !== 'OPENCLAW_OVERALL_SYNTHESIS' ||
    !stored.requestOrigin.startsWith('OPENCLAW_OVR_') ||
    !(stored.createdAt instanceof Date)
  ) {
    throw new Error('OPENCLAW_OVERALL_ATTEMPT_IDENTITY_INVALID');
  }
  return {
    attemptId: stored.attemptId,
    workItemId: stored.workItemId,
    actionType: stored.actionType,
    attemptNo: stored.attemptNo,
    triggerRequestId: stored.triggerRequestId,
    requestOrigin: stored.requestOrigin,
    status: stored.status,
    actorUserId: stored.actorUserId,
    tenantId: stored.tenantId,
    packageArtifactRef: stored.packageArtifactRef,
    packageArtifactSha256: stored.packageArtifactSha256,
    failureArtifactRef: stored.failureArtifactRef,
    failureArtifactSha256: stored.failureArtifactSha256,
    createdAt: stored.createdAt,
  };
}

function overallRequestOrigin(providerCodes: string[]): string {
  const unique = [...new Set(providerCodes)].sort();
  if (unique.some((code) => !['A', 'B', 'C'].includes(code))) {
    throw new Error('OPENCLAW_OVERALL_PROVIDER_CODE_INVALID');
  }
  return `OPENCLAW_OVR_${unique.length > 0 ? unique.join('') : 'NONE'}`;
}

function rawHash(value: string): string {
  return value.replace(/^sha256:/u, '');
}

function normalizeAutoProcessingBlockCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,119}$/u.test(value)
    ? value
    : 'AUTO_WORK_ITEM_AUTHORIZATION_INVALID';
}

function parseProjection(
  value: string | null,
): CanonicalWorkItemProjection | null {
  if (value === null) return null;
  const parsed = JSON.parse(value) as CanonicalWorkItemProjection;
  if (!parsed.workItemId || !Number.isInteger(parsed.revision)) {
    throw new Error('WORK_ITEM_PROJECTION_INVALID');
  }
  return parsed;
}

function assertReservationIdentity(
  row: typeof workItem.$inferSelect,
  input: WorkItemReservationInput,
): void {
  const model = readStoredExecutionModel(row.analysisModelJson);
  if (
    input.modelChoiceExplicit &&
    input.analysisModel?.modelRef !== model?.modelRef
  ) {
    throw canonicalModelError('WORK_ITEM_MODEL_IDEMPOTENCY_CONFLICT', 409);
  }
  if (
    row.documentId !== input.documentId ||
    row.sourceArtifactId !== input.sourceArtifactId ||
    row.sourceFileSha256 !== rawHash(input.sourceFileSha256) ||
    Number(row.sourceByteLength) !== input.sourceByteLength ||
    row.normalizedFamily !== input.normalizedFamily ||
    row.runKey !== input.runKey
  ) {
    throw new Error('WORK_ITEM_BUSINESS_KEY_COLLISION');
  }
}

function assertRetryIdentity(
  row: typeof workItem.$inferSelect,
  input: WorkItemReservationInput & {
    workItemId: string;
    requestId: string;
  },
): void {
  assertReservationIdentity(row, input);
  if (
    row.workItemId !== input.workItemId ||
    row.requestId !== input.requestId ||
    row.tenantId !== input.tenantId ||
    row.documentVersionId !== input.documentVersionId ||
    row.requestedByUserId !== input.actorUserId
  ) {
    throw new Error('WORK_ITEM_RETRY_IDENTITY_MISMATCH');
  }
}
