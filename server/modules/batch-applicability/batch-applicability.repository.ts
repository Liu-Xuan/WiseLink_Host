import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, asc, eq } from 'drizzle-orm';

import {
  batchApplicabilityConfirmation,
  batchApplicabilityRun,
} from '../../database/schema';
import type {
  CreateBatchApplicabilityConfirmationRecord,
  CreateBatchApplicabilityRunRecord,
  PersistedBatchApplicabilityConfirmation,
  PersistedBatchApplicabilityRun,
} from './batch-applicability-host.types';

@Injectable()
export class BatchApplicabilityRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async findRunByRequest(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    requestId: string;
  }): Promise<PersistedBatchApplicabilityRun | null> {
    const [row] = await this.db
      .select()
      .from(batchApplicabilityRun)
      .where(
        and(
          eq(batchApplicabilityRun.tenantId, input.tenantId),
          eq(batchApplicabilityRun.actorId, input.actorId),
          eq(batchApplicabilityRun.workItemId, input.workItemId),
          eq(batchApplicabilityRun.requestId, input.requestId),
        ),
      )
      .limit(1);
    return row ? toRun(row) : null;
  }

  async findRun(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    runId: string;
  }): Promise<PersistedBatchApplicabilityRun | null> {
    const [row] = await this.db
      .select()
      .from(batchApplicabilityRun)
      .where(
        and(
          eq(batchApplicabilityRun.tenantId, input.tenantId),
          eq(batchApplicabilityRun.actorId, input.actorId),
          eq(batchApplicabilityRun.workItemId, input.workItemId),
          eq(batchApplicabilityRun.runId, input.runId),
        ),
      )
      .limit(1);
    return row ? toRun(row) : null;
  }

  async createRun(
    input: CreateBatchApplicabilityRunRecord,
  ): Promise<{ run: PersistedBatchApplicabilityRun; created: boolean }> {
    const candidate = input.candidateSet;
    const [inserted] = await this.db
      .insert(batchApplicabilityRun)
      .values({
        runId: input.runId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        workItemId: input.workItemId,
        requestId: input.request.requestId,
        requestPayloadJson: JSON.stringify(input.request),
        workItemRevision: candidate.source.workItemRevision,
        documentVersionId: candidate.source.documentVersionId,
        sourcePackageId: candidate.source.packageId,
        sourceExpressionId: candidate.source.sourceExpressionId,
        sourceConditionId: candidate.source.sourceConditionId,
        sourceRefIdsJson: JSON.stringify(candidate.source.sourceRefIds),
        fleetSourceSnapshotId:
          candidate.source.hostBinding.frozenFleetHead.sourceSnapshotId,
        fleetSourceRevisionKey:
          candidate.source.hostBinding.frozenFleetHead.sourceRevisionKey,
        fleetAuthorityRevision:
          candidate.source.hostBinding.frozenFleetHead.authorityRevision,
        fleetSourceAsOf:
          candidate.source.hostBinding.frozenFleetHead.sourceAsOf,
        hostBindingStatus: candidate.source.hostBinding.status,
        candidateSetJson: JSON.stringify(candidate),
      })
      .onConflictDoNothing({
        target: [
          batchApplicabilityRun.tenantId,
          batchApplicabilityRun.workItemId,
          batchApplicabilityRun.requestId,
        ],
      })
      .returning();
    if (inserted) return { run: toRun(inserted), created: true };
    const replay = await this.findRunByRequest({
      tenantId: input.tenantId,
      actorId: input.actorId,
      workItemId: input.workItemId,
      requestId: input.request.requestId,
    });
    if (!replay) throw conflict('BATCH_RUN_IDEMPOTENCY_READBACK_FAILED');
    return { run: replay, created: false };
  }

  async listConfirmations(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    runId: string;
  }): Promise<PersistedBatchApplicabilityConfirmation[]> {
    const rows = await this.db
      .select()
      .from(batchApplicabilityConfirmation)
      .where(
        and(
          eq(batchApplicabilityConfirmation.tenantId, input.tenantId),
          eq(batchApplicabilityConfirmation.actorId, input.actorId),
          eq(batchApplicabilityConfirmation.workItemId, input.workItemId),
          eq(batchApplicabilityConfirmation.runId, input.runId),
        ),
      )
      .orderBy(
        asc(batchApplicabilityConfirmation.createdAt),
        asc(batchApplicabilityConfirmation.receiptId),
      );
    return rows.map(toConfirmation);
  }

  async createConfirmation(
    input: CreateBatchApplicabilityConfirmationRecord,
  ): Promise<{
    confirmation: PersistedBatchApplicabilityConfirmation;
    created: boolean;
  }> {
    const [inserted] = await this.db
      .insert(batchApplicabilityConfirmation)
      .values({
        receiptId: input.receiptId,
        runId: input.run.runId,
        tenantId: input.run.tenantId,
        actorId: input.actorId,
        workItemId: input.run.workItemId,
        requestId: input.request.requestId,
        requestPayloadJson: JSON.stringify(input.request),
        workItemRevision: input.run.workItemRevision,
        candidateClusterId: input.request.candidateClusterId,
        decision: input.request.decision,
        reason: input.request.reason,
        confirmedAt: new Date(input.candidate.audit.confirmedAt),
        validUntil: new Date(input.request.validUntil),
        confirmationCandidateJson: JSON.stringify(input.candidate),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      return { confirmation: toConfirmation(inserted), created: true };
    }
    const existing = await this.findConfirmationByRequest({
      tenantId: input.run.tenantId,
      actorId: input.actorId,
      workItemId: input.run.workItemId,
      requestId: input.request.requestId,
    });
    if (existing) return { confirmation: existing, created: false };
    throw conflict('BATCH_CLUSTER_ALREADY_CONFIRMED');
  }

  async findConfirmationByRequest(input: {
    tenantId: string;
    actorId: string;
    workItemId: string;
    requestId: string;
  }): Promise<PersistedBatchApplicabilityConfirmation | null> {
    const [row] = await this.db
      .select()
      .from(batchApplicabilityConfirmation)
      .where(
        and(
          eq(batchApplicabilityConfirmation.tenantId, input.tenantId),
          eq(batchApplicabilityConfirmation.actorId, input.actorId),
          eq(batchApplicabilityConfirmation.workItemId, input.workItemId),
          eq(batchApplicabilityConfirmation.requestId, input.requestId),
        ),
      )
      .limit(1);
    return row ? toConfirmation(row) : null;
  }
}

