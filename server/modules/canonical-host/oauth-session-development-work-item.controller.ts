import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { SessionResolver } from '../identity/session-resolver.service';
import { OrdinaryWorkItemService } from '../work-item/ordinary-work-item.service';
import { developmentRunBody } from './canonical-development-run-input';

@Controller('api/canonical-host')
export class OauthSessionDevelopmentWorkItemController {
  constructor(
    private readonly sessions: SessionResolver,
    private readonly workItems: OrdinaryWorkItemService,
  ) {}

  @Post('work-items/development-runs')
  async create(@Body() body: unknown, @Req() request: Request) {
    const session = await this.sessions.resolve(request);
    if (!session) {
      throw new HttpException(
        { code: 'SESSION_REQUIRED', statusCode: 401 },
        HttpStatus.UNAUTHORIZED,
      );
    }
    const input = developmentRunBody(body);
    if (!input.documentVersionId) {
      throw new BadRequestException({
        code: 'OAUTH_SESSION_DOCUMENT_VERSION_REQUIRED',
        message:
          'OAuth session creation consumes an existing current DocumentVersion owned by the mapped Miaoda user.',
      });
    }
    return this.workItems.createOauthSessionDevelopmentRun(
      { ...input, documentVersionId: input.documentVersionId },
      session.actor,
    );
  }
}
