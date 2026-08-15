import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';

import { AEO_UNIFIED_ACCEPTANCE_READER_PORT } from '../../../shared/aeo-integration';

import { AeoAilyController } from './aeo-aily.controller';
import {
  AEO_AILY_REQUESTER_RESOLVER,
  UnconfiguredAeoAilyRequesterResolver,
} from './aeo-aily-requester.service';
import { AeoWorkItemAuthoringController } from './aeo-authoring.workitem.controller';
import {
  AEO_ARTIFACT_STORE_PORT,
  AEO_HUB_REGISTRAR_PORT,
  AeoArtifactActionService,
} from './aeo-artifact-action.service';
import {
  AEO_SIMILAR_SEARCH_PORT,
  AEO_WORK_ITEM_READ_PORT,
  AeoAilyService,
} from './aeo-aily.service';
import { AeoAuthoringSessionService } from './aeo-authoring-session.service';
import { AeoAuthoringService } from './aeo-authoring.service';
import {
  AEO_CANONICAL_ROLE_RESOLVER,
  AeoWorkItemBindingService,
} from './aeo-work-item-binding.service';
import {
  AEO_HOSTED_ACTIVATION_AUTHORITY_PORT,
  AEO_HOSTED_PLATFORM_PORT_BUNDLE,
  AeoHostedPlatformReadinessService,
  UnconfiguredAeoHostedActivationAuthorityPort,
  UnconfiguredAeoHostedPlatformPortBundle,
} from './aeo-hosted-platform.service';
import { AeoHostedCandidateVerticalService } from './aeo-hosted-candidate-vertical.service';
import {
  AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER,
  provideAeoSameWorkItemAssessmentAdapter,
} from './aeo-same-workitem-assessment.adapter';
import { AeoUnifiedAcceptanceReaderAdapter } from './aeo-unified-acceptance-reader.adapter';
import {
  AEO_VALIDATION_WRITE_AUTHORITY_PORT,
  AeoValidationWriteAuthorizationService,
  UnconfiguredAeoValidationWriteAuthorityPort,
} from './aeo-validation-write.service';

export interface AeoAuthoringModuleOptions {
  /**
   * One provider must own the five operational ports. The same activation
   * manifest also binds the R1 U0/specialist/façade/receipt-owner ports.
   * overrides is intentionally unsupported because partial activation is unsafe.
   */
  hostedPlatformBundleProvider?: Provider;
  /**
   * A separate master-owned provider must read back the activation receipt and
   * manifest actual bytes. It must never be aliased to the hosted bundle.
   */
  hostedActivationAuthorityProvider?: Provider;
  /**
   * Independent per-action receipt reader. Platform activation and WorkItem
   * projection are explicitly not write authorities.
   */
  validationWriteAuthorityProvider?: Provider;
  /**
   * Resolves the Aily actor from platform-authenticated request context. The
   * HTTP body is deliberately not an identity source.
   */
  ailyRequesterResolverProvider?: Provider;
  /**
   * Explicit host opt-in for the same-WorkItem SB Assessment → AEO adapter.
   * Omit to keep the adapter unavailable; no endpoint is registered either way.
   */
  sameWorkItemAssessmentAdapterProvider?: Provider;
  imports?: ModuleMetadata['imports'];
}

@Module({
  controllers: [AeoWorkItemAuthoringController, AeoAilyController],
  providers: [
    AeoAuthoringService,
    AeoAuthoringSessionService,
    AeoWorkItemBindingService,
    AeoAilyService,
    AeoArtifactActionService,
    AeoHostedPlatformReadinessService,
    AeoHostedCandidateVerticalService,
    AeoValidationWriteAuthorizationService,
    AeoUnifiedAcceptanceReaderAdapter,
    {
      provide: AEO_UNIFIED_ACCEPTANCE_READER_PORT,
      useExisting: AeoUnifiedAcceptanceReaderAdapter,
    },
  ],
  exports: [
    AeoHostedPlatformReadinessService,
    AeoAuthoringSessionService,
    AeoArtifactActionService,
    AeoHostedCandidateVerticalService,
    AEO_UNIFIED_ACCEPTANCE_READER_PORT,
  ],
})
export class AeoAuthoringModule {
  static forRoot(options: AeoAuthoringModuleOptions = {}): DynamicModule {
    const hostedPlatformBundleProvider = resolveHostedProvider(options);
    const activationAuthorityProvider =
      resolveActivationAuthorityProvider(options);
    const ailyRequesterResolverProvider =
      resolveAilyRequesterResolverProvider(options);
    const validationWriteAuthorityProvider =
      resolveValidationWriteAuthorityProvider(options);
    const sameWorkItemAssessmentAdapterProvider =
      resolveSameWorkItemAssessmentAdapterProvider(options);
    return {
      module: AeoAuthoringModule,
      imports: options.imports ?? [],
      providers: [
        hostedPlatformBundleProvider,
        activationAuthorityProvider,
        ailyRequesterResolverProvider,
        validationWriteAuthorityProvider,
        ...(sameWorkItemAssessmentAdapterProvider
          ? [sameWorkItemAssessmentAdapterProvider]
          : []),
        {
          provide: AEO_CANONICAL_ROLE_RESOLVER,
          useExisting: AEO_HOSTED_PLATFORM_PORT_BUNDLE,
        },
        {
          provide: AEO_WORK_ITEM_READ_PORT,
          useExisting: AEO_HOSTED_PLATFORM_PORT_BUNDLE,
        },
        {
          provide: AEO_SIMILAR_SEARCH_PORT,
          useExisting: AEO_HOSTED_PLATFORM_PORT_BUNDLE,
        },
        {
          provide: AEO_ARTIFACT_STORE_PORT,
          useExisting: AEO_HOSTED_PLATFORM_PORT_BUNDLE,
        },
        {
          provide: AEO_HUB_REGISTRAR_PORT,
          useExisting: AEO_HOSTED_PLATFORM_PORT_BUNDLE,
        },
      ],
      exports: [
        AEO_HOSTED_PLATFORM_PORT_BUNDLE,
        AEO_HOSTED_ACTIVATION_AUTHORITY_PORT,
        AEO_AILY_REQUESTER_RESOLVER,
        AEO_VALIDATION_WRITE_AUTHORITY_PORT,
        ...(sameWorkItemAssessmentAdapterProvider
          ? [AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER]
          : []),
      ],
    };
  }
}

