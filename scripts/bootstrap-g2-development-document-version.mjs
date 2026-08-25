import 'reflect-metadata';

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const importBuilt = (relativePath) =>
  import(pathToFileURL(resolve(root, 'dist/server', relativePath)));

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseHostedUser() {
  const raw = requiredEnv('SUDA_WEBUSER');
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(raw.replaceAll('\\"', '"'));
  }
}

assert.equal(process.env.NODE_ENV, 'development');
assert.equal(requiredEnv('MIAODA_LOCAL_DEV'), '1');
assert.equal(requiredEnv('FORCE_DB_BRANCH'), 'dev');
assert.equal(requiredEnv('MIAODA_APP_ID'), 'app_17bzc551rsg');

const tenantId = requiredEnv('WL_G2_DEV_TENANT_ID');
const documentProfile = requiredEnv('WL_G2_DEV_DOCUMENT_PROFILE');
assert.ok(['FTD', 'SB'].includes(documentProfile), 'WL_G2_DEV_DOCUMENT_PROFILE must be FTD or SB.');
const selection = {
  bucketId: requiredEnv('WL_G2_DEV_SELECTION_BUCKET_ID'),
  filePath: requiredEnv('WL_G2_DEV_SELECTION_FILE_PATH'),
};
const hostedUser = parseHostedUser();
const actorUserId = String(hostedUser.user_id || '').trim();
assert.ok(actorUserId, 'SUDA_WEBUSER.user_id is required.');
assert.equal(String(hostedUser.tenant_id), tenantId);
assert.equal(String(hostedUser.app_id), process.env.MIAODA_APP_ID);

const { Test } = require('@nestjs/testing');
const { PlatformModule, FileService } = require('@lark-apaas/fullstack-nestjs-core');
const { RequestContextService } = require('@lark-apaas/nestjs-common');
const [
  { DocumentManagementHostedCore },
  { MiaodaFileServiceArtifactStore },
  { MiaodaHostedDocumentCatalog },
  { PHASE5_737_34_3830_HANDOFF },
] = await Promise.all([
  importBuilt('modules/document-management/src/hosted/documentManagementHostedCore.js'),
  importBuilt('modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js'),
  importBuilt('modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.js'),
  importBuilt('modules/document-management/src/hosted/phase5BoeingSbHandoff.js'),
]);

const expected = documentProfile === 'SB'
  ? {
      sourceSha256: PHASE5_737_34_3830_HANDOFF.source.sha256,
      sourceByteLength: PHASE5_737_34_3830_HANDOFF.source.byteLength,
      documentId: PHASE5_737_34_3830_HANDOFF.catalogIdentity.documentId,
      documentVersionId:
        PHASE5_737_34_3830_HANDOFF.catalogIdentity.documentVersionId,
      descriptor: structuredClone(PHASE5_737_34_3830_HANDOFF.descriptor),
      idempotencyKey:
        'g2-isolated-dev:01a02f83-5a1b-7990-af79-9ff0437793f9:sb-737-34-3830-original',
    }
  : {
      sourceSha256:
        'b1b5c198df4a3d42925218f48d70ddc361563c65692be35dac4c81e0d8367a3c',
      sourceByteLength: 122_102,
      documentId: 'document_3943d8eb5b7c7ee8fc742092',
      documentVersionId: 'document_version_fd88dcb9cf64cf3ba21033ef',
      descriptor: {},
      idempotencyKey:
        'g2-isolated-dev:01a02f83-5a1b-7990-af79-9ff0437793f9:ftd-09262025',
    };

const moduleRef = await Test.createTestingModule({
  imports: [PlatformModule.forRoot()],
  providers: [MiaodaHostedDocumentCatalog],
}).compile();

let initialized = false;
let primaryError;
try {
  await moduleRef.init();
  initialized = true;
  const fileService = moduleRef.get(FileService, { strict: false });
  const requestContext = moduleRef.get(RequestContextService, { strict: false });
  const catalog = moduleRef.get(MiaodaHostedDocumentCatalog, { strict: false });
  const authorizer = {
    async assertCanIngest(input) {
      assert.equal(input.actorUserId, actorUserId);
      assert.equal(input.tenantId, tenantId);
      assert.equal(input.action, 'DOCUMENT_INGEST');
      assert.deepEqual(input.selection, selection);
    },
    async assertCanRead() {
      throw new Error('G2 development bootstrap does not authorize catalog reads.');
    },
  };
  const core = new DocumentManagementHostedCore({
    artifactStore: new MiaodaFileServiceArtifactStore(fileService),
    catalog,
    authorizer,
  });
  const result = await requestContext.run(
    {
      appId: process.env.MIAODA_APP_ID,
      tenantId,
      userId: actorUserId,
      isSystemAccount: false,
    },
    () => core.ingestFileServiceSelection(
      {
        sourceChannel: 'g2_isolated_development_fixture',
        sourceRef: `miaoda-file-service:${selection.bucketId}:${selection.filePath}`,
        selection,
        descriptor: expected.descriptor,
        idempotencyKey: expected.idempotencyKey,
      },
      {
        actorUserId,
        tenantId,
        roles: ['g2-development-resource-owner'],
      },
    ),
  );

  assert.equal(result.documentId, expected.documentId);
  assert.equal(result.documentVersionId, expected.documentVersionId);
  assert.equal(result.catalogFreshReadVerified, true);
  const freshVersion = await catalog.readDocumentVersion(result.documentVersionId);
  const freshFamily = await catalog.readFamily(freshVersion?.familyId);
  assert.equal(freshVersion?.pdfSha256, expected.sourceSha256);
  assert.equal(Number(freshVersion?.byteLength), expected.sourceByteLength);
  assert.equal(freshFamily?.currentDocumentVersionId, expected.documentVersionId);

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'wiselink.g2_development_document_bootstrap.v1',
    environment: 'dev',
    documentProfile,
    disposition: result.disposition,
    documentId: result.documentId,
    documentVersionId: result.documentVersionId,
    sourceSha256: freshVersion.pdfSha256,
    sourceByteLength: Number(freshVersion.byteLength),
    newDocumentVersionCreated: result.newDocumentVersionCreated,
    currentnessChanged: result.currentnessChanged,
    catalogFreshReadVerified: result.catalogFreshReadVerified,
  })}\n`);
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  if (initialized) {
    try {
      await moduleRef.close();
    } catch (closeError) {
      const knownPlatformProxyShutdown =
        closeError instanceof Error
        && closeError.message === 'Database not initialized. Call initialize() first.';
      if (!primaryError && !knownPlatformProxyShutdown) throw closeError;
    }
  }
}
