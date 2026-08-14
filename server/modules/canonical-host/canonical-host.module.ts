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
import { CanonicalEntryFacadeService } from './canonical-entry-facade.service';
import { CanonicalHostVerticalService } from './canonical-host-vertical.service';
import { CanonicalHostController } from './canonical-host.controller';
import { CanonicalHostOpenApiController } from './canonical-host.openapi.controller';
import { CanonicalFailureRecordingService } from './canonical-failure-recording.service';
import { ExactFtdFrozen2PdfProducerAdapter } from './exact-ftd-frozen2-pdf-producer.adapter';
import { OrdinaryFailureValidationWriteAuthorizationAdapter } from './ordinary-failure-validation-write-authorization.adapter';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION,
  CANONICAL_HOST_BINDING,
  CANONICAL_HOST_CLOCK,
  CANONICAL_MIAODA_APP_BINDING,
  CANONICAL_PDF_PRODUCER,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type { CanonicalHostBindingState } from './canonical-host.types';
import { MiaodaCanonicalWorkItemRegistrarAdapter } from '../work-item/miaoda-canonical-work-item-registrar.adapter';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { OrdinaryWorkItemService } from '../work-item/ordinary-work-item.service';
import { UnconfiguredCanonicalPdfProducerAdapter } from './unconfigured-canonical-pdf-producer.adapter';
import { UnconfiguredCanonicalMiaodaAppBindingAdapter } from './unconfigured-canonical-miaoda-app-binding.adapter';
import { UnconfiguredCanonicalAuthorizationAdapter } from './unconfigured-canonical-authorization.adapter';
import { UnconfiguredCanonicalPermissionSnapshotAdapter } from './unconfigured-canonical-permission-snapshot.adapter';
import { UnconfiguredCanonicalWorkItemRegistrarAdapter } from './unconfigured-canonical-work-item-registrar.adapter';
import { SystemCanonicalHostClockAdapter } from './system-canonical-host-clock.adapter';
import { UnconfiguredFailureValidationWriteAuthorizationAdapter } from './unconfigured-failure-validation-write-authorization.adapter';

export interface CanonicalHostModuleOptions {
  imports?: ModuleMetadata['imports'];
  unifiedReader?: UnifiedReaderModuleOptions;
  workItemRegistrarProvider?: Provider;
  pdfProducerProvider?: Provider;
  authorizationProvider?: Provider;
  permissionSnapshotProvider?: Provider;
  miaodaAppBindingProvider?: Provider;
  failureValidationWriteAuthorizationProvider?: Provider;
}

@Module({
  controllers: [CanonicalHostController, CanonicalHostOpenApiController],
  providers: [
    CanonicalEntryFacadeService,
    CanonicalFailureRecordingService,
    CanonicalHostVerticalService,
    ExactFtdFrozen2PdfProducerAdapter,
    MiaodaWorkItemRepository,
    MiaodaDocumentVersionSourceResolver,
    MiaodaCanonicalWorkItemRegistrarAdapter,
    OrdinaryWorkItemService,
    OrdinaryFailureValidationWriteAuthorizationAdapter,
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
      permissionSnapshotConfigured: Boolean(
        options.permissionSnapshotProvider,
      ),
      miaodaAppBindingConfigured: Boolean(options.miaodaAppBindingProvider),
      failureValidationWriteAuthorizationConfigured: Boolean(
        options.failureValidationWriteAuthorizationProvider,
      ),
      authority: 'CANDIDATE_COMPOSITION_NOT_CANONICAL_ACTIVATION',
    };
    return {
      module: CanonicalHostModule,
      imports: [
        UnifiedReaderModule.forRoot(options.unifiedReader),
        ...(options.imports ?? []),
      ],
      controllers: [CanonicalHostController, CanonicalHostOpenApiController],
      providers: [
        workItemRegistrarProvider,
        pdfProducerProvider,
        authorizationProvider,
        permissionSnapshotProvider,
        miaodaAppBindingProvider,
        failureValidationWriteAuthorizationProvider,
        {
          provide: CANONICAL_HOST_CLOCK,
          useClass: SystemCanonicalHostClockAdapter,
        },
        { provide: CANONICAL_HOST_BINDING, useValue: binding },
        CanonicalEntryFacadeService,
        CanonicalFailureRecordingService,
        CanonicalHostVerticalService,
        ExactFtdFrozen2PdfProducerAdapter,
        MiaodaWorkItemRepository,
        MiaodaDocumentVersionSourceResolver,
        MiaodaCanonicalWorkItemRegistrarAdapter,
        OrdinaryWorkItemService,
        OrdinaryFailureValidationWriteAuthorizationAdapter,
      ],
      exports: [
        CanonicalEntryFacadeService,
        CanonicalHostVerticalService,
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
