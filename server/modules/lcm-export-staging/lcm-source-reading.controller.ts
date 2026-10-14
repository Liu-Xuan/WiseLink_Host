import { Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import {
  miaodaHostedFinalUserActor, ProductionMiaodaBrowserObjectIngressGuard,
} from '../work-item/production-miaoda-browser-ingress';
import { LcmSourceReadingService } from './lcm-source-reading.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/lcm-source')
export class LcmSourceReadingController {
  constructor(private readonly service: LcmSourceReadingService) {}

  @Get('snapshots')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  catalogue(@Req() req: Request, @Query() query: Record<string, unknown>) {
    return this.service.catalogue(miaodaHostedFinalUserActor(req.userContext), query);
  }

  @Get('snapshots/:id')
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie, Authorization')
  snapshot(@Req() req: Request, @Param('id') snapshotId: string, @Query() query: Record<string, unknown>) {
    return this.service.snapshot(miaodaHostedFinalUserActor(req.userContext), snapshotId, query);
  }
}
