import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Post,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { z } from 'zod/v4';
import { SessionResolver } from '../identity/session-resolver.service';
import type { Request } from 'express';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import { CanonicalInitialAnalysisContinuationService } from './canonical-initial-analysis-continuation.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/work-items/:workItemId/initial-analysis')
export class CanonicalInitialAnalysisContinuationController {
  constructor(
    private readonly service: CanonicalInitialAnalysisContinuationService,
    private readonly sessions: SessionResolver,
  ) {}

  @Post('continue')
  async request(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    try {
      return await this.sessions.withRequestSession(request, (session) =>
        this.service.request(workItemId, body, hostActor(request), session),
      );
    } catch (error) {
      if (error instanceof z.ZodError)
        throw new BadRequestException('INITIAL_CONTINUATION_REQUEST_INVALID');
      if (
        error instanceof Error &&
        'code' in error &&
        typeof error.code === 'string' &&
        error.code.startsWith('ACTION_ATTEMPT_')
      )
        throw new ConflictException(error.code);
      if (
        error instanceof Error &&
        (error.message.startsWith('INITIAL_CONTINUATION_') ||
          error.message.startsWith('ACTION_ATTEMPT_') ||
          error.message.startsWith('TRANSLATION_') ||
          error.message.startsWith('JOBAID_') ||
          error.message.startsWith('CONFIGURATION_REEVALUATION_'))
      )
        throw new ConflictException(error.message);
      throw error;
    }
  }
}
