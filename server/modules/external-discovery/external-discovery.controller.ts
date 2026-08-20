import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import {
  assertProductionMiaodaBrowserIdentityAvailable,
  ProductionMiaodaBrowserObjectIngressGuard,
} from '../work-item/production-miaoda-browser-ingress';
import { ExternalDiscoveryService } from './external-discovery.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/external-discovery')
export class ExternalDiscoveryController {
  constructor(private readonly service: ExternalDiscoveryService) {}

  @Get('search-runs')
  list(@Req() request: Request) {
    return this.service.list(serverContext(request));
  }

  @Post('search-runs/:searchRunRef/candidates/:candidateRef/select')
  select(
    @Param('searchRunRef') searchRunRef: string,
    @Param('candidateRef') candidateRef: string,
    @Req() request: Request,
  ) {
    return this.service.select({
      searchRunRef,
      candidateRef,
      context: serverContext(request),
    });
  }

  @Post('search-runs/:searchRunRef/candidates/:candidateRef/reject')
  reject(
    @Param('searchRunRef') searchRunRef: string,
    @Param('candidateRef') candidateRef: string,
    @Req() request: Request,
  ) {
    return this.service.reject({
      searchRunRef,
      candidateRef,
      context: serverContext(request),
    });
  }
}

function serverContext(request: Request) {
  assertProductionMiaodaBrowserIdentityAvailable();
  const actor = request.userContext;
  if (
    !actor?.userId ||
    actor.tenantId === undefined ||
    actor.tenantId === null ||
    actor.isSystemAccount === true
  ) {
    throw Object.assign(new Error('CANONICAL_HOST_ACTOR_CONTEXT_REQUIRED'), {
      code: 'CANONICAL_HOST_ACTOR_CONTEXT_REQUIRED',
      statusCode: 401,
    });
  }
  return {
    actorUserId: String(actor.userId),
    tenantId: String(actor.tenantId),
    roles: [...(actor.roles ?? [])],
  };
}
