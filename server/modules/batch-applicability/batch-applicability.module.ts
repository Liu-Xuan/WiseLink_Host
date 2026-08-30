import { Module } from '@nestjs/common';

import { BatchApplicabilityService } from './batch-applicability.service';

@Module({
  providers: [BatchApplicabilityService],
  exports: [BatchApplicabilityService],
})
export class BatchApplicabilityModule {}
