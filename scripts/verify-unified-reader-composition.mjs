import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import 'reflect-metadata';
import { Module, RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants.js';
import { NestFactory } from '@nestjs/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  await readFile(
    join(
      root,
      'contracts/unified-acceptance/v0/unified-reader-host-composition.manifest.json',
    ),
    'utf8',
  ),
);
const moduleRoot = join(root, 'dist/server/modules/unified-reader');
const {
  UnifiedReaderModule,
  createAeoSpecialistReaderBridgeProvider,
} = await import(
  pathToFileURL(join(moduleRoot, 'unified-reader.module.js'))
);
const publicApi = await import(
  pathToFileURL(join(moduleRoot, 'public-api.js'))
);
const { UnifiedReaderController } = await import(
  pathToFileURL(join(moduleRoot, 'unified-reader.controller.js'))
);
const { UnifiedReaderService } = await import(
  pathToFileURL(join(moduleRoot, 'unified-reader.service.js'))
);
const {
  AEO_SPECIALIST_READER,
  AEO_SPECIALIST_READER_PORT,
  IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER,
  U0_FULL_PACKAGE_VALIDATOR,
  UNIFIED_ARTIFACT_STORE,
  UNIFIED_READER_HOST_BINDING,
} = await import(
  pathToFileURL(join(moduleRoot, 'unified-reader.constants.js'))
);

const exactHostBinding = {
  canonicalMiaodaHostId: 'app_17bzc551rsg',
  tenantId: 'tenant-composition-test',
  environment: 'local-composition-test',
  roleResolutionRevision: 'local-composition-test',
  roleResolutionFingerprint:
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  canonicalArtifactStoreId: 'file-service-composition-test',
  soleRegistrarServicePrincipal: 'registrar-composition-test',
  immutableReceiptOwnerId: 'receipt-owner-composition-test',
  immutableReceiptOwnerAdapterRevision: 'local-composition-test',
  immutableReceiptStoreId: 'receipt-store-composition-test',
};
const fileServiceProvider = publicApi.createMiaodaFileArtifactStoreProvider({
  activationBinding: exactHostBinding,
});
assert.equal(fileServiceProvider.provide, UNIFIED_ARTIFACT_STORE);
assert.equal(fileServiceProvider.inject.length, 1);
assert.equal(fileServiceProvider.inject[0].name, 'FileService');
const noIoFileService = {
  getFileMetadata() {
    throw new Error('UNEXPECTED_FILE_SERVICE_IO');
  },
  upload() {
    throw new Error('UNEXPECTED_FILE_SERVICE_IO');
  },
  download() {
    throw new Error('UNEXPECTED_FILE_SERVICE_IO');
  },
};
class NoIoFileServiceModule {}
Module({
  providers: [{ provide: fileServiceProvider.inject[0], useValue: noIoFileService }],
  exports: [fileServiceProvider.inject[0]],
})(NoIoFileServiceModule);
const hostedArtifactStore = fileServiceProvider.useFactory(noIoFileService);
assert.deepEqual(hostedArtifactStore.activationBinding, exactHostBinding);
await assert.rejects(
  hostedArtifactStore.persistAndReadback(
    new TextEncoder().encode('{"ok":true}\n'),
  ),
  /VALIDATION_WRITE_RECEIPT_REQUIRED:PACKAGE_ARTIFACT_PERSIST/u,
);
const fullValidatorProvider =
  publicApi.createPythonU0FullPackageValidatorProvider({
    pythonExecutable: '/usr/bin/python3',
    contractRoot: '/contract-root-not-executed-by-composition-check',
    contractCommit: 'fa69ada08265934951df53c7a61a3ccdb8cb2900',
    validatorRevision: 'u0-frozen2-python-hosted-probe',
    pythonModulePath: '/vendor-path-not-executed-by-composition-check',
  });
assert.equal(fullValidatorProvider.provide, U0_FULL_PACKAGE_VALIDATOR);
assert.equal(
  fullValidatorProvider.useFactory().constructor.name,
  'PythonU0FullPackageValidatorAdapter',
);
const fakeReceiptOwner = {
  activationBinding: exactHostBinding,
  async persistAndReadback() {
    throw new Error('UNEXPECTED_RECEIPT_OWNER_IO');
  },
};
const receiptOwnerProvider =
  publicApi.createImmutableAcceptanceReceiptOwnerProvider(fakeReceiptOwner);
