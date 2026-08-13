import { type DynamicModule, Module } from '@nestjs/common';

import {
  hostedRegistrarActivationProvider,
  type HostedRegistrarProviderOptions,
} from './work-item-registrar-hosted.provider';
import { WorkItemRegistrarActivationController } from './work-item-registrar-activation.controller';

@Module({ controllers: [WorkItemRegistrarActivationController] })
export class AssessmentRegistrarModule {
  static forHostedRegistrar(
    options: HostedRegistrarProviderOptions = {},
  ): DynamicModule {
    return {
      module: AssessmentRegistrarModule,
      providers: [hostedRegistrarActivationProvider(options)],
    };
  }
}
