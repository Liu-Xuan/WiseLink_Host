import { Module } from '@nestjs/common';

import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  DocumentManagementHostedModule,
} from '../document-management/src/hosted/nest';
import { OrdinaryDocumentManagementAuthorizer } from './ordinary-document-management-authorizer';

@Module({
  imports: [
    DocumentManagementHostedModule.register({
      authorizerProvider: {
        provide: DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
        useClass: OrdinaryDocumentManagementAuthorizer,
      },
    }),
  ],
  exports: [DocumentManagementHostedModule],
})
export class DocumentManagementRuntimeModule {}
