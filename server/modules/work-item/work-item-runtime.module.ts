import { Module } from '@nestjs/common';

import { CANONICAL_OBJECT_ACCESS } from './canonical-object-access.port';
import { CanonicalObjectAccessRouter } from './canonical-object-access.router';
import { MiaodaWorkItemRepository } from './miaoda-work-item.repository';
import {
  UnavailableAilyObjectAccessAdapter,
  UnavailableMiaodaBrowserObjectAccessAdapter,
  UnavailableServiceObjectAccessAdapter,
  UnavailableSessionObjectAccessAdapter,
} from './unavailable-canonical-object-access.adapters';

@Module({
  providers: [
    MiaodaWorkItemRepository,
    UnavailableMiaodaBrowserObjectAccessAdapter,
    UnavailableAilyObjectAccessAdapter,
    UnavailableServiceObjectAccessAdapter,
    UnavailableSessionObjectAccessAdapter,
    {
      provide: CanonicalObjectAccessRouter,
      inject: [
        UnavailableMiaodaBrowserObjectAccessAdapter,
        UnavailableAilyObjectAccessAdapter,
        UnavailableServiceObjectAccessAdapter,
        UnavailableSessionObjectAccessAdapter,
      ],
      useFactory: (
        unavailableMiaoda: UnavailableMiaodaBrowserObjectAccessAdapter,
        unavailableAily: UnavailableAilyObjectAccessAdapter,
        unavailableService: UnavailableServiceObjectAccessAdapter,
        unavailableSession: UnavailableSessionObjectAccessAdapter,
      ) =>
        new CanonicalObjectAccessRouter(
          unavailableMiaoda,
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
  exports: [MiaodaWorkItemRepository, CANONICAL_OBJECT_ACCESS],
})
export class WorkItemRuntimeModule {}
