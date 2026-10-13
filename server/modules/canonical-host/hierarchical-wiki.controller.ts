import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { z } from 'zod/v4';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import { HierarchicalWikiService } from './hierarchical-wiki.service';
import { summaryText } from './derived-summary.validation';

const enable = z.strictObject({
  fleetFamilyId: z.string().trim().min(1).max(96),
  fleetModelId: z.string().trim().min(1).max(96).nullable(),
  modelRef: z.string().trim().min(1).max(128),
});
const change = z.strictObject({
  enabled: z.boolean().optional(),
  immediately: z.boolean().optional(),
});
const classification = z.strictObject({
  sourceKind: z.enum(['DOCUMENT', 'MATTER']),
  sourceId: z.string().min(1).max(96),
  ata: z
    .string()
    .regex(/^\d{2}(?:-\d{2})?$/u)
    .nullable(),
  included: z.boolean(),
});

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/hierarchical-wiki')
export class HierarchicalWikiController {
  constructor(private readonly wiki: HierarchicalWikiService) {}

  @Get()
  list(
    @Req() request: Request,
    @Query('classificationCursor') cursor?: string,
  ) {
    return this.wiki.list(
      hostActor(request),
      cursor === undefined ? undefined : summaryText(cursor, 500),
    );
  }

  @Post()
  enable(@Body() body: unknown, @Req() request: Request) {
    const input = enable.parse(body);
    return this.wiki.enable(
      { ...input, fleetModelId: input.fleetModelId ?? null },
      hostActor(request),
    );
  }

  @Post(':summaryId')
  change(
    @Param('summaryId') summaryId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    return this.wiki.update(
      summaryText(summaryId, 96),
      change.parse(body),
      hostActor(request),
    );
  }

  @Post(':summaryId/classification')
  classify(
    @Param('summaryId') summaryId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = classification.parse(body);
    return this.wiki.classify(
      summaryText(summaryId, 96),
      { ...input, ata: input.ata ?? null },
      hostActor(request),
    );
  }

  @Post(':summaryId/upstream-matter')
  delegate(
    @Param('summaryId') summaryId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = z
      .strictObject({
        matterId: z.string().startsWith('MAT-').max(96),
        enabled: z.boolean(),
      })
      .parse(body);
    return this.wiki.delegateMatter(
      summaryText(summaryId, 96),
      input,
      hostActor(request),
    );
  }
}
