import {
  Body,
  Controller,
  Inject,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { RequestContextService } from '@lark-apaas/nestjs-common';
import type { Request, Response } from 'express';

import { AILY_ACTOR_REQUEST_CONTEXT_KEY } from './aily-canonical-service-scope.authorization';
import { AilyNativeFinalUserIdentityService } from './aily-native-final-user-identity.service';
import { CANONICAL_MIAODA_APP_ID } from './canonical-host.constants';
import { CanonicalHostMcpService } from './canonical-host-mcp.service';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
} from './canonical-service-scope.authorization';

@Controller('openapi/wiselink')
export class CanonicalHostMcpOpenApiController {
  private readonly logger = new Logger(CanonicalHostMcpOpenApiController.name);

  constructor(
    private readonly mcp: CanonicalHostMcpService,
    private readonly identity: AilyNativeFinalUserIdentityService,
    private readonly requestContext: RequestContextService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  @Post('mcp')
  async handleWiseLinkMcp(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const inherited = this.requestContext.getContext() ?? {};
    await this.requestContext.run(
      {
        ...inherited,
        appId: CANONICAL_MIAODA_APP_ID,
        userId: undefined,
        tenantId: undefined,
        path: request.path,
        method: request.method,
      },
      async () => {
        const verified = await this.identity.verifyAndMap(
          singleHeader(request.headers['x-aily-jwt']),
        );
        this.requestContext.setContext({
          userId: verified.actor.canonicalSubject.id,
          tenantId: verified.actor.tenantId,
          [AILY_ACTOR_REQUEST_CONTEXT_KEY]: verified.actor,
        });
        this.logger.log(
          JSON.stringify({
            event: 'AILY_MCP_IDENTITY_VERIFIED',
            requestId: this.requestContext.get('requestId') ?? null,
            actorFingerprint: verified.actorFingerprint,
            agentId: verified.agentId,
            tokenExpiresAt: verified.tokenExpiresAt,
            applicationScopeId: verified.actor.applicationScopeId,
          }),
        );
        await this.serviceScope.assertTransport({ transport: 'READONLY_MCP' });
        await this.mcp.handle(request, response, body);
      },
    );
  }
}

function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
