import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
} from '@nestjs/common';

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
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
} from './canonical-service-scope.authorization';

@Controller('openapi/wiselink')
export class CanonicalHostOpenApiController {
  constructor(
    private readonly service: CanonicalHostVerticalService,
    private readonly workItems: OrdinaryWorkItemService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  @Post('development-work-items')
  @HttpCode(200)
  async createDevelopmentWorkItem(
    @Body() body: CanonicalDevelopmentWorkItemRunRequest,
  ): Promise<CanonicalOrdinaryWorkItemRunResponse> {
    const input = developmentRunBody(body);
    if (!input.documentVersionId) {
      throw new BadRequestException({
        code: 'CANONICAL_DEVELOPMENT_SERVICE_DOCUMENT_VERSION_REQUIRED',
        message: 'Service-scoped creation requires a current DocumentVersion.',
      });
    }
    const documentVersionInput = {
      ...input,
      documentVersionId: input.documentVersionId,
    };
    const scope = await this.serviceScope.authorizeDevelopmentCreate(
      documentVersionInput,
    );
    return this.workItems.createDevelopmentAcceptanceRun(
      documentVersionInput,
      scope,
    );
  }

  @Get('work-items/status')
  async getWorkItemStatus(
    @Query('workItemId') workItemId: string,
  ): Promise<AilyWorkItemStatusResponse> {
    const scope = await this.serviceScope.authorizeWorkItemRead({
      transport: 'OPENAPI_REST',
      operation: 'READ_STATUS',
      workItemId,
    });
    return this.service.openApiStatus(workItemId, scope);
  }

  @Get('work-items/parsed-units')
  async querySourceBoundUnits(
    @Query('workItemId') workItemId: string,
    @Query('query') query: string,
  ): Promise<AilyParsedPackageQueryResponse> {
    const scope = await this.serviceScope.authorizeWorkItemRead({
      transport: 'OPENAPI_REST',
      operation: 'QUERY_PARSED_PACKAGE',
      workItemId,
    });
    return this.service.openApiQuery({ workItemId, query }, scope);
  }

  @Get('work-items/deep-link')
  async getWorkItemDeepLink(
    @Query('workItemId') workItemId: string,
  ): Promise<AilyWorkItemDeepLinkResponse> {
    const scope = await this.serviceScope.authorizeWorkItemRead({
      transport: 'OPENAPI_REST',
      operation: 'READ_DEEP_LINK',
      workItemId,
    });
    return this.service.openApiDeepLink(workItemId, scope);
  }
}
