import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { TdmsSourceController } from './tdms-source.controller';
import { TdmsDailyMetadataController } from './tdms-daily-metadata.controller';
import { TdmsSourceService } from './tdms-source.service';
import { MiaodaTdmsSourceRepository } from './tdms-source.repository';
import {
  UnconfiguredTdmsDocumentAccess,
  UnconfiguredTdmsSourceAuthorization,
} from './tdms-source.authorization';
import {
  TDMS_ARTIFACT_STORE,
  TDMS_DOCUMENT_ACCESS,
  TDMS_REPOSITORY,
  TDMS_SOURCE_AUTHORIZATION,
  tdmsError,
} from './tdms-source.types';
import { UnconfiguredTdmsArtifactStore } from './unconfigured-tdms-artifact-store';
export { UnconfiguredTdmsArtifactStore } from './unconfigured-tdms-artifact-store';
@Module({
  controllers: [TdmsSourceController, TdmsDailyMetadataController],
  providers: [
    TdmsSourceService,
    MiaodaTdmsSourceRepository,
    UnconfiguredTdmsSourceAuthorization,
    UnconfiguredTdmsDocumentAccess,
    UnconfiguredTdmsArtifactStore,
    { provide: TDMS_REPOSITORY, useExisting: MiaodaTdmsSourceRepository },
    {
      provide: TDMS_SOURCE_AUTHORIZATION,
      useExisting: UnconfiguredTdmsSourceAuthorization,
    },
    {
      provide: TDMS_DOCUMENT_ACCESS,
      useExisting: UnconfiguredTdmsDocumentAccess,
    },
    {
      provide: TDMS_ARTIFACT_STORE,
      useExisting: UnconfiguredTdmsArtifactStore,
    },
  ],
  exports: [TdmsSourceService],
})
export class TdmsSourceModule {
  static register(options: {
    imports?: DynamicModule['imports'];
    authorizationProvider: Provider;
    documentAccessProvider?: Provider;
    artifactStoreProvider?: Provider;
  }): DynamicModule {
    const bindings: Array<[Provider | undefined, symbol]> = [
      [options?.authorizationProvider, TDMS_SOURCE_AUTHORIZATION],
      [options?.documentAccessProvider, TDMS_DOCUMENT_ACCESS],
      [options?.artifactStoreProvider, TDMS_ARTIFACT_STORE],
    ];
    for (const [provider, token] of bindings) {
      if (provider === undefined && token !== TDMS_SOURCE_AUTHORIZATION)
        continue;
      if (
        !provider ||
        typeof provider !== 'object' ||
        !('provide' in provider) ||
        provider.provide !== token
      )
        throw tdmsError('TDMS_SERVER_PROVIDER_BINDING_INVALID');
    }
    return {
      module: TdmsSourceModule,
      imports: options.imports ?? [],
      providers: [
        options.authorizationProvider,
        ...(options.documentAccessProvider
          ? [options.documentAccessProvider]
          : []),
        ...(options.artifactStoreProvider
          ? [options.artifactStoreProvider]
          : []),
      ],
    };
  }
}
