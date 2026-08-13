import { DynamicModule, Module, type Provider } from '@nestjs/common';

import { DocumentManagementHostedController } from './document-management-hosted.controller';
import { DocumentManagementHostedService } from './document-management-hosted.service';
import { MiaodaHostedDocumentCatalog } from './miaoda-hosted-document-catalog';
import { DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER } from './document-management-hosted.tokens';

export interface DocumentManagementHostedModuleOptions {
  authorizerProvider: Provider;
}
@Module({})
export class DocumentManagementHostedModule {
  static register(options: DocumentManagementHostedModuleOptions): DynamicModule {
    const provider = options?.authorizerProvider;
    if (!provider || typeof provider !== 'object' || !('provide' in provider)) {
      throw new Error('DocumentManagementHostedModule requires a server-bound authorizerProvider.');
    }
    if (provider.provide !== DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER) {
      throw new Error('authorizerProvider must bind DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER.');
    }
    return {
      module: DocumentManagementHostedModule,
      controllers: [DocumentManagementHostedController],
      providers: [
        provider,
        MiaodaHostedDocumentCatalog,
        DocumentManagementHostedService,
      ],
      exports: [MiaodaHostedDocumentCatalog, DocumentManagementHostedService],
    };
  }
}
