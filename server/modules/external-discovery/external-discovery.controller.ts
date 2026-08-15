import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import { hostActor } from '../canonical-host/canonical-host.controller';
import { ExternalDiscoveryService } from './external-discovery.service';

@NeedLogin()
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
  const actor = hostActor(request);
  return {
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    roles: actor.roles,
  };
}
