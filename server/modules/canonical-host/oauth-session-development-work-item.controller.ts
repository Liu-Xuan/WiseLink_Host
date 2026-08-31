import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { SessionResolver } from '../identity/session-resolver.service';
import { OrdinaryWorkItemService } from '../work-item/ordinary-work-item.service';
import { miaodaHostedFinalUserActor } from '../work-item/production-miaoda-browser-ingress';
import { developmentRunBody } from './canonical-development-run-input';

@Controller('api/canonical-host')
export class OauthSessionDevelopmentWorkItemController {
  constructor(
    private readonly sessions: SessionResolver,
    private readonly workItems: OrdinaryWorkItemService,
  ) {}

  @Get('work-items/development-runs/existing-pdfs')
  async listExistingPdfs(
    @Query('search') search: string | undefined,
    @Query('offset') offset: string | undefined,
    @Req() request: Request,
  ) {
    const session = await this.sessions.resolve(request);
    if (!session) {
      throw new HttpException(
        { code: 'SESSION_REQUIRED', statusCode: 401 },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.workItems.listOauthSessionDevelopmentPdfs(
      { search, offset },
      session.actor,
      miaodaHostedFinalUserActor(request.userContext),
    );
  }

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
    return this.workItems.createOauthSessionDevelopmentRun(
      input,
      session.actor,
      miaodaHostedFinalUserActor(request.userContext),
    );
  }

  @Post('work-items/:workItemId/retry-development-run')
  async retry(
    @Param('workItemId') workItemId: string,
    @Req() request: Request,
  ) {
    const session = await this.sessions.resolve(request);
    if (!session) {
      throw new HttpException(
        { code: 'SESSION_REQUIRED', statusCode: 401 },
        HttpStatus.UNAUTHORIZED,
      );
    }
    return this.workItems.retryOauthSessionDevelopmentRun(
      workItemId,
      session.actor,
      miaodaHostedFinalUserActor(request.userContext),
    );
  }
}
