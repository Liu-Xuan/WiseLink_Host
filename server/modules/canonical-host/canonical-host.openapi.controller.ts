import { Controller, Get, Query } from '@nestjs/common';

import type {
  AilyParsedPackageQueryResponse,
  AilyWorkItemDeepLinkResponse,
  AilyWorkItemStatusResponse,
} from '@shared/api.interface';

import { CanonicalHostVerticalService } from './canonical-host-vertical.service';

@Controller('openapi/wiselink')
export class CanonicalHostOpenApiController {
  constructor(private readonly service: CanonicalHostVerticalService) {}

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
