import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type { CreateDerivedSummaryRequest, RequestDerivedSummaryUpdate } from '@shared/derived-summary.interface';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import { DerivedSummaryService } from './derived-summary.service';
import { parseSummaryRequest, summaryText } from './derived-summary.validation';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/derived-summaries')
export class DerivedSummaryController {
  constructor(private readonly summaries: DerivedSummaryService) {}

  @Get()
  list(@Req() request: Request) { return this.summaries.list(hostActor(request)); }

  @Post()
  create(@Body() body: unknown, @Req() request: Request) {
    return this.summaries.create(parseSummaryRequest(body) as CreateDerivedSummaryRequest, hostActor(request));
  }

  @Post(':summaryId/requests')
  update(@Param('summaryId') summaryId: string, @Body() body: unknown, @Req() request: Request) {
    return this.summaries.request(summaryText(summaryId, 96),
      parseSummaryRequest(body, true) as RequestDerivedSummaryUpdate, hostActor(request));
  }

  @Get(':summaryId/requests/:attemptRef')
  status(@Param('summaryId') summaryId: string, @Param('attemptRef') attemptRef: string, @Req() request: Request) {
    return this.summaries.status(summaryText(summaryId, 96), summaryText(attemptRef, 128), hostActor(request));
  }

  @Get(':summaryId/revisions/:summaryRef')
  revision(@Param('summaryId') summaryId: string, @Param('summaryRef') summaryRef: string, @Req() request: Request) {
    return this.summaries.readRevision(summaryText(summaryId, 96), summaryText(summaryRef, 96), hostActor(request));
  }

  @Get(':summaryId')
  read(@Param('summaryId') summaryId: string, @Req() request: Request) {
    return this.summaries.read(summaryText(summaryId, 96), hostActor(request));
  }
}
