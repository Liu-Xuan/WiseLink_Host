import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import {
  AEO_ARTIFACT_ACTION_VERSION,
  AEO_HOSTED_CANDIDATE_VERTICAL_VERSION,
} from '../../../shared/aeo-integration';
import { AeoArtifactActionService } from './aeo-artifact-action.service';
import { AeoAuthoringSessionService } from './aeo-authoring-session.service';
import { isRecord } from './aeo-editor-projection.utils';
import { AeoHostedCandidateVerticalService } from './aeo-hosted-candidate-vertical.service';
import { AeoHostedPlatformReadinessService } from './aeo-hosted-platform.service';
import { rethrowAeoAuthoringHttpError } from './aeo-authoring.http';
import { AeoWorkItemBindingService } from './aeo-work-item-binding.service';

/** Canonical Miaoda surface. It exposes no legacy document or shadow storage. */
@NeedLogin()
@Controller('api/aeo-authoring')
export class AeoWorkItemAuthoringController {
  constructor(
    private readonly workItemBinding: AeoWorkItemBindingService,
    private readonly authoringSession: AeoAuthoringSessionService,
    private readonly artifactActions: AeoArtifactActionService,
    private readonly hostedReadiness: AeoHostedPlatformReadinessService,
    private readonly candidateVertical: AeoHostedCandidateVerticalService,
  ) {}

  @Get('platform-readiness')
  readHostedPlatformReadiness(@Req() request: Request) {
    return this.handle(request, async () => this.hostedReadiness.read());
  }

  @Post('validation/work-items/:workItemId/candidate-loop')
  runHostedCandidateVertical(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.handle(request, (userId) =>
      this.candidateVertical.run({
        ...(isRecord(body) ? body : {}),
        schemaVersion: AEO_HOSTED_CANDIDATE_VERTICAL_VERSION,
        workItemId,
        requesterRef: `miaoda-user://${userId}`,
      }),
    );
  }

  @Get('work-items/:workItemId/session')
  openWorkItemSession(
    @Param('workItemId') workItemId: string,
    @Query('requestId') requestId: string | undefined,
    @Query('stateVersion') stateVersion: string | undefined,
    @Query('permissionSnapshotVersion')
    permissionSnapshotVersion: string | undefined,
    @Req() request: Request,
  ) {
    return this.handle(request, (userId) =>
      this.authoringSession.open({
        workItemId,
        requestId,
        requesterRef: `miaoda-user://${userId}`,
        permissionSnapshotVersion,
        expectedStateVersion: Number(stateVersion),
      }),
    );
  }

  @Post('work-items/:workItemId/artifact-actions')
  executeWorkItemArtifactAction(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.handle(request, (userId) =>
      this.artifactActions.executeFromAuthenticatedHost({
        ...(isRecord(body) ? body : {}),
        schemaVersion: AEO_ARTIFACT_ACTION_VERSION,
        workItemId,
        requesterRef: `miaoda-user://${userId}`,
      }),
    );
  }

  @Post('work-items/preflight')
  preflightWorkItem(@Body() body: unknown, @Req() request: Request) {
    return this.handle(request, async () =>
      this.workItemBinding.preflight(body),
    );
  }

  private async handle<T>(
    request: Request,
    operation: (userId: string) => Promise<T>,
  ): Promise<T> {
    const userId = request.userContext?.userId;
    if (!userId) throw new UnauthorizedException('无法识别当前妙搭用户。');
    try {
      return await operation(userId);
    } catch (error) {
      rethrowAeoAuthoringHttpError(error);
    }
  }
}
