import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type { UpdateCanonicalModelSettingsRequest } from '@shared/api.interface';

import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from '../canonical-host/canonical-host-request-actor';
import { CanonicalModelSettingsService } from './canonical-model-settings.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/settings/models')
export class CanonicalModelSettingsController {
  constructor(private readonly service: CanonicalModelSettingsService) {}

  @Get()
  read(@Req() request: Request) {
    return this.service.read(hostActor(request));
  }

  @Post()
  update(
    @Body() input: UpdateCanonicalModelSettingsRequest,
    @Req() request: Request,
  ) {
    return this.service.update(input, hostActor(request));
  }
}
