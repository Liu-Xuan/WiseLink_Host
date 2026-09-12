import { CanonicalModelSettingsModule } from '../model-settings/canonical-model-settings.module';
import { MatterActionAttemptService } from './matter-action-attempt.service';
import { Module } from '@nestjs/common';
import { WorkItemRuntimeModule } from '../work-item/work-item-runtime.module';
import { EngineeringMatterRepository } from './engineering-matter.repository';
import { EngineeringMatterService } from './engineering-matter.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import { EngineeringMatterWorkingService } from './engineering-matter-working.service';
import { EngineeringMatterDirectoryService } from './engineering-matter-directory.service';
import { EngineeringSearchProjectionWriter } from './engineering-search-projection';

/** Shared Matter storage and authorization without a Review/Host module cycle. */
@Module({
  imports: [WorkItemRuntimeModule, CanonicalModelSettingsModule],
  providers: [
    EngineeringSearchProjectionWriter,
    MatterActionAttemptService,
    EngineeringMatterRepository,
    EngineeringMatterService,
    EngineeringMatterWorkingRepository,
    EngineeringMatterWorkingService,
    EngineeringMatterDirectoryService,
  ],
  exports: [
    MatterActionAttemptService,
    EngineeringMatterRepository,
    EngineeringMatterService,
    EngineeringMatterWorkingRepository,
    EngineeringMatterWorkingService,
    EngineeringMatterDirectoryService,
  ],
})
export class EngineeringMatterModule {}
