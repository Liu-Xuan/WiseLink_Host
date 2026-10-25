import { assertCanonicalHostExecutor } from './canonical-host-executor-policy';
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
    assertCanonicalHostExecutor('HOSTED');
    await this.serviceScope.assertTransport({ transport: 'OPENCLAW_MCP' });
    assertCanonicalHostExecutor('HOSTED');
    await this.mcp.handle(request, response, body);
  }

  @Post('apply-pending-model-configuration')
  async applyPendingModelConfiguration(@Body() body: unknown) {
    assertCanonicalHostExecutor('HOSTED');
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    assertCanonicalHostExecutor('HOSTED');
    return this.autoWorkItems.applyPendingModelConfiguration(body);
  }

  @Post('next-work-item')
  async nextWorkItem(
    @Body() body?: NextAutomaticWorkItemRequest,
  ): Promise<AutomaticWorkItemClaimResult> {
    assertCanonicalHostExecutor('HOSTED');
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    assertCanonicalHostExecutor('HOSTED');
    return this.autoWorkItems.nextWorkItem(body);
  }

  @Post('ack-work-item')
  async acknowledgeWorkItem(
    @Body() body: AcknowledgeAutomaticWorkItemRequest,
  ): Promise<AcknowledgeAutomaticWorkItemResponse> {
    assertCanonicalHostExecutor('HOSTED');
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    assertCanonicalHostExecutor('HOSTED');
    return this.autoWorkItems.acknowledgeWorkItem(body);
  }

  @Post('block-work-item')
  async blockWorkItem(
    @Body() body: BlockAutomaticWorkItemRequest,
  ): Promise<BlockAutomaticWorkItemResponse> {
    assertCanonicalHostExecutor('HOSTED');
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    assertCanonicalHostExecutor('HOSTED');
    return this.autoWorkItems.blockWorkItem(body);
  }

  @Post('codex-mcp')
  async handleCodexMcp(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: unknown,
  ): Promise<void> {
    assertCanonicalHostExecutor('CODEX');
    await this.serviceScope.assertTransport({ transport: 'CODEX_MCP' });
    assertCanonicalHostExecutor('CODEX');
    await this.mcp.handle(request, response, body, 'CODEX');
  }

  @Post('codex-apply-pending-model-configuration')
  async applyPendingCodexModelConfiguration(@Body() body: unknown) {
    assertCanonicalHostExecutor('CODEX');
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    assertCanonicalHostExecutor('CODEX');
    return this.autoWorkItems.applyPendingModelConfiguration(body);
  }

  @Post('codex-next-work-item')
  async nextCodexWorkItem(
    @Body() body?: NextAutomaticWorkItemRequest,
  ): Promise<AutomaticWorkItemClaimResult> {
    assertCanonicalHostExecutor('CODEX');
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    assertCanonicalHostExecutor('CODEX');
    return this.autoWorkItems.nextWorkItem(body);
  }

  @Post('codex-ack-work-item')
  async acknowledgeCodexWorkItem(
    @Body() body: AcknowledgeAutomaticWorkItemRequest,
  ): Promise<AcknowledgeAutomaticWorkItemResponse> {
    assertCanonicalHostExecutor('CODEX');
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    assertCanonicalHostExecutor('CODEX');
    return this.autoWorkItems.acknowledgeWorkItem(body);
  }

  @Post('codex-block-work-item')
  async blockCodexWorkItem(
    @Body() body: BlockAutomaticWorkItemRequest,
  ): Promise<BlockAutomaticWorkItemResponse> {
    assertCanonicalHostExecutor('CODEX');
    await this.serviceScope.assertAutoWorkItemQueueTransport();
    assertCanonicalHostExecutor('CODEX');
    return this.autoWorkItems.blockWorkItem(body);
  }

}
