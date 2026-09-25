import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  AcknowledgeAutomaticWorkItemRequest,
  AcknowledgeAutomaticWorkItemResponse,
  BlockAutomaticWorkItemRequest,
  BlockAutomaticWorkItemResponse,
  AutomaticWorkItemClaimResult,
  NextAutomaticWorkItemRequest,
} from '@shared/api.interface';

import { CanonicalHostOpenClawMcpService } from './canonical-host-openclaw-mcp.service';
import { AutomaticWorkItemDispatchService } from './automatic-work-item-dispatch.service';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
} from './canonical-service-scope.authorization';

@Controller('openapi/wiselink')
export class CanonicalHostOpenClawMcpOpenApiController {
  constructor(
    private readonly mcp: CanonicalHostOpenClawMcpService,
    private readonly autoWorkItems: AutomaticWorkItemDispatchService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  @Post('openclaw-mcp')
  async handleOpenClawMcp(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    await this.serviceScope.assertTransport({ transport: 'OPENCLAW_MCP' });
    await this.mcp.handle(request, response, body);
  }

  @Post('next-work-item')
  async nextWorkItem(
    @Body() body?: NextAutomaticWorkItemRequest,
  ): Promise<AutomaticWorkItemClaimResult> {
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    return this.autoWorkItems.nextWorkItem(body);
  }

  @Post('ack-work-item')
  async acknowledgeWorkItem(
    @Body() body: AcknowledgeAutomaticWorkItemRequest,
  ): Promise<AcknowledgeAutomaticWorkItemResponse> {
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    return this.autoWorkItems.acknowledgeWorkItem(body);
  }

  @Post('block-work-item')
  async blockWorkItem(
    @Body() body: BlockAutomaticWorkItemRequest,
  ): Promise<BlockAutomaticWorkItemResponse> {
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    return this.autoWorkItems.blockWorkItem(body);
  }
}
