import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  ActivateCanonicalRuleSetSnapshotRequest,
  ActivateCanonicalRuleSetSnapshotResponse,
  CanonicalRuleSetLifecycleReadModel,
  CreateCanonicalRuleSetSnapshotRequest,
  CreateCanonicalRuleSetSnapshotResponse,
} from '@shared/api.interface';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import { CanonicalRuleSetLifecycleService } from './canonical-rule-set-lifecycle.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/rule-set')
export class CanonicalRuleSetLifecycleController {
  constructor(private readonly lifecycle: CanonicalRuleSetLifecycleService) {}

  @Get()
  read(@Req() request: Request): Promise<CanonicalRuleSetLifecycleReadModel> {
    return this.lifecycle.read(hostActor(request));
  }

  @Post('snapshots')
  createSnapshot(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<CreateCanonicalRuleSetSnapshotResponse> {
    return this.lifecycle.createSnapshot(
      snapshotRequest(body),
      hostActor(request),
    );
  }

  @Post('promotions')
  promote(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<ActivateCanonicalRuleSetSnapshotResponse> {
    return this.lifecycle.promote(activationRequest(body), hostActor(request));
  }

  @Post('rollbacks')
  rollback(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<ActivateCanonicalRuleSetSnapshotResponse> {
    return this.lifecycle.rollback(activationRequest(body), hostActor(request));
  }
}

function snapshotRequest(
  value: unknown,
): CreateCanonicalRuleSetSnapshotRequest {
  const body = exactRecord(value, ['selection']);
  const selection = exactRecord(body.selection, ['bucketId', 'filePath']);
  return {
    selection: {
      bucketId: requiredText(
        selection.bucketId,
        'RULE_SET_BUCKET_ID_REQUIRED',
        255,
      ),
      filePath: requiredText(
        selection.filePath,
        'RULE_SET_FILE_PATH_REQUIRED',
        1024,
      ),
    },
  };
}

function activationRequest(
  value: unknown,
): ActivateCanonicalRuleSetSnapshotRequest {
  const body = exactRecord(value, [
    'targetSnapshotId',
    'expectedRevision',
    'reason',
  ]);
  if (
    typeof body.expectedRevision !== 'number' ||
    !Number.isSafeInteger(body.expectedRevision) ||
    body.expectedRevision < 0
  ) {
    throw badRequest('RULE_SET_EXPECTED_REVISION_INVALID');
  }
  return {
    targetSnapshotId: requiredText(
      body.targetSnapshotId,
      'RULE_SET_TARGET_SNAPSHOT_REQUIRED',
      96,
    ),
    expectedRevision: Number(body.expectedRevision),
    reason: requiredText(
      body.reason,
      'RULE_SET_ACTIVATION_REASON_REQUIRED',
      1000,
    ),
  };
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('RULE_SET_REQUEST_BODY_INVALID');
  }
  const body = value as Record<string, unknown>;
  const unknownKey = Object.keys(body).find(
    (key: string): boolean => !allowedKeys.includes(key),
  );
  const missingKey = allowedKeys.find(
    (key: string): boolean => !Object.hasOwn(body, key),
  );
  if (unknownKey) throw badRequest(`RULE_SET_UNKNOWN_FIELD:${unknownKey}`);
  if (missingKey) throw badRequest(`RULE_SET_REQUIRED_FIELD:${missingKey}`);
  return body;
}

function requiredText(value: unknown, code: string, maxLength: number): string {
  if (typeof value !== 'string') throw badRequest(code);
  const normalized: string = value.trim();
  if (!normalized || normalized.length > maxLength) throw badRequest(code);
  return normalized;
}

function badRequest(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 400 });
}
