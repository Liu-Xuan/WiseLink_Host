import { Body, Controller, Get, Header, Param, Post, Req, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import type { Request } from 'express';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';
import { DialogueBrowserScope } from './dialogue-browser-scope.service';
import { CanonicalJobAidWorkCorrectionService } from './canonical-jobaid-work-correction.service';
import { correctionError } from './jobaid-work-correction';

@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/work-items/:workItemId/assessment-work/corrections')
export class CanonicalJobAidWorkCorrectionController {
  constructor(private readonly corrections: CanonicalJobAidWorkCorrectionService,
    private readonly browser: DialogueBrowserScope) {}

  @Post()
  @Header('Cache-Control', 'private, no-store')
  save(@Param('workItemId') workItemId: string, @Body() body: unknown, @Req() request: Request) {
    return this.browser.run(request, () => this.corrections.save(this.id(workItemId), body, request));
  }

  @Get(':requestId')
  @Header('Cache-Control', 'private, no-cache, must-revalidate')
  @Header('Vary', 'Cookie, Authorization')
  read(@Param('workItemId') workItemId: string, @Param('requestId') requestId: string, @Req() request: Request) {
    return this.browser.run(request, () => this.corrections.read(this.id(workItemId), requestId, request));
  }

  private id(value: string): string {
    if (!/^[A-Za-z0-9:_-]{1,96}$/u.test(value))
      throw correctionError('JOBAID_CORRECTION_WORK_ITEM_INVALID', 400);
    return value;
  }
}
