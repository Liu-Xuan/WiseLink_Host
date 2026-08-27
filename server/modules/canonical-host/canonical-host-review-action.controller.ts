import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type { ConfirmReviewActionDraftResponse } from '@shared/api.interface';
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
    emptyBody(body);
    return this.service.confirmDraft(
      requiredIdentifier(workItemIdValue, 'WORK_ITEM_ID_INVALID'),
      requiredIdentifier(
        reviewConversationIdValue,
        'REVIEW_CONVERSATION_ID_INVALID',
      ),
      requiredIdentifier(reviewTurnIdValue, 'REVIEW_TURN_ID_INVALID'),
      request,
    );
  }
}

function emptyBody(body: unknown): void {
  if (body === undefined || body === null) return;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('REVIEW_REQUEST_BODY_INVALID');
  }
  const key = Object.keys(body)[0];
  if (key) throw badRequest(`REVIEW_REQUEST_UNKNOWN_FIELD:${key}`);
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
