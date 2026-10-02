import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq } from 'drizzle-orm';
import type {
  CanonicalReviewOverallProjectionReceipt,
  RequestCanonicalReviewOverallProjectionRequest,
} from '@shared/api.interface';
import { actionAttempt } from '../../database/schema';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';

export const REVIEW_OVERALL_ACTION_TYPE = 'HOST_REVIEW_OVERALL_PROJECTION';
export const REVIEW_OVERALL_REQUEST_ORIGIN = 'HOST_BROWSER_PROJECTION';

export interface ReviewOverallStructuralChecks {
  sourceReceiptMatched: boolean;
  latestWorkMatched: boolean;
  workItemRevisionMatched: boolean;
  sourceBindingsReauthorized: boolean;
  documentVersionAndParseMatched: boolean;
  fullV3ReadingConstructed: boolean;
  overviewCurrent: boolean;
  completionNotInProgress: boolean;
}

interface StoredProjectionExecution {
  schemaVersion: 'wiselink.3_1.review_overall_projection_execution.v1';
  executionKind: 'DETERMINISTIC_PROJECTION';
  modelRequests: 0;
  semanticReanalysisPerformed: false;
  input: RequestCanonicalReviewOverallProjectionRequest;
  checks: ReviewOverallStructuralChecks;
  receipt: CanonicalReviewOverallProjectionReceipt;
}

function executionId(input: {
  tenantId: string;
  actorUserId: string;
  workItemId: string;
  requestId: string;
}): string {
  return 'ATT-' + createHash('sha256').update(canonicalJson(input)).digest('hex');
}

@Injectable()
export class CanonicalHostReviewOverallProjectionRepository {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  attemptId(input: {
    tenantId: string;
    actorUserId: string;
    workItemId: string;
    requestId: string;
  }): string {
    return executionId(input);
  }

  async read(input: {
    tenantId: string;
    actorUserId: string;
    workItemId: string;
    requestId: string;
  }, database = this.db): Promise<StoredProjectionExecution | null> {
    const [row] = await database.select({
      status: actionAttempt.status,
      requestOrigin: actionAttempt.requestOrigin,
      actionType: actionAttempt.actionType,
      reviewActivityJson: actionAttempt.reviewActivityJson,
    }).from(actionAttempt).where(and(
      eq(actionAttempt.tenantId, input.tenantId),
      eq(actionAttempt.actorUserId, input.actorUserId),
      eq(actionAttempt.workItemId, input.workItemId),
      eq(actionAttempt.attemptId, executionId(input)),
    )).limit(1);
    if (!row) return null;
    if (row.status !== 'SUCCEEDED' ||
      row.requestOrigin !== REVIEW_OVERALL_REQUEST_ORIGIN ||
      row.actionType !== REVIEW_OVERALL_ACTION_TYPE ||
      !row.reviewActivityJson)
      throw new Error('REVIEW_OVERALL_EXECUTION_RECORD_INVALID');
    const execution = JSON.parse(row.reviewActivityJson) as StoredProjectionExecution;
    if (execution.schemaVersion !==
      'wiselink.3_1.review_overall_projection_execution.v1' ||
      execution.receipt.executionAttemptId !== executionId(input) ||
      execution.input.requestId !== input.requestId)
      throw new Error('REVIEW_OVERALL_EXECUTION_RECORD_INVALID');
    return execution;
  }

  async insert(input: {
    database: PostgresJsDatabase;
    tenantId: string;
    actorUserId: string;
    workItemId: string;
    documentVersionId: string;
    request: RequestCanonicalReviewOverallProjectionRequest;
    receipt: CanonicalReviewOverallProjectionReceipt;
    checks: ReviewOverallStructuralChecks;
  }): Promise<void> {
    const [last] = await input.database.select({
      attemptNo: actionAttempt.attemptNo,
    }).from(actionAttempt).where(and(
      eq(actionAttempt.workItemId, input.workItemId),
      eq(actionAttempt.actionType, REVIEW_OVERALL_ACTION_TYPE),
    )).orderBy(desc(actionAttempt.attemptNo)).limit(1);
    const now = new Date();
    if (Object.values(input.checks).some((value) => value !== true))
      throw new Error('REVIEW_OVERALL_STRUCTURAL_CHECK_FAILED');
    const activity: StoredProjectionExecution = {
      schemaVersion: 'wiselink.3_1.review_overall_projection_execution.v1',
      executionKind: 'DETERMINISTIC_PROJECTION',
      modelRequests: 0,
      semanticReanalysisPerformed: false,
      input: input.request,
      checks: input.checks,
      receipt: input.receipt,
    };
    await input.database.insert(actionAttempt).values({
      attemptId: input.receipt.executionAttemptId,
      operationRef: 'review-overall://' + input.receipt.executionAttemptId.slice(4),
      workItemId: input.workItemId,
      actionType: REVIEW_OVERALL_ACTION_TYPE,
      attemptNo: (last?.attemptNo ?? 0) + 1,
      triggerRequestId: input.request.requestId,
      requestOrigin: REVIEW_OVERALL_REQUEST_ORIGIN,
      status: 'SUCCEEDED',
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      documentVersionId: input.documentVersionId,
      inputRevision: input.request.expectedRevision,
      baseRevision: input.request.expectedRevision,
      idempotencyKey: 'review-overall:' + input.receipt.executionAttemptId.slice(4),
      reviewActivityJson: canonicalJson(activity),
      projectionApplied: true,
      maxAttempts: 1,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
}
