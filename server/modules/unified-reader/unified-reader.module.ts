import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';

import { Frozen2CandidateReaderService } from './frozen2-candidate-reader.service';
import { UnconfiguredAeoSpecialistReaderAdapter } from './unconfigured-aeo-specialist-reader.adapter';
import { UnconfiguredUnifiedArtifactStoreAdapter } from './unconfigured-unified-artifact-store.adapter';
import { UnconfiguredU0FullPackageValidatorAdapter } from './unconfigured-u0-full-package-validator.adapter';
import { UnconfiguredU0Frozen2FailureAdapter } from './unconfigured-u0-frozen2-failure-adapter.adapter';
import { UnconfiguredImmutableAcceptanceReceiptOwnerAdapter } from './unconfigured-immutable-acceptance-receipt-owner.adapter';
import {
  AEO_SPECIALIST_READER,
  AEO_SPECIALIST_READER_PORT,
  IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER,
  U0_FULL_PACKAGE_VALIDATOR,
  U0_FROZEN2_FAILURE_ADAPTER_PORT,
  UNIFIED_ARTIFACT_STORE,
  UNIFIED_READER_HOST_BINDING,
} from './unified-reader.constants';
import { UnifiedAcceptanceFacadeService } from './unified-acceptance-facade.service';
import { U0FullValidationService } from './u0-full-validation.service';
import { UnifiedReaderController } from './unified-reader.controller';
import { UnifiedReaderService } from './unified-reader.service';
import type { UnifiedReaderHostBindingState } from './unified-reader.types';

export interface UnifiedReaderModuleOptions {
  imports?: ModuleMetadata['imports'];
  artifactStoreProvider?: Provider;
  fullU0ValidatorProvider?: Provider;
  immutableAcceptanceReceiptOwnerProvider?: Provider;
  u0Frozen2FailureAdapterProvider?: Provider;
  aeoSpecialistReaderProvider?: Provider;
}

/** Host-only bridge from the AEO module's exported stable port to this module's private DI token. */
export function createAeoSpecialistReaderBridgeProvider(): Provider {
  return {
    provide: AEO_SPECIALIST_READER,
    useExisting: AEO_SPECIALIST_READER_PORT,
  };
}

@Module({
  controllers: [UnifiedReaderController],
  providers: [
    Frozen2CandidateReaderService,
    U0FullValidationService,
    UnifiedAcceptanceFacadeService,
    UnifiedReaderService,
  ],
  exports: [
    Frozen2CandidateReaderService,
    UnifiedAcceptanceFacadeService,
    UnifiedReaderService,
    UNIFIED_ARTIFACT_STORE,
    U0_FULL_PACKAGE_VALIDATOR,
    U0FullValidationService,
    UNIFIED_READER_HOST_BINDING,
  ],
})
export class UnifiedReaderModule {
  static forRoot(options: UnifiedReaderModuleOptions = {}): DynamicModule {
    const artifactStoreProvider = resolvePortProvider(
      options.artifactStoreProvider,
      UNIFIED_ARTIFACT_STORE,
      UnconfiguredUnifiedArtifactStoreAdapter,
      'UNIFIED_ARTIFACT_STORE_PROVIDER_INVALID',
    );
    const aeoSpecialistReaderProvider = resolvePortProvider(
      options.aeoSpecialistReaderProvider,
      AEO_SPECIALIST_READER,
      UnconfiguredAeoSpecialistReaderAdapter,
      'AEO_SPECIALIST_READER_PROVIDER_INVALID',
    );
    const fullU0ValidatorProvider = resolvePortProvider(
      options.fullU0ValidatorProvider,
      U0_FULL_PACKAGE_VALIDATOR,
      UnconfiguredU0FullPackageValidatorAdapter,
      'U0_FULL_PACKAGE_VALIDATOR_PROVIDER_INVALID',
    );
    const u0Frozen2FailureAdapterProvider = resolvePortProvider(
      options.u0Frozen2FailureAdapterProvider,
      U0_FROZEN2_FAILURE_ADAPTER_PORT,
      UnconfiguredU0Frozen2FailureAdapter,
      'U0_FROZEN2_FAILURE_ADAPTER_PROVIDER_INVALID',
    );
    const immutableAcceptanceReceiptOwnerProvider = resolvePortProvider(
      options.immutableAcceptanceReceiptOwnerProvider,
      IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER,
      UnconfiguredImmutableAcceptanceReceiptOwnerAdapter,
      'IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_PROVIDER_INVALID',
    );
    const hostBinding: UnifiedReaderHostBindingState = {
      mode:
        options.artifactStoreProvider ||
        options.fullU0ValidatorProvider ||
        options.immutableAcceptanceReceiptOwnerProvider ||
        options.aeoSpecialistReaderProvider
          ? 'HOST_CONFIGURED'
          : 'DEFAULT_UNCONFIGURED',
      artifactStoreConfigured: Boolean(options.artifactStoreProvider),
      fullU0ValidatorConfigured: Boolean(options.fullU0ValidatorProvider),
      immutableAcceptanceReceiptOwnerConfigured: Boolean(
        options.immutableAcceptanceReceiptOwnerProvider,
      ),
      aeoSpecialistReaderConfigured: Boolean(
        options.aeoSpecialistReaderProvider,
      ),
      authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
    };
    return {
      module: UnifiedReaderModule,
      imports: options.imports ?? [],
      providers: [
        artifactStoreProvider,
        fullU0ValidatorProvider,
        immutableAcceptanceReceiptOwnerProvider,
        u0Frozen2FailureAdapterProvider,
        aeoSpecialistReaderProvider,
        { provide: UNIFIED_READER_HOST_BINDING, useValue: hostBinding },
      ],
      exports: [
        UnifiedAcceptanceFacadeService,
        UnifiedReaderService,
        AEO_SPECIALIST_READER,
        UNIFIED_ARTIFACT_STORE,
        U0_FULL_PACKAGE_VALIDATOR,
        IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER,
        U0_FROZEN2_FAILURE_ADAPTER_PORT,
        U0FullValidationService,
        UNIFIED_READER_HOST_BINDING,
      ],
    };
  }
}

function resolvePortProvider(
  provider: Provider | undefined,
  expectedToken: string | symbol,
  unconfiguredClass: new (...args: never[]) => unknown,
  errorCode: string,
): Provider {
  if (!provider) {
    return { provide: expectedToken, useClass: unconfiguredClass };
  }
  if (
    typeof provider === 'function' ||
    !('provide' in provider) ||
    provider.provide !== expectedToken
  ) {
    throw new Error(
      `${errorCode}: provider 必须绑定唯一平台端口 ${String(expectedToken)}。`,
    );
  }
  return provider;
}
