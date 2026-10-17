import { Test } from '@nestjs/testing';
import { Global, Module } from '@nestjs/common';
import { DRIZZLE_DATABASE } from '@lark-apaas/fullstack-nestjs-core';
import { TdmsSourceModule } from '../../../server/modules/tdms-source/tdms-source.module';
import { TdmsSourceService } from '../../../server/modules/tdms-source/tdms-source.service';
import { MiaodaTdmsSourceRepository } from '../../../server/modules/tdms-source/tdms-source.repository';
import { TDMS_SOURCE_AUTHORIZATION, TDMS_DOCUMENT_ACCESS, TDMS_ARTIFACT_STORE } from '../../../server/modules/tdms-source/tdms-source.types';
import { UnconfiguredTdmsArtifactStore } from '../../../server/modules/tdms-source/unconfigured-tdms-artifact-store';
import { UnconfiguredTdmsDocumentAccess, UnconfiguredTdmsSourceAuthorization } from '../../../server/modules/tdms-source/tdms-source.authorization';
import { MiaodaTdmsArtifactStore } from '../../../server/modules/tdms-source/miaoda-tdms-artifact-store';
import { MiaodaTdmsDocumentAccess } from '../../../server/modules/tdms-source/miaoda-tdms-document-access';
import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  type DocumentManagementIngestAuthorizer,
} from '../../../server/modules/document-management/src/hosted/nest/document-management-hosted.tokens';
import { actor, fixture } from './tdms-fixtures';

const inactiveDatabase = { transaction: jest.fn(), execute: jest.fn() };
@Global()
@Module({ providers: [{ provide: DRIZZLE_DATABASE, useValue: inactiveDatabase }], exports: [DRIZZLE_DATABASE] })
class SyntheticDatabaseModule {}

