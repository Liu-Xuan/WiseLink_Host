import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  or,
} from 'drizzle-orm';

import type {
  CanonicalParseAuthorizationProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  actionAttempt,
  dmDocumentVersion,
  dmPublicationFamily,
  workItem,
} from '../../database/schema';

const ACTION_TYPE = 'PARSE_PDF';

export interface WorkItemReservationInput {
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

export interface OwnedLibraryCatalogCursor {
  updatedAt: Date;
  workItemId: string;
}

export interface OwnedLibraryCatalogRow {
  workItemId: string;
  revision: number;
  status: string;
  documentId: string;
  documentVersionId: string;
  requestedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  projection: CanonicalWorkItemProjection | null;
  documentCode: string;
  documentFamily: string;
  businessRevision: string;
  currentDocumentVersionId: string | null;
  currentGeneration: number;
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

@Injectable()
export class MiaodaWorkItemRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async reserve(input: WorkItemReservationInput): Promise<WorkItemReservation> {
    return this.db.transaction(async (transaction) => {
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
      return {
        workItemId: stored.workItemId,
        requestId: stored.requestId,
        attemptId: attempt.attemptId,
        created,
      };
    });
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
        projection?.phase !== 'FAILED' ||
        projection.failure?.failureCode !== 'SOURCE_BINDING_FAILED'
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

  /**
   * Creator-owned, tenant-scoped catalog rows for the native browser.
   * Search and cursor predicates stay in SQL so pagination never depends on
   * browser history or a post-filtered page.
   */
  async listOwnedLibraryCatalog(input: {
    tenantId: string;
    actorUserId: string;
    query?: string;
    family?: string;
    cursor?: OwnedLibraryCatalogCursor;
    limit: number;
  }): Promise<OwnedLibraryCatalogRow[]> {
    const conditions = [
      eq(workItem.tenantId, input.tenantId),
      eq(workItem.requestedByUserId, input.actorUserId),
      eq(workItem.documentId, dmDocumentVersion.documentId),
    ];
    const query = input.query?.trim();
    if (query) {
      const pattern = `%${query}%`;
      conditions.push(
        or(
          ilike(dmPublicationFamily.canonicalDocumentNumber, pattern),
          ilike(dmPublicationFamily.documentFamily, pattern),
          ilike(dmDocumentVersion.originalFilename, pattern),
          ilike(workItem.status, pattern),
        )!,
      );
    }
    const family = input.family?.trim();
    if (family) {
      conditions.push(eq(dmPublicationFamily.documentFamily, family));
    }
    if (input.cursor) {
      conditions.push(
        or(
          lt(workItem.updatedAt, input.cursor.updatedAt),
          and(
            eq(workItem.updatedAt, input.cursor.updatedAt),
            lt(workItem.workItemId, input.cursor.workItemId),
          ),
        )!,
      );
    }
    const rows = await this.db
      .select({
        workItemId: workItem.workItemId,
        revision: workItem.revision,
        status: workItem.status,
        documentId: workItem.documentId,
        documentVersionId: workItem.documentVersionId,
        requestedByUserId: workItem.requestedByUserId,
        createdAt: workItem.createdAt,
        updatedAt: workItem.updatedAt,
        projectionJson: workItem.projectionJson,
        documentCode: dmPublicationFamily.canonicalDocumentNumber,
        documentFamily: dmPublicationFamily.documentFamily,
        businessRevision: dmDocumentVersion.businessRevision,
        currentDocumentVersionId: dmPublicationFamily.currentDocumentVersionId,
        currentGeneration: dmPublicationFamily.currentGeneration,
      })
      .from(workItem)
      .innerJoin(
        dmDocumentVersion,
        eq(workItem.documentVersionId, dmDocumentVersion.documentVersionId),
      )
      .innerJoin(
        dmPublicationFamily,
        eq(dmDocumentVersion.familyId, dmPublicationFamily.familyId),
      )
      .where(and(...conditions))
      .orderBy(desc(workItem.updatedAt), desc(workItem.workItemId))
      .limit(Math.min(Math.max(input.limit, 1), 51));
    return rows.map((row) => ({
      ...row,
      projection: parseProjection(row.projectionJson),
    }));
  }

  async listOwnedLibraryFamilies(input: {
    tenantId: string;
    actorUserId: string;
  }): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ family: dmPublicationFamily.documentFamily })
      .from(workItem)
      .innerJoin(
        dmDocumentVersion,
        eq(workItem.documentVersionId, dmDocumentVersion.documentVersionId),
      )
      .innerJoin(
        dmPublicationFamily,
        eq(dmDocumentVersion.familyId, dmPublicationFamily.familyId),
      )
      .where(
        and(
          eq(workItem.tenantId, input.tenantId),
          eq(workItem.requestedByUserId, input.actorUserId),
          eq(workItem.documentId, dmDocumentVersion.documentId),
        ),
      )
      .orderBy(asc(dmPublicationFamily.documentFamily));
    return rows.map((row) => row.family);
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
  }): Promise<CanonicalWorkItemProjection> {
    const next: CanonicalWorkItemProjection = {
      ...input.next,
      revision: input.expectedRevision + 1,
    };
    const now = new Date();
    const updated = await this.db
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
