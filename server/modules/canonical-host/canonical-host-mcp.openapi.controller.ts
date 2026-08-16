import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CanonicalHostMcpService } from './canonical-host-mcp.service';

@Controller('openapi/wiselink')
export class CanonicalHostMcpOpenApiController {
  constructor(private readonly mcp: CanonicalHostMcpService) {}

  @Post('mcp')
  handleWiseLinkMcp(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    return this.mcp.handle(request, response, body);
  }
}
