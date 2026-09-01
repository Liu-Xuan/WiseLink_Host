import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';

import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { CanonicalLibraryCatalogService } from './canonical-library-catalog.service';
import { hostActor } from './canonical-host-request-actor';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/library-catalog')
export class CanonicalLibraryCatalogController {
  constructor(private readonly catalog: CanonicalLibraryCatalogService) {}

  @Get()
  read(
    @Query('view') view: string | undefined,
    @Query('query') query: string | undefined,
    @Query('family') family: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitValue: string | undefined,
    @Req() request: Request,
  ) {
    return this.catalog.read(
      {
        view,
        query,
        family,
        cursor,
        ...(limitValue === undefined
          ? {}
          : { limit: requiredInteger(limitValue) }),
      },
      hostActor(request),
    );
  }

  @Get(':workItemId/quicklook')
  quicklook(@Param('workItemId') workItemId: string, @Req() request: Request) {
    return this.catalog.quicklook(requiredText(workItemId), hostActor(request));
  }
}

function requiredText(value: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 96) {
    throw Object.assign(new Error('LIBRARY_CATALOG_WORK_ITEM_ID_INVALID'), {
      code: 'LIBRARY_CATALOG_WORK_ITEM_ID_INVALID',
      statusCode: 400,
    });
  }
  return normalized;
}

function requiredInteger(value: string): number {
  if (!/^\d{1,3}$/u.test(value)) {
    throw Object.assign(new Error('LIBRARY_CATALOG_LIMIT_INVALID'), {
      code: 'LIBRARY_CATALOG_LIMIT_INVALID',
      statusCode: 400,
    });
  }
  return Number(value);
}
