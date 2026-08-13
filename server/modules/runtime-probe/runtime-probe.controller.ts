import { Controller, Get } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';

import { RuntimeProbeService } from './runtime-probe.service';

@Controller('api/runtime-probe')
export class RuntimeProbeController {
  constructor(private readonly service: RuntimeProbeService) {}

  @Get()
  @NeedLogin()
  probe() {
    return this.service.probe();
  }
}
