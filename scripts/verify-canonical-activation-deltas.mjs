import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants.js';
import { NEED_LOGIN_KEY } from '@lark-apaas/nestjs-authnpaas';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleRoot = join(root, 'dist/server/modules/canonical-host');
const unifiedModuleRoot = join(root, 'dist/server/modules/unified-reader');
const { CanonicalHostModule } = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host.module.js'))
);
const { CanonicalHostController } = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host.controller.js'))
);
const { CanonicalHostOpenApiController } = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host.openapi.controller.js'))
);
const { CanonicalHostMcpOpenApiController } = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host-mcp.openapi.controller.js'))
);
const { CanonicalHostOpenClawMcpOpenApiController } = await import(
  pathToFileURL(
    join(moduleRoot, 'canonical-host-openclaw-mcp.openapi.controller.js'),
  )
);
const {
  CANONICAL_AUTHORIZATION,
  CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION,
  CANONICAL_HOST_BINDING,
  CANONICAL_MIAODA_APP_BINDING,
  CANONICAL_PERMISSION_SNAPSHOT,
} = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host.constants.js'))
);
const { UnifiedReaderModule } = await import(
  pathToFileURL(join(unifiedModuleRoot, 'unified-reader.module.js'))
);
const { U0_FROZEN2_FAILURE_ADAPTER_PORT } = await import(
  pathToFileURL(join(unifiedModuleRoot, 'unified-reader.constants.js'))
);
const openApiSpec = JSON.parse(
  await readFile(join(root, 'docs/openapi.json'), 'utf8'),
);

const providers = providerMap(CanonicalHostModule.forRoot().providers ?? []);
const unifiedProviders = providerMap(
  UnifiedReaderModule.forRoot().providers ?? [],
);
assert.equal(
  providers.get(CANONICAL_AUTHORIZATION).useClass.name,
  'UnconfiguredCanonicalAuthorizationAdapter',
);
assert.equal(
  providers.get(CANONICAL_FAILURE_VALIDATION_WRITE_AUTHORIZATION).useClass.name,
  'UnconfiguredFailureValidationWriteAuthorizationAdapter',
);
assert.equal(
  providers.get(CANONICAL_PERMISSION_SNAPSHOT).useClass.name,
  'UnconfiguredCanonicalPermissionSnapshotAdapter',
);
assert.equal(
  providers.get(CANONICAL_MIAODA_APP_BINDING).useClass.name,
  'UnconfiguredCanonicalMiaodaAppBindingAdapter',
);
assert.equal(
  unifiedProviders.get(U0_FROZEN2_FAILURE_ADAPTER_PORT).useClass.name,
  'UnconfiguredU0Frozen2FailureAdapter',
);
assert.deepEqual(providers.get(CANONICAL_HOST_BINDING).useValue, {
  mode: 'DEFAULT_UNCONFIGURED',
  workItemRegistrarConfigured: false,
  pdfProducerConfigured: false,
  authorizationConfigured: false,
  permissionSnapshotConfigured: false,
  miaodaAppBindingConfigured: false,
  failureValidationWriteAuthorizationConfigured: false,
  authority: 'CANDIDATE_COMPOSITION_NOT_CANONICAL_ACTIVATION',
});

