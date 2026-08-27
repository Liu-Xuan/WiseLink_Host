import { Module } from '@nestjs/common';

import { CANONICAL_OBJECT_ACCESS } from './canonical-object-access.port';
import { CanonicalObjectAccessRouter } from './canonical-object-access.router';
import { MiaodaHostedCanonicalObjectAccessAdapter } from './miaoda-hosted-canonical-object-access.adapter';
import { MiaodaWorkItemRepository } from './miaoda-work-item.repository';
import { MiaodaDocumentVersionSourceResolver } from './miaoda-document-version-source.resolver';
import {
  UnavailableAilyObjectAccessAdapter,
  UnavailableServiceObjectAccessAdapter,
  UnavailableSessionObjectAccessAdapter,
} from './unavailable-canonical-object-access.adapters';

@Module({
  providers: [
    MiaodaWorkItemRepository,
    MiaodaDocumentVersionSourceResolver,
    {
      provide: MiaodaHostedCanonicalObjectAccessAdapter,
      inject: [MiaodaWorkItemRepository],
      useFactory: (workItems: MiaodaWorkItemRepository) =>
        new MiaodaHostedCanonicalObjectAccessAdapter(workItems),
    },
    UnavailableAilyObjectAccessAdapter,
    UnavailableServiceObjectAccessAdapter,
    UnavailableSessionObjectAccessAdapter,
    {
      provide: CanonicalObjectAccessRouter,
      inject: [
        MiaodaHostedCanonicalObjectAccessAdapter,
        UnavailableAilyObjectAccessAdapter,
        UnavailableServiceObjectAccessAdapter,
        UnavailableSessionObjectAccessAdapter,
      ],
      useFactory: (
        hostedFinalUser: MiaodaHostedCanonicalObjectAccessAdapter,
        unavailableAily: UnavailableAilyObjectAccessAdapter,
        unavailableService: UnavailableServiceObjectAccessAdapter,
        unavailableSession: UnavailableSessionObjectAccessAdapter,
      ) =>
        new CanonicalObjectAccessRouter(
          hostedFinalUser,
          unavailableAily,
          unavailableService,
          unavailableSession,
        ),
    },
    {
      provide: CANONICAL_OBJECT_ACCESS,
      useExisting: CanonicalObjectAccessRouter,
    },
  ],
  exports: [
    MiaodaWorkItemRepository,
    MiaodaDocumentVersionSourceResolver,
    CANONICAL_OBJECT_ACCESS,
  ],
})
export class WorkItemRuntimeModule {}
