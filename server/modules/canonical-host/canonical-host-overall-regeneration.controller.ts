import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CanonicalOverallRegenerationReadModel,
  CanonicalOverallRegenerationSourceIdentity,
  RequestCanonicalOverallRegenerationRequest,
  RequestCanonicalOverallRegenerationResponse,
} from '@shared/api.interface';
import { CanonicalHostOverallRegenerationService } from './canonical-host-overall-regeneration.service';
import { canonicalHostBareSha256 } from './canonical-host-sha256';

const MAX_IDENTIFIER_LENGTH = 96;

@NeedLogin()
@Controller(
  'api/canonical-host/work-items/:workItemId/integrated-assessment/overall-regeneration-requests',
)
export class CanonicalHostOverallRegenerationController {
  constructor(
    private readonly service: CanonicalHostOverallRegenerationService,
  ) {}

  @Post()
  requestRegeneration(
    @Param('workItemId') workItemIdValue: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<RequestCanonicalOverallRegenerationResponse> {
    const workItemId = requiredIdentifier(
      workItemIdValue,
      'OVERALL_REGENERATION_WORK_ITEM_ID_INVALID',
    );
    return this.service.request(workItemId, regenerationBody(body), request);
  }

  @Get(':requestId')
  status(
    @Param('workItemId') workItemIdValue: string,
    @Param('requestId') requestIdValue: string,
    @Req() request: Request,
  ): Promise<CanonicalOverallRegenerationReadModel> {
    const workItemId = requiredIdentifier(
      workItemIdValue,
      'OVERALL_REGENERATION_WORK_ITEM_ID_INVALID',
    );
    const requestId = requiredIdentifier(
      requestIdValue,
      'OVERALL_REGENERATION_REQUEST_ID_INVALID',
    );
    return this.service.status(workItemId, requestId, request);
  }
}

function regenerationBody(
  body: unknown,
): RequestCanonicalOverallRegenerationRequest {
  const value = objectBody(body);
  strictKeys(value, ['requestId', 'expectedRevision', 'sourceIdentity']);
  if (!Number.isSafeInteger(value.expectedRevision)) {
    throw badRequest('OVERALL_REGENERATION_REVISION_INVALID');
  }
  const expectedRevision = Number(value.expectedRevision);
  if (expectedRevision < 1) {
    throw badRequest('OVERALL_REGENERATION_REVISION_INVALID');
  }
  return {
    requestId: requiredIdentifier(
      value.requestId,
      'OVERALL_REGENERATION_REQUEST_ID_INVALID',
    ),
    expectedRevision,
    sourceIdentity: sourceIdentity(value.sourceIdentity),
  };
}

function sourceIdentity(
  value: unknown,
): CanonicalOverallRegenerationSourceIdentity {
  const source = objectBody(value);
  strictKeys(source, [
    'documentVersionId',
    'sourceArtifactId',
    'sourceFileSha256',
    'packageId',
    'packageArtifactSha256',
  ]);
  return {
    documentVersionId: requiredIdentifier(
      source.documentVersionId,
      'OVERALL_REGENERATION_DOCUMENT_VERSION_ID_INVALID',
    ),
    sourceArtifactId: requiredIdentifier(
      source.sourceArtifactId,
      'OVERALL_REGENERATION_SOURCE_ARTIFACT_ID_INVALID',
    ),
    sourceFileSha256: requiredHash(
      source.sourceFileSha256,
      'OVERALL_REGENERATION_SOURCE_HASH_INVALID',
    ),
    packageId: requiredText(
      source.packageId,
      'OVERALL_REGENERATION_PACKAGE_ID_INVALID',
    ),
    packageArtifactSha256: requiredHash(
      source.packageArtifactSha256,
      'OVERALL_REGENERATION_PACKAGE_HASH_INVALID',
    ),
  };
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('OVERALL_REGENERATION_BODY_INVALID');
  }
  return body as Record<string, unknown>;
}

function strictKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw badRequest(`OVERALL_REGENERATION_UNKNOWN_FIELD:${key}`);
    }
  }
}

function requiredIdentifier(value: unknown, code: string): string {
  const text = requiredText(value, code);
  if (text.length > MAX_IDENTIFIER_LENGTH) throw badRequest(code);
  return text;
}

function requiredHash(value: unknown, code: string): string {
  const digest = canonicalHostBareSha256(value);
  if (!digest) throw badRequest(code);
  return digest;
}

function requiredText(value: unknown, code: string): string {
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

function badRequest(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}
