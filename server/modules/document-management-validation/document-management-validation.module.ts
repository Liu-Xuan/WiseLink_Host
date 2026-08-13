import { Module } from '@nestjs/common';

import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  DocumentManagementHostedModule,
} from '../document-management/src/hosted/nest';
import { Phase2dValidationAuthorizer } from './phase2d-validation-authorizer';
import { Phase2dValidationController } from './phase2d-validation.controller';
import { Phase2dValidationService } from './phase2d-validation.service';

@Module({
  imports: [
    DocumentManagementHostedModule.register({
      authorizerProvider: {
        provide: DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
        useClass: Phase2dValidationAuthorizer,
      },
    }),
  ],
  controllers: [Phase2dValidationController],
  providers: [Phase2dValidationService],
})
export class DocumentManagementValidationModule {}
