import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { RequestContextService } from '@lark-apaas/nestjs-common';
import type { Request, Response } from 'express';

import { CanonicalHostOpenClawMcpService } from './canonical-host-openclaw-mcp.service';

const CANONICAL_HOST_APP_ID = 'app_17bzc551rsg';

@Controller('openapi/wiselink')
export class CanonicalHostOpenClawMcpOpenApiController {
  constructor(
    private readonly mcp: CanonicalHostOpenClawMcpService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Post('openclaw-mcp')
  handleOpenClawMcp(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    this.bindCanonicalHostContext();
    return this.mcp.handle(request, response, body);
  }

  private bindCanonicalHostContext(): void {
    const requestAppId = this.requestContext.get('appId');
    if (requestAppId && requestAppId !== CANONICAL_HOST_APP_ID) {
      throw new Error('OPENCLAW_MCP_HOST_CONTEXT_MISMATCH');
    }
    this.requestContext.setContext({ appId: CANONICAL_HOST_APP_ID });
    if (this.requestContext.get('appId') !== CANONICAL_HOST_APP_ID) {
      throw new Error('OPENCLAW_MCP_REQUEST_CONTEXT_UNAVAILABLE');
    }
  }
}