describe('actual Nest native module composition', () => {
  it('constructs the real repository with a synthetic db and resolves only closed native ports', async () => {
    const module = await Test.createTestingModule({ imports: [SyntheticDatabaseModule, TdmsSourceModule] }).compile();
    try {
      expect(module.get(MiaodaTdmsSourceRepository)).toBeInstanceOf(MiaodaTdmsSourceRepository);
      expect(module.get(TDMS_SOURCE_AUTHORIZATION)).toBeInstanceOf(UnconfiguredTdmsSourceAuthorization);
      expect(module.get(TDMS_DOCUMENT_ACCESS)).toBeInstanceOf(UnconfiguredTdmsDocumentAccess);
      const artifact = module.get<UnconfiguredTdmsArtifactStore>(TDMS_ARTIFACT_STORE);
      expect(artifact).toBeInstanceOf(UnconfiguredTdmsArtifactStore);
      expect(() => module.get(MiaodaTdmsArtifactStore)).toThrow();
      expect(await module.get(TdmsSourceService).catalogue(actor())).toMatchObject({ sourceStatus: 'DISABLED', records: [], readPerformed: false });
      await expect(module.get(TdmsSourceService).readRecord(actor(), 'unconfigured-record')).rejects.toMatchObject({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' });
      await expect(artifact.acquire()).rejects.toMatchObject({ code: 'TDMS_CONTROLLED_ARTIFACT_STORE_UNCONFIGURED' });
      expect(inactiveDatabase.transaction).not.toHaveBeenCalled(); expect(inactiveDatabase.execute).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });
  it('resolves default closed service without any native query or real DB', async () => {
    const repository = { transaction: jest.fn() };
    const module = await Test.createTestingModule({
      imports: [TdmsSourceModule],
    })
      .overrideProvider(MiaodaTdmsSourceRepository)
      .useValue(repository)
      .compile();
    const service = module.get(TdmsSourceService);
    expect(await service.catalogue(actor())).toMatchObject({
      sourceStatus: 'DISABLED',
      records: [],
      readPerformed: false,
    });
    await expect(service.readRecord(actor(), 'ref')).rejects.toMatchObject({
      code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED',
    });
    expect(repository.transaction).not.toHaveBeenCalled();
    await module.close();
  });
  it('requires an exact server authorization provider token', () => {
    expect(() =>
      TdmsSourceModule.register({
        authorizationProvider: { provide: 'caller-ACL', useValue: {} },
      }),
    ).toThrow('TDMS_SERVER_PROVIDER_BINDING_INVALID');
    expect(
      TdmsSourceModule.register({
        authorizationProvider: {
          provide: TDMS_SOURCE_AUTHORIZATION,
          useValue: { available: false },
        },
      }).module,
    ).toBe(TdmsSourceModule);
  });
});

describe('opt-in TDMS document access with the existing DM policy token', () => {
  const previousSandboxId: string | undefined = process.env.SANDBOX_ID;
  afterAll(() => {
    if (previousSandboxId === undefined) delete process.env.SANDBOX_ID;
    else process.env.SANDBOX_ID = previousSandboxId;
  });

  async function setup() {
    const authorization: jest.Mocked<DocumentManagementIngestAuthorizer> = {
      assertCanRead: jest.fn().mockResolvedValue(undefined),
      assertCanIngest: jest.fn(),
    };
    @Module({
      providers: [{
        provide: DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
        useValue: authorization,
      }],
      exports: [DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER],
    })
    class SyntheticDocumentAuthorizationModule {}

    const module = await Test.createTestingModule({
      imports: [
        SyntheticDatabaseModule,
        TdmsSourceModule.register({
          imports: [SyntheticDocumentAuthorizationModule],
          authorizationProvider: {
            provide: TDMS_SOURCE_AUTHORIZATION,
            useExisting: UnconfiguredTdmsSourceAuthorization,
          },
          documentAccessProvider: {
            provide: TDMS_DOCUMENT_ACCESS,
            useClass: MiaodaTdmsDocumentAccess,
          },
        }),
      ],
    }).compile();
    return { module, authorization, service: module.get(TdmsSourceService) };
  }

  it('consumes the adapter in the real service while Source and artifact stay closed', async () => {
    const { module, authorization, service } = await setup();
    try {
      expect(module.get(TDMS_DOCUMENT_ACCESS)).toBeInstanceOf(MiaodaTdmsDocumentAccess);
      expect(module.get(TDMS_SOURCE_AUTHORIZATION)).toBeInstanceOf(UnconfiguredTdmsSourceAuthorization);
      const artifact = module.get<UnconfiguredTdmsArtifactStore>(TDMS_ARTIFACT_STORE);
      expect(artifact).toBeInstanceOf(UnconfiguredTdmsArtifactStore);

      expect(await service.catalogue(actor(), {
        documentVersionId: 'DV-owned@revision-2',
      })).toMatchObject({ sourceStatus: 'DISABLED', records: [], readPerformed: false });
      expect(authorization.assertCanRead).toHaveBeenCalledTimes(1);
      expect(authorization.assertCanRead).toHaveBeenCalledWith({
        actorUserId: '123', tenantId: 'tenant-a', roles: [],
        action: 'DOCUMENT_READ', documentVersionId: 'DV-owned@revision-2',
      });
      await expect(service.readDocumentVersion(actor(), {
        documentVersionId: 'DV-owned@revision-2',
      })).rejects.toMatchObject({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' });
      await expect(service.importPackage(actor(), {
        sourceKey: 'TDMS', sourceInstanceId: 'synthetic-instance', scopeId: 'synthetic-scope',
      }, fixture())).rejects.toMatchObject({ code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED' });
      await expect(artifact.acquire()).rejects.toMatchObject({ code: 'TDMS_CONTROLLED_ARTIFACT_STORE_UNCONFIGURED' });
      expect(authorization.assertCanRead).toHaveBeenCalledTimes(1);
      expect(authorization.assertCanIngest).not.toHaveBeenCalled();
      expect(inactiveDatabase.transaction).not.toHaveBeenCalled();
      expect(inactiveDatabase.execute).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });

  it('propagates document policy failure before any repository access', async () => {
    const { module, authorization, service } = await setup();
    try {
      const denied: Error = Object.assign(new Error('DOCUMENT_ACTION_FORBIDDEN'), {
        code: 'DOCUMENT_ACTION_FORBIDDEN', statusCode: 403,
      });
      authorization.assertCanRead.mockRejectedValueOnce(denied);
      await expect(service.catalogue(actor(), {
        documentVersionId: 'DV-owned@revision-2',
      })).rejects.toBe(denied);
      expect(inactiveDatabase.transaction).not.toHaveBeenCalled();
      expect(inactiveDatabase.execute).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });

  it('requires an explicit DM policy provider when the adapter is selected', async () => {
    await expect(Test.createTestingModule({
      imports: [
        SyntheticDatabaseModule,
        TdmsSourceModule.register({
          authorizationProvider: {
            provide: TDMS_SOURCE_AUTHORIZATION,
            useExisting: UnconfiguredTdmsSourceAuthorization,
          },
          documentAccessProvider: {
            provide: TDMS_DOCUMENT_ACCESS,
            useClass: MiaodaTdmsDocumentAccess,
          },
        }),
      ],
    }).compile()).rejects.toThrow('DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER');
    expect(inactiveDatabase.transaction).not.toHaveBeenCalled();
    expect(inactiveDatabase.execute).not.toHaveBeenCalled();
  });
});
