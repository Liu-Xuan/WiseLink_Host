import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type {
  ConfigurationEvidenceCurrentReadModel,
  ConfigurationEvidenceRefreshResponse,
  ConfigurationEvidenceSnapshotReadResponse,
} from './configuration-evidence.persistence.types';
import { ConfigurationEvidenceService } from './configuration-evidence.service';

@NeedLogin()
@Controller('api/canonical-host/work-items/:workItemId/configuration-evidence')
export class ConfigurationEvidenceController {
  constructor(private readonly service: ConfigurationEvidenceService) {}

  @Post('snapshots')
  refresh(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<ConfigurationEvidenceRefreshResponse> {
    return this.service.refresh(workItemId, body, request);
  }

  @Get('snapshots/current')
  current(
    @Param('workItemId') workItemId: string,
    @Req() request: Request,
  ): Promise<ConfigurationEvidenceCurrentReadModel> {
    return this.service.current(workItemId, request);
  }

  @Get('snapshots/:snapshotId')
  snapshot(
    @Param('workItemId') workItemId: string,
    @Param('snapshotId') snapshotId: string,
    @Req() request: Request,
  ): Promise<ConfigurationEvidenceSnapshotReadResponse> {
    return this.service.snapshot(workItemId, snapshotId, request);
  }
}
