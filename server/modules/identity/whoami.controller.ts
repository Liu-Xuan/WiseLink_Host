import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import type { WhoamiResponse } from './identity.types';
import { SessionResolver } from './session-resolver.service';

@Controller('api/identity')
export class WhoamiController {
  constructor(private readonly sessions: SessionResolver) {}

  @Get('whoami')
  async whoami(@Req() request: Request): Promise<WhoamiResponse> {
    const resolved = await this.sessions.resolve(request);
    if (!resolved) {
      throw new HttpException(
        {
          code: 'SESSION_REQUIRED',
          message: 'Complete the official Feishu OAuth flow first.',
          statusCode: 401,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return {
      authenticated: true,
      verifiedIdentity: {
        provenance: resolved.identity.provenance,
        miaodaUserId: resolved.identity.miaodaUserId,
        tenantId: resolved.identity.tenantId,
        feishuUserId: resolved.identity.feishuUserId,
        feishuOpenId: resolved.identity.feishuOpenId,
        namespacedSubject: resolved.identity.namespacedSubject,
        verifiedAt: resolved.identity.verifiedAt,
      },
      session: {
        id: resolved.session.id,
        revision: resolved.session.revision,
        expiresAt: resolved.session.expiresAt.toISOString(),
        provenance: 'SERVER_OPAQUE_SESSION',
      },
    };
  }
}
