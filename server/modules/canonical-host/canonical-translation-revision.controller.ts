import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { z } from 'zod/v4';
import type { Request } from 'express';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import { CanonicalTranslationRevisionService } from './canonical-translation-revision.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/work-items/:workItemId/translation-workspaces')
export class CanonicalTranslationRevisionController {
  constructor(private readonly service: CanonicalTranslationRevisionService) {}
  @Get(':workspaceId/revisions')
  async read(
    @Param('workItemId') workItemId: string,
    @Param('workspaceId') workspaceId: string,
    @Req() request: Request,
  ) {
    try {
      return await this.service.read(
        workItemId,
        workspaceId,
        hostActor(request),
      );
    } catch (error) {
      throw responseError(error);
    }
  }
  @Post('revisions')
  async save(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    try {
      return await this.service.save(workItemId, body, hostActor(request));
    } catch (error) {
      throw responseError(error);
    }
  }
}

function responseError(error: unknown): unknown {
  if (error instanceof z.ZodError)
    return new BadRequestException('TRANSLATION_REVISION_COMMAND_INVALID');
  if (
    error instanceof Error &&
    [
      'TRANSLATION_WORKSPACE_NOT_FOUND',
      'TRANSLATION_ENGINEER_REVISION_OWNER_MISMATCH',
    ].includes(error.message)
  )
    return new NotFoundException('CANONICAL_OBJECT_NOT_FOUND');
  if (error instanceof Error && error.message.startsWith('TRANSLATION_'))
    return new ConflictException(error.message);
  return error;
}
