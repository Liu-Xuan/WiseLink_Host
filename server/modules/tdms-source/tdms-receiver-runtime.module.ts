import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DocumentManagementRuntimeModule } from '../document-management-runtime/document-management-runtime.module';
import { MiaodaTdmsSourceAuthorization } from './miaoda-tdms-source-authorization';
import { MiaodaTdmsDailyArtifactStore } from './miaoda-tdms-daily-artifact-store';
import { TdmsReceiverRepository } from './tdms-receiver.repository';
import { TdmsReceiverService } from './tdms-receiver.service';
import { TdmsReceiverController } from './tdms-receiver.controller';

@Module({
  imports: [IdentityModule, DocumentManagementRuntimeModule],
  providers: [
    TdmsReceiverRepository,
    MiaodaTdmsSourceAuthorization,
    MiaodaTdmsDailyArtifactStore,
    TdmsReceiverService,
  ],
  controllers: [TdmsReceiverController],
  exports: [
    MiaodaTdmsSourceAuthorization,
    MiaodaTdmsDailyArtifactStore,
    TdmsReceiverService,
  ],
})
export class TdmsReceiverRuntimeModule {}
