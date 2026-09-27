import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Module } from '@nestjs/common';
import { ActionAttemptModule } from '../action-attempt/action-attempt.module';
import { ActionAttemptRepository } from '../action-attempt/action-attempt.repository';
import { CanonicalModelSettingsModule } from '../model-settings/canonical-model-settings.module';
import { CanonicalModelSettingsService } from '../model-settings/canonical-model-settings.service';
import { ReviewConversationRepository } from '../review-persistence/review-conversation.repository';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { MiaodaAutomaticWorkItemLeaseAuthorizationAdapter } from './miaoda-automatic-work-item-lease-authorization.adapter';
import { AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION } from './automatic-work-item-source-authorization.port';

@Module({
  providers: [{ provide: CanonicalModelSettingsService, useValue: {} }],
  exports: [CanonicalModelSettingsService],
})
class TestModelSettingsModule {}

describe('successor authorization composition', () => {
  it('receives the real exported ActionAttempt repository through the imported module', async () => {
    const attempts = {
      readByOperationRef: jest.fn().mockResolvedValue({
        tenantId: 'tenant-A',
        workItemId: 'WI-A',
        actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
      }),
    };
    const module = await Test.createTestingModule({
      imports: [ActionAttemptModule],
      providers: [
        MiaodaAutomaticWorkItemLeaseAuthorizationAdapter,
        { provide: MiaodaWorkItemRepository, useValue: {} },
        { provide: MiaodaDocumentVersionSourceResolver, useValue: {} },
        { provide: ReviewConversationRepository, useValue: {} },
        { provide: AUTOMATIC_WORK_ITEM_SOURCE_AUTHORIZATION, useValue: {} },
      ],
    })
      .overrideModule(CanonicalModelSettingsModule)
      .useModule(TestModelSettingsModule)
      .overrideProvider(ActionAttemptRepository)
      .useValue(attempts)
      .compile();
    try {
      await expect(
        module
          .get(MiaodaAutomaticWorkItemLeaseAuthorizationAdapter)
          .authorizeReviewAttempt({
            tenantId: 'tenant-A',
            workItemId: 'WI-A',
            attemptRef: 'OP-A',
            principalId: 'service:worker',
          }),
      ).resolves.toBeNull();
      expect(attempts.readByOperationRef).toHaveBeenCalledWith('OP-A');
    } finally {
      await module.close();
    }
  });
});
