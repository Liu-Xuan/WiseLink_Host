import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CanonicalHostOpenClawMcpService } from './canonical-host-openclaw-mcp.service';

@Controller('openapi/wiselink')
export class CanonicalHostOpenClawMcpOpenApiController {
  constructor(private readonly mcp: CanonicalHostOpenClawMcpService) {}

  @Post('openclaw-mcp')
  handleOpenClawMcp(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    return this.mcp.handle(request, response, body);
  }
}
