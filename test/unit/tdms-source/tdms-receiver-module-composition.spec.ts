import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DRIZZLE_DATABASE,
  FileService,
} from '@lark-apaas/fullstack-nestjs-core';
import { IdentityModule } from '../../../server/modules/identity/identity.module';
import { SessionResolver } from '../../../server/modules/identity/session-resolver.service';
import { OAUTH_CONFIG } from '../../../server/modules/identity/oauth-config.port';
import { DocumentManagementRuntimeModule } from '../../../server/modules/document-management-runtime/document-management-runtime.module';
import { MiaodaHostedDocumentCatalog } from '../../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { TdmsSourceModule } from '../../../server/modules/tdms-source/tdms-source.module';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { TdmsReceiverRuntimeModule } from '../../../server/modules/tdms-source/tdms-receiver-runtime.module';
import { TdmsReceiverService } from '../../../server/modules/tdms-source/tdms-receiver.service';
import { TdmsReceiverController } from '../../../server/modules/tdms-source/tdms-receiver.controller';
import { MiaodaTdmsSourceAuthorization } from '../../../server/modules/tdms-source/miaoda-tdms-source-authorization';
import { MiaodaTdmsDailyArtifactStore } from '../../../server/modules/tdms-source/miaoda-tdms-daily-artifact-store';
import {
  TDMS_SOURCE_AUTHORIZATION,
  TDMS_ARTIFACT_STORE,
} from '../../../server/modules/tdms-source/tdms-source.types';
import { TdmsDailyMetadataController } from '../../../server/modules/tdms-source/tdms-daily-metadata.controller';
import type { Request } from 'express';

// External SDK services are inert doubles; provider selection and Nest imports are real.
@Global()
@Module({
  providers: [
    { provide: DRIZZLE_DATABASE, useValue: {} },
    {
      provide: FileService,
      useValue: {
        from() {
          throw new Error('unexpected FileService I/O');
        },
      },
    },
  ],
  exports: [DRIZZLE_DATABASE, FileService],
})
class FixturePlatformModule {}
@Module({
  providers: [
    { provide: SessionResolver, useValue: {} },
    // Explicit synthetic port for the real receiver profile provider; no default
    // production profile is introduced by this module-composition fixture.
    {
      provide: OAUTH_CONFIG,
      useValue: {
        clientId: 'synthetic-client',
        configured: false,
        applicationScopeId: 'app_17bzc551rsg',
      },
    },
  ],
  exports: [SessionResolver, OAUTH_CONFIG],
})
class FixtureIdentityModule {}
@Module({
  providers: [{ provide: MiaodaHostedDocumentCatalog, useValue: {} }],
  exports: [MiaodaHostedDocumentCatalog],
})
class FixtureDocumentModule {}

describe('actual opted-in receiver module consumes persistent authority and daily artifact providers', () => {
  it('resolves useExisting bindings and the original daily controller optional dependency', async () => {
    const module = await Test.createTestingModule({
      imports: [
        FixturePlatformModule,
        TdmsSourceModule.register({
          imports: [TdmsReceiverRuntimeModule],
          authorizationProvider: {
            provide: TDMS_SOURCE_AUTHORIZATION,
            useExisting: MiaodaTdmsSourceAuthorization,
          },
          artifactStoreProvider: {
            provide: TDMS_ARTIFACT_STORE,
            useExisting: MiaodaTdmsDailyArtifactStore,
          },
        }),
      ],
    })
      .overrideModule(IdentityModule)
      .useModule(FixtureIdentityModule)
      .overrideModule(DocumentManagementRuntimeModule)
      .useModule(FixtureDocumentModule)
      .compile();
    try {
      expect(module.get(TDMS_SOURCE_AUTHORIZATION)).toBe(
        module.get(MiaodaTdmsSourceAuthorization),
      );
      expect(module.get(TDMS_ARTIFACT_STORE)).toBe(
        module.get(MiaodaTdmsDailyArtifactStore),
      );
      expect(module.get(TdmsSourceService)).toBeInstanceOf(TdmsSourceService);
      expect(module.get(TdmsReceiverController)).toBeInstanceOf(
        TdmsReceiverController,
      );
      const runtime = module.get(TdmsReceiverService),
        controller = module.get(TdmsDailyMetadataController);
      const check = jest
        .spyOn(runtime, 'withExpected')
        .mockRejectedValue(new Error('synthetic-pin-rejected'));
      const body = {
        schemaVersion: 'wiselink.tdms-native-host-receiver-binding.v1',
        receiverId: 'r',
        tenantRef: 't',
        applicationRef: 'a',
        principalRef: 'p',
        sourceSystem: 'TDMS',
        sourceInstanceRef: 's',
        authorityRevision: 'v',
        authorityEvidenceRef: 'e',
        sessionEvidenceRef: 'session',
        observedAt: '2026-10-18T00:00:00Z',
      };
      const req = {
        headers: {
          'x-wiselink-tdms-expected-receiver': Buffer.from(
            JSON.stringify(body),
          ).toString('base64url'),
        },
      } as unknown as Request;
      await expect(controller.submit(req, {}, {})).rejects.toThrow(
        'synthetic-pin-rejected',
      );
      expect(check).toHaveBeenCalledWith(req, expect.any(Function));
      const noRuntime = new TdmsDailyMetadataController(
        {} as TdmsSourceService,
      );
      expect(() => noRuntime.submit(req, {}, {})).toThrow(
        'TDMS_RECEIVER_EXPECTATION_UNCONFIGURED',
      );
    } finally {
      await module.close();
    }
  });
});
