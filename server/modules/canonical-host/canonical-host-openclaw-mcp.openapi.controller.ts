import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CanonicalHostOpenClawMcpService } from './canonical-host-openclaw-mcp.service';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
} from './canonical-service-scope.authorization';

@Controller('openapi/wiselink')
export class CanonicalHostOpenClawMcpOpenApiController {
  constructor(
    private readonly mcp: CanonicalHostOpenClawMcpService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  @Post('openclaw-mcp')
  async handleOpenClawMcp(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    await this.serviceScope.assertTransport({ transport: 'OPENCLAW_MCP' });
    await this.mcp.handle(request, response, body);
  }
}
