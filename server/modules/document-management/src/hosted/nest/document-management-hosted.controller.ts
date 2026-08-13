import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import { DocumentManagementHostedService } from './document-management-hosted.service';

function contextFromRequest(request: Request) {
  const user = request.userContext;
  if (!user?.userId || user.tenantId === undefined || user.tenantId === null) {
    throw Object.assign(new Error('Authenticated Miaoda user context is required.'), {
      code: 'SERVER_LOGIN_CONTEXT_REQUIRED',
      statusCode: 401,
    });
  }
  return {
    actorUserId: String(user.userId),
    tenantId: String(user.tenantId),
    roles: Array.isArray(user.roles) ? [...user.roles] : [],
  };
}
@NeedLogin()
@Controller('api/document-management')
// Registered by DocumentManagementHostedModule.register(); the static lint rule
// cannot follow DynamicModule metadata.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentManagementHostedController {
  constructor(private readonly service: DocumentManagementHostedService) {}

  @Post('ingestions/file-service')
  ingestFileServiceSelection(@Body() body: unknown, @Req() request: Request) {
    return this.service.ingestFileServiceSelection(body, contextFromRequest(request));
  }

  @Get('document-versions/:documentVersionId')
  getDocumentVersion(
    @Param('documentVersionId') documentVersionId: string,
    @Req() request: Request,
  ) {
    return this.service.getDocumentVersion(documentVersionId, contextFromRequest(request));
  }
}
