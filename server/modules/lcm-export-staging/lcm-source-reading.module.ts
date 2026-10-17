import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { LcmSourceReadingController } from './lcm-source-reading.controller';
import { LcmSourceReadingService } from './lcm-source-reading.service';
import { LcmNativeMatrixReadingService } from './lcm-native-matrix-reading.service';
import {
  DRIZZLE_DATABASE,
  FileService,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { lcmHostDatabase } from './lcm-host-database';
import { LcmPersonalSourceRepository } from './lcm-personal-source.repository';
import { LcmHostSourceReadAuthorization } from './lcm-host-source-read.authorization';
import { LcmSnapshotBrowserRepository } from './lcm-snapshot-browser.repository';
import { LcmFileOriginalStore } from './lcm-file-original.store';
import { LcmPersonalImportService } from './lcm-personal-import.service';
import { LcmPersonalImportController } from './lcm-personal-import.controller';
import {
  LCM_SOURCE_READ_AUTHORIZATION,
  LCM_SNAPSHOT_READ_REPOSITORY,
  lcmReadingError,
  UnconfiguredLcmSourceReadAuthorization,
  UnconfiguredLcmSnapshotReadRepository,
} from './lcm-source-reading.port';

@Module({
  controllers: [LcmSourceReadingController],
  providers: [
    LcmSourceReadingService,
    LcmNativeMatrixReadingService,
    {
      provide: LCM_SOURCE_READ_AUTHORIZATION,
      useClass: UnconfiguredLcmSourceReadAuthorization,
    },
    {
      provide: LCM_SNAPSHOT_READ_REPOSITORY,
      useClass: UnconfiguredLcmSnapshotReadRepository,
    },
  ],
  exports: [LcmSourceReadingService],
})
export class LcmSourceReadingModule {
  /** Reuses PlatformModule's context-aware client; never creates a connection or executes DDL. */
  static forHost(): DynamicModule {
    const sourceProvider: Provider = {
      provide: LcmPersonalSourceRepository,
      inject: [DRIZZLE_DATABASE],
      useFactory: (database: PostgresJsDatabase): LcmPersonalSourceRepository =>
        new LcmPersonalSourceRepository(lcmHostDatabase(database)),
    };
    return {
      module: LcmSourceReadingModule,
      controllers: [LcmPersonalImportController],
      providers: [
        sourceProvider,
        {
          provide: LCM_SOURCE_READ_AUTHORIZATION,
          inject: [LcmPersonalSourceRepository],
          useFactory: (sources: LcmPersonalSourceRepository) =>
            new LcmHostSourceReadAuthorization(sources),
        },
        {
          provide: LCM_SNAPSHOT_READ_REPOSITORY,
          inject: [LcmPersonalSourceRepository],
          useFactory: (sources: LcmPersonalSourceRepository) =>
            new LcmSnapshotBrowserRepository(sources.sql),
        },
        {
          provide: LcmFileOriginalStore,
          inject: [FileService],
          useFactory: (files: FileService) => new LcmFileOriginalStore(files),
        },
        {
          provide: LcmPersonalImportService,
          inject: [LcmPersonalSourceRepository, LcmFileOriginalStore],
          useFactory: (
            sources: LcmPersonalSourceRepository,
            files: LcmFileOriginalStore,
          ) => new LcmPersonalImportService(sources, files),
        },
      ],
    };
  }
  /** Binding real audience decisions and a received store requires the integration owner. */
  static register(options: {
    imports?: DynamicModule['imports'];
    authorizationProvider: Provider;
    repositoryProvider: Provider;
  }): DynamicModule {
    for (const [provider, token] of [
      [options.authorizationProvider, LCM_SOURCE_READ_AUTHORIZATION],
      [options.repositoryProvider, LCM_SNAPSHOT_READ_REPOSITORY],
    ] as const) {
      if (
        !provider ||
        typeof provider !== 'object' ||
        !('provide' in provider) ||
        provider.provide !== token
      )
        throw lcmReadingError('LCM_SERVER_PROVIDER_BINDING_INVALID', 400);
    }
    return {
      module: LcmSourceReadingModule,
      imports: options.imports ?? [],
      providers: [options.authorizationProvider, options.repositoryProvider],
    };
  }
}
