import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Body: noOpDecorator,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    Param: noOpDecorator,
    Post: noOpDecorator,
    Req: noOpDecorator,
    UseGuards: noOpDecorator,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return { ...actual, NeedLogin: () => () => undefined };
});

jest.mock(
  '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js',
  () => ({ DocumentManagementHostedCore: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog',
  () => ({ MiaodaHostedDocumentCatalog: class MiaodaHostedDocumentCatalog {} }),
);

import { Global, Module } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  FileService,
} from '@lark-apaas/fullstack-nestjs-core';
import { Test } from '@nestjs/testing';

import { DocumentManagementRuntimeModule } from '../../server/modules/document-management-runtime/document-management-runtime.module';
import { DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.tokens';
import { DocumentManagementHostedService } from '../../server/modules/document-management/src/hosted/nest/document-management-hosted.service';
import { OrdinaryDocumentManagementAuthorizer } from '../../server/modules/document-management-runtime/ordinary-document-management-authorizer';

const fakeFileService = {
  from: jest.fn(),
  getDefaultBucket: jest.fn(),
};

@Global()
@Module({
  providers: [
    { provide: DRIZZLE_DATABASE, useValue: {} },
    { provide: FileService, useValue: fakeFileService },
  ],
  exports: [DRIZZLE_DATABASE, FileService],
})
class HostedPlatformTestModule {}

describe('DocumentManagementRuntimeModule composition', () => {
  it('resolves the real hosted service and WorkItem-backed authorizer', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HostedPlatformTestModule, DocumentManagementRuntimeModule],
    }).compile();

    expect(moduleRef.get(DocumentManagementHostedService)).toBeInstanceOf(
      DocumentManagementHostedService,
    );
    expect(moduleRef.get(DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER)).toBeInstanceOf(
      OrdinaryDocumentManagementAuthorizer,
    );

    await moduleRef.close();
  });
});
