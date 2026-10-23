import { assertAutomaticWorkItemAttemptLease } from '../action-attempt/automatic-work-item-attempt-lease';
import type { AssessmentTdmsNativeEvidence } from '@shared/assessment-tdms-evidence';
import { tdmsReadObservation } from './jobaid-tdms-context';
import { assertTdmsSealedResultFence, tdmsReviewBinding, type TdmsReviewCaller } from '../tdms-source/tdms-review-delegation';
import { canonicalHostBareSha256 } from './canonical-host-sha256';
import type { JobAidKnowledgeObservationStatus } from '@shared/jobaid-activity.interface';
import { JOBAID_ACTIVITY_WINDOW, type JobAidExecutionObservation, type JobAidSavedActivityObservation } from './jobaid-activity';
import { readHistoricalJobAidWork } from './jobaid-historical-reading';
import { randomUUID } from 'node:crypto';
import { dmDocumentParseRun } from '../../database/document-parsing.schema';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { HierarchicalWikiChanges } from './hierarchical-wiki-changes';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  JobAidProblemWorkContent,
  JobAidWorkRevision,
  JobAidWorkingReadModel,
} from '@shared/jobaid-problem-assessment.interface';
import {
  actionAttempt,
  assessmentWorkRevision,
  identitySubjectMapping,
  reviewTurn,
  workItem,
} from '../../database/schema';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { ACTION_ATTEMPT_REQUEST_ORIGIN, type ActionAttemptRow } from '../action-attempt/action-attempt.types';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import type { JobAidSourceBinding } from './jobaid-problem-task';
import { EngineeringSearchProjectionWriter } from './engineering-search-projection';

type StoredJobAidWork = Pick<typeof assessmentWorkRevision.$inferSelect,
  'assessmentWorkRevisionId' | 'workItemId' | 'workRevision' | 'previousWorkRevisionId' |
  'requestId' | 'actionAttemptId' | 'basedOnWorkItemRevision' | 'documentVersionId' | 'createdAt' | 'contentJson'>;

export interface JobAidWorkFence {
  principalId: string;
  leaseToken: string;
  leaseGeneration: number;
  allowCommittingReview?: boolean;
  automaticLeaseRequired?: boolean;
}

interface JobAidSaveScope {
  row: ActionAttemptRow;
  actorUserId: string;
  fence: JobAidWorkFence;
  sourceBindings: JobAidSourceBinding[];
  reviewCaller?:TdmsReviewCaller;
}

export function assertJobAidWorkFence(
  row: Pick<
    ActionAttemptRow,
    | 'status'
    | 'leaseOwner'
    | 'leaseToken'
    | 'leaseGeneration'
    | 'leaseExpiresAt'
    | 'deadlineAt'
    | 'cancelRequestedAt'
  >,
  fence: JobAidWorkFence,
  now = new Date(),
): void {
  if (
    (row.status !== 'RUNNING' &&
      !(fence.allowCommittingReview && row.status === 'COMMITTING')) ||
    row.cancelRequestedAt ||
    row.leaseOwner !== fence.principalId ||
    row.leaseToken !== fence.leaseToken ||
    row.leaseGeneration !== fence.leaseGeneration ||
    !row.leaseExpiresAt ||
    row.leaseExpiresAt <= now ||
    !row.deadlineAt ||
    row.deadlineAt <= now
  )
    throw new Error('JOBAID_WORK_LEASE_FENCE_REJECTED');
}

