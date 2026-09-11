import { BadRequestException, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type { EngineeringIssueSearchHit } from '@shared/engineering-issue-search.interface';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import { EngineeringIssueSearchService } from './engineering-issue-search.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/engineering-issues')
export class EngineeringIssueSearchController {
  constructor(private readonly issues: EngineeringIssueSearchService) {}

  @Get()
  search(@Query('search') search: string | undefined, @Req() request: Request) {
    return this.issues.search(search ?? '', hostActor(request));
  }

  @Get('work')
  read(
    @Query('subjectKind') subjectKind: EngineeringIssueSearchHit['subjectKind'],
    @Query('subjectId') subjectId: string,
    @Query('workRef') workRef: string,
    @Query('issueKey') issueKey: string,
    @Req() request: Request,
  ) {
    return this.issues.read(
      { subjectKind, subjectId, workRef, issueKey },
      hostActor(request),
    );
  }

  @Post('projection/rebuild')
  rebuildProjection(@Query('limit') limit: string | undefined, @Req() request: Request) {
    const parsed = limit === undefined ? undefined : Number(limit);
    if (parsed !== undefined && (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100)) {
      throw new BadRequestException('ENGINEERING_SEARCH_REBUILD_LIMIT_INVALID');
    }
    return this.issues.rebuildProjection(parsed, hostActor(request));
  }
}
