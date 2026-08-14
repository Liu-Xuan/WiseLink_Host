import { Module } from '@nestjs/common';

import { DocumentManagementRuntimeModule } from '../document-management-runtime/document-management-runtime.module';
import { ExternalDiscoveryController } from './external-discovery.controller';
import { ExternalDiscoveryService } from './external-discovery.service';
import { MiaodaExternalCandidateStore } from './miaoda-external-candidate.store';

@Module({
  imports: [DocumentManagementRuntimeModule],
  controllers: [ExternalDiscoveryController],
  providers: [MiaodaExternalCandidateStore, ExternalDiscoveryService],
  exports: [ExternalDiscoveryService],
})
export class ExternalDiscoveryModule {}