assert.equal(
  receiptOwnerProvider.provide,
  IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER,
);
assert.equal(receiptOwnerProvider.useValue, fakeReceiptOwner);

assert.equal(
  AEO_SPECIALIST_READER_PORT,
  manifest.ports.aeoSpecialistReader.exportedPortToken,
);
const bridgeProvider = createAeoSpecialistReaderBridgeProvider();
assert.equal(bridgeProvider.provide, AEO_SPECIALIST_READER);
assert.equal(bridgeProvider.useExisting, AEO_SPECIALIST_READER_PORT);
assert.equal(
  manifest.ports.aeoSpecialistReader.bridgeFactory,
  'createAeoSpecialistReaderBridgeProvider',
);
const controllers = Reflect.getMetadata(
  MODULE_METADATA.CONTROLLERS,
  UnifiedReaderModule,
);
assert.deepEqual(controllers, [UnifiedReaderController]);
const routes = readRoutes(controllers);
assert.deepEqual(
  routes,
  manifest.httpSurface.map(({ method, path }) => ({ method, path })),
);

const defaults = providerMap(UnifiedReaderModule.forRoot().providers ?? []);
assert.equal(
  defaults.get(U0_FULL_PACKAGE_VALIDATOR).useClass.name,
  'UnconfiguredU0FullPackageValidatorAdapter',
);
assert.equal(
  defaults.get(UNIFIED_ARTIFACT_STORE).useClass.name,
  'UnconfiguredUnifiedArtifactStoreAdapter',
);
assert.equal(
  defaults.get(IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER).useClass.name,
  'UnconfiguredImmutableAcceptanceReceiptOwnerAdapter',
);
assert.equal(
  defaults.get(AEO_SPECIALIST_READER).useClass.name,
  'UnconfiguredAeoSpecialistReaderAdapter',
);
assert.deepEqual(defaults.get(UNIFIED_READER_HOST_BINDING).useValue, {
  mode: 'DEFAULT_UNCONFIGURED',
  artifactStoreConfigured: false,
  fullU0ValidatorConfigured: false,
  immutableAcceptanceReceiptOwnerConfigured: false,
  aeoSpecialistReaderConfigured: false,
  authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
});

const fakeArtifactStore = { role: 'test-artifact-store' };
const fakeAeoReader = { role: 'test-aeo-reader' };
const fakeFullValidator = { role: 'test-u0-full-validator' };
const configured = providerMap(
  UnifiedReaderModule.forRoot({
    artifactStoreProvider: {
      provide: UNIFIED_ARTIFACT_STORE,
      useValue: fakeArtifactStore,
    },
    fullU0ValidatorProvider: {
      provide: U0_FULL_PACKAGE_VALIDATOR,
      useValue: fakeFullValidator,
    },
    immutableAcceptanceReceiptOwnerProvider: receiptOwnerProvider,
    aeoSpecialistReaderProvider: {
      provide: AEO_SPECIALIST_READER,
      useValue: fakeAeoReader,
    },
  }).providers ?? [],
);
assert.equal(configured.get(UNIFIED_ARTIFACT_STORE).useValue, fakeArtifactStore);
assert.equal(
  configured.get(U0_FULL_PACKAGE_VALIDATOR).useValue,
  fakeFullValidator,
);
assert.equal(
  configured.get(IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER).useValue,
  fakeReceiptOwner,
);
assert.equal(configured.get(AEO_SPECIALIST_READER).useValue, fakeAeoReader);
assert.deepEqual(configured.get(UNIFIED_READER_HOST_BINDING).useValue, {
  mode: 'HOST_CONFIGURED',
  artifactStoreConfigured: true,
  fullU0ValidatorConfigured: true,
  immutableAcceptanceReceiptOwnerConfigured: true,
  aeoSpecialistReaderConfigured: true,
  authority: 'COMPOSITION_STATE_NOT_ACTIVATION_NOT_WRITE_AUTHORIZATION',
});
assert.throws(
  () =>
    UnifiedReaderModule.forRoot({
      artifactStoreProvider: { provide: 'WRONG_TOKEN', useValue: {} },
    }),
  /UNIFIED_ARTIFACT_STORE_PROVIDER_INVALID/u,
);
const defaultContext = await NestFactory.createApplicationContext(
  UnifiedReaderModule.forRoot({ imports: [NoIoFileServiceModule] }),
  { logger: ['error'], abortOnError: false },
);
const defaultReadiness = defaultContext.get(UnifiedReaderService).readiness();
assert.equal(defaultReadiness.capabilities.artifactStoreConfigured, false);
assert.equal(defaultReadiness.capabilities.fullU0ValidatorConfigured, false);
assert.equal(
  defaultReadiness.capabilities.immutableAcceptanceReceiptOwnerConfigured,
  false,
);
assert.equal(
  defaultReadiness.capabilities.aeoSpecialistReaderConfigured,
  false,
);
assert.ok(
  defaultReadiness.blockers.includes('UNIFIED_ARTIFACT_STORE_NOT_CONFIGURED'),
);
assert.ok(
  defaultReadiness.blockers.includes('U0_FULL_VALIDATOR_NOT_CONFIGURED'),
);
assert.ok(
  defaultReadiness.blockers.includes(
    'IMMUTABLE_ACCEPTANCE_RECEIPT_OWNER_NOT_CONFIGURED',
  ),
);
assert.ok(
  defaultReadiness.blockers.includes('AEO_SPECIALIST_READER_NOT_CONFIGURED'),
);
await defaultContext.close();