const controllers = Reflect.getMetadata(
  MODULE_METADATA.CONTROLLERS,
  CanonicalHostModule,
);
assert.deepEqual(controllers, [
  CanonicalHostController,
  CanonicalHostOpenApiController,
  CanonicalHostMcpOpenApiController,
  CanonicalHostOpenClawMcpOpenApiController,
]);
assert.equal(
  Reflect.getMetadata(PATH_METADATA, CanonicalHostController),
  'api/canonical-host',
);
assert.deepEqual(Reflect.getMetadata(NEED_LOGIN_KEY, CanonicalHostController), {
  loginPath: undefined,
});
const authenticatedRoutes = readRoutes([CanonicalHostController]);
assert.ok(
  authenticatedRoutes.some(
    (route) =>
      route.method === 'POST' &&
      route.path ===
        'api/canonical-host/work-items/:workItemId/assessment/evaluate',
  ),
);
assert.ok(
  authenticatedRoutes.some(
    (route) =>
      route.method === 'POST' &&
      route.path ===
        'api/canonical-host/work-items/:workItemId/assessment/resynthesize',
  ),
);
assert.equal(
  Reflect.getMetadata(PATH_METADATA, CanonicalHostOpenApiController),
  'openapi/wiselink',
);
assert.equal(
  Reflect.getMetadata(NEED_LOGIN_KEY, CanonicalHostOpenApiController),
  undefined,
);
assert.equal(
  Reflect.getMetadata(PATH_METADATA, CanonicalHostMcpOpenApiController),
  'openapi/wiselink',
);
assert.equal(
  Reflect.getMetadata(NEED_LOGIN_KEY, CanonicalHostMcpOpenApiController),
  undefined,
);
assert.equal(
  Reflect.getMetadata(PATH_METADATA, CanonicalHostOpenClawMcpOpenApiController),
  'openapi/wiselink',
);
assert.equal(
  Reflect.getMetadata(
    NEED_LOGIN_KEY,
    CanonicalHostOpenClawMcpOpenApiController,
  ),
  undefined,
);
assert.deepEqual(readRoutes([CanonicalHostOpenApiController]), [
  {
    method: 'GET',
    path: 'openapi/wiselink/work-items/status',
  },
  {
    method: 'GET',
    path: 'openapi/wiselink/work-items/parsed-units',
  },
  {
    method: 'GET',
    path: 'openapi/wiselink/work-items/deep-link',
  },
]);
assert.deepEqual(
  readOpenApiSpecRoutes(openApiSpec),
  readRoutes([
    CanonicalHostOpenApiController,
    CanonicalHostMcpOpenApiController,
    CanonicalHostOpenClawMcpOpenApiController,
  ]),
);
assert.deepEqual(readRoutes([CanonicalHostMcpOpenApiController]), [
  { method: 'POST', path: 'openapi/wiselink/mcp' },
]);
assert.deepEqual(readRoutes([CanonicalHostOpenClawMcpOpenApiController]), [
  { method: 'POST', path: 'openapi/wiselink/openclaw-mcp' },
]);
assert.ok(Object.keys(openApiSpec.paths).every((path) => !path.includes('{')));
assert.ok(
  Object.entries(openApiSpec.paths)
    .filter(([path]) => !path.endsWith('mcp'))
    .every(([, pathItem]) =>
      pathItem.get.parameters.some(
        (parameter) =>
          parameter.in === 'query' &&
          parameter.name === 'workItemId' &&
          parameter.required === true,
      ),
    ),
);

const source = await readFile(
  join(root, 'client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx'),
  'utf8',
);
assert.ok(source.includes('getDocumentParsingPage'));
assert.ok(source.includes('FRESH READ REQUIRED'));
assert.ok(source.includes("['原件', '分类', '解析', '统一包', 'Reader']"));
assert.ok(source.includes('.evaluateAssessment(workItemId)'));
assert.ok(source.includes('.resynthesizeAssessment(workItemId'));
assert.ok(source.includes('expectedRevision: data.workItem.revision'));
assert.ok(!source.includes('const SAMPLE'));
const request = JSON.parse(
  await readFile(
    join(root, 'test/fixtures/real-ftd-canonical-vertical.request.json'),
    'utf8',
  ),
);
assert.ok(!Object.hasOwn(request, 'permissionSnapshotVersion'));
assert.ok(!Object.hasOwn(request, 'actor'));
assert.ok(!Object.hasOwn(request, 'authority'));
assert.ok(!Object.hasOwn(request, 'decision'));
assert.ok(!Object.hasOwn(request, 'deepLinkPath'));
const controllerSource = await readFile(
  join(moduleRoot, 'canonical-host.controller.js'),
  'utf8',
);
assert.ok(!controllerSource.includes('deepLinkPath'));

