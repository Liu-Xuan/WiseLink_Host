import { Module } from '@nestjs/common';
import { TdmsReceiverIdentityModule } from './tdms-receiver-identity.module';
import { DocumentManagementRuntimeModule } from '../document-management-runtime/document-management-runtime.module';
import { TdmsBrowserSourceAuthorization } from './tdms-browser-source-authorization';
import { MiaodaTdmsDocumentAccess } from './miaoda-tdms-document-access';

@Module({
  imports: [TdmsReceiverIdentityModule, DocumentManagementRuntimeModule],
  providers: [
    MiaodaTdmsDocumentAccess,
    TdmsBrowserSourceAuthorization,
  ],
  exports: [TdmsBrowserSourceAuthorization],
})
export class TdmsSourceReadAuthorityModule {}
