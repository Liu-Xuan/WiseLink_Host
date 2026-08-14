import { Controller, Get, Post } from '@nestjs/common';
import { NeedLogin } from '@lark-apaas/fullstack-nestjs-core';

import { FileServiceP0ProbeService } from './file-service-p0-probe.service';
import { RuntimeProbeService } from './runtime-probe.service';

@Controller('api/runtime-probe')
export class RuntimeProbeController {
  constructor(
    private readonly service: RuntimeProbeService,
    private readonly fileServiceP0Probe: FileServiceP0ProbeService,
  ) {}

  @Get()
  @NeedLogin()
  probe() {
    return this.service.probe();
  }

  @Post('file-service-upload')
  @NeedLogin()
  uploadFileServiceProbe() {
    return this.fileServiceP0Probe.run();
  }
}
