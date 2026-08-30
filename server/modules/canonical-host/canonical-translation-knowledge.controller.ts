import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CanonicalTranslationKnowledgeCandidateSnapshot,
  CreateCanonicalTranslationKnowledgeCandidatesRequest,
  CreateCanonicalTranslationKnowledgeCandidatesResponse,
  RecordCanonicalTranslationKnowledgeFeedbackRequest,
  RecordCanonicalTranslationKnowledgeFeedbackResponse,
} from '@shared/api.interface';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import { CanonicalTranslationKnowledgeProductService } from './canonical-translation-knowledge-product.service';

const MAX_IDENTIFIER_LENGTH = 96;
const MAX_FEEDBACK_LENGTH = 2_000;

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/work-items/:workItemId/translation-knowledge')
export class CanonicalTranslationKnowledgeController {
  constructor(
    private readonly service: CanonicalTranslationKnowledgeProductService,
  ) {}

  @Post('candidates')
  createCandidates(
    @Param('workItemId') workItemIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CreateCanonicalTranslationKnowledgeCandidatesResponse> {
    return this.service.createCandidates(
      identifier(workItemIdValue, 'KNOWLEDGE_WORK_ITEM_ID_INVALID'),
      createBody(body),
      hostActor(request),
    );
  }

  @Get('candidates/:assetId')
  readCandidate(
    @Param('workItemId') workItemIdValue: string,
    @Param('assetId') assetIdValue: string,
    @Query('asOf') asOfValue: string,
    @Req() request: Request,
  ): Promise<CanonicalTranslationKnowledgeCandidateSnapshot> {
    return this.service.readCandidate(
      identifier(workItemIdValue, 'KNOWLEDGE_WORK_ITEM_ID_INVALID'),
      identifier(assetIdValue, 'KNOWLEDGE_ASSET_ID_INVALID'),
      timestamp(asOfValue, 'KNOWLEDGE_AS_OF_INVALID'),
      hostActor(request),
    );
  }

  @Post('candidates/:assetId/feedback')
  recordFeedback(
    @Param('workItemId') workItemIdValue: string,
    @Param('assetId') assetIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<RecordCanonicalTranslationKnowledgeFeedbackResponse> {
    return this.service.recordFeedback(
      identifier(workItemIdValue, 'KNOWLEDGE_WORK_ITEM_ID_INVALID'),
      identifier(assetIdValue, 'KNOWLEDGE_ASSET_ID_INVALID'),
      feedbackBody(body),
      hostActor(request),
    );
  }
}

function createBody(
  body: unknown,
): CreateCanonicalTranslationKnowledgeCandidatesRequest {
  const value: Record<string, unknown> = objectBody(body);
  strictKeys(value, [
    'requestId',
    'expectedWorkItemRevision',
    'validFrom',
    'expiresAt',
  ]);
  const validFrom: string = timestamp(
    value.validFrom,
    'KNOWLEDGE_VALID_FROM_INVALID',
  );
  const expiresAt: string = timestamp(
    value.expiresAt,
    'KNOWLEDGE_EXPIRES_AT_INVALID',
  );
  if (Date.parse(expiresAt) <= Date.parse(validFrom)) {
    throw badRequest('KNOWLEDGE_VALIDITY_WINDOW_INVALID');
  }
  return {
    requestId: identifier(value.requestId, 'KNOWLEDGE_REQUEST_ID_INVALID'),
    expectedWorkItemRevision: positiveRevision(
      value.expectedWorkItemRevision,
      'KNOWLEDGE_WORK_ITEM_REVISION_INVALID',
    ),
    validFrom,
    expiresAt,
  };
}

function feedbackBody(
  body: unknown,
): RecordCanonicalTranslationKnowledgeFeedbackRequest {
  const value: Record<string, unknown> = objectBody(body);
  strictKeys(value, [
    'requestId',
    'expectedWorkItemRevision',
    'expectedGovernanceRevision',
    'decision',
    'comment',
  ]);
  const decision: string = text(
    value.decision,
    'KNOWLEDGE_FEEDBACK_DECISION_INVALID',
  );
  if (
    decision !== 'ADOPTED_AS_CANDIDATE_SUGGESTION' &&
    decision !== 'REJECTED'
  ) {
    throw badRequest('KNOWLEDGE_FEEDBACK_DECISION_INVALID');
  }
  const comment: string = text(
    value.comment,
    'KNOWLEDGE_FEEDBACK_COMMENT_INVALID',
  );
  if (comment.length > MAX_FEEDBACK_LENGTH) {
    throw badRequest('KNOWLEDGE_FEEDBACK_COMMENT_INVALID');
  }
  return {
    requestId: identifier(value.requestId, 'KNOWLEDGE_REQUEST_ID_INVALID'),
    expectedWorkItemRevision: positiveRevision(
      value.expectedWorkItemRevision,
      'KNOWLEDGE_WORK_ITEM_REVISION_INVALID',
    ),
    expectedGovernanceRevision: nonNegativeRevision(
      value.expectedGovernanceRevision,
      'KNOWLEDGE_GOVERNANCE_REVISION_INVALID',
    ),
    decision,
    comment,
  };
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('KNOWLEDGE_REQUEST_BODY_INVALID');
  }
  return body as Record<string, unknown>;
}

function strictKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw badRequest(`KNOWLEDGE_REQUEST_UNKNOWN_FIELD:${key}`);
    }
  }
}

function identifier(value: unknown, code: string): string {
  const result: string = text(value, code);
  if (result.length > MAX_IDENTIFIER_LENGTH) throw badRequest(code);
  return result;
}

function text(value: unknown, code: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim() !== value ||
    value.includes('\u0000')
  ) {
    throw badRequest(code);
  }
  return value;
}

function timestamp(value: unknown, code: string): string {
  const result: string = text(value, code);
  const parsed: Date = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== result) {
    throw badRequest(code);
  }
  return result;
}

function positiveRevision(value: unknown, code: string): number {
  const result: number = nonNegativeRevision(value, code);
  if (result < 1) throw badRequest(code);
  return result;
}

function nonNegativeRevision(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw badRequest(code);
  }
  return Number(value);
}

function badRequest(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}
