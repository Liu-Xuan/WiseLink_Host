import { Module } from '@nestjs/common';

import { RuntimeProbeController } from './runtime-probe.controller';
import { RuntimeProbeService } from './runtime-probe.service';

@Module({
  controllers: [RuntimeProbeController],
  providers: [RuntimeProbeService],
})
export class RuntimeProbeModule {}
