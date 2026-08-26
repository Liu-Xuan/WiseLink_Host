import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { WorkItemRuntimeModule } from '../work-item/work-item-runtime.module';
import { ReviewConversationController } from './review-conversation.controller';
import { ReviewConversationRepository } from './review-conversation.repository';
import { ReviewConversationService } from './review-conversation.service';

@Module({
  imports: [IdentityModule, WorkItemRuntimeModule],
  controllers: [ReviewConversationController],
  providers: [ReviewConversationRepository, ReviewConversationService],
})
export class ReviewPersistenceModule {}
