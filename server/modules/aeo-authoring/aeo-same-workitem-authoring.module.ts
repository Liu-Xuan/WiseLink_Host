import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
  type Provider,
  type Type,
} from '@nestjs/common';

import {
  AEO_ARTIFACT_STORE_PORT,
  AEO_HUB_REGISTRAR_PORT,
  AeoArtifactActionService,
  UnconfiguredAeoArtifactStorePort,
  UnconfiguredAeoHubRegistrarPort,
} from './aeo-artifact-action.service';
import {
  AEO_SIMILAR_SEARCH_PORT,
  AEO_WORK_ITEM_READ_PORT,
  UnconfiguredAeoSimilarSearchPort,
  UnconfiguredAeoWorkItemReadPort,
} from './aeo-same-workitem-host.ports';
import { AeoAuthoringSessionService } from './aeo-authoring-session.service';
import { AeoReviewedIntegratedAssessmentConsumer } from './aeo-reviewed-integrated-assessment.consumer';
export interface AeoSameWorkItemAuthoringModuleOptions {
  workItemReadProvider?: Provider;
  similarSearchProvider?: Provider;
  artifactStoreProvider?: Provider;
  registrarProvider?: Provider;
  imports?: ModuleMetadata['imports'];
}

/**
 * Production host-consumption module.
 *
 * It owns no HTTP route, user-agent tool, input acceptance authority or
 * persistence store.
 * The single canonical Miaoda host supplies its existing authenticated
 * WorkItem/permission, candidate-read, ArtifactStore and CAS services.
 */
@Module({
  providers: [
    AeoAuthoringSessionService,
    AeoArtifactActionService,
    AeoReviewedIntegratedAssessmentConsumer,
  ],
  exports: [
    AeoAuthoringSessionService,
    AeoArtifactActionService,
    AeoReviewedIntegratedAssessmentConsumer,
  ],
})
export class AeoSameWorkItemAuthoringModule {
  static forRoot(
    options: AeoSameWorkItemAuthoringModuleOptions = {},
  ): DynamicModule {
    return {
      module: AeoSameWorkItemAuthoringModule,
      imports: options.imports ?? [],
      providers: [
        resolveProvider(
          options.workItemReadProvider,
          AEO_WORK_ITEM_READ_PORT,
          UnconfiguredAeoWorkItemReadPort,
          'workItemReadProvider',
        ),
        resolveProvider(
          options.similarSearchProvider,
          AEO_SIMILAR_SEARCH_PORT,
          UnconfiguredAeoSimilarSearchPort,
          'similarSearchProvider',
        ),
        resolveProvider(
          options.artifactStoreProvider,
          AEO_ARTIFACT_STORE_PORT,
          UnconfiguredAeoArtifactStorePort,
          'artifactStoreProvider',
        ),
        resolveProvider(
          options.registrarProvider,
          AEO_HUB_REGISTRAR_PORT,
          UnconfiguredAeoHubRegistrarPort,
          'registrarProvider',
        ),
      ],
      exports: [
        AEO_WORK_ITEM_READ_PORT,
        AEO_SIMILAR_SEARCH_PORT,
        AEO_ARTIFACT_STORE_PORT,
        AEO_HUB_REGISTRAR_PORT,
      ],
    };
  }
}

function resolveProvider(
  provider: Provider | undefined,
  token: symbol,
  fallback: Type<unknown>,
  field: string,
): Provider {
  if (!provider) return { provide: token, useClass: fallback };
  return requireTokenProvider(provider, token, field);
}

function requireTokenProvider(
  provider: Provider,
  token: symbol,
  field: string,
): Provider {
  if (
    typeof provider === 'function' ||
    !('provide' in provider) ||
    provider.provide !== token
  ) {
    throw new Error(
      `AEO_SAME_WORKITEM_HOST_PROVIDER_INVALID:${field}:${String(token)}`,
    );
  }
  return provider;
}
