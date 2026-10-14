import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { LcmSourceReadingController } from './lcm-source-reading.controller';
import { LcmSourceReadingService } from './lcm-source-reading.service';
import {
  LCM_SOURCE_READ_AUTHORIZATION, LCM_SNAPSHOT_READ_REPOSITORY, lcmReadingError,
  UnconfiguredLcmSourceReadAuthorization, UnconfiguredLcmSnapshotReadRepository,
} from './lcm-source-reading.port';

@Module({
  controllers: [LcmSourceReadingController],
  providers: [
    LcmSourceReadingService,
    { provide: LCM_SOURCE_READ_AUTHORIZATION, useClass: UnconfiguredLcmSourceReadAuthorization },
    { provide: LCM_SNAPSHOT_READ_REPOSITORY, useClass: UnconfiguredLcmSnapshotReadRepository },
  ],
  exports: [LcmSourceReadingService],
})
export class LcmSourceReadingModule {
  /** Binding real audience decisions and a received store requires the integration owner. */
  static register(options: {
    imports?: DynamicModule['imports']; authorizationProvider: Provider; repositoryProvider: Provider;
  }): DynamicModule {
    for (const [provider, token] of [
      [options.authorizationProvider, LCM_SOURCE_READ_AUTHORIZATION],
      [options.repositoryProvider, LCM_SNAPSHOT_READ_REPOSITORY],
    ] as const) {
      if (!provider || typeof provider !== 'object' || !('provide' in provider) || provider.provide !== token)
        throw lcmReadingError('LCM_SERVER_PROVIDER_BINDING_INVALID', 400);
    }
    return { module: LcmSourceReadingModule, imports: options.imports ?? [],
      providers: [options.authorizationProvider, options.repositoryProvider] };
  }
}
