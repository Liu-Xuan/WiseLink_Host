import { Module } from '@nestjs/common';

import { ActionAttemptLifecycleService } from './action-attempt-lifecycle.service';
import { ActionAttemptRepository } from './action-attempt.repository';
import { ReviewAttemptDispatchService } from './review-attempt-dispatch.service';

@Module({
  providers: [ActionAttemptRepository, ActionAttemptLifecycleService, ReviewAttemptDispatchService],
  exports: [ActionAttemptLifecycleService, ReviewAttemptDispatchService],
})
export class ActionAttemptModule {}
