import { Module } from '@nestjs/common';

import { ActionAttemptLifecycleService } from './action-attempt-lifecycle.service';
import { ActionAttemptRepository } from './action-attempt.repository';

@Module({
  providers: [ActionAttemptRepository, ActionAttemptLifecycleService],
  exports: [ActionAttemptLifecycleService],
})
export class ActionAttemptModule {}
