import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DRIZZLE_DATABASE,
  DATAPAAS_CONFIG,
  CapabilityService,
  FileService,
  SqlExecutionContextMiddleware,
} from '@lark-apaas/fullstack-nestjs-core';
import { IdentityModule } from '../../../server/modules/identity/identity.module';
import { SessionResolver } from '../../../server/modules/identity/session-resolver.service';
import { OAUTH_CONFIG } from '../../../server/modules/identity/oauth-config.port';
import { DocumentManagementHostedService } from '../../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';
import { DocumentManagementRuntimeModule } from '../../../server/modules/document-management-runtime/document-management-runtime.module';
import { MiaodaHostedDocumentCatalog } from '../../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog';
import { TdmsSourceModule } from '../../../server/modules/tdms-source/tdms-source.module';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { TdmsReceiverRuntimeModule } from '../../../server/modules/tdms-source/tdms-receiver-runtime.module';
import { TdmsReceiverService } from '../../../server/modules/tdms-source/tdms-receiver.service';
import { TdmsReceiverController } from '../../../server/modules/tdms-source/tdms-receiver.controller';
import { TdmsFormalDocumentRegistrationController } from '../../../server/modules/tdms-source/tdms-formal-document-registration.controller';
import { TdmsFormalDocumentRegistrationService } from '../../../server/modules/tdms-source/tdms-formal-document-registration.service';
import { DocumentManagementHostedController } from '../../../server/modules/document-management/src/hosted/nest/document-management-hosted.controller';
import { OrdinaryDocumentManagementAuthorizer } from '../../../server/modules/document-management-runtime/ordinary-document-management-authorizer';
import { DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER } from '../../../server/modules/document-management/src/hosted/nest/document-management-hosted.tokens';
import { DOCUMENT_SOURCE_READ } from '../../../server/modules/document-management/src/hosted/nest/document-source-read.port';
import { MiaodaTdmsSourceAuthorization } from '../../../server/modules/tdms-source/miaoda-tdms-source-authorization';
import { TdmsDocumentSourceReadAdapter } from '../../../server/modules/tdms-source/tdms-document-source-read.adapter';
import { TdmsSourceAuthorityModule } from '../../../server/modules/tdms-source/tdms-source-authority.module';
import { TdmsReceiverRepository } from '../../../server/modules/tdms-source/tdms-receiver.repository';
import { MiaodaTdmsDailyArtifactStore } from '../../../server/modules/tdms-source/miaoda-tdms-daily-artifact-store';
import {
  TDMS_SOURCE_AUTHORIZATION,
  TDMS_ARTIFACT_STORE,
  TDMS_FORMAL_REGISTRATION,
} from '../../../server/modules/tdms-source/tdms-source.types';
import { TdmsDailyMetadataController } from '../../../server/modules/tdms-source/tdms-daily-metadata.controller';
import type { Request } from 'express';

// External SDK services are inert doubles; provider selection and Nest imports are real.
@Global()
@Module({
  providers: [
    { provide: DRIZZLE_DATABASE, useValue: {} },
    { provide: DATAPAAS_CONFIG, useValue: { roleSchema: 'synthetic-role-schema' } },
    { provide: SqlExecutionContextMiddleware, useValue: {} },
    { provide: CapabilityService, useValue: {} },
    {
      provide: FileService,
      useValue: {
        from() {
          throw new Error('unexpected FileService I/O');
        },
      },
    },
  ],
  exports: [DRIZZLE_DATABASE, DATAPAAS_CONFIG, SqlExecutionContextMiddleware, CapabilityService, FileService],
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
  providers: [
    { provide: MiaodaHostedDocumentCatalog, useValue: {} },
    { provide: DocumentManagementHostedService, useValue: {} },
  ],
  exports: [MiaodaHostedDocumentCatalog, DocumentManagementHostedService],
})
class FixtureDocumentModule {}

describe('actual opted-in receiver module consumes persistent authority and daily artifact providers', () => {
  it('initializes the lower Source authority alone without DM or Receiver runtime providers', async () => {
    const module = await Test.createTestingModule({
      imports: [FixturePlatformModule, TdmsSourceAuthorityModule],
    })
      .overrideModule(IdentityModule).useModule(FixtureIdentityModule)
      .compile();
    try {
      await module.init();
      expect(module.get(DOCUMENT_SOURCE_READ)).toBeInstanceOf(TdmsDocumentSourceReadAdapter);
      expect(module.get(MiaodaTdmsSourceAuthorization)).toBeInstanceOf(MiaodaTdmsSourceAuthorization);
      expect(() => module.get(DocumentManagementHostedService)).toThrow();
      expect(() => module.get(TdmsReceiverService)).toThrow();
    } finally { await module.close(); }
  });

  it('compiles and initializes the real receiver -> DM runtime -> hosted module graph and resolves the registration/ordinary services', async () => {
    const module = await Test.createTestingModule({
      imports: [FixturePlatformModule, TdmsSourceModule.register({
        imports: [TdmsReceiverRuntimeModule],
        authorizationProvider: { provide: TDMS_SOURCE_AUTHORIZATION, useExisting: MiaodaTdmsSourceAuthorization },
        artifactStoreProvider: { provide: TDMS_ARTIFACT_STORE, useExisting: MiaodaTdmsDailyArtifactStore },
        formalRegistrationProvider: { provide: TDMS_FORMAL_REGISTRATION, useExisting: TdmsFormalDocumentRegistrationService },
      })],
    })
      // Only the external session/config boundary is replaced. Both real DM
      // modules and their hosted service/catalog/ordinary authorizer remain.
      .overrideModule(IdentityModule).useModule(FixtureIdentityModule)
      .compile();
    try {
      await module.init();
      const documents = module.get(DocumentManagementHostedService);
      const registration = module.get(TdmsFormalDocumentRegistrationService);
      expect(documents).toBeInstanceOf(DocumentManagementHostedService);
      expect(module.get(MiaodaHostedDocumentCatalog)).toBeInstanceOf(MiaodaHostedDocumentCatalog);
      expect(module.get(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER)).toBeInstanceOf(OrdinaryDocumentManagementAuthorizer);
      expect(module.get(TDMS_FORMAL_REGISTRATION)).toBe(registration);
      const sourceRead = module.get(TdmsDocumentSourceReadAdapter);
      const authority = module.get(MiaodaTdmsSourceAuthorization);
      const repository = module.get(TdmsReceiverRepository);
      expect(module.get(DOCUMENT_SOURCE_READ)).toBe(sourceRead);
      expect(Reflect.get(module.get(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER), 'sourceRead')).toBe(sourceRead);
      expect(Reflect.get(sourceRead, 'authorization')).toBe(authority);
      expect(Reflect.get(sourceRead, 'receivers')).toBe(repository);
      expect(Reflect.get(module.get(TdmsReceiverService), 'authorization')).toBe(authority);
      expect(Reflect.get(module.get(TdmsReceiverService), 'receivers')).toBe(repository);
      expect(Reflect.get(registration, 'documents')).toBe(documents);
      expect(Reflect.get(module.get(TdmsFormalDocumentRegistrationController), 'registration')).toBe(registration);
      expect(module.get(DocumentManagementHostedController)).toBeInstanceOf(DocumentManagementHostedController);
      expect(module.get(TdmsDailyMetadataController)).toBeInstanceOf(TdmsDailyMetadataController);
      expect(module.get(TdmsReceiverController)).toBeInstanceOf(TdmsReceiverController);
    } finally { await module.close(); }
  });
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
