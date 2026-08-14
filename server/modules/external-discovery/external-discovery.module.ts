import { type DynamicModule, Module, type Provider } from '@nestjs/common';

import { DocumentManagementRuntimeModule } from '../document-management-runtime/document-management-runtime.module';
import { ExternalDiscoveryAutomation } from './external-discovery.automation';
import { ExternalDiscoveryController } from './external-discovery.controller';
import { ExternalDiscoveryService } from './external-discovery.service';
import { MiaodaExternalCandidateStore } from './miaoda-external-candidate.store';

export interface ExternalDiscoveryModuleOptions {
  discoveryPortProvider?: Provider;
}

@Module({
  imports: [DocumentManagementRuntimeModule],
  controllers: [ExternalDiscoveryController],
  providers: [
    MiaodaExternalCandidateStore,
    ExternalDiscoveryService,
    ExternalDiscoveryAutomation,
  ],
  exports: [ExternalDiscoveryService],
})
export class ExternalDiscoveryModule {
  static forRoot(
    options: ExternalDiscoveryModuleOptions = {},
  ): DynamicModule {
    const providers: Provider[] = options.discoveryPortProvider
      ? [options.discoveryPortProvider]
      : [];
    return {
      module: ExternalDiscoveryModule,
      providers,
    };
  }
}