@Injectable()
export class JobAidWorkRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly actorTransactions: EngineeringMatterWorkingRepository,
    private readonly searchProjection: EngineeringSearchProjectionWriter,
    @Optional() private readonly wikiChanges?: HierarchicalWikiChanges,
  ) {}

  async withActorScope<T>(actorUserId: string, operation: () => Promise<T>, database?: PostgresJsDatabase): Promise<T> {
    return this.actorTransactions.withActorScope(actorUserId, operation, database);
  }

  async publishedOriginalBinding(input: { tenantId: string; actorUserId: string; workItemId: string; documentVersionId: string }) {
    return this.withActorTransaction(input.actorUserId, database => this.readPublishedOriginalBinding(input, database));
  }

  /** Request admission uses the existing authenticated SQL identity and RLS.
   * It must not attempt to enter the Hosted service actor scope. */
  async publishedOriginalBindingForRequest(input: { tenantId: string; actorUserId: string; workItemId: string; documentVersionId: string }) {
    return this.db.transaction(database => this.readPublishedOriginalBinding(input, database as PostgresJsDatabase));
  }

  async publishedOriginalBindingInTransaction(
    input: { tenantId: string; actorUserId: string; workItemId: string; documentVersionId: string },
    database: PostgresJsDatabase,
  ) {
    return this.readPublishedOriginalBinding(input, database);
  }

  private async readPublishedOriginalBinding(
    input: { tenantId: string; actorUserId: string; workItemId: string; documentVersionId: string },
    database: PostgresJsDatabase,
  ) {
    const owned = await this.loadOwnedSourceBinding({...input,kind:'SOURCE_FILE'}, database);
    if (!owned || owned.documentVersionId !== input.documentVersionId) throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
    const [run] = await database.select({ parseRunId: dmDocumentParseRun.parseRunId, parseRevision: dmDocumentParseRun.parseRevision }).from(dmDocumentParseRun)
      .where(and(eq(dmDocumentParseRun.tenantId,input.tenantId),eq(dmDocumentParseRun.documentVersionId,input.documentVersionId),
        eq(dmDocumentParseRun.status,'PUBLISHED'))).orderBy(desc(dmDocumentParseRun.parseRevision)).limit(1);
    if (!run) throw new Error('DOCUMENT_ORIGINAL_NOT_PUBLISHED');
    return run;
  }

  /** The caller supplies the actor resolved from the Host owner/task binding. */
  async withActorTransaction<T>(
    actorUserId: string,
    operation: (database: PostgresJsDatabase) => Promise<T>,
  ): Promise<T> {
    return this.actorTransactions.withActorTransaction(
      actorUserId,
      ({ database }) => operation(database),
    );
  }

  async loadOwnedSourceBinding(
    input: { tenantId: string; workItemId: string; actorUserId: string; kind?: 'SOURCE_FILE' },
    database: PostgresJsDatabase,
  ): Promise<JobAidSourceBinding | null> {
    const [row] = await database
      .select({
        documentVersionId: workItem.documentVersionId,
        projectionJson: workItem.projectionJson,
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
    if (!row?.projectionJson) return null;
    const projection = JSON.parse(row.projectionJson) as {
      package?: { artifact?: { ref?: unknown; sha256?: unknown } };
      source?: {sourceArtifactId?: string;sourceFileSha256?: string};
    };
    if (input.kind === 'SOURCE_FILE') {
      const source=projection.source;
      const sha256 = canonicalHostBareSha256(source?.sourceFileSha256);
      if (!source?.sourceArtifactId || !sha256) return null;
      return {kind:'SOURCE_FILE',workItemId:input.workItemId,documentVersionId:row.documentVersionId,
        artifactRef:source.sourceArtifactId,artifactSha256:sha256};
    }
    const artifact = projection.package?.artifact;
    if (
      typeof artifact?.ref !== 'string' ||
      !artifact.ref ||
      typeof artifact.sha256 !== 'string' ||
      !artifact.sha256
    )
      return null;
    return {
      workItemId: input.workItemId,
      documentVersionId: row.documentVersionId,
      artifactRef: artifact.ref,
      artifactSha256: artifact.sha256,
    };
  }

  async reviewTurnBindingForProjection(input: {
    tenantId: string;
    actorUserId: string;
    workItemId: string;
    reviewTurnId: string;
    actionAttemptId: string;
  }): Promise<{ reviewConversationId: string } | null> {
    const [turn] = await this.db.select({
      reviewConversationId: reviewTurn.reviewConversationId,
    }).from(reviewTurn).innerJoin(actionAttempt,
      eq(actionAttempt.attemptId, reviewTurn.actionAttemptId))
      .where(and(
        eq(reviewTurn.tenantId, input.tenantId),
        eq(reviewTurn.actorId, input.actorUserId),
        eq(reviewTurn.workItemId, input.workItemId),
        eq(reviewTurn.reviewTurnId, input.reviewTurnId),
        eq(reviewTurn.actionAttemptId, input.actionAttemptId),
        eq(actionAttempt.status, 'SUCCEEDED'),
        eq(actionAttempt.actionType, 'OPENCLAW_INTERACTIVE_REVIEW'),
      )).limit(1);
    return turn ?? null;
  }

  async hasActiveReviewOverallConflict(tenantId: string, workItemId: string,
    actionTypes: string[], statuses: string[]): Promise<boolean> {
    const [active] = await this.db.select({ id: actionAttempt.attemptId })
      .from(actionAttempt).where(and(
        eq(actionAttempt.tenantId, tenantId),
        eq(actionAttempt.workItemId, workItemId),
        inArray(actionAttempt.actionType, actionTypes),
        inArray(actionAttempt.status, statuses),
      )).limit(1);
    return !!active;
  }

  async list(
    input: { tenantId: string; workItemId: string },
    db = this.db,
  ): Promise<JobAidWorkRevision[]> {
    const rows = await db
      .select()
      .from(assessmentWorkRevision)
      .where(
        and(
          eq(assessmentWorkRevision.tenantId, input.tenantId),
          eq(assessmentWorkRevision.workItemId, input.workItemId),
        ),
      )
      .orderBy(desc(assessmentWorkRevision.workRevision));
    return rows.map(project);
  }

  async latest(
    input: { tenantId: string; workItemId: string },
    db = this.db,
  ): Promise<JobAidWorkRevision | null> {
    const [row] = await db
      .select()
      .from(assessmentWorkRevision)
      .where(
        and(
          eq(assessmentWorkRevision.tenantId, input.tenantId),
          eq(assessmentWorkRevision.workItemId, input.workItemId),
        ),
      )
      .orderBy(desc(assessmentWorkRevision.workRevision))
      .limit(1);
    return row ? project(row) : null;
  }

  async latestForRuntime(input: {
    tenantId: string;
    workItemId: string;
    actorUserId: string;
  }): Promise<JobAidWorkRevision | null> {
    return this.actorTransactions.withActorTransaction(
      input.actorUserId,
      ({ database }) => this.latest(input, database),
    );
  }

  /** Exact revision lookup stays inside the owner/RLS scope, never a global id lookup. */
  async readByRef(
    input: { tenantId: string; workItemId: string; workRevisionRef: string },
    database = this.db,
  ): Promise<JobAidWorkRevision | null> {
    const [row] = await database
      .select()
      .from(assessmentWorkRevision)
      .where(
        and(
          eq(assessmentWorkRevision.tenantId, input.tenantId),
          eq(assessmentWorkRevision.workItemId, input.workItemId),
          eq(assessmentWorkRevision.assessmentWorkRevisionId, input.workRevisionRef),
        ),
      )
      .limit(1);
    return row ? project(row) : null;
  }

  async readByRefForRuntime(input: {
    tenantId: string;
    workItemId: string;
    actorUserId: string;
    workRevisionRef: string;
  }): Promise<JobAidWorkRevision | null> {
    return this.actorTransactions.withActorTransaction(
      input.actorUserId,
      ({ database }) => this.readByRef(input, database),
    );
  }

  /** Exact immutable work lookup for an already-held runtime transaction. The
   * existing service-role check and SDK actor context use the supplied executor;
   * no root-pool role query or nested transaction is opened. */
  async readByRefForRuntimeInTransaction(input: {
    tenantId: string;
    workItemId: string;
    actorUserId: string;
    workRevisionRef: string;
  }, database: PostgresJsDatabase): Promise<JobAidWorkRevision | null> {
    return this.actorTransactions.withActorScope(input.actorUserId, async () => {
      const [row] = await database.select().from(assessmentWorkRevision).where(and(
        eq(assessmentWorkRevision.tenantId, input.tenantId),
        eq(assessmentWorkRevision.workItemId, input.workItemId),
        eq(assessmentWorkRevision.assessmentWorkRevisionId, input.workRevisionRef),
        eq(assessmentWorkRevision.createdByUserId, input.actorUserId),
      )).limit(1);
      return row ? project(row) : null;
    }, database);
  }

  /** Context discovery needs identities, not every historical issue body. */
  async listHeadersForRuntime(input: {
    tenantId: string;
    workItemId: string;
    actorUserId: string;
  }): Promise<
    Array<Pick<JobAidWorkRevision, 'workRevisionRef' | 'workRevision'>>
  > {
    return this.actorTransactions.withActorTransaction(
      input.actorUserId,
      ({ database }) =>
        database
          .select({
            workRevisionRef: assessmentWorkRevision.assessmentWorkRevisionId,
            workRevision: assessmentWorkRevision.workRevision,
          })
          .from(assessmentWorkRevision)
          .where(
            and(
              eq(assessmentWorkRevision.tenantId, input.tenantId),
              eq(assessmentWorkRevision.workItemId, input.workItemId),
            ),
          )
          .orderBy(desc(assessmentWorkRevision.workRevision)),
    );
  }

  async listForRuntime(input: {
    tenantId: string;
    workItemId: string;
    actorUserId: string;
  }): Promise<JobAidWorkRevision[]> {
    return this.actorTransactions.withActorTransaction(
      input.actorUserId,
      ({ database }) => this.list(input, database),
    );
  }

  /** One statement gives one MVCC snapshot without switching the platform's
   * authenticated transaction type (Datapaas rejects SET TRANSACTION). */
  async readBrowserSnapshot(input: {
    tenantId: string;
    workItemId: string;
    documentVersionId: string;
  }) {
    const rows = await this.db.execute<{
      execution: JobAidExecutionObservation | null;
      latestAttempt: JobAidWorkingReadModel['latestAttempt'];
      current: (Omit<StoredJobAidWork, 'createdAt'> & { createdAt: string }) | null;
      savedActivity: Array<Omit<JobAidSavedActivityObservation, 'createdAt'> & { createdAt: string }>;
    }>(sql`
      WITH selected_execution AS (
        SELECT ${actionAttempt.status} AS "status", ${actionAttempt.attemptId} AS "attemptId",
          ${actionAttempt.operationRef} AS "attemptRef", ${actionAttempt.reviewActivityJson} AS "activityJson"
        FROM ${actionAttempt}
        WHERE ${actionAttempt.tenantId} = ${input.tenantId}
          AND ${actionAttempt.workItemId} = ${input.workItemId}
          AND ${actionAttempt.documentVersionId} = ${input.documentVersionId}
          AND ${actionAttempt.subjectKind} = 'WORK_ITEM'
          AND ${actionAttempt.requestOrigin} = ${ACTION_ATTEMPT_REQUEST_ORIGIN}
          AND ${actionAttempt.actionType} IN ('OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS')
        ORDER BY CASE WHEN ${actionAttempt.status} IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING') THEN 1 ELSE 0 END DESC,
          ${actionAttempt.createdAt} DESC, ${actionAttempt.attemptId} DESC LIMIT 1
      ), selected_dynamic AS (
        SELECT ${actionAttempt.attemptId} AS "attemptId", ${actionAttempt.status} AS "status",
          ${actionAttempt.inputRevision} AS "inputRevision",
          ${actionAttempt.createdAt} AS "createdAt", ${actionAttempt.startedAt} AS "startedAt",
          ${actionAttempt.completedAt} AS "completedAt",
          (SELECT min(${assessmentWorkRevision.createdAt}) FROM ${assessmentWorkRevision}
            WHERE ${assessmentWorkRevision.tenantId} = ${input.tenantId}
              AND ${assessmentWorkRevision.workItemId} = ${input.workItemId}
              AND ${assessmentWorkRevision.documentVersionId} = ${input.documentVersionId}
              AND ${assessmentWorkRevision.actionAttemptId} = ${actionAttempt.attemptId}) AS "firstSavedAt"
        FROM ${actionAttempt}
        WHERE ${actionAttempt.tenantId} = ${input.tenantId}
          AND ${actionAttempt.workItemId} = ${input.workItemId}
          AND ${actionAttempt.documentVersionId} = ${input.documentVersionId}
          AND ${actionAttempt.subjectKind} = 'WORK_ITEM'
          AND ${actionAttempt.requestOrigin} = ${ACTION_ATTEMPT_REQUEST_ORIGIN}
          AND ${actionAttempt.actionType} = 'OPENCLAW_DYNAMIC_EVALUATION'
        ORDER BY ${actionAttempt.attemptNo} DESC, ${actionAttempt.attemptId} DESC LIMIT 1
      ), selected_work AS (
        SELECT ${assessmentWorkRevision.assessmentWorkRevisionId} AS "assessmentWorkRevisionId",
          ${assessmentWorkRevision.workItemId} AS "workItemId", ${assessmentWorkRevision.workRevision} AS "workRevision",
          ${assessmentWorkRevision.previousWorkRevisionId} AS "previousWorkRevisionId",
          ${assessmentWorkRevision.requestId} AS "requestId", ${assessmentWorkRevision.actionAttemptId} AS "actionAttemptId",
          ${assessmentWorkRevision.basedOnWorkItemRevision} AS "basedOnWorkItemRevision",
          ${assessmentWorkRevision.documentVersionId} AS "documentVersionId",
          ${assessmentWorkRevision.createdAt} AS "createdAt", ${assessmentWorkRevision.contentJson} AS "contentJson"
        FROM ${assessmentWorkRevision}
        WHERE ${assessmentWorkRevision.tenantId} = ${input.tenantId}
          AND ${assessmentWorkRevision.workItemId} = ${input.workItemId}
        ORDER BY ${assessmentWorkRevision.workRevision} DESC LIMIT 1
      ), selected_saves AS (
        SELECT ${assessmentWorkRevision.assessmentWorkRevisionId} AS "workRevisionRef",
          ${assessmentWorkRevision.workRevision} AS "workRevision", ${assessmentWorkRevision.createdAt} AS "createdAt"
        FROM ${assessmentWorkRevision}
        WHERE ${assessmentWorkRevision.tenantId} = ${input.tenantId}
          AND ${assessmentWorkRevision.workItemId} = ${input.workItemId}
          AND ${assessmentWorkRevision.documentVersionId} = ${input.documentVersionId}
          AND ${assessmentWorkRevision.actionAttemptId} = (SELECT "attemptId" FROM selected_execution)
        ORDER BY ${assessmentWorkRevision.workRevision} DESC LIMIT ${JOBAID_ACTIVITY_WINDOW + 1}
      )
      SELECT (SELECT to_jsonb(e) FROM selected_execution e) AS "execution",
        (SELECT to_jsonb(d) FROM selected_dynamic d) AS "latestAttempt",
        (SELECT to_jsonb(w) FROM selected_work w) AS "current",
        (SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."workRevision" DESC), '[]'::jsonb)
          FROM selected_saves s) AS "savedActivity"
    `);
    const row = rows[0];
    if (!row) throw new Error('JOBAID_SNAPSHOT_READBACK_MISSING');
    return { execution: row.execution, latestAttempt: row.latestAttempt ? {
      ...row.latestAttempt,
      createdAt: new Date(row.latestAttempt.createdAt!).toISOString(),
      startedAt: row.latestAttempt.startedAt ? new Date(row.latestAttempt.startedAt).toISOString() : null,
      completedAt: row.latestAttempt.completedAt ? new Date(row.latestAttempt.completedAt).toISOString() : null,
      firstSavedAt: row.latestAttempt.firstSavedAt ? new Date(row.latestAttempt.firstSavedAt).toISOString() : null,
    } : null,
      current: row.current ? project({ ...row.current, createdAt: new Date(row.current.createdAt) }) : null,
      savedActivity: row.savedActivity.map(saved => ({ ...saved, createdAt: new Date(saved.createdAt) })) };
  }

  async readCurrentExecution(input: {
    tenantId: string;
    workItemId: string;
    documentVersionId: string;
  }, database = this.db): Promise<JobAidExecutionObservation | null> {
    const [row] = await database
      .select({ status: actionAttempt.status, attemptId: actionAttempt.attemptId,
        attemptRef: actionAttempt.operationRef, activityJson: actionAttempt.reviewActivityJson })
      .from(actionAttempt)
      .where(and(
        eq(actionAttempt.tenantId, input.tenantId),
        eq(actionAttempt.workItemId, input.workItemId),
        eq(actionAttempt.documentVersionId, input.documentVersionId),
        eq(actionAttempt.subjectKind, 'WORK_ITEM'),
        eq(actionAttempt.requestOrigin, ACTION_ATTEMPT_REQUEST_ORIGIN),
        inArray(actionAttempt.actionType, ['OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS']),
      ))
      .orderBy(
        desc(sql`CASE WHEN ${actionAttempt.status} IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING') THEN 1 ELSE 0 END`),
        desc(actionAttempt.createdAt),
        desc(actionAttempt.attemptId),
      )
      .limit(1);
    return row ?? null;
  }

  async readSavedActivity(input: {
    tenantId: string; workItemId: string; documentVersionId: string; actionAttemptId: string;
  }, database = this.db): Promise<JobAidSavedActivityObservation[]> {
    return database.select({
      workRevisionRef: assessmentWorkRevision.assessmentWorkRevisionId,
      workRevision: assessmentWorkRevision.workRevision,
      createdAt: assessmentWorkRevision.createdAt,
    }).from(assessmentWorkRevision).where(and(
      eq(assessmentWorkRevision.tenantId, input.tenantId),
      eq(assessmentWorkRevision.workItemId, input.workItemId),
      eq(assessmentWorkRevision.documentVersionId, input.documentVersionId),
      eq(assessmentWorkRevision.actionAttemptId, input.actionAttemptId),
    )).orderBy(desc(assessmentWorkRevision.workRevision)).limit(JOBAID_ACTIVITY_WINDOW + 1);
  }

  async save(
    input: {
      row: ActionAttemptRow;
      actorUserId: string;
      fence: JobAidWorkFence;
      sourceBindings: JobAidSourceBinding[];
      requestId: string;
      expectedWorkRevision: number;
      command: unknown;
      content: JobAidProblemWorkContent;
      assertNativeAuthorized?: (database: PostgresJsDatabase) => Promise<void>;
      reviewCaller?:TdmsReviewCaller;
    },
    executor?: PostgresJsDatabase,
  ): Promise<{ revision: JobAidWorkRevision; replayed: boolean }> {
    if (
      !/^[A-Za-z0-9:_-]{1,96}$/u.test(input.requestId) ||
      !Number.isSafeInteger(input.expectedWorkRevision) ||
      input.expectedWorkRevision < 0
    )
      throw new Error('JOBAID_SAVE_IDENTITY_INVALID');
    if (input.content.evidence.some(item=>item.kind==='TDMS_NATIVE_RECORD') && !input.assertNativeAuthorized)
      throw new Error('TDMS_NATIVE_EVIDENCE_VERIFIER_UNAVAILABLE');
    const commandJson = canonicalJson(input.command);
    const apply = async (database: PostgresJsDatabase) => {
      await input.assertNativeAuthorized?.(database);
      const { primary, attempt } = await this.lockSaveScope(input, database);
      const [existing] = await database
        .select()
        .from(assessmentWorkRevision)
        .where(
          and(
            eq(assessmentWorkRevision.tenantId, input.row.tenantId),
            eq(assessmentWorkRevision.workItemId, input.row.workItemId),
            eq(assessmentWorkRevision.requestId, input.requestId),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.actionAttemptId !== attempt.attemptId ||
          existing.commandJson !== commandJson ||
          existing.basedOnWorkItemRevision !== attempt.baseRevision
        )
          throw new Error('JOBAID_SAVE_REQUEST_REUSE');
        // Response-loss recovery returns the original saved content even after
        // this attempt becomes terminal. It cannot advance a working pointer.
        await input.assertNativeAuthorized?.(database);
        return { revision: project(existing), replayed: true };
      }
      if (
        input.fence.allowCommittingReview &&
        attempt.actionType !== 'OPENCLAW_INTERACTIVE_REVIEW'
      )
        throw new Error('JOBAID_REVIEW_SAVE_BINDING_INVALID');
      if(input.reviewCaller && tdmsReviewBinding(input.reviewCaller).attempt?.phase==='SEALED_RECOVERY') {
        if(!executor || !input.assertNativeAuthorized) throw new Error('TDMS_SEALED_RECOVERY_TRANSACTION_REQUIRED');
        const sealed=assertTdmsSealedResultFence(input.reviewCaller,attempt,input.fence,'REVIEW');
        const candidate=JSON.parse(sealed.modelOutput),binding=tdmsReviewBinding(input.reviewCaller);
        if(!candidate.jobAidWorkingDelta || input.requestId!==`review-turn:${binding.reviewTurnRef}` ||
          input.expectedWorkRevision!==binding.workRevision ||
          commandJson!==canonicalJson({expectedWorkRevision:binding.workRevision,work:candidate.jobAidWorkingDelta}))
          throw new Error('TDMS_SEALED_RECOVERY_PAYLOAD_CHANGED');
      } else assertJobAidWorkFence(attempt, input.fence);
      if (primary.revision !== attempt.baseRevision)
        throw new Error('JOBAID_SAVE_WORK_ITEM_CHANGED');
      const current = await this.latest(
        { tenantId: attempt.tenantId, workItemId: attempt.workItemId },
        database,
      );
      if ((current?.workRevision ?? 0) !== input.expectedWorkRevision)
        throw new Error('JOBAID_WORK_REVISION_CONFLICT');
      await input.assertNativeAuthorized?.(database);
      const [saved] = await database
        .insert(assessmentWorkRevision)
        .values({
          assessmentWorkRevisionId: `JAWR-${randomUUID()}`,
          tenantId: attempt.tenantId,
          workItemId: attempt.workItemId,
          workRevision: input.expectedWorkRevision + 1,
          requestId: input.requestId,
          actionAttemptId: attempt.attemptId,
          basedOnWorkItemRevision: attempt.baseRevision!,
          documentVersionId: attempt.documentVersionId!,
          previousWorkRevisionId: current?.workRevisionRef ?? null,
          commandJson,
          contentJson: canonicalJson(input.content),
          createdByUserId: input.actorUserId,
        })
        .returning();
      if (!saved) throw new Error('JOBAID_WORK_SAVE_READBACK_MISSING');
      await this.searchProjection.enqueuePending({ tenantId: saved.tenantId, ownerKind: 'USER',
        ownerId: saved.createdByUserId, subjectId: saved.workItemId,
        revisionRef: saved.assessmentWorkRevisionId, database });
      await this.wikiChanges?.record({ tenantId: saved.tenantId, actorUserId: input.actorUserId,
        kind: 'WORK_ITEM', subjectId: saved.workItemId, versionRef: saved.assessmentWorkRevisionId }, database);
      await input.assertNativeAuthorized?.(database);
      return { revision: project(saved), replayed: false };
    };
    return executor
      ? apply(executor)
      : this.actorTransactions.withActorTransaction(
          input.actorUserId,
          ({ database }) => apply(database),
        );
  }

  /** Check an unchanged Review under its caller's already-held actor
   * transaction. All work writers lock these sources before comparing latest. */
  async assertReviewUnchanged(
    input: JobAidSaveScope & { expectedWorkRevisionRef: string; expectedWorkRevision: number },
    database: PostgresJsDatabase,
  ): Promise<JobAidWorkRevision> {
    if (!input.expectedWorkRevisionRef?.trim() || !Number.isSafeInteger(input.expectedWorkRevision) ||
        input.expectedWorkRevision < 1)
      throw new Error('JOBAID_REVIEW_UNCHANGED_BASIS_INVALID');
    return this.actorTransactions.withActorScope(input.actorUserId, async () => {
      const { primary, attempt } = await this.lockSaveScope(input, database);
      if (attempt.actionType !== 'OPENCLAW_INTERACTIVE_REVIEW' || attempt.actionType !== input.row.actionType ||
          attempt.actorUserId !== input.actorUserId || attempt.actorUserId !== input.row.actorUserId ||
          attempt.inputRevision !== input.row.inputRevision || attempt.inputRevision !== attempt.baseRevision ||
          attempt.requestOrigin !== ACTION_ATTEMPT_REQUEST_ORIGIN || attempt.requestOrigin !== input.row.requestOrigin)
        throw new Error('JOBAID_REVIEW_SAVE_BINDING_INVALID');
      if(input.reviewCaller && tdmsReviewBinding(input.reviewCaller).attempt?.phase==='SEALED_RECOVERY') {
        const sealed=assertTdmsSealedResultFence(input.reviewCaller,attempt,input.fence,'REVIEW');
        const binding=tdmsReviewBinding(input.reviewCaller);
        if(JSON.parse(sealed.modelOutput).jobAidWorkingDelta!==null || input.expectedWorkRevisionRef!==binding.workRevisionRef ||
          input.expectedWorkRevision!==binding.workRevision) throw new Error('TDMS_SEALED_RECOVERY_PAYLOAD_CHANGED');
      } else assertJobAidWorkFence(attempt, { ...input.fence, allowCommittingReview: true });
      if (primary.documentVersionId !== attempt.documentVersionId)
        throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
      if (primary.revision !== attempt.baseRevision) throw new Error('JOBAID_SAVE_WORK_ITEM_CHANGED');
      const latest = await this.latest({ tenantId: attempt.tenantId, workItemId: attempt.workItemId }, database);
      if (!latest || latest.workRevisionRef !== input.expectedWorkRevisionRef ||
          latest.workRevision !== input.expectedWorkRevision)
        throw new Error('JOBAID_WORK_REVISION_CONFLICT');
      const current = await this.readByRefForRuntimeInTransaction({
        tenantId: attempt.tenantId, workItemId: attempt.workItemId, actorUserId: input.actorUserId,
        workRevisionRef: input.expectedWorkRevisionRef,
      }, database);
      if (!current || current.documentVersionId !== attempt.documentVersionId ||
          current.workRevision !== input.expectedWorkRevision)
        throw new Error('JOBAID_REVIEW_UNCHANGED_BASIS_INVALID');
      return current;
    }, database);
  }

  private async lockSaveScope(input: JobAidSaveScope, database: PostgresJsDatabase) {
    const primary = await this.lockSources(database, input.row, input.actorUserId, input.sourceBindings);
    await assertAutomaticWorkItemAttemptLease(database, input.row, input.fence.principalId, input.fence.automaticLeaseRequired);
    const [attempt] = await database.select().from(actionAttempt).where(and(
      eq(actionAttempt.attemptId, input.row.attemptId),
      eq(actionAttempt.tenantId, input.row.tenantId),
      eq(actionAttempt.workItemId, input.row.workItemId),
    )).for('update');
    if (!attempt || attempt.taskInputHash !== input.row.taskInputHash ||
        attempt.baseRevision !== input.row.baseRevision || attempt.documentVersionId !== input.row.documentVersionId ||
        !['OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS', 'OPENCLAW_INTERACTIVE_REVIEW'].includes(attempt.actionType))
      throw new Error('JOBAID_SAVE_ATTEMPT_CHANGED');
    return { primary, attempt };
  }

  async recordSourceRead(input: {
    row: ActionAttemptRow;
    actorUserId: string;
    fence: JobAidWorkFence;
    sourceBindings: JobAidSourceBinding[];
    sourceRefs: string[];
    purpose: string;
    nativeEvidence?: AssessmentTdmsNativeEvidence[];
    assertNativeAuthorized?: (database: PostgresJsDatabase) => Promise<void>;
  }): Promise<void> {
    return this.recordReadObservation(input, {
      kind: 'ASSESSMENT_SOURCES_READ',
      sourceRefs: input.sourceRefs,
      purpose: input.purpose,
      ...(input.nativeEvidence ? {nativeEvidence:input.nativeEvidence} : {}),
    });
  }

  async recordKnowledgeObservation(input: {
    row: ActionAttemptRow;
    actorUserId: string;
    fence: JobAidWorkFence;
    sourceBindings: JobAidSourceBinding[];
    status: JobAidKnowledgeObservationStatus;
  }): Promise<void> {
    return this.recordReadObservation(input, {
      kind: 'ASSESSMENT_KNOWLEDGE_OBSERVED', status: input.status,
    });
  }

  private async recordReadObservation(input: {
    row: ActionAttemptRow;
    actorUserId: string;
    fence: JobAidWorkFence;
    sourceBindings: JobAidSourceBinding[];
    assertNativeAuthorized?: (database: PostgresJsDatabase) => Promise<void>;
  }, observation: { kind: 'ASSESSMENT_SOURCES_READ'; sourceRefs: string[]; purpose: string; nativeEvidence?: AssessmentTdmsNativeEvidence[] }
    | { kind: 'ASSESSMENT_KNOWLEDGE_OBSERVED'; status: JobAidKnowledgeObservationStatus }): Promise<void> {
    await this.actorTransactions.withActorTransaction(
      input.actorUserId,
      async ({ database }) => {
        if (observation.kind === 'ASSESSMENT_SOURCES_READ' && observation.nativeEvidence?.length) {
          if (!input.assertNativeAuthorized) throw new Error('TDMS_NATIVE_EVIDENCE_VERIFIER_UNAVAILABLE');
          if (observation.nativeEvidence.some(item=>!observation.sourceRefs.includes(item.evidenceRef)))
            throw new Error('JOBAID_TDMS_READ_BINDING_INVALID');
        }
        await input.assertNativeAuthorized?.(database);
        const primary = await this.lockSources(
          database,
          input.row,
          input.actorUserId,
          input.sourceBindings,
        );
        await assertAutomaticWorkItemAttemptLease(database, input.row, input.fence.principalId, input.fence.automaticLeaseRequired);
        const [attempt] = await database
          .select()
          .from(actionAttempt)
          .where(
            and(
              eq(actionAttempt.attemptId, input.row.attemptId),
              eq(actionAttempt.tenantId, input.row.tenantId),
              eq(actionAttempt.workItemId, input.row.workItemId),
            ),
          )
          .for('update');
        if (
          !attempt ||
          attempt.taskInputHash !== input.row.taskInputHash ||
          attempt.baseRevision !== primary.revision
        )
          throw new Error('JOBAID_SOURCE_READ_BINDING_CHANGED');
        assertJobAidWorkFence(attempt, input.fence);
        await input.assertNativeAuthorized?.(database);
        const activity = {
          ...observation,
          ...(observation.kind === 'ASSESSMENT_SOURCES_READ' ? tdmsReadObservation(observation,attempt.reviewActivityJson,attempt.operationRef) : {}),
          observedAt: new Date().toISOString(),
        };
        await database
          .update(actionAttempt)
          .set({
            reviewActivityJson: sql`(COALESCE(${actionAttempt.reviewActivityJson}::jsonb, '[]'::jsonb) || ${JSON.stringify([activity])}::jsonb)::text`,
          })
          .where(eq(actionAttempt.attemptId, attempt.attemptId));
        await input.assertNativeAuthorized?.(database);
      },
    );
  }

  private async lockSources(
    db: PostgresJsDatabase,
    attempt: ActionAttemptRow,
    actorUserId: string,
    bindings: JobAidSourceBinding[],
  ) {
    const [mapping] = await db
      .select({ id: identitySubjectMapping.id })
      .from(identitySubjectMapping)
      .where(
        and(
          eq(identitySubjectMapping.miaodaUserId, actorUserId),
          eq(identitySubjectMapping.miaodaTenantId, attempt.tenantId),
          eq(identitySubjectMapping.expectedClientId, 'cli_aadde8b579f95bc9'),
          eq(identitySubjectMapping.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    if (!mapping) throw new Error('JOBAID_ACTOR_AUTHORIZATION_CHANGED');
    const ordered = [...bindings].sort((a, b) =>
      a.workItemId < b.workItemId ? -1 : a.workItemId > b.workItemId ? 1 : 0,
    );
    if (!ordered.some((item) => item.workItemId === attempt.workItemId))
      throw new Error('JOBAID_PRIMARY_SOURCE_BINDING_MISSING');
    let primary: typeof workItem.$inferSelect | undefined;
    for (const binding of ordered) {
      const [row] = await db
        .select()
        .from(workItem)
        .where(
          and(
            eq(workItem.workItemId, binding.workItemId),
            eq(workItem.tenantId, attempt.tenantId),
            eq(workItem.requestedByUserId, actorUserId),
          ),
        )
        .for('update');
      if (
        !row ||
        row.documentVersionId !== binding.documentVersionId ||
        !row.projectionJson
      )
        throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
      const projection = JSON.parse(row.projectionJson) as {
        package?: { artifact?: { ref?: string; sha256?: string } };
        source?: {sourceArtifactId?: string;sourceFileSha256?: string};
      };
      if (binding.kind === 'SOURCE_FILE'
        ? projection.source?.sourceArtifactId !== binding.artifactRef || canonicalHostBareSha256(projection.source?.sourceFileSha256) !== binding.artifactSha256
        : projection.package?.artifact?.ref !== binding.artifactRef ||
          projection.package?.artifact?.sha256 !== binding.artifactSha256)
        throw new Error('JOBAID_SOURCE_VERSION_CHANGED');
      if (row.workItemId === attempt.workItemId) primary = row;
    }
    if (!primary) throw new Error('JOBAID_PRIMARY_SOURCE_NOT_FOUND');
    return primary;
  }
}

function project(
  row: StoredJobAidWork,
): JobAidWorkRevision {
  const content = readHistoricalJobAidWork(JSON.parse(row.contentJson), { workItemId: row.workItemId });
  if (
    content.schemaVersion !== 'wiselink.jobaid-problem-work.v3' ||
    !Array.isArray(content.issues)
  )
    throw new Error('JOBAID_STORED_WORK_INVALID');
  return {
    workRevisionRef: row.assessmentWorkRevisionId,
    workItemId: row.workItemId,
    workRevision: row.workRevision,
    previousWorkRevisionRef: row.previousWorkRevisionId,
    requestId: row.requestId,
    actionAttemptId: row.actionAttemptId,
    basedOnWorkItemRevision: row.basedOnWorkItemRevision,
    documentVersionId: row.documentVersionId,
    createdAt: new Date(row.createdAt).toISOString(),
    content,
  };
}
