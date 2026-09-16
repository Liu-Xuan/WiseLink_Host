import { BadRequestException, Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { contextFromRequest } from '../document-management/src/hosted/nest/document-management-hosted.controller';
import { DocumentActivityRuntimeService } from './document-activity-runtime.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/document-management/document-versions/:documentVersionId')
// Registered in CanonicalHostModule.forRoot dynamic controllers.
// eslint-disable-next-line @darraghor/nestjs-typed/injectable-should-be-provided
export class DocumentActivityReadingController {
  constructor(private readonly activity: DocumentActivityRuntimeService) {}

  @Get('activity-reading')
  @Header('Cache-Control', 'private, no-store')
  async read(@Param('documentVersionId') documentVersionId: string, @Query('parseRunId') parseRunId: string,
    @Query('candidateRevision') candidateRevision: string | undefined, @Req() request: Request) {
    if (candidateRevision !== undefined && (typeof candidateRevision !== 'string' || !/^[1-9][0-9]*$/.test(candidateRevision)))
      throw new BadRequestException('DOCUMENT_ACTIVITY_REVISION_INVALID');
    return this.activity.readForBrowser({ documentVersionId, parseRunId,
      ...(candidateRevision === undefined ? {} : { candidateRevision: Number(candidateRevision) }) }, contextFromRequest(request));
  }
}
