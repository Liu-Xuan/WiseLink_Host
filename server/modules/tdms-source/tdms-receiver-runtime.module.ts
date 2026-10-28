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
import { TdmsProcessingSetController } from './tdms-processing-set.controller';
import { TdmsProcessingSetProducerService } from './tdms-processing-set-producer.service';
import { TdmsProcessingSetSourceAuthority } from './tdms-processing-set-source-authority';

@Module({
  imports: [
    IdentityModule,
    TdmsSourceAuthorityModule,
    DocumentManagementRuntimeModule,
    TdmsSourceReadAuthorityModule,
  ],
  providers: [
    MiaodaTdmsDailyArtifactStore,
    TdmsReceiverService,
    TdmsFormalDocumentRegistrationService,
    TdmsReceiverSourceAuthorization,
    TdmsProcessingSetProducerService,
    TdmsProcessingSetSourceAuthority,
  ],
  controllers: [
    TdmsReceiverController,
    TdmsFormalDocumentRegistrationController,
    TdmsProcessingSetController,
  ],
  exports: [
    TdmsSourceAuthorityModule,
    MiaodaTdmsDailyArtifactStore,
    TdmsReceiverService,
    TdmsFormalDocumentRegistrationService,
    TdmsReceiverSourceAuthorization,
  ],
})
export class TdmsReceiverRuntimeModule {}
