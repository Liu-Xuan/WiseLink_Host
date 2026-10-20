import { Module } from '@nestjs/common';
import { DOCUMENT_SOURCE_READ } from '../document-management/src/hosted/nest/document-source-read.port';
import { IdentityModule } from '../identity/identity.module';
import { MiaodaTdmsSourceAuthorization } from './miaoda-tdms-source-authorization';
import { TdmsDocumentSourceReadAdapter } from './tdms-document-source-read.adapter';
import { TdmsReceiverIdentityProfile } from './tdms-receiver-identity-profile';
import { TdmsReceiverRepository } from './tdms-receiver.repository';

/** Lower authority providers: no DM runtime, Receiver runtime or FileService dependency. */
@Module({
  imports: [IdentityModule],
  providers: [
    TdmsReceiverIdentityProfile,
    TdmsReceiverRepository,
    MiaodaTdmsSourceAuthorization,
    TdmsDocumentSourceReadAdapter,
    {
      provide: DOCUMENT_SOURCE_READ,
      useExisting: TdmsDocumentSourceReadAdapter,
    },
  ],
  exports: [
    TdmsReceiverIdentityProfile,
    TdmsReceiverRepository,
    MiaodaTdmsSourceAuthorization,
    TdmsDocumentSourceReadAdapter,
    DOCUMENT_SOURCE_READ,
  ],
})
export class TdmsSourceAuthorityModule {}
