import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';

import type {
  AilyParsedPackageQueryResponse,
  AilyWorkItemDeepLinkResponse,
  AilyWorkItemStatusResponse,
  CanonicalDevelopmentWorkItemRunRequest,
  CanonicalOrdinaryWorkItemRunResponse,
} from '@shared/api.interface';

import { OrdinaryWorkItemService } from '../work-item/ordinary-work-item.service';
import { developmentRunBody } from './canonical-development-run-input';
import { CanonicalHostVerticalService } from './canonical-host-vertical.service';

@Controller('openapi/wiselink')
export class CanonicalHostOpenApiController {
  constructor(
    private readonly service: CanonicalHostVerticalService,
    private readonly workItems: OrdinaryWorkItemService,
  ) {}

  @Post('development-work-items')
  @HttpCode(200)
  createDevelopmentWorkItem(
    @Body() body: CanonicalDevelopmentWorkItemRunRequest,
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    return this.workItems.createDevelopmentAcceptanceRun(
      developmentRunBody(body),
    );
  }

  @Get('work-items/status')
  getWorkItemStatus(
    @Query('workItemId') workItemId: string,
  ): Promise<AilyWorkItemStatusResponse> {
    return this.service.openApiStatus(workItemId);
  }

  @Get('work-items/parsed-units')
  querySourceBoundUnits(
    @Query('workItemId') workItemId: string,
    @Query('query') query: string,
  ): Promise<AilyParsedPackageQueryResponse> {
    return this.service.openApiQuery({ workItemId, query });
  }

  @Get('work-items/deep-link')
  getWorkItemDeepLink(
    @Query('workItemId') workItemId: string,
  ): Promise<AilyWorkItemDeepLinkResponse> {
    return this.service.openApiDeepLink(workItemId);
  }
}
