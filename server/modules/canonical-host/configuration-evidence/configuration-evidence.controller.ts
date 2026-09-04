import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import type { CanonicalConfigurationEvidenceStatusReadModel } from '@shared/api.interface';
import type {
  ConfigurationEvidenceCurrentReadModel,
  ConfigurationEvidenceAdoptionResponse,
  ConfigurationEvidenceQueryResponse,
  ConfigurationEvidenceSnapshotReadResponse,
} from './configuration-evidence.persistence.types';
import { ConfigurationEvidenceService } from './configuration-evidence.service';

@NeedLogin()
@Controller('api/canonical-host/work-items/:workItemId/configuration-evidence')
export class ConfigurationEvidenceController {
  constructor(private readonly service: ConfigurationEvidenceService) {}

  @Get('status')
  status(
    @Param('workItemId') workItemId: string,
    @Req() request: Request,
  ): Promise<CanonicalConfigurationEvidenceStatusReadModel> {
    return this.service.status(workItemId, request);
  }

  @Post('queries')
  query(
    @Param('workItemId') workItemId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<ConfigurationEvidenceQueryResponse> {
    return this.service.query(workItemId, body, request);
  }

  @Get('queries/:queryAttemptRef')
  queryStatus(
    @Param('workItemId') workItemId: string,
    @Param('queryAttemptRef') queryAttemptRef: string,
    @Req() request: Request,
  ): Promise<ConfigurationEvidenceQueryResponse> {
    return this.service.queryStatus(workItemId, queryAttemptRef, request);
  }

  @Post('candidate-evidence/:candidateEvidenceRef/adoptions')
  adopt(
    @Param('workItemId') workItemId: string,
    @Param('candidateEvidenceRef') candidateEvidenceRef: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<ConfigurationEvidenceAdoptionResponse> {
    return this.service.adopt(workItemId, candidateEvidenceRef, body, request);
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