function toRun(
  row: typeof batchApplicabilityRun.$inferSelect,
): PersistedBatchApplicabilityRun {
  return {
    runId: row.runId,
    tenantId: row.tenantId,
    actorId: row.actorId,
    workItemId: row.workItemId,
    requestId: row.requestId,
    requestPayloadJson: row.requestPayloadJson,
    workItemRevision: row.workItemRevision,
    documentVersionId: row.documentVersionId,
    sourcePackageId: row.sourcePackageId,
    sourceExpressionId: row.sourceExpressionId,
    sourceConditionId: row.sourceConditionId,
    sourceRefIdsJson: row.sourceRefIdsJson,
    fleetHead: {
      sourceSnapshotId: row.fleetSourceSnapshotId,
      sourceRevisionKey: row.fleetSourceRevisionKey,
      authorityRevision: row.fleetAuthorityRevision,
      sourceAsOf: row.fleetSourceAsOf,
    },
    hostBindingStatus: hostBindingStatus(row.hostBindingStatus),
    candidateSetJson: row.candidateSetJson,
    createdAt: row.createdAt,
  };
}

function toConfirmation(
  row: typeof batchApplicabilityConfirmation.$inferSelect,
): PersistedBatchApplicabilityConfirmation {
  return {
    receiptId: row.receiptId,
    runId: row.runId,
    tenantId: row.tenantId,
    actorId: row.actorId,
    workItemId: row.workItemId,
    requestId: row.requestId,
    requestPayloadJson: row.requestPayloadJson,
    workItemRevision: row.workItemRevision,
    candidateClusterId: row.candidateClusterId,
    decision: confirmationDecision(row.decision),
    reason: row.reason,
    confirmedAt: row.confirmedAt,
    validUntil: row.validUntil,
    confirmationCandidateJson: row.confirmationCandidateJson,
    createdAt: row.createdAt,
  };
}

function hostBindingStatus(
  value: string,
): PersistedBatchApplicabilityRun['hostBindingStatus'] {
  if (
    value === 'CURRENT' ||
    value === 'STALE' ||
    value === 'CONFLICT' ||
    value === 'UNVERIFIED'
  ) {
    return value;
  }
  throw new Error('BATCH_PERSISTED_HOST_BINDING_STATUS_INVALID');
}

function confirmationDecision(
  value: string,
): PersistedBatchApplicabilityConfirmation['decision'] {
  if (
    value === 'CONFIRM_CLUSTER_CANDIDATE' ||
    value === 'REJECT_CLUSTER_CANDIDATE'
  ) {
    return value;
  }
  throw new Error('BATCH_PERSISTED_CONFIRMATION_DECISION_INVALID');
}

function conflict(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
