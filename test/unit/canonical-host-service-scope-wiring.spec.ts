import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Body: noOpDecorator,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    HttpCode: noOpDecorator,
    Param: noOpDecorator,
    Post: noOpDecorator,
    Put: noOpDecorator,
    Query: noOpDecorator,
    Req: noOpDecorator,
    Res: noOpDecorator,
    UseGuards: noOpDecorator,
  };
});

jest.mock('@lark-apaas/fullstack-nestjs-core', () => {
  const actual = jest.requireActual('@lark-apaas/fullstack-nestjs-core');
  return { ...actual, NeedLogin: () => () => undefined };
});

jest.mock(
  '../../server/modules/document-management/src/hosted/documentManagementHostedCore.js',
  () => ({ DocumentManagementHostedCore: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  () => ({ MiaodaFileServiceArtifactStore: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog',
  () => ({ MiaodaHostedDocumentCatalog: class MiaodaHostedDocumentCatalog {} }),
);

jest.mock(
  '../../server/modules/assessment-workbench/assessment-host-consumer.public-api',
  () => ({
    AssessmentHostConsumerModule: class AssessmentHostConsumerModule {},
    AssessmentHostConsumerService: class AssessmentHostConsumerService {},
    DynamicRulesEvaluationProcessor: class DynamicRulesEvaluationProcessor {},
  }),
);
jest.mock(
  '../../server/modules/assessment-workbench/job-aid-runtime/criterionSet.js',
  () => ({ buildJobAidCriterionSetVersion: jest.fn() }),
);
jest.mock(
  '../../server/modules/document-management/src/hosted/phase5BoeingSbHandoff.js',
  () => ({
    createPhase5BoeingSbIngestRequest: jest.fn(),
    PHASE5_737_34_3830_HANDOFF: {
      classificationEnvelope: {
        status: 'CONFIRMED',
        normalizedFamily: 'SB',
      },
      source: { sha256: 'a'.repeat(64), byteLength: 1024 },
      canonicalHostClassification: {
        status: 'CANDIDATE',
        normalizedFamily: 'SB',
        classifierReleaseId: 'classifier@test',
        classifierReleaseHash: `sha256:${'b'.repeat(64)}`,
        parserProfileId: 'parser@test',
        parserProfileHash: `sha256:${'c'.repeat(64)}`,
        fingerprint: `sha256:${'d'.repeat(64)}`,
      },
    },
  }),
);

jest.mock(
  '@shared/aeo-integration',
  () => ({
    AEO_ARTIFACT_ACTION_VERSION:
      'wiselink.3_1.aeo_artifact_action.v0.candidate.2',
    AEO_ARTIFACT_INDEX_VERSION:
      'wiselink.3_1.aeo_artifact_index.v0.candidate.2',
  }),
  { virtual: true },
);
jest.mock('../../server/modules/aeo-authoring/public-api', () => ({
  AeoSameWorkItemAuthoringModule: class {
    static forRoot() {
      return { module: this };
    }
  },
  AeoArtifactActionService: class AeoArtifactActionService {},
  AeoAuthoringSessionService: class AeoAuthoringSessionService {},
  AeoReviewedIntegratedAssessmentConsumer: class AeoReviewedIntegratedAssessmentConsumer {},
}));

import type { Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  UnavailableCanonicalServiceScopeAuthorization,
} from '../../server/modules/canonical-host/canonical-service-scope.authorization';
import { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } from '../../server/modules/canonical-host/configured-development-service-scope.authorization';
import {
  CanonicalHostModule,
  type CanonicalHostModuleOptions,
} from '../../server/modules/canonical-host/canonical-host.module';

describe('CanonicalHostModule service-scope wiring', () => {
  it('aliases the canonical scope to the configured executor scope instance', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: scopeProviders({
        serviceScopeAuthorizationProvider: {
          provide: CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
          useClass: ConfiguredDevelopmentCanonicalServiceScopeAuthorization,
        },
      }),
    }).compile();

    const canonicalScope =
      moduleRef.get<CanonicalServiceScopeAuthorizationPort>(
        CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
      );
    const executorScope = moduleRef.get<CanonicalServiceScopeAuthorizationPort>(
      CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION,
    );

    expect(canonicalScope).toBe(executorScope);
    expect(canonicalScope).toBeInstanceOf(
      ConfiguredDevelopmentCanonicalServiceScopeAuthorization,
    );

    await moduleRef.close();
  });

  it('keeps the default canonical scope fail-closed', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: scopeProviders(),
    }).compile();
    const canonicalScope =
      moduleRef.get<CanonicalServiceScopeAuthorizationPort>(
        CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
      );

    expect(canonicalScope).toBe(
      moduleRef.get(CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION),
    );
    expect(canonicalScope).toBeInstanceOf(
      UnavailableCanonicalServiceScopeAuthorization,
    );
    await expect(
      canonicalScope.assertTransport({ transport: 'OPENCLAW_MCP' }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });

    await moduleRef.close();
  });
});

function scopeProviders(options: CanonicalHostModuleOptions = {}): Provider[] {
  return (CanonicalHostModule.forRoot(options).providers ?? []).filter(
    (provider): provider is Provider => {
      if (
        !provider ||
        typeof provider === 'function' ||
        !('provide' in provider)
      ) {
        return false;
      }
      return (
        provider.provide === CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION ||
        provider.provide === CANONICAL_SERVICE_SCOPE_AUTHORIZATION
      );
    },
  );
}
