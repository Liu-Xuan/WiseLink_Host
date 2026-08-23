import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import {
  assertProductionMiaodaBrowserIdentityAvailable,
  ProductionMiaodaBrowserObjectIngressGuard,
} from '../../../../work-item/production-miaoda-browser-ingress';
import { DocumentManagementHostedService } from './document-management-hosted.service';

function contextFromRequest(request: Request) {
  const user = request.userContext;
  if (!user?.userId || user.tenantId === undefined || user.tenantId === null) {
    throw Object.assign(
      new Error('Authenticated Miaoda user context is required.'),
      {
        code: 'SERVER_LOGIN_CONTEXT_REQUIRED',
        statusCode: 401,
      },
    );
  }
  return {
    actorUserId: String(user.userId),
    tenantId: String(user.tenantId),
    roles: Array.isArray(user.roles) ? [...user.roles] : [],
    appId: String(user.appId ?? ''),
    env: String(user.env ?? ''),
  };
}
@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/document-management')
// Registered by DocumentManagementHostedModule.register(); the static lint rule
// cannot follow DynamicModule metadata.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentManagementHostedController {
  constructor(private readonly service: DocumentManagementHostedService) {}

  @Post('ingestions/file-service')
  ingestFileServiceSelection(@Body() body: unknown, @Req() request: Request) {
    assertProductionMiaodaBrowserIdentityAvailable();
    rejectReservedExternalDiscoveryClaims(body);
    return this.service.ingestFileServiceSelection(
      body,
      contextFromRequest(request),
    );
  }

  @Get('document-versions/:documentVersionId')
  getDocumentVersion(
    @Param('documentVersionId') documentVersionId: string,
    @Req() request: Request,
  ) {
    assertProductionMiaodaBrowserIdentityAvailable();
    return this.service.getDocumentVersion(
      documentVersionId,
      contextFromRequest(request),
    );
  }
}

function rejectReservedExternalDiscoveryClaims(body: unknown): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const value = body as Record<string, unknown>;
  const descriptor = value.descriptor;
  const claimsExternalDiscovery =
    descriptor !== null &&
    typeof descriptor === 'object' &&
    !Array.isArray(descriptor) &&
    Object.hasOwn(descriptor, 'externalDiscovery');
  const sourceChannel = String(value.sourceChannel ?? '').trim();
  if (
    claimsExternalDiscovery ||
    sourceChannel === 'openclaw_external_discovery_review' ||
    sourceChannel === 'openclaw_external_monitor_review'
  ) {
    throw Object.assign(
      new Error(
        'External discovery provenance can only be written by the server-owned reviewed-candidate ingestion service.',
      ),
      {
        code: 'EXTERNAL_DISCOVERY_REVIEWED_INGEST_REQUIRED',
        statusCode: 400,
      },
    );
  }
}
