import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DRIZZLE_DATABASE,
  SqlExecutionContextMiddleware,
  CapabilityService,
  FileService,
  DATAPAAS_CONFIG,
} from '@lark-apaas/fullstack-nestjs-core';
import { TdmsSourceModule } from '../../../server/modules/tdms-source/tdms-source.module';
import { TdmsSourceReadAuthorityModule } from '../../../server/modules/tdms-source/tdms-source-read-authority.module';
import { TdmsBrowserSourceAuthorization } from '../../../server/modules/tdms-source/tdms-browser-source-authorization';
import {
  TDMS_SOURCE_AUTHORIZATION,
  TDMS_ARTIFACT_STORE,
} from '../../../server/modules/tdms-source/tdms-source.types';
import { UnconfiguredTdmsArtifactStore } from '../../../server/modules/tdms-source/unconfigured-tdms-artifact-store';

const database = { transaction: jest.fn(), execute: jest.fn() };
@Global()
@Module({
  providers: [
    { provide: DRIZZLE_DATABASE, useValue: database },
    { provide: SqlExecutionContextMiddleware, useValue: { use: jest.fn() } },
    { provide: DATAPAAS_CONFIG, useValue: { roleSchema: 'fixture' } },
    { provide: CapabilityService, useValue: {} },
    {
      provide: FileService,
      useValue: {
        from: jest.fn(() => {
          throw new Error('UNEXPECTED_FILE_IO');
        }),
      },
    },
  ],
  exports: [
    DRIZZLE_DATABASE,
    SqlExecutionContextMiddleware,
    CapabilityService,
    FileService,
    DATAPAAS_CONFIG,
  ],
})
class BrowserSourceDatabaseFixture {}

it('resolves the real read-only Source module through existing OAuth and document policy modules', async () => {
  const module = await Test.createTestingModule({
    imports: [
      BrowserSourceDatabaseFixture,
      TdmsSourceModule.register({
        imports: [TdmsSourceReadAuthorityModule],
        authorizationProvider: {
          provide: TDMS_SOURCE_AUTHORIZATION,
          useExisting: TdmsBrowserSourceAuthorization,
        },
      }),
    ],
  }).compile();
  try {
    const authorization = module.get<TdmsBrowserSourceAuthorization>(
      TDMS_SOURCE_AUTHORIZATION,
    );
    expect(authorization).toBeInstanceOf(TdmsBrowserSourceAuthorization);
    expect(module.get(TDMS_ARTIFACT_STORE)).toBeInstanceOf(
      UnconfiguredTdmsArtifactStore,
    );
    await expect(authorization.authorizeImport()).rejects.toMatchObject({
      code: 'TDMS_BROWSER_SOURCE_IMPORT_UNCONFIGURED',
    });
    expect(database.transaction).not.toHaveBeenCalled();
  } finally {
    await module.close();
  }
});
