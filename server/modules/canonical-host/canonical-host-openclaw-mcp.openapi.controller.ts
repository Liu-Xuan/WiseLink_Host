import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CanonicalHostOpenClawMcpService } from './canonical-host-openclaw-mcp.service';
import { canonicalServiceScopeUnavailable } from './canonical-service-scope.authorization';

@Controller('openapi/wiselink')
export class CanonicalHostOpenClawMcpOpenApiController {
  constructor(private readonly mcp: CanonicalHostOpenClawMcpService) {}

  @Post('openclaw-mcp')
  async handleOpenClawMcp(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    void request;
    void response;
    void body;
    throw canonicalServiceScopeUnavailable();
  }
}
