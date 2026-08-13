import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleRoot = join(
  root,
  'dist/server/modules/document-management/src/hosted/nest',
);
const hosted = await import(pathToFileURL(join(moduleRoot, 'index.js')));

assert.throws(
  () => hosted.DocumentManagementHostedModule.register({}),
  /requires a server-bound authorizerProvider/u,
);
assert.throws(
  () =>
    hosted.DocumentManagementHostedModule.register({
      authorizerProvider: { provide: 'WRONG_TOKEN', useValue: {} },
    }),
  /must bind DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER/u,
);

const configured = hosted.DocumentManagementHostedModule.register({
  authorizerProvider: {
    provide: hosted.DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
    useClass: hosted.UnconfiguredDocumentManagementIngestAuthorizer,
  },
});
const configuredProvider = configured.providers.find(
  (provider) =>
    provider?.provide === hosted.DOCUMENT_MANAGEMENT_INGEST_AUTHORIZER,
);
assert.equal(
  configuredProvider?.useClass,
  hosted.UnconfiguredDocumentManagementIngestAuthorizer,
);
const authorizer = new hosted.UnconfiguredDocumentManagementIngestAuthorizer();
await assert.rejects(
  authorizer.assertCanIngest(),
  (error) =>
    error?.code === 'DOCUMENT_MANAGEMENT_HOST_AUTHORITY_UNCONFIGURED' &&
    error?.details?.action === 'DOCUMENT_INGEST',
);

const adapterDir = join(root, 'dist/config/document-family-adapters');
const adapterFiles = (await readdir(adapterDir)).filter((name) =>
  name.endsWith('.json'),
);
assert.equal(adapterFiles.length, 23);
for (const adapterFile of adapterFiles) {
  JSON.parse(await readFile(join(adapterDir, adapterFile), 'utf8'));
}
await access(
  join(
    root,
    'dist/server/modules/document-management/src/hosted/documentManagementHostedCore.js',
  ),
);
await access(
  join(
    root,
    'dist/server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js',
  ),
);

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  sourceOwnerCommit: 'cb5cadd940d869891e6d969ea04167c2bcbd502e',
  appId: 'app_17bzc551rsg',
  moduleLoad: 'COMMONJS_PASS',
  hostAuthorizationDefault: 'FAIL_CLOSED_BEFORE_IO',
  adapterCount: adapterFiles.length,
  onlineMutationPerformed: false,
}, null, 2)}\n`);
