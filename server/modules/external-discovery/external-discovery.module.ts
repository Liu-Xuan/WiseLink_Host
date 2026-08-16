import { Module } from '@nestjs/common';

import { DocumentManagementRuntimeModule } from '../document-management-runtime/document-management-runtime.module';
import { ExternalDiscoveryController } from './external-discovery.controller';
import { ExternalDiscoveryService } from './external-discovery.service';
import { MiaodaExternalDiscoveryCandidateStore } from './miaoda-external-discovery-candidate.store';

@Module({
  imports: [DocumentManagementRuntimeModule],
  controllers: [ExternalDiscoveryController],
  providers: [MiaodaExternalDiscoveryCandidateStore, ExternalDiscoveryService],
  exports: [ExternalDiscoveryService],
})
export class ExternalDiscoveryModule {}
