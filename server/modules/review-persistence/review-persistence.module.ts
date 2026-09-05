import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';
import { ActionAttemptModule } from '../action-attempt/action-attempt.module';
import { DocumentManagementRuntimeModule } from '../document-management-runtime/document-management-runtime.module';
import { WorkItemRuntimeModule } from '../work-item/work-item-runtime.module';
import { ReviewAttachmentService } from './review-attachment.service';
import { ReviewConversationController } from './review-conversation.controller';
import { ReviewConversationRepository } from './review-conversation.repository';
import { ReviewConversationService } from './review-conversation.service';

@Module({
  imports: [
    ActionAttemptModule,
    IdentityModule,
    WorkItemRuntimeModule,
    DocumentManagementRuntimeModule,
  ],
  controllers: [ReviewConversationController],
  providers: [
    ReviewConversationRepository,
    ReviewConversationService,
    ReviewAttachmentService,
  ],
  exports: [ReviewConversationRepository, ReviewConversationService],
})
export class ReviewPersistenceModule {}
