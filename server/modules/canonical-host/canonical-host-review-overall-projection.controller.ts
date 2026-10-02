import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type {
  CanonicalReviewOverallProjectionEligibility,
  CanonicalReviewOverallProjectionReceipt,
  RequestCanonicalReviewOverallProjectionRequest,
} from '@shared/api.interface';
import { canonicalHostBareSha256 } from './canonical-host-sha256';
import { CanonicalHostReviewOverallProjectionService } from './canonical-host-review-overall-projection.service';

function badRequest(code: string): Error {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw badRequest('REVIEW_OVERALL_BODY_INVALID');
  return value as Record<string, unknown>;
}

function strict(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw badRequest('REVIEW_OVERALL_UNKNOWN_FIELD');
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value ||
    value.length > 96 || value.includes('\u0000'))
    throw badRequest('REVIEW_OVERALL_IDENTIFIER_INVALID');
  return value;
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw badRequest('REVIEW_OVERALL_REVISION_INVALID');
  return Number(value);
}

function body(value: unknown): RequestCanonicalReviewOverallProjectionRequest {
  const payload = object(value);
  strict(payload, ['requestId', 'expectedRevision', 'reviewConversationId',
    'reviewTurnId', 'workRevisionRef', 'expectedWorkRevision', 'sourceIdentity']);
  const source = object(payload.sourceIdentity);
  strict(source, ['documentVersionId', 'sourceArtifactId', 'sourceFileSha256',
    'packageId', 'packageArtifactSha256']);
  const sourceFileSha256 = canonicalHostBareSha256(source.sourceFileSha256);
  const packageArtifactSha256 = canonicalHostBareSha256(source.packageArtifactSha256);
  if (!sourceFileSha256 || !packageArtifactSha256)
    throw badRequest('REVIEW_OVERALL_SOURCE_HASH_INVALID');
  return {
    requestId: id(payload.requestId),
    expectedRevision: revision(payload.expectedRevision),
    reviewConversationId: id(payload.reviewConversationId),
    reviewTurnId: id(payload.reviewTurnId),
    workRevisionRef: id(payload.workRevisionRef),
    expectedWorkRevision: revision(payload.expectedWorkRevision),
    sourceIdentity: {
      documentVersionId: id(source.documentVersionId),
      sourceArtifactId: id(source.sourceArtifactId),
      sourceFileSha256,
      packageId: id(source.packageId),
      packageArtifactSha256,
    },
  };
}

@NeedLogin()
@Controller(
  'api/canonical-host/work-items/:workItemId/integrated-assessment/review-overall-projections',
)
export class CanonicalHostReviewOverallProjectionController {
  constructor(private readonly service: CanonicalHostReviewOverallProjectionService) {}

  @Get('eligibility')
  eligibility(@Param('workItemId') workItemId: string, @Req() request: Request):
    Promise<CanonicalReviewOverallProjectionEligibility> {
    return this.service.eligibility(id(workItemId), request);
  }

  @Post()
  project(@Param('workItemId') workItemId: string, @Body() input: unknown,
    @Req() request: Request): Promise<CanonicalReviewOverallProjectionReceipt> {
    return this.service.project(id(workItemId), body(input), request);
  }

  @Get(':requestId')
  status(@Param('workItemId') workItemId: string,
    @Param('requestId') requestId: string, @Req() request: Request):
    Promise<CanonicalReviewOverallProjectionReceipt> {
    return this.service.status(id(workItemId), id(requestId), request);
  }
}
