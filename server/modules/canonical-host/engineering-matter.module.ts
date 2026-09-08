import { Module } from '@nestjs/common';
import { WorkItemRuntimeModule } from '../work-item/work-item-runtime.module';
import { EngineeringMatterRepository } from './engineering-matter.repository';
import { EngineeringMatterService } from './engineering-matter.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { EngineeringMatterWorkingService } from './engineering-matter-working.service';
import { EngineeringMatterDirectoryService } from './engineering-matter-directory.service';

/** Shared Matter storage and authorization without a Review/Host module cycle. */
@Module({
  imports: [WorkItemRuntimeModule],
  providers: [
    EngineeringMatterRepository,
    EngineeringMatterService,
    EngineeringMatterWorkingRepository,
    EngineeringMatterWorkingService,
    EngineeringMatterDirectoryService,
  ],
  exports: [
    EngineeringMatterRepository,
    EngineeringMatterService,
    EngineeringMatterWorkingRepository,
    EngineeringMatterWorkingService,
    EngineeringMatterDirectoryService,
  ],
})
export class EngineeringMatterModule {}
