import { Controller, Header, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { ProductionMiaodaBrowserObjectIngressGuard } from '../work-item/production-miaoda-browser-ingress';

/** This partial delivery has no manual producer or persistence path. */
@NeedLogin()
@UseGuards(ProductionMiaodaBrowserObjectIngressGuard)
@Controller('api/canonical-host/work-items/:workItemId/assessment-work/corrections')
export class CanonicalJobAidManualCorrectionUnavailableController {
  @Post()
  @Header('Cache-Control', 'private, no-store')
  save(): never {
    throw new ServiceUnavailableException({
      code: 'JOBAID_MANUAL_CORRECTION_NOT_ENABLED',
      message: '当前版本暂未启用人工更正。',
    });
  }
}
