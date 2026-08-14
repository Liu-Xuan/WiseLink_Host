import { Module } from '@nestjs/common';

import { FileServiceP0ProbeService } from './file-service-p0-probe.service';
import { RuntimeProbeController } from './runtime-probe.controller';
import { RuntimeProbeService } from './runtime-probe.service';

@Module({
  controllers: [RuntimeProbeController],
  providers: [FileServiceP0ProbeService, RuntimeProbeService],
})
export class RuntimeProbeModule {}
