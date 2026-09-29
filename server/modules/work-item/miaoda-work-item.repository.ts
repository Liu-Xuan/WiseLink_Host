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
  or,
  sql,
} from 'drizzle-orm';

import type {
  CanonicalParseAuthorizationProjection,
  CanonicalWorkItemProjection,
  CanonicalExecutionModelSelection,
  DocumentDeliverySelection,
} from '@shared/api.interface';
import { isRetryableParseFailureCode } from '@shared/parse-retry-policy';
import {
  sourceIdentityBatchQuery,
  sourceIdentityQuery,
} from './document-version-source-identity';
import { autoWorkItemAuthorization } from '../../database/auto-work-item-authorization.schema';
import { dmDocumentReadingRun } from '../../database/document-reading.schema';
import {
  actionAttempt,
  translationBlockRevision,
  workItem,
} from '../../database/schema';
import { readStoredExecutionModel } from '../model-settings/canonical-execution-model';
import { canonicalModelError } from '../model-settings/canonical-model-catalog';

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

export interface AutoWorkItemProjectionSnapshot {
  row: Pick<
    typeof workItem.$inferSelect,
    'workItemId' | 'requestedByUserId' | 'revision' | 'packageId'
  >;
  projection: CanonicalWorkItemProjection | null;
}

export interface AutoWorkItemLease {
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
            AND (t.trigger_request_id LIKE ${`${input.translationRequestId}:resume-%`}
              OR t.trigger_request_id IN (${input.translationRequestId},${`${input.translationRequestId}:hosted-m3`},
              ${`${input.translationRequestId}:partial-repair`},${`${input.translationRequestId}:partial-repair-v2`},
              ${`${input.translationRequestId}:known-failure`}))
            AND t.subject_kind='DOCUMENT_VERSION' AND t.action_type='DOCUMENT_TRANSLATE'
            AND t.status IN ('QUEUED','RUNNING','RETRY_SCHEDULED')
            AND (t.trigger_request_id<>${`${input.translationRequestId}:partial-repair`}
              OR jsonb_exists(t.task_envelope_json::jsonb->'modelInput','retranslateBlockIds'))
            AND t.deadline_at>CURRENT_TIMESTAMP
            AND (t.lease_expires_at IS NULL OR t.lease_expires_at<=CURRENT_TIMESTAMP))
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
            AND (t.trigger_request_id LIKE ${`${input.translationRequestId}:resume-%`}
              OR t.trigger_request_id IN (${input.translationRequestId},
                ${`${input.translationRequestId}:hosted-m3`},${`${input.translationRequestId}:known-failure`}))
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
            AND (t.trigger_request_id LIKE ${`${input.translationRequestId}:resume-%`}
              OR t.trigger_request_id IN (${input.translationRequestId},${`${input.translationRequestId}:hosted-m3`},
              ${`${input.translationRequestId}:partial-repair`},${`${input.translationRequestId}:partial-repair-v2`},
              ${`${input.translationRequestId}:known-failure`}))
            AND t.subject_kind='DOCUMENT_VERSION' AND t.action_type='DOCUMENT_TRANSLATE'))
      ) AS missing`);
    return { pending: rows[0]?.pending === true, missing: rows[0]?.missing === true };
  }

  async reserve(input: WorkItemReservationInput): Promise<WorkItemReservation> {
    return this.db.transaction(async (transaction) => {
      if (input.developmentIntake) {
        // The request token identifies one actor and one source version, even
        // when two submissions race for different DocumentVersions.
        await transaction.execute(sql`select pg_advisory_xact_lock(
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
              lt(autoWorkItemAuthorization.leaseExpiresAt, input.now),
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
    const loaded = await this.loadTenantScopedProjection(
      input.workItemId,
      input.tenantId,
    );
    const receipt = loaded?.projection?.autoProcessingCompletionReceipt;
    const row = loaded?.row;
    return Boolean(
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
      Number.isFinite(Date.parse(receipt.completedAt)),
    );
  }

  /** Discovery only: completion is not a successor execution delegation. */
  async listCompletedAutoProcessingReviewSubjects(input: {
    tenantId: string;
    afterWorkItemId?: string;
    workItemId?: string;
    limit?: number;
  }): Promise<AutoWorkItemLeaseBinding[]> {
    return this.db
      .select({ authorization: autoWorkItemAuthorization, workItem })
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

  /** One conditional UPDATE elects a single queue consumer for each lease. */
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
  }): Promise<AutoWorkItemLease | null> {
    const [claimed] = await this.db
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
          or(
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
  }): Promise<{ acknowledgedAt: Date; replayed: boolean } | null> {
    return this.db.transaction(async (transaction) => {
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
            eq(
              autoWorkItemAuthorization.leaseGeneration,
              input.leaseGeneration,
            ),
            gt(autoWorkItemAuthorization.leaseExpiresAt, input.now),
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
  }): Promise<{ blockedAt: Date; blockedCode: string } | null> {
    const leaseTokenHash = createHash('sha256')
      .update(input.leaseToken)
      .digest('hex');
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
    return blocked?.blockedAt && blocked.blockedCode
      ? { blockedAt: blocked.blockedAt, blockedCode: blocked.blockedCode }
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
              projectionJson: JSON.stringify(rebound),
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

      if (
        !projection ||
        !(
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
          projectionJson: JSON.stringify(next),
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
          projectionJson: JSON.stringify(reopened),
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
  ): Promise<{
    row: typeof workItem.$inferSelect;
    projection: CanonicalWorkItemProjection | null;
  } | null> {
    const [row] = await this.db
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
          eq(workItem.workItemId, input.workItemId),
          eq(workItem.tenantId, input.tenantId),
          eq(workItem.requestedByUserId, input.actorUserId),
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
    }[],
  ): Promise<Map<string, WorkItemAuthorizationBinding>> {
    if (inputs.length < 2 || inputs.length > 4)
      throw new Error('WORK_ITEM_AUTHORIZATION_BATCH_SIZE_INVALID');
    const { tenantId, actorUserId } = inputs[0];
    if (
      inputs.some(
        (input) =>
          input.tenantId !== tenantId || input.actorUserId !== actorUserId,
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
          eq(workItem.requestedByUserId, actorUserId),
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
  }): Promise<WorkItemAuthorizationBinding | null> {
    const conditions = [
      eq(workItem.tenantId, input.tenantId),
      eq(workItem.documentVersionId, input.documentVersionId),
    ];
    if (input.actorUserId) {
      conditions.push(eq(workItem.requestedByUserId, input.actorUserId));
    }
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
    jobAidWorkRevisionGuard?: { tenantId: string; workRevisionRef: string };
  }): Promise<CanonicalWorkItemProjection> {
    if (input.jobAidWorkRevisionGuard) {
      const guard = input.jobAidWorkRevisionGuard;
      if (
        !guard.tenantId.trim() ||
        !/^JAWR-[A-Za-z0-9-]{1,91}$/u.test(guard.workRevisionRef) ||
        input.syncPrimaryAttempt !== false ||
        input.applicabilityInputGuard
      )
        throw new Error('JOBAID_OVERALL_WORK_CAS_GUARD_INVALID');
      return this.db.transaction(async (transaction) => {
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
        return this.persistProjectionCas(input, transaction);
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

  private async persistProjectionCas(
    input: Parameters<MiaodaWorkItemRepository['compareAndSet']>[0],
    db: Pick<PostgresJsDatabase, 'update'>,
  ): Promise<CanonicalWorkItemProjection> {
    const next: CanonicalWorkItemProjection = {
      ...input.next,
      revision: input.expectedRevision + 1,
    };
    const now = new Date();
    const updated = await db
      .update(workItem)
      .set({
        projectionJson: JSON.stringify(next),
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
