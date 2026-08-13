import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { AssessmentRegistrarModule } from './modules/assessment-registrar/assessment-registrar.module';
import { CanonicalHostModule } from './modules/canonical-host/canonical-host.module';
import {
  DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
  DocumentManagementHostedModule,
} from './modules/document-management/src/hosted/nest';
import { UnconfiguredDocumentManagementIngestAuthorizer } from './modules/document-management/src/hosted/nest/unconfigured-document-management-ingest-authorizer';
import { RuntimeProbeModule } from './modules/runtime-probe/runtime-probe.module';
import { ViewModule } from './modules/view/view.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    AssessmentRegistrarModule.forHostedRegistrar(),
    CanonicalHostModule.forRoot(),
    DocumentManagementHostedModule.register({
      authorizerProvider: {
        provide: DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
        useClass: UnconfiguredDocumentManagementIngestAuthorizer,
      },
    }),
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
