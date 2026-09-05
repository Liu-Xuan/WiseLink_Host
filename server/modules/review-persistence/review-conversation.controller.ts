import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  AppendReviewTextTurnRequest,
  AppendReviewTextTurnResponse,
  CloseReviewConversationResponse,
  CreateOrResumeReviewConversationResponse,
  CurrentReviewConversationResponse,
} from '@shared/api.interface';
import { ReviewConversationService } from './review-conversation.service';

const MAX_MESSAGE_LENGTH = 20_000;
const MAX_IDENTIFIER_LENGTH = 96;
const MAX_BUCKET_ID_LENGTH = 255;
const MAX_FILE_PATH_LENGTH = 1_024;

@NeedLogin()
@Controller('api')
export class ReviewConversationController {
  constructor(private readonly service: ReviewConversationService) {}

  @Post('work-items/:workItemId/review-conversations/current')
  async createOrResume(
    @Param('workItemId') workItemIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CreateOrResumeReviewConversationResponse> {
    emptyBody(body);
    const workItemId: string = requiredIdentifier(
      workItemIdValue,
      'WORK_ITEM_ID_INVALID',
    );
    return this.service.createOrResume(workItemId, request);
  }

  @Get('work-items/:workItemId/review-conversations/current')
  async current(
    @Param('workItemId') workItemIdValue: string,
    @Req() request: Request,
  ): Promise<CurrentReviewConversationResponse> {
    const workItemId: string = requiredIdentifier(
      workItemIdValue,
      'WORK_ITEM_ID_INVALID',
    );
    return this.service.current(workItemId, request);
  }

  @Post(
    'work-items/:workItemId/review-conversations/:reviewConversationId/turns',
  )
  async appendTextTurn(
    @Param('workItemId') workItemIdValue: string,
    @Param('reviewConversationId') reviewConversationIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<AppendReviewTextTurnResponse> {
    const workItemId: string = requiredIdentifier(
      workItemIdValue,
      'WORK_ITEM_ID_INVALID',
    );
    const reviewConversationId: string = requiredIdentifier(
      reviewConversationIdValue,
      'REVIEW_CONVERSATION_ID_INVALID',
    );
    const input: AppendReviewTextTurnRequest = reviewTextBody(body);
    return this.service.appendTextTurn(
      workItemId,
      reviewConversationId,
      input,
      request,
    );
  }

  @Post(
    'work-items/:workItemId/review-conversations/:reviewConversationId/close',
  )
  async close(
    @Param('workItemId') workItemIdValue: string,
    @Param('reviewConversationId') reviewConversationIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CloseReviewConversationResponse> {
    emptyBody(body);
    const workItemId: string = requiredIdentifier(
      workItemIdValue,
      'WORK_ITEM_ID_INVALID',
    );
    const reviewConversationId: string = requiredIdentifier(
      reviewConversationIdValue,
      'REVIEW_CONVERSATION_ID_INVALID',
    );
    return this.service.close(workItemId, reviewConversationId, request);
  }
}

function reviewTextBody(body: unknown): AppendReviewTextTurnRequest {
  const value: Record<string, unknown> = objectBody(body);
  strictKeys(value, [
    'requestId',
    'userMessage',
    'selectedEvaluationItemId',
    'attachmentSelection',
  ]);
  const requestId: string = requiredIdentifier(
    value.requestId,
    'REVIEW_TURN_REQUEST_ID_INVALID',
  );
  if (typeof value.userMessage !== 'string') {
    throw badRequest('REVIEW_TURN_MESSAGE_INVALID');
  }
  const userMessage: string = value.userMessage.trim();
  if (userMessage.length === 0 || userMessage.length > MAX_MESSAGE_LENGTH) {
    throw badRequest('REVIEW_TURN_MESSAGE_INVALID');
  }
  const input: AppendReviewTextTurnRequest = { requestId, userMessage };
  if (value.selectedEvaluationItemId !== undefined) {
    input.selectedEvaluationItemId =
      value.selectedEvaluationItemId === null
        ? null
        : requiredIdentifier(
            value.selectedEvaluationItemId,
            'REVIEW_SELECTED_EVALUATION_ITEM_INVALID',
          );
  }
  if (value.attachmentSelection === undefined) return input;
  const selection: Record<string, unknown> = objectBody(
    value.attachmentSelection,
  );
  strictKeys(selection, ['bucketId', 'filePath']);
  return {
    ...input,
    attachmentSelection: {
      bucketId: exactNonEmptyString(
        selection.bucketId,
        MAX_BUCKET_ID_LENGTH,
        'REVIEW_ATTACHMENT_BUCKET_ID_INVALID',
      ),
      filePath: exactNonEmptyString(
        selection.filePath,
        MAX_FILE_PATH_LENGTH,
        'REVIEW_ATTACHMENT_FILE_PATH_INVALID',
      ),
    },
  };
}

function emptyBody(body: unknown): void {
  if (body === undefined || body === null) return;
  const value: Record<string, unknown> = objectBody(body);
  strictKeys(value, []);
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('REVIEW_REQUEST_BODY_INVALID');
  }
  return body as Record<string, unknown>;
}

function strictKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw badRequest(`REVIEW_REQUEST_UNKNOWN_FIELD:${key}`);
    }
  }
}

function requiredIdentifier(value: unknown, code: string): string {
  if (typeof value !== 'string') throw badRequest(code);
  const normalized: string = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_IDENTIFIER_LENGTH) {
    throw badRequest(code);
  }
  return normalized;
}

function exactNonEmptyString(
  value: unknown,
  maxLength: number,
  code: string,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    value.includes('\u0000')
  ) {
    throw badRequest(code);
  }
  return value;
}

function badRequest(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}
