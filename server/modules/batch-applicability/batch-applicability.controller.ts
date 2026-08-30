import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  BatchApplicabilityRunReadModel,
  ConfirmBatchApplicabilityClusterRequest,
  CreateBatchApplicabilityRunRequest,
} from '@shared/batch-applicability.interface';
import { BatchApplicabilityHostService } from './batch-applicability-host.service';

const MAX_IDENTIFIER_LENGTH = 160;
const MAX_TARGETS = 500;
const MAX_REASON_LENGTH = 2_000;

@NeedLogin()
@Controller('api/work-items/:workItemId/batch-applicability-runs')
export class BatchApplicabilityController {
  constructor(private readonly service: BatchApplicabilityHostService) {}

  @Post()
  create(
    @Param('workItemId') workItemIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<BatchApplicabilityRunReadModel> {
    const workItemId = identifier(
      workItemIdValue,
      'BATCH_WORK_ITEM_ID_INVALID',
    );
    return this.service.create(workItemId, createBody(body), request);
  }

  @Get(':runId')
  read(
    @Param('workItemId') workItemIdValue: string,
    @Param('runId') runIdValue: string,
    @Req() request: Request,
  ): Promise<BatchApplicabilityRunReadModel> {
    return this.service.read(
      identifier(workItemIdValue, 'BATCH_WORK_ITEM_ID_INVALID'),
      identifier(runIdValue, 'BATCH_RUN_ID_INVALID'),
      request,
    );
  }

  @Post(':runId/confirmations')
  confirm(
    @Param('workItemId') workItemIdValue: string,
    @Param('runId') runIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<BatchApplicabilityRunReadModel> {
    return this.service.confirm(
      identifier(workItemIdValue, 'BATCH_WORK_ITEM_ID_INVALID'),
      identifier(runIdValue, 'BATCH_RUN_ID_INVALID'),
      confirmationBody(body),
      request,
    );
  }
}

function createBody(body: unknown): CreateBatchApplicabilityRunRequest {
  const value = object(body, 'BATCH_CREATE_BODY_INVALID');
  strictKeys(value, ['requestId', 'sourceExpressionId', 'targets']);
  if (!Array.isArray(value.targets)) {
    throw badRequest('BATCH_TARGETS_INVALID');
  }
  if (value.targets.length === 0 || value.targets.length > MAX_TARGETS) {
    throw badRequest('BATCH_TARGET_COUNT_INVALID');
  }
  return {
    requestId: identifier(value.requestId, 'BATCH_REQUEST_ID_INVALID'),
    sourceExpressionId: identifier(
      value.sourceExpressionId,
      'BATCH_SOURCE_EXPRESSION_ID_INVALID',
    ),
    targets: value.targets.map((candidate: unknown, index: number) => {
      const target = object(candidate, `BATCH_TARGET_INVALID:${index}`);
      strictKeys(target, ['aircraftIdentifier', 'asOf']);
      return {
        aircraftIdentifier: identifier(
          target.aircraftIdentifier,
          `BATCH_AIRCRAFT_IDENTIFIER_INVALID:${index}`,
        ).toUpperCase(),
        asOf: isoDate(target.asOf, `BATCH_AS_OF_INVALID:${index}`),
      };
    }),
  };
}

function confirmationBody(
  body: unknown,
): ConfirmBatchApplicabilityClusterRequest {
  const value = object(body, 'BATCH_CONFIRMATION_BODY_INVALID');
  strictKeys(value, [
    'requestId',
    'expectedWorkItemRevision',
    'candidateClusterId',
    'decision',
    'reason',
    'validUntil',
  ]);
  if (
    !Number.isSafeInteger(value.expectedWorkItemRevision) ||
    Number(value.expectedWorkItemRevision) < 0
  ) {
    throw badRequest('BATCH_EXPECTED_WORK_ITEM_REVISION_INVALID');
  }
  if (
    value.decision !== 'CONFIRM_CLUSTER_CANDIDATE' &&
    value.decision !== 'REJECT_CLUSTER_CANDIDATE'
  ) {
    throw badRequest('BATCH_CONFIRMATION_DECISION_INVALID');
  }
  const reason = text(value.reason, 'BATCH_CONFIRMATION_REASON_INVALID');
  if (reason.length > MAX_REASON_LENGTH) {
    throw badRequest('BATCH_CONFIRMATION_REASON_INVALID');
  }
  return {
    requestId: identifier(value.requestId, 'BATCH_REQUEST_ID_INVALID'),
    expectedWorkItemRevision: Number(value.expectedWorkItemRevision),
    candidateClusterId: identifier(
      value.candidateClusterId,
      'BATCH_CLUSTER_ID_INVALID',
      255,
    ),
    decision: value.decision,
    reason,
    validUntil: isoTimestamp(value.validUntil, 'BATCH_VALID_UNTIL_INVALID'),
  };
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest(code);
  }
  return value as Record<string, unknown>;
}

function strictKeys(value: Record<string, unknown>, allowed: string[]): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw badRequest(`BATCH_REQUEST_UNKNOWN_FIELD:${unexpected}`);
}

function identifier(value: unknown, code: string, max = MAX_IDENTIFIER_LENGTH) {
  const normalized = text(value, code);
  if (normalized.length > max || !/^[A-Za-z0-9_.:@/-]+$/u.test(normalized)) {
    throw badRequest(code);
  }
  return normalized;
}

function text(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(code);
  return value.trim();
}

function isoDate(value: unknown, code: string): string {
  const normalized = text(value, code);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(normalized) ||
    new Date(`${normalized}T00:00:00.000Z`).toISOString().slice(0, 10) !==
      normalized
  ) {
    throw badRequest(code);
  }
  return normalized;
}

function isoTimestamp(value: unknown, code: string): string {
  const normalized = text(value, code);
  const parsed = Date.parse(normalized);
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== normalized
  ) {
    throw badRequest(code);
  }
  return normalized;
}

function badRequest(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}
