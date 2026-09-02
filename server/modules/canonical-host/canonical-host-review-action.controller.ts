import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  ConfirmReviewActionDraftRequest,
  ConfirmReviewActionDraftResponse,
} from '@shared/api.interface';
import { CanonicalHostReviewActionService } from './canonical-host-review-action.service';

const MAX_IDENTIFIER_LENGTH = 96;

@NeedLogin()
@Controller('api')
export class CanonicalHostReviewActionController {
  constructor(private readonly service: CanonicalHostReviewActionService) {}

  @Post(
    'work-items/:workItemId/review-conversations/:reviewConversationId/turns/:reviewTurnId/confirm-draft',
  )
  async confirmDraft(
    @Param('workItemId') workItemIdValue: string,
    @Param('reviewConversationId') reviewConversationIdValue: string,
    @Param('reviewTurnId') reviewTurnIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<ConfirmReviewActionDraftResponse> {
    const input: ConfirmReviewActionDraftRequest = confirmBody(body);
    return this.service.confirmDraft(
      requiredIdentifier(workItemIdValue, 'WORK_ITEM_ID_INVALID'),
      requiredIdentifier(
        reviewConversationIdValue,
        'REVIEW_CONVERSATION_ID_INVALID',
      ),
      requiredIdentifier(reviewTurnIdValue, 'REVIEW_TURN_ID_INVALID'),
      input,
      request,
    );
  }
}

function confirmBody(body: unknown): ConfirmReviewActionDraftRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('REVIEW_REQUEST_BODY_INVALID');
  }
  const value: Record<string, unknown> = body as Record<string, unknown>;
  const allowed = new Set(['reviewActionDraftRef', 'expectedRevision']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw badRequest(`REVIEW_REQUEST_UNKNOWN_FIELD:${key}`);
    }
  }
  if (Object.keys(value).length !== allowed.size) {
    throw badRequest('REVIEW_REQUEST_BODY_INVALID');
  }
  const expectedRevision: number = Number(value.expectedRevision);
  if (
    !Number.isSafeInteger(value.expectedRevision) ||
    expectedRevision < 1
  ) {
    throw badRequest('REVIEW_EXPECTED_REVISION_INVALID');
  }
  return {
    reviewActionDraftRef: requiredIdentifier(
      value.reviewActionDraftRef,
      'REVIEW_ACTION_DRAFT_REF_INVALID',
    ),
    expectedRevision,
  };
}

function requiredIdentifier(value: unknown, code: string): string {
  if (typeof value !== 'string') throw badRequest(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw badRequest(code);
  }
  return normalized;
}

function badRequest(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}
