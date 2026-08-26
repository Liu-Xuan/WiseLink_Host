import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';

import {
  UnifiedReaderModule,
  type UnifiedReaderModuleOptions,
} from '../unified-reader/unified-reader.module';
import { ActionAttemptModule } from '../action-attempt/action-attempt.module';
import { CanonicalEntryFacadeService } from './canonical-entry-facade.service';
import { CanonicalHostVerticalService } from './canonical-host-vertical.service';
import { CanonicalHostController } from './canonical-host.controller';
import { CanonicalHostOpenApiController } from './canonical-host.openapi.controller';
import { CanonicalHostMcpOpenApiController } from './canonical-host-mcp.openapi.controller';
import { CanonicalHostMcpService } from './canonical-host-mcp.service';
import { CanonicalHostOpenClawMcpOpenApiController } from './canonical-host-openclaw-mcp.openapi.controller';
import { OauthSessionDevelopmentWorkItemController } from './oauth-session-development-work-item.controller';
import { CanonicalHostOpenClawMcpService } from './canonical-host-openclaw-mcp.service';
import { CanonicalHostOpenClawDynamicEvaluationService } from './canonical-host-openclaw-dynamic-evaluation.service';
import { CanonicalHostOpenClawDiscoveryService } from './canonical-host-openclaw-discovery.service';
import { CanonicalHostOpenClawOverallService } from './canonical-host-openclaw-overall.service';
import { CanonicalHostOpenClawTranslationService } from './canonical-host-openclaw-translation.service';
import { HostOwnedV1TranslationRuleSetPrivateProvider } from './canonical-translation-rule-set-v1.private';
import { ExternalDiscoveryModule } from '../external-discovery/external-discovery.module';
import { CanonicalFailureRecordingService } from './canonical-failure-recording.service';
import { ExactFtdFrozen2PdfProducerAdapter } from './exact-ftd-frozen2-pdf-producer.adapter';
import { OrdinaryFailureValidationWriteAuthorizationAdapter } from './ordinary-failure-validation-write-authorization.adapter';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_BASE_RULE_RESULT_PROVIDER,
  CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION,
  CANONICAL_HOST_BINDING,
  CANONICAL_HOST_CLOCK,
  CANONICAL_MIAODA_APP_BINDING,
  CANONICAL_OPENCLAW_OVERALL_PROVIDER,
  CANONICAL_PDF_PRODUCER,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
  SCOPED_PROFESSIONAL_ARTIFACT_CORRELATION,
} from './canonical-host.constants';
import type { CanonicalHostBindingState } from './canonical-host.types';
import { MiaodaCanonicalWorkItemRegistrarAdapter } from '../work-item/miaoda-canonical-work-item-registrar.adapter';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { WorkItemRuntimeModule } from '../work-item/work-item-runtime.module';
import { IdentityModule } from '../identity/identity.module';
import { OrdinaryWorkItemService } from '../work-item/ordinary-work-item.service';
import { UnconfiguredCanonicalPdfProducerAdapter } from './unconfigured-canonical-pdf-producer.adapter';
import { UnconfiguredCanonicalMiaodaAppBindingAdapter } from './unconfigured-canonical-miaoda-app-binding.adapter';
import { UnconfiguredCanonicalAuthorizationAdapter } from './unconfigured-canonical-authorization.adapter';
import { UnconfiguredCanonicalPermissionSnapshotAdapter } from './unconfigured-canonical-permission-snapshot.adapter';
import { UnconfiguredCanonicalWorkItemRegistrarAdapter } from './unconfigured-canonical-work-item-registrar.adapter';
import { SystemCanonicalHostClockAdapter } from './system-canonical-host-clock.adapter';
import { UnconfiguredFailureValidationWriteAuthorizationAdapter } from './unconfigured-failure-validation-write-authorization.adapter';
import { AssessmentHostConsumerModule } from '../assessment-workbench/assessment-host-consumer.public-api';
import { CanonicalHostAssessmentService } from './canonical-host-assessment.service';
import { CanonicalHostAeoService } from './canonical-host-aeo.service';
import { CanonicalHostIntegratedAssessmentService } from './canonical-host-integrated-assessment.service';
import { CanonicalHostEngineerReviewService } from './canonical-host-engineer-review.service';
import { CanonicalHostLibraryIndexService } from './canonical-host-library-index.service';
import { AeoSameWorkItemAuthoringModule } from '../aeo-authoring/public-api';
import {
  UnconfiguredCanonicalBaseRuleResultProvider,
  UnconfiguredCanonicalOpenClawOverallProvider,
} from './unconfigured-integrated-assessment.adapters';
import {
  CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  UnavailableCanonicalServiceScopeAuthorization,
} from './canonical-service-scope.authorization';
import {
  MiaodaScopedProfessionalArtifactCorrelationAdapter,
  UnavailableScopedProfessionalArtifactCorrelationAdapter,
} from './scoped-professional-artifact-correlation.port';

