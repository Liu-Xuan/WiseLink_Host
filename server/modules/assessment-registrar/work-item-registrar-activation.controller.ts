import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';
import { Controller, Get, Inject } from '@nestjs/common';

import {
  type WorkItemRegistrarActivationAuthority,
  type WorkItemRegistrarActivationReadiness,
  WORK_ITEM_REGISTRAR_ACTIVATION_AUTHORITY,
} from './work-item-registrar-activation';

@Controller('api/sb-job-aid/registrar-activation')
export class WorkItemRegistrarActivationController {
  constructor(
    @Inject(WORK_ITEM_REGISTRAR_ACTIVATION_AUTHORITY)
    private readonly authority: WorkItemRegistrarActivationAuthority,
  ) {}

  @Get('readiness')
  @NeedLogin()
  readiness(): WorkItemRegistrarActivationReadiness {
    return this.authority.readiness();
  }
}
