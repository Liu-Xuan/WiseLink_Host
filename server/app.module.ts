import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { CanonicalHostModule } from './modules/canonical-host/canonical-host.module';
import { DocumentManagementRuntimeModule } from './modules/document-management-runtime/document-management-runtime.module';
import { RuntimeProbeModule } from './modules/runtime-probe/runtime-probe.module';
import { ExternalDiscoveryModule } from './modules/external-discovery/external-discovery.module';
import { HostNativeDocumentFamilyPdfProducerAdapter } from './modules/canonical-host/exact-ftd-frozen2-pdf-producer.adapter';
import { MiaodaCanonicalWorkItemRegistrarAdapter } from './modules/work-item/miaoda-canonical-work-item-registrar.adapter';
import {
  OrdinaryCanonicalAuthorizationAdapter,
  OrdinaryCanonicalPermissionSnapshotAdapter,
} from './modules/canonical-host/ordinary-canonical-authorization.adapter';
import { OrdinaryMiaodaAppBindingAdapter } from './modules/canonical-host/ordinary-miaoda-app-binding.adapter';
import {
  CANONICAL_APPLICABILITY_CONTROLLED_SELECTION,
  CANONICAL_AUTHORIZATION,
  CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION,
  CANONICAL_MIAODA_APP_BINDING,
  CANONICAL_PDF_PRODUCER,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './modules/canonical-host/canonical-host.constants';
import { MiaodaApplicabilityControlledSelectionAdapter } from './modules/canonical-host/miaoda-applicability-controlled-selection.adapter';
import { OrdinaryFailureValidationWriteAuthorizationAdapter } from './modules/canonical-host/ordinary-failure-validation-write-authorization.adapter';
import { UNIFIED_ARTIFACT_STORE } from './modules/unified-reader/unified-reader.constants';
import { MiaodaOrdinaryArtifactStoreAdapter } from './modules/unified-reader/miaoda-ordinary-artifact-store.adapter';
import { createHostedU0FullPackageValidatorProvider } from './modules/unified-reader/hosted-u0-full-validator.provider';
import { createHostedU0Frozen2FailureAdapterProvider } from './modules/unified-reader/hosted-u0-frozen2-failure-adapter.provider';
import { ViewModule } from './modules/view/view.module';
import { IdentityModule } from './modules/identity/identity.module';
import { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } from './modules/canonical-host/configured-development-service-scope.authorization';
import { CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION } from './modules/canonical-host/canonical-service-scope.authorization';
import { ReviewPersistenceModule } from './modules/review-persistence/review-persistence.module';
import {
  S1000D_DOCUMENT_SOURCE,
  S1000D_STRUCTURED_PACKAGE_PRODUCER,
} from './modules/s1000d-ingress/s1000d-ingress.constants';
import { MiaodaS1000dDocumentSourceAdapter } from './modules/s1000d-ingress/miaoda-s1000d-document-source.adapter';
import { S1000dXmlStructuredPackageProducerAdapter } from './modules/s1000d-ingress/s1000d-xml-structured-package-producer.adapter';

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
        useExisting: HostNativeDocumentFamilyPdfProducerAdapter,
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
      serviceScopeAuthorizationProvider: {
        provide: CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
        useClass: ConfiguredDevelopmentCanonicalServiceScopeAuthorization,
      },
      applicabilityControlledSelectionProvider: {
        provide: CANONICAL_APPLICABILITY_CONTROLLED_SELECTION,
        useExisting: MiaodaApplicabilityControlledSelectionAdapter,
      },
      s1000dDocumentSourceProvider: {
        provide: S1000D_DOCUMENT_SOURCE,
        useExisting: MiaodaS1000dDocumentSourceAdapter,
      },
      s1000dProducerProvider: {
        provide: S1000D_STRUCTURED_PACKAGE_PRODUCER,
        useExisting: S1000dXmlStructuredPackageProducerAdapter,
      },
      unifiedReader: {
        artifactStoreProvider: {
          provide: UNIFIED_ARTIFACT_STORE,
          useExisting: MiaodaOrdinaryArtifactStoreAdapter,
        },
        fullU0ValidatorProvider: createHostedU0FullPackageValidatorProvider(),
        u0Frozen2FailureAdapterProvider:
          createHostedU0Frozen2FailureAdapterProvider(),
      },
    }),
    RuntimeProbeModule,
    ExternalDiscoveryModule,
    IdentityModule,
    ReviewPersistenceModule,
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
