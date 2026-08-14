import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  CanonicalEntryQueryRequest,
} from '@shared/api.interface';

import { OrdinaryWorkItemService } from '../work-item/ordinary-work-item.service';
import { CanonicalHostVerticalService } from './canonical-host-vertical.service';
import type { CanonicalHostActor } from './canonical-host.types';

@NeedLogin()
@Controller('api/canonical-host')
export class CanonicalHostController {
  constructor(
    private readonly service: CanonicalHostVerticalService,
    private readonly workItems: OrdinaryWorkItemService,
  ) {}

  @Post('work-items/parse-pdf')
  runPdf(
    @Body() request: unknown,
    @Req() httpRequest: Request,
  ) {
    return this.workItems.parsePdf(
      request as Parameters<OrdinaryWorkItemService['parsePdf']>[0],
      hostActor(httpRequest),
    );
  }

  @Get('work-items/:workItemId/document-parsing')
  page(
    @Param('workItemId') workItemId: string,
    @Query('query') query: string,
    @Req() httpRequest: Request,
  ) {
    return this.service.page(
      {
        workItemId,
        query,
      },
      hostActor(httpRequest),
    );
  }

  @Get('work-items/:workItemId/status')
  status(
    @Param('workItemId') workItemId: string,
    @Query('requestId') requestId: string,
    @Query('documentVersionId') documentVersionId: string,
    @Req() httpRequest: Request,
  ) {
    return this.service.status({
      workItemId,
      requestId,
      documentVersionId,
    }, hostActor(httpRequest));
  }

  @Post('work-items/query-parsed-units')
  query(
    @Body() request: CanonicalEntryQueryRequest,
    @Req() httpRequest: Request,
  ) {
    return this.service.query(request, hostActor(httpRequest));
  }
}

export function hostActor(request: Request): CanonicalHostActor {
  const context = request.userContext;
  if (!context?.userId || !context.tenantId || !context.appId || !context.env) {
    throw new Error('CANONICAL_HOST_ACTOR_CONTEXT_REQUIRED');
  }
  return {
    userId: context.userId,
    tenantId: String(context.tenantId),
    appId: context.appId,
    roles: [...(context.roles ?? [])],
    env: context.env,
  };
}