const configuredContext = await NestFactory.createApplicationContext(
  UnifiedReaderModule.forRoot({
    imports: [NoIoFileServiceModule],
    artifactStoreProvider: {
      provide: UNIFIED_ARTIFACT_STORE,
      useValue: fakeArtifactStore,
    },
    fullU0ValidatorProvider: {
      provide: U0_FULL_PACKAGE_VALIDATOR,
      useValue: fakeFullValidator,
    },
    immutableAcceptanceReceiptOwnerProvider: receiptOwnerProvider,
    aeoSpecialistReaderProvider: {
      provide: AEO_SPECIALIST_READER,
      useValue: fakeAeoReader,
    },
  }),
  { logger: ['error'], abortOnError: false },
);
const configuredReadiness = configuredContext
  .get(UnifiedReaderService)
  .readiness();
assert.equal(configuredReadiness.capabilities.artifactStoreConfigured, true);
assert.equal(configuredReadiness.capabilities.fullU0ValidatorConfigured, true);
assert.equal(
  configuredReadiness.capabilities.immutableAcceptanceReceiptOwnerConfigured,
  true,
);
assert.equal(
  configuredReadiness.capabilities.aeoSpecialistReaderConfigured,
  true,
);
assert.ok(
  configuredReadiness.blockers.includes('CANONICAL_ROLE_UNRESOLVED'),
);
assert.ok(
  configuredReadiness.blockers.includes(
    'HOSTED_CANONICAL_RUNTIME_UNVERIFIED',
  ),
);
await configuredContext.close();
assert.throws(
  () =>
    UnifiedReaderModule.forRoot({
      aeoSpecialistReaderProvider: {
        provide: Symbol('wrong-token'),
        useValue: {},
      },
    }),
  /AEO_SPECIALIST_READER_PROVIDER_INVALID/u,
);
for (const key of [
  'onlineWritesAuthorized',
  'applicationPublishAuthorized',
  'currentSwitchAuthorized',
  'canonicalAcceptanceAuthorized',
]) {
  assert.equal(manifest.validation[key], false);
}

console.log(
  JSON.stringify(
    {
      status: 'passed',
      schemaVersion: manifest.schemaVersion,
      canonicalHostBinding: manifest.canonicalHost.exactObjectBinding,
      defaultMode:
        defaults.get(UNIFIED_READER_HOST_BINDING).useValue.mode,
      configuredMode:
        configured.get(UNIFIED_READER_HOST_BINDING).useValue.mode,
      defaultNestContextReadiness: defaultReadiness.status,
      configuredNestContextReadiness: configuredReadiness.status,
      sharedAeoPortToken: AEO_SPECIALIST_READER_PORT,
      specialistBridgeFactory:
        manifest.ports.aeoSpecialistReader.bridgeFactory,
      httpRoutes: routes,
      genericFallbackAllowed:
        manifest.acceptanceFacade.genericFallbackAllowed,
      canonicalAcceptanceAuthorized:
        manifest.validation.canonicalAcceptanceAuthorized,
      authority: manifest.authority,
    },
    null,
    2,
  ),
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
