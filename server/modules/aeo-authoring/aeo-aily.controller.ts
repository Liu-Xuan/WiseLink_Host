import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { rethrowAeoAuthoringHttpError } from './aeo-authoring.http';
import {
  AEO_AILY_REQUESTER_RESOLVER,
  type AeoAilyRequesterResolver,
  attachTrustedAilyRequester,
} from './aeo-aily-requester.service';
import { AeoAilyService } from './aeo-aily.service';

@Controller('openapi/aeo')
export class AeoAilyController {
  constructor(
    private readonly aeo: AeoAilyService,
    @Inject(AEO_AILY_REQUESTER_RESOLVER)
    private readonly requesterResolver: AeoAilyRequesterResolver,
  ) {}

  @Post('find-similar')
  findSimilar(@Body() body: unknown, @Req() request: Request) {
    return this.handle(request, body, (input) => this.aeo.findSimilar(input));
  }

  @Post('start-authoring')
  startAuthoring(@Body() body: unknown, @Req() request: Request) {
    return this.handle(request, body, (input) =>
      this.aeo.startAuthoring(input),
    );
  }

  @Post('check-draft')
  checkDraft(@Body() body: unknown, @Req() request: Request) {
    return this.handle(request, body, (input) => this.aeo.checkDraft(input));
  }

  @Post('todos')
  listTodos(@Body() body: unknown, @Req() request: Request) {
    return this.handle(request, body, (input) => this.aeo.listTodos(input));
  }

  @Post('deep-link')
  getDeepLink(@Body() body: unknown, @Req() request: Request) {
    return this.handle(request, body, (input) => this.aeo.getDeepLink(input));
  }

  private async handle<T>(
    request: Request,
    body: unknown,
    operation: (input: Record<string, unknown>) => Promise<T>,
  ): Promise<T> {
    try {
      const requesterRef = await this.requesterResolver.resolve(request);
      return await operation(attachTrustedAilyRequester(body, requesterRef));
    } catch (error) {
      rethrowAeoAuthoringHttpError(error);
    }
  }
}
