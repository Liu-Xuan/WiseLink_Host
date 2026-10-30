import { Body, Controller, Headers, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CanonicalHostAilyMcpService } from './canonical-host-aily-mcp.service';

/** Platform API-key gateway retained. Service configuration explicitly selects JWT or Host service trust. */
@Controller('openapi/wiselink')
export class CanonicalHostAilyMcpOpenApiController {
  constructor(private readonly mcp: CanonicalHostAilyMcpService) {}

  @Post('aily-mcp')
  async handleWiseLinkAilyMcp(@Req() request: Request, @Res() response: Response,
    @Body() body: unknown, @Headers('x-aily-jwt') jwt?: string): Promise<void> {
    await this.mcp.handle(request, response, body, jwt);
  }
}
