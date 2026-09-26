import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type { MatterAssessmentActivityQuery } from '@shared/matter-assessment-activity.interface';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import { EngineeringMatterWorkingService } from './engineering-matter-working.service';
import { MatterActionAttemptService } from './matter-action-attempt.service';
import type { MatterAttemptScope } from './matter-action-attempt.service';
import type { CanonicalHostActor } from './canonical-host.types';
import { validateActivityQuery } from './matter-assessment-activity';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/engineering-matters')
export class MatterAssessmentActivityController {
  constructor(
    private readonly working: EngineeringMatterWorkingService,
    private readonly attempts: MatterActionAttemptService,
  ) {}

  @Get(':matterId/execution-summary')
  async summary(@Param('matterId') matterId: string, @Req() request: Request) {
    this.validateMatterId(matterId);
    const actor = hostActor(request);
    await this.working.readWorking(matterId, actor);
    const scope = this.browserScope(matterId, actor);
    return this.attempts.readExecutionSummaryForBrowser(scope, actor);
  }

  @Get(':matterId/assessment-activity')
  async read(
    @Param('matterId') matterId: string,
    @Query() raw: Record<string, unknown>,
    @Req() request: Request,
  ) {
    this.validateMatterId(matterId);
    if (
      Object.keys(raw).some(
        (key) => !['attemptRef', 'workRef', 'cursor', 'limit'].includes(key),
      ) ||
      Object.values(raw).some((value) => typeof value !== 'string')
    )
      throw new BadRequestException('MATTER_ACTIVITY_QUERY_INVALID');
    const query: MatterAssessmentActivityQuery = {
      ...(raw.attemptRef === undefined
        ? {}
        : { attemptRef: String(raw.attemptRef) }),
      ...(raw.workRef === undefined ? {} : { workRef: String(raw.workRef) }),
      ...(raw.cursor === undefined ? {} : { cursor: String(raw.cursor) }),
      ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    };
    validateActivityQuery(query);
    const actor = hostActor(request);
    // The browser actor must freshly read the exact Matter or work revision.
    if (query.workRef)
      await this.working.readWorkingRevision(matterId, query.workRef, actor);
    else await this.working.readWorking(matterId, actor);
    const scope = this.browserScope(matterId, actor);
    return this.attempts.readActivityForBrowser(scope, query, actor);
  }

  private validateMatterId(matterId: string): void {
    if (!matterId || matterId.trim() !== matterId || matterId.length > 96)
      throw new BadRequestException('MATTER_ACTIVITY_QUERY_INVALID');
  }

  private browserScope(matterId: string, actor: CanonicalHostActor): MatterAttemptScope {
    // This read-only browser projection uses native identity and fresh member/source
    // checks. The OpenClaw service allowlist applies to service execution only.
    const authorizeReferenceMatter = async (referenceMatterId: string) => {
      await this.working.readWorking(referenceMatterId, actor);
    };
    return {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      matterId,
      authorizeReferenceMatter,
    };
  }
}
