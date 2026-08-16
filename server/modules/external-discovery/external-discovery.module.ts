import { Module } from '@nestjs/common';

import { DocumentManagementRuntimeModule } from '../document-management-runtime/document-management-runtime.module';
import { MiaodaExternalDiscoveryCandidateStore } from '../document-management/src/hosted/nest';
import { ExternalDiscoveryController } from './external-discovery.controller';
import { ExternalDiscoveryService } from './external-discovery.service';

@Module({
  imports: [DocumentManagementRuntimeModule],
  controllers: [ExternalDiscoveryController],
  providers: [MiaodaExternalDiscoveryCandidateStore, ExternalDiscoveryService],
  exports: [ExternalDiscoveryService],
})
export class ExternalDiscoveryModule {}