function resolveSameWorkItemAssessmentAdapterProvider(
  options: AeoAuthoringModuleOptions,
): Provider | null {
  const provider = options.sameWorkItemAssessmentAdapterProvider;
  if (!provider) return null;
  if (
    typeof provider === 'function' ||
    !('provide' in provider) ||
    provider.provide !== AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER
  ) {
    throw new Error(
      'AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER_PROVIDER_INVALID: use provideAeoSameWorkItemAssessmentAdapter() and bind only AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER.',
    );
  }
  return provider;
}

export { provideAeoSameWorkItemAssessmentAdapter };

function resolveValidationWriteAuthorityProvider(
  options: AeoAuthoringModuleOptions,
): Provider {
  const provider = options.validationWriteAuthorityProvider;
  if (!provider) {
    return {
      provide: AEO_VALIDATION_WRITE_AUTHORITY_PORT,
      useClass: UnconfiguredAeoValidationWriteAuthorityPort,
    };
  }
  if (
    typeof provider === 'function' ||
    !('provide' in provider) ||
    provider.provide !== AEO_VALIDATION_WRITE_AUTHORITY_PORT ||
    ('useExisting' in provider &&
      (provider.useExisting === AEO_HOSTED_PLATFORM_PORT_BUNDLE ||
        provider.useExisting === AEO_HOSTED_ACTIVATION_AUTHORITY_PORT ||
        provider.useExisting === AEO_AILY_REQUESTER_RESOLVER))
  ) {
    throw new Error(
      'AEO_VALIDATION_WRITE_AUTHORITY_PROVIDER_INVALID: provider 必须独立绑定 AEO_VALIDATION_WRITE_AUTHORITY_PORT，且不得 alias hosted bundle、activation authority 或 Aily resolver。',
    );
  }
  return provider;
}

function resolveAilyRequesterResolverProvider(
  options: AeoAuthoringModuleOptions,
): Provider {
  const provider = options.ailyRequesterResolverProvider;
  if (!provider) {
    return {
      provide: AEO_AILY_REQUESTER_RESOLVER,
      useClass: UnconfiguredAeoAilyRequesterResolver,
    };
  }
  if (
    typeof provider === 'function' ||
    !('provide' in provider) ||
    provider.provide !== AEO_AILY_REQUESTER_RESOLVER ||
    ('useExisting' in provider &&
      (provider.useExisting === AEO_HOSTED_PLATFORM_PORT_BUNDLE ||
        provider.useExisting === AEO_HOSTED_ACTIVATION_AUTHORITY_PORT))
  ) {
    throw new Error(
      'AEO_AILY_REQUESTER_RESOLVER_PROVIDER_INVALID: provider 必须独立绑定 AEO_AILY_REQUESTER_RESOLVER，且不得 alias hosted bundle 或 activation authority。',
    );
  }
  return provider;
}

function resolveHostedProvider(options: AeoAuthoringModuleOptions): Provider {
  const provider = options.hostedPlatformBundleProvider;
  if (!provider) {
    return {
      provide: AEO_HOSTED_PLATFORM_PORT_BUNDLE,
      useClass: UnconfiguredAeoHostedPlatformPortBundle,
    };
  }
  if (
    typeof provider === 'function' ||
    !('provide' in provider) ||
    provider.provide !== AEO_HOSTED_PLATFORM_PORT_BUNDLE
  ) {
    throw new Error(
      'AEO_HOSTED_PLATFORM_PROVIDER_INVALID: provider 必须原子绑定 AEO_HOSTED_PLATFORM_PORT_BUNDLE。',
    );
  }
  return provider;
}

function resolveActivationAuthorityProvider(
  options: AeoAuthoringModuleOptions,
): Provider {
  const provider = options.hostedActivationAuthorityProvider;
  if (!provider) {
    return {
      provide: AEO_HOSTED_ACTIVATION_AUTHORITY_PORT,
      useClass: UnconfiguredAeoHostedActivationAuthorityPort,
    };
  }
  if (
    typeof provider === 'function' ||
    !('provide' in provider) ||
    provider.provide !== AEO_HOSTED_ACTIVATION_AUTHORITY_PORT ||
    ('useExisting' in provider &&
      provider.useExisting === AEO_HOSTED_PLATFORM_PORT_BUNDLE)
  ) {
    throw new Error(
      'AEO_HOSTED_ACTIVATION_AUTHORITY_PROVIDER_INVALID: provider 必须独立绑定 AEO_HOSTED_ACTIVATION_AUTHORITY_PORT，且不得 alias hosted bundle。',
    );
  }
  return provider;
}
