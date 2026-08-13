import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { AssessmentRegistrarModule } from './modules/assessment-registrar/assessment-registrar.module';
import { CanonicalHostModule } from './modules/canonical-host/canonical-host.module';
import { DocumentManagementValidationModule } from './modules/document-management-validation/document-management-validation.module';
import { RuntimeProbeModule } from './modules/runtime-probe/runtime-probe.module';
import { createHostedU0FullPackageValidatorProvider } from './modules/unified-reader/hosted-u0-full-validator.provider';
import { ViewModule } from './modules/view/view.module';

const hostedU0ValidatorProvider =
  process.env.WL_U0_HOSTED_VALIDATOR_ENABLED === 'true'
    ? createHostedU0FullPackageValidatorProvider()
    : undefined;

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    AssessmentRegistrarModule.forHostedRegistrar(),
    CanonicalHostModule.forRoot({
      unifiedReader: {
        fullU0ValidatorProvider: hostedU0ValidatorProvider,
      },
    }),
    DocumentManagementValidationModule,
    RuntimeProbeModule,
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
