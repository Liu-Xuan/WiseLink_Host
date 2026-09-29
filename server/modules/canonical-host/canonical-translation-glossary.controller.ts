import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import type { TranslationGlossarySnapshot } from '@shared/api.interface';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { hostActor } from './canonical-host-request-actor';
import { CanonicalTranslationGlossaryService } from './canonical-translation-glossary.service';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/translation-glossary')
export class CanonicalTranslationGlossaryController {
  constructor(private readonly glossary: CanonicalTranslationGlossaryService) {}

  @Get()
  read(@Req() request: Request): Promise<TranslationGlossarySnapshot> {
    return this.glossary.read(hostActor(request).tenantId);
  }

  @Put()
  update(@Body() body: unknown, @Req() request: Request): Promise<TranslationGlossarySnapshot> {
    const actor = hostActor(request);
    return this.glossary.update(actor.tenantId, actor.userId, body);
  }
}
