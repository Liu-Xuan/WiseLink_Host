import { TdmsFormalDocumentRegistrationService } from './tdms-formal-document-registration.service';
import { TdmsFormalDocumentRegistrationController } from './tdms-formal-document-registration.controller';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DocumentManagementRuntimeModule } from '../document-management-runtime/document-management-runtime.module';
import { MiaodaTdmsDailyArtifactStore } from './miaoda-tdms-daily-artifact-store';
import { TdmsReceiverService } from './tdms-receiver.service';
import { TdmsReceiverController } from './tdms-receiver.controller';
import { TdmsSourceAuthorityModule } from './tdms-source-authority.module';

@Module({
  imports: [IdentityModule, TdmsSourceAuthorityModule, DocumentManagementRuntimeModule],
  providers: [
    MiaodaTdmsDailyArtifactStore,
    TdmsReceiverService,
    TdmsFormalDocumentRegistrationService,
  ],
  controllers: [TdmsReceiverController, TdmsFormalDocumentRegistrationController],
  exports: [
    TdmsSourceAuthorityModule,
    MiaodaTdmsDailyArtifactStore,
    TdmsReceiverService,
    TdmsFormalDocumentRegistrationService,
  ],
})
export class TdmsReceiverRuntimeModule {}
