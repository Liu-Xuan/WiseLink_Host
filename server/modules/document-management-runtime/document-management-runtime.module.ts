import { Module } from '@nestjs/common';

import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  DocumentManagementHostedModule,
} from '../document-management/src/hosted/nest';
import { OrdinaryDocumentManagementAuthorizer } from './ordinary-document-management-authorizer';
import { WorkItemRuntimeModule } from '../work-item/work-item-runtime.module';
import { EngineeringMatterModule } from '../canonical-host/engineering-matter.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [
    DocumentManagementHostedModule.register({
      imports: [WorkItemRuntimeModule, EngineeringMatterModule, IdentityModule],
      authorizerProvider: {
        provide: DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
        useClass: OrdinaryDocumentManagementAuthorizer,
      },
    }),
  ],
  exports: [DocumentManagementHostedModule],
})
export class DocumentManagementRuntimeModule {}
