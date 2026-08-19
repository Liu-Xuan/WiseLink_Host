import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { RequestContextService } from '@lark-apaas/nestjs-common';

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

const CANONICAL_HOST_APP_ID = 'app_17bzc551rsg';
const S1_ACCEPTANCE_ACTOR_ID = 'service:wiselink-s1-acceptance';
const S1_ACCEPTANCE_ROLE_ID = 'wiselink_development';

@Controller('openapi/wiselink')
export class CanonicalHostOpenApiController {
  constructor(
    private readonly service: CanonicalHostVerticalService,
    private readonly workItems: OrdinaryWorkItemService,
    private readonly requestContext: RequestContextService,
  ) {}

  @Post('development-work-items')
  @HttpCode(200)
  createDevelopmentWorkItem(
    @Body() body: CanonicalDevelopmentWorkItemRunRequest,
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    const context = this.requestContext.getContext();
    const tenantId = context?.tenantId;
    if (typeof tenantId !== 'string' || !tenantId.trim()) {
      throw new Error('S1_ACCEPTANCE_TENANT_CONTEXT_REQUIRED');
    }
    return this.workItems.createDevelopmentRun(
      developmentRunBody(body),
      {
        userId: S1_ACCEPTANCE_ACTOR_ID,
        tenantId: tenantId.trim(),
        appId: CANONICAL_HOST_APP_ID,
        roles: [S1_ACCEPTANCE_ROLE_ID],
        env: 'hosted',
      },
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