export interface CanonicalHostModuleOptions {
  imports?: ModuleMetadata['imports'];
  unifiedReader?: UnifiedReaderModuleOptions;
  workItemRegistrarProvider?: Provider;
  pdfProducerProvider?: Provider;
  authorizationProvider?: Provider;
  permissionSnapshotProvider?: Provider;
  miaodaAppBindingProvider?: Provider;
  failureValidationWriteAuthorizationProvider?: Provider;
  baseRuleResultProvider?: Provider;
  openClawOverallProvider?: Provider;
  serviceScopeAuthorizationProvider?: Provider;
  professionalArtifactCorrelationProvider?: Provider;
}

@Module({
  imports: [
    ActionAttemptModule,
    ExternalDiscoveryModule,
    AssessmentHostConsumerModule,
    AeoSameWorkItemAuthoringModule.forRoot(),
    WorkItemRuntimeModule,
    IdentityModule,
  ],
  controllers: [
    CanonicalHostController,
    CanonicalHostOpenApiController,
    CanonicalHostMcpOpenApiController,
    CanonicalHostOpenClawMcpOpenApiController,
    OauthSessionDevelopmentWorkItemController,
  ],
  providers: [
    CanonicalEntryFacadeService,
    CanonicalFailureRecordingService,
    CanonicalHostVerticalService,
    CanonicalHostMcpService,
    CanonicalHostOpenClawMcpService,
    CanonicalHostOpenClawDynamicEvaluationService,
    CanonicalHostOpenClawDiscoveryService,
    CanonicalHostOpenClawOverallService,
    CanonicalHostOpenClawTranslationService,
    HostOwnedV1TranslationRuleSetPrivateProvider,
    ExactFtdFrozen2PdfProducerAdapter,
    MiaodaDocumentVersionSourceResolver,
    MiaodaCanonicalWorkItemRegistrarAdapter,
    OrdinaryWorkItemService,
    OrdinaryFailureValidationWriteAuthorizationAdapter,
    CanonicalHostAssessmentService,
    CanonicalHostIntegratedAssessmentService,
    CanonicalHostEngineerReviewService,
    CanonicalHostLibraryIndexService,
    CanonicalHostAeoService,
    UnavailableCanonicalServiceScopeAuthorization,
    UnavailableScopedProfessionalArtifactCorrelationAdapter,
    MiaodaScopedProfessionalArtifactCorrelationAdapter,
    {
      provide: SCOPED_PROFESSIONAL_ARTIFACT_CORRELATION,
      useExisting: MiaodaScopedProfessionalArtifactCorrelationAdapter,
    },
    {
      provide: CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
      useExisting: UnavailableCanonicalServiceScopeAuthorization,
    },
    {
      provide: CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
      useExisting: CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
    },
  ],
})
export class CanonicalHostModule {
  static forRoot(options: CanonicalHostModuleOptions = {}): DynamicModule {
    const workItemRegistrarProvider = resolveProvider(
      options.workItemRegistrarProvider,
      CANONICAL_WORK_ITEM_REGISTRAR,
      UnconfiguredCanonicalWorkItemRegistrarAdapter,
      'CANONICAL_WORK_ITEM_REGISTRAR_PROVIDER_INVALID',
    );
    const pdfProducerProvider = resolveProvider(
      options.pdfProducerProvider,
      CANONICAL_PDF_PRODUCER,
      UnconfiguredCanonicalPdfProducerAdapter,
      'CANONICAL_PDF_PRODUCER_PROVIDER_INVALID',
    );
    const authorizationProvider = resolveProvider(
      options.authorizationProvider,
      CANONICAL_AUTHORIZATION,
      UnconfiguredCanonicalAuthorizationAdapter,
      'CANONICAL_AUTHORIZATION_PROVIDER_INVALID',
    );
    const permissionSnapshotProvider = resolveProvider(
      options.permissionSnapshotProvider,
      CANONICAL_PERMISSION_SNAPSHOT,
      UnconfiguredCanonicalPermissionSnapshotAdapter,
      'CANONICAL_PERMISSION_SNAPSHOT_PROVIDER_INVALID',
    );
    const miaodaAppBindingProvider = resolveProvider(
      options.miaodaAppBindingProvider,
      CANONICAL_MIAODA_APP_BINDING,
      UnconfiguredCanonicalMiaodaAppBindingAdapter,
      'CANONICAL_MIAODA_APP_BINDING_PROVIDER_INVALID',
    );
    const failureValidationWriteAuthorizationProvider = resolveProvider(
      options.failureValidationWriteAuthorizationProvider,
      CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION,
      UnconfiguredFailureValidationWriteAuthorizationAdapter,
      'FAILURE_VALIDATION_WRITE_AUTHORIZATION_PROVIDER_INVALID',
    );
    const baseRuleResultProvider = resolveProvider(
      options.baseRuleResultProvider,
      CANONICAL_BASE_RULE_RESULT_PROVIDER,
      UnconfiguredCanonicalBaseRuleResultProvider,
      'BASE_RULE_RESULT_PROVIDER_INVALID',
    );
    const openClawOverallProvider = resolveProvider(
      options.openClawOverallProvider,
      CANONICAL_OPENCLAW_OVERALL_PROVIDER,
      UnconfiguredCanonicalOpenClawOverallProvider,
      'OPENCLAW_OVERALL_PROVIDER_INVALID',
    );
    const serviceScopeAuthorizationProvider = resolveProvider(
      options.serviceScopeAuthorizationProvider,
      CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
      UnavailableCanonicalServiceScopeAuthorization,
      'CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION_PROVIDER_INVALID',
    );
    const professionalArtifactCorrelationProvider = resolveProvider(
      options.professionalArtifactCorrelationProvider,
      SCOPED_PROFESSIONAL_ARTIFACT_CORRELATION,
      MiaodaScopedProfessionalArtifactCorrelationAdapter,
      'SCOPED_PROFESSIONAL_ARTIFACT_CORRELATION_PROVIDER_INVALID',
    );
    const binding: CanonicalHostBindingState = {
      mode:
        options.workItemRegistrarProvider &&
        options.pdfProducerProvider &&
        options.authorizationProvider &&
        options.permissionSnapshotProvider &&
        options.miaodaAppBindingProvider
          ? 'HOST_CONFIGURED'
          : 'DEFAULT_UNCONFIGURED',
      workItemRegistrarConfigured: Boolean(options.workItemRegistrarProvider),
      pdfProducerConfigured: Boolean(options.pdfProducerProvider),
      authorizationConfigured: Boolean(options.authorizationProvider),
      permissionSnapshotConfigured: Boolean(options.permissionSnapshotProvider),
      miaodaAppBindingConfigured: Boolean(options.miaodaAppBindingProvider),
      failureValidationWriteAuthorizationConfigured: Boolean(
        options.failureValidationWriteAuthorizationProvider,
      ),
      authority: 'CANDIDATE_COMPOSITION_NOT_CANONICAL_ACTIVATION',
    };
    return {
      module: CanonicalHostModule,
      imports: [
        ActionAttemptModule,
        UnifiedReaderModule.forRoot(options.unifiedReader),
        AssessmentHostConsumerModule,
        ExternalDiscoveryModule,
        AeoSameWorkItemAuthoringModule.forRoot(),
        WorkItemRuntimeModule,
        IdentityModule,
        ...(options.imports ?? []),
      ],
      controllers: [
        CanonicalHostController,
        CanonicalHostOpenApiController,
        CanonicalHostMcpOpenApiController,
        CanonicalHostOpenClawMcpOpenApiController,
        OauthSessionDevelopmentWorkItemController,
      ],
      providers: [
        workItemRegistrarProvider,
        pdfProducerProvider,
        authorizationProvider,
        permissionSnapshotProvider,
        miaodaAppBindingProvider,
        failureValidationWriteAuthorizationProvider,
        baseRuleResultProvider,
        openClawOverallProvider,
        serviceScopeAuthorizationProvider,
        professionalArtifactCorrelationProvider,
        {
          provide: CANONICAL_HOST_CLOCK,
          useClass: SystemCanonicalHostClockAdapter,
        },
        { provide: CANONICAL_HOST_BINDING, useValue: binding },
        CanonicalEntryFacadeService,
        CanonicalFailureRecordingService,
        CanonicalHostVerticalService,
        CanonicalHostMcpService,
        CanonicalHostOpenClawMcpService,
        CanonicalHostOpenClawDynamicEvaluationService,
        CanonicalHostOpenClawDiscoveryService,
        CanonicalHostOpenClawOverallService,
        CanonicalHostOpenClawTranslationService,
        HostOwnedV1TranslationRuleSetPrivateProvider,
        ExactFtdFrozen2PdfProducerAdapter,
        MiaodaDocumentVersionSourceResolver,
        MiaodaCanonicalWorkItemRegistrarAdapter,
        OrdinaryWorkItemService,
        OrdinaryFailureValidationWriteAuthorizationAdapter,
        CanonicalHostAssessmentService,
        CanonicalHostIntegratedAssessmentService,
        CanonicalHostEngineerReviewService,
        CanonicalHostLibraryIndexService,
        CanonicalHostAeoService,
        {
          provide: CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
          useExisting: CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
        },
      ],
      exports: [
        CanonicalEntryFacadeService,
        CanonicalHostVerticalService,
        CanonicalHostAssessmentService,
        CanonicalHostIntegratedAssessmentService,
        CanonicalHostEngineerReviewService,
        CanonicalHostLibraryIndexService,
        CanonicalHostAeoService,
        CANONICAL_HOST_BINDING,
      ],
    };
  }
}

function resolveProvider(
  provider: Provider | undefined,
  expectedToken: symbol,
  unconfiguredClass: new (...args: never[]) => unknown,
  errorCode: string,
): Provider {
  if (!provider) return { provide: expectedToken, useClass: unconfiguredClass };
  if (
    typeof provider === 'function' ||
    !('provide' in provider) ||
    provider.provide !== expectedToken
  ) {
    throw new Error(`${errorCode}:${String(expectedToken)}`);
  }
  return provider;
}