const assessmentCalls = [];
const controller = new CanonicalHostController(
  {},
  {},
  {
    evaluateCandidate: async (input, actor) => {
      assessmentCalls.push({ action: 'EVALUATE', input, actor });
      return { revision: 4 };
    },
    resynthesizeAfterEngineerChange: async (input, actor) => {
      assessmentCalls.push({ action: 'RESYNTHESIZE', input, actor });
      return { revision: 5 };
    },
  },
);
const hostRequest = {
  userContext: {
    userId: 'activation-engineer',
    tenantId: 'activation-tenant',
    appId: 'app_17bzc551rsg',
    roles: ['authenticated'],
    env: 'development',
  },
};
await controller.evaluateAssessment('WI-SB-ACTIVATION', {}, hostRequest);
await controller.resynthesizeAssessment(
  'WI-SB-ACTIVATION',
  {
    expectedRevision: 4,
    criterionId: 'JAC-001',
    decision: 'deferred',
    comment: '需要补证',
  },
  hostRequest,
);
assert.equal(assessmentCalls.length, 2);
assert.equal(assessmentCalls[0].actor.userId, 'activation-engineer');
assert.equal(
  assessmentCalls[0].input.assessmentAsOf,
  assessmentCalls[0].input.generatedAt,
);
assert.deepEqual(assessmentCalls[1].input.review, {
  baseRecordId: 'ENGINEER-REVIEW:WI-SB-ACTIVATION:JAC-001',
  decision: 'deferred',
  comment: '需要补证',
  reviewingEngineerUserIds: ['activation-engineer'],
  status: 'NEEDS_REVIEW',
  updatedAt: assessmentCalls[1].input.review.updatedAt,
});
assert.equal(assessmentCalls[1].input.expectedRevision, 4);
let rejectedStatus = null;
try {
  await controller.evaluateAssessment(
    'WI-SB-ACTIVATION',
    { actor: { userId: 'untrusted' } },
    hostRequest,
  );
} catch (error) {
  rejectedStatus = error.getStatus?.();
}
assert.equal(rejectedStatus, 400);
assert.equal(assessmentCalls.length, 2);

process.stdout.write(
  `${JSON.stringify(
    {
      status: 'PASSED',
      schemaVersion:
        'wiselink.3_1.canonical_activation_delta_evidence.v0.candidate',
      defaultPorts: {
        authorization: 'UNCONFIGURED',
        permissionSnapshot: 'UNCONFIGURED',
        canonicalMiaodaAppBinding: 'UNCONFIGURED',
        failureValidationWriteAuthorization: 'UNCONFIGURED',
        u0Frozen2FailureAdapter: 'UNCONFIGURED',
      },
      writeRequestSelfReportedAuthorityFields: [],
      pageProjection: 'SERVER_FRESH_READ_ONLY',
      pageActions: {
        evaluate: 'AUTHENTICATED_SAME_WORK_ITEM',
        engineerChangeResynthesis: 'AUTHENTICATED_EXPECTED_REVISION',
        parsePhasePreserved: true,
      },
      controllerNeedLogin: true,
      openApi: {
        authentication: 'MIAODA_OPENAPI_KEY_GATEWAY',
        controllerNeedLogin: false,
        routes: readRoutes([
          CanonicalHostOpenApiController,
          CanonicalHostMcpOpenApiController,
          CanonicalHostOpenClawMcpOpenApiController,
        ]),
        mcpTransportRoutes: 2,
        ailyMutationTools: 0,
        openClawCandidateMutationTools: 5,
      },
      hardCodedSamplePresent: false,
      failureStates: ['FAILED_WITH_IMMUTABLE_ARTIFACT', 'RECORDING_FAILED'],
      selectedFailureContract: {
        schemaVersion: 'techpub.parse-failure-report.v1',
        contractRevision: 'frozen.2',
        strictValidatorRequired: true,
        actualByteReadbackRequired: true,
        uniqueAdapterPort:
          'wiselink.3_1.port.u0_frozen2_failure_adapter.v0.candidate.1',
        unifiedSourceCommit: 'ebf84f87213227b0a4bdf2f9d4909ca1a58b3518',
      },
      deepLinkWire: 'SERVER_DERIVED_FROM_VERIFIED_CANONICAL_BINDING_ONLY',
      onlineWrites: 0,
      published: false,
    },
    null,
    2,
  )}\n`,
);

function providerMap(providers) {
  return new Map(
    providers
      .filter(
        (provider) =>
          typeof provider === 'object' &&
          provider !== null &&
          'provide' in provider,
      )
      .map((provider) => [provider.provide, provider]),
  );
}

function readRoutes(controllers) {
  return controllers.flatMap((controller) => {
    const basePath = Reflect.getMetadata(PATH_METADATA, controller);
    return Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== 'constructor')
      .flatMap((name) => {
        const handler = controller.prototype[name];
        const path = Reflect.getMetadata(PATH_METADATA, handler);
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (path === undefined || method === undefined) return [];
        return [
          {
            method: RequestMethod[method],
            path: [basePath, path].filter(Boolean).join('/'),
          },
        ];
      });
  });
}

function readOpenApiSpecRoutes(spec) {
  return Object.entries(spec.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem).flatMap(([method]) =>
      ['get', 'post', 'put', 'patch', 'delete'].includes(method)
        ? [
            {
              method: method.toUpperCase(),
              path: path.replace(/^\//u, '').replace(/\{([^}]+)\}/gu, ':$1'),
            },
          ]
        : [],
    ),
  );
}
