import { Module } from '@nestjs/common';
import { CanonicalModelSettingsModule } from '../model-settings/canonical-model-settings.module';

import { ActionAttemptLifecycleService } from './action-attempt-lifecycle.service';
import { ActionAttemptRepository } from './action-attempt.repository';
import { ReviewAttemptDispatchService } from './review-attempt-dispatch.service';

@Module({
  imports: [CanonicalModelSettingsModule],
  providers: [
    ActionAttemptRepository,
    ActionAttemptLifecycleService,
    ReviewAttemptDispatchService,
  ],
  exports: [ActionAttemptLifecycleService, ReviewAttemptDispatchService],
})
export class ActionAttemptModule {}
