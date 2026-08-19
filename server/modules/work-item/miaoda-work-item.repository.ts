import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';

import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import { actionAttempt, workItem } from '../../database/schema';

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

export type AssessmentActionType =
  | 'EVALUATE_JOB_AID'
  | 'RESYNTHESIZE_ASSESSMENT'
  | 'PERSIST_BASE_RULE_RESULT'
  | 'PERSIST_OPENCLAW_OVERALL'
  | 'CONFIRM_OPENCLAW_OVERALL_FOR_AEO'
  | 'OPENCLAW_DYNAMIC_EVALUATION'
  | 'OPENCLAW_OVERALL_SYNTHESIS'
  | 'RECORD_ENGINEER_REVIEW'
  | 'RUN_AEO_CANDIDATE_LOOP';

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

  async reserve(
    input: WorkItemReservationInput,
  ): Promise<WorkItemReservation> {
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
          next.failure?.failureCode ?? next.recordingFailure?.failureCode ?? null,
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
      .where(and(
        eq(actionAttempt.workItemId, input.workItemId),
        eq(actionAttempt.actionType, input.actionType),
        eq(actionAttempt.attemptNo, input.attemptNo),
      ))
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
    if (rows.length !== 1) throw new Error('OPENCLAW_OVERALL_ATTEMPT_NOT_FOUND');
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
    if (rows.length !== 1) throw new Error('OPENCLAW_OVERALL_ATTEMPT_NOT_FOUND');
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
      .where(and(
        eq(actionAttempt.attemptId, attemptId),
        inArray(actionAttempt.status, ['RUNNING', 'COMMITTING']),
      ))
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
      .where(and(
        eq(actionAttempt.attemptId, input.attemptId),
        inArray(actionAttempt.status, ['RUNNING', 'COMMITTING']),
      ));
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
    await this.db
      .update(actionAttempt)
      .set({
        status: terminal
          ? projection.phase === 'CANDIDATE_READBACK_VERIFIED'
            ? 'SUCCEEDED'
            : projection.phase
          : projection.phase,
        packageArtifactRef: projection.package?.artifact.ref ?? null,
        packageArtifactSha256: projection.package?.artifact.sha256 ?? null,
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
      .where(
        and(
          eq(actionAttempt.workItemId, projection.workItemId),
          eq(actionAttempt.actionType, ACTION_TYPE),
          eq(actionAttempt.attemptNo, 1),
        ),
      );
  }
}

function dynamicEvaluationAttempt(
  stored: typeof actionAttempt.$inferSelect,
): DynamicEvaluationActionAttempt {
  if (
    stored.actionType !== 'OPENCLAW_DYNAMIC_EVALUATION' ||
    stored.requestOrigin !== 'OPENCLAW' ||
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
    requestOrigin: stored.requestOrigin,
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

function parseProjection(value: string | null): CanonicalWorkItemProjection | null {
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
    row.normalizedFamily !== input.normalizedFamily
    || row.runKey !== input.runKey
  ) {
    throw new Error('WORK_ITEM_BUSINESS_KEY_COLLISION');
  }
}
