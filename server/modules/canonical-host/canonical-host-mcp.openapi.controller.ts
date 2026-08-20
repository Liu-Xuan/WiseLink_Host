import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CanonicalHostMcpService } from './canonical-host-mcp.service';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
} from './canonical-service-scope.authorization';

@Controller('openapi/wiselink')
export class CanonicalHostMcpOpenApiController {
  constructor(
    private readonly mcp: CanonicalHostMcpService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  @Post('mcp')
  async handleWiseLinkMcp(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    await this.serviceScope.assertTransport({ transport: 'READONLY_MCP' });
    await this.mcp.handle(request, response, body);
  }
}
