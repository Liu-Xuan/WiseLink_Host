import { Body, Controller, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type { HostedRequestContext } from '../document-management/src/hosted/nest';
import {
  Phase2dValidationService,
  type Phase2dValidationRequest,
} from './phase2d-validation.service';

@NeedLogin()
@Controller('api/document-management/validation')
export class Phase2dValidationController {
  constructor(private readonly service: Phase2dValidationService) {}

  @Post('phase2d-ftd-two-version')
  run(@Body() body: Phase2dValidationRequest, @Req() request: Request) {
    return this.service.run(body, contextFromRequest(request));
  }
}

function contextFromRequest(request: Request): HostedRequestContext {
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
