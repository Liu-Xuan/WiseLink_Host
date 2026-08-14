import { Controller, Get, Param, Query } from '@nestjs/common';

import type {
  AilyParsedPackageQueryResponse,
  AilyWorkItemDeepLinkResponse,
  AilyWorkItemStatusResponse,
} from '@shared/api.interface';

import { CanonicalHostVerticalService } from './canonical-host-vertical.service';

@Controller('openapi/wiselink')
export class CanonicalHostOpenApiController {
  constructor(private readonly service: CanonicalHostVerticalService) {}

  @Get('work-items/:workItemId/status')
  getWorkItemStatus(
    @Param('workItemId') workItemId: string,
  ): Promise<AilyWorkItemStatusResponse> {
    return this.service.openApiStatus(workItemId);
  }

  @Get('work-items/:workItemId/parsed-units')
  querySourceBoundUnits(
    @Param('workItemId') workItemId: string,
    @Query('query') query: string,
  ): Promise<AilyParsedPackageQueryResponse> {
    return this.service.openApiQuery({ workItemId, query });
  }

  @Get('work-items/:workItemId/deep-link')
  getWorkItemDeepLink(
    @Param('workItemId') workItemId: string,
  ): Promise<AilyWorkItemDeepLinkResponse> {
    return this.service.openApiDeepLink(workItemId);
  }
}
