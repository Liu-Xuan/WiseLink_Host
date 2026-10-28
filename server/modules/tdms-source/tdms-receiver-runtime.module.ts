import { TdmsFormalDocumentRegistrationService } from './tdms-formal-document-registration.service';
import { TdmsFormalDocumentRegistrationController } from './tdms-formal-document-registration.controller';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DocumentManagementRuntimeModule } from '../document-management-runtime/document-management-runtime.module';
import { MiaodaTdmsDailyArtifactStore } from './miaoda-tdms-daily-artifact-store';
import { TdmsReceiverService } from './tdms-receiver.service';
import { TdmsReceiverController } from './tdms-receiver.controller';
import { TdmsSourceAuthorityModule } from './tdms-source-authority.module';
import { TdmsSourceReadAuthorityModule } from './tdms-source-read-authority.module';
import { TdmsReceiverSourceAuthorization } from './tdms-receiver-source-authorization';

@Module({
  imports: [IdentityModule, TdmsSourceAuthorityModule, DocumentManagementRuntimeModule, TdmsSourceReadAuthorityModule],
  providers: [
    MiaodaTdmsDailyArtifactStore,
    TdmsReceiverService,
    TdmsFormalDocumentRegistrationService,
    TdmsReceiverSourceAuthorization,
  ],
  controllers: [TdmsReceiverController, TdmsFormalDocumentRegistrationController],
  exports: [
    TdmsSourceAuthorityModule,
    MiaodaTdmsDailyArtifactStore,
    TdmsReceiverService,
    TdmsFormalDocumentRegistrationService,
    TdmsReceiverSourceAuthorization,
  ],
})
export class TdmsReceiverRuntimeModule {}
