import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { CanonicalHostModule } from './modules/canonical-host/canonical-host.module';
import { DocumentManagementRuntimeModule } from './modules/document-management-runtime/document-management-runtime.module';
import { RuntimeProbeModule } from './modules/runtime-probe/runtime-probe.module';
import { ExternalDiscoveryModule } from './modules/external-discovery/external-discovery.module';
import { ExactFtdFrozen2PdfProducerAdapter } from './modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter';
import { MiaodaCanonicalWorkItemRegistrarAdapter } from './modules/work-item/miaoda-canonical-work-item-registrar.adapter';
import {
  OrdinaryCanonicalAuthorizationAdapter,
  OrdinaryCanonicalPermissionSnapshotAdapter,
} from './modules/canonical-host/ordinary-canonical-authorization.adapter';
import { OrdinaryMiaodaAppBindingAdapter } from './modules/canonical-host/ordinary-miaoda-app-binding.adapter';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION,
  CANONICAL_MIAODA_APP_BINDING,
  CANONICAL_PDF_PRODUCER,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './modules/canonical-host/canonical-host.constants';
import { OrdinaryFailureValidationWriteAuthorizationAdapter } from './modules/canonical-host/ordinary-failure-validation-write-authorization.adapter';
import { UNIFIED_ARTIFACT_STORE } from './modules/unified-reader/unified-reader.constants';
import { MiaodaOrdinaryArtifactStoreAdapter } from './modules/unified-reader/miaoda-ordinary-artifact-store.adapter';
import { createHostedU0FullPackageValidatorProvider } from './modules/unified-reader/hosted-u0-full-validator.provider';
import { createHostedU0Frozen2FailureAdapterProvider } from './modules/unified-reader/hosted-u0-frozen2-failure-adapter.provider';
import { ViewModule } from './modules/view/view.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    CanonicalHostModule.forRoot({
      imports: [DocumentManagementRuntimeModule],
      workItemRegistrarProvider: {
        provide: CANONICAL_WORK_ITEM_REGISTRAR,
        useClass: MiaodaCanonicalWorkItemRegistrarAdapter,
      },
      pdfProducerProvider: {
        provide: CANONICAL_PDF_PRODUCER,
        useExisting: ExactFtdFrozen2PdfProducerAdapter,
      },
      authorizationProvider: {
        provide: CANONICAL_AUTHORIZATION,
        useClass: OrdinaryCanonicalAuthorizationAdapter,
      },
      permissionSnapshotProvider: {
        provide: CANONICAL_PERMISSION_SNAPSHOT,
        useClass: OrdinaryCanonicalPermissionSnapshotAdapter,
      },
      miaodaAppBindingProvider: {
        provide: CANONICAL_MIAODA_APP_BINDING,
        useClass: OrdinaryMiaodaAppBindingAdapter,
      },
      failureValidationWriteAuthorizationProvider: {
        provide: CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION,
        useExisting: OrdinaryFailureValidationWriteAuthorizationAdapter,
      },
      unifiedReader: {
        artifactStoreProvider: {
          provide: UNIFIED_ARTIFACT_STORE,
          useExisting: MiaodaOrdinaryArtifactStoreAdapter,
        },
        fullU0ValidatorProvider:
          createHostedU0FullPackageValidatorProvider(),
        u0Frozen2FailureAdapterProvider:
          createHostedU0Frozen2FailureAdapterProvider(),
      },
    }),
    RuntimeProbeModule,
    ExternalDiscoveryModule,
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
