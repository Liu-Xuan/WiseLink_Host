// Isolated local HTTP fixture. Production components and API validation remain in use.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { libraryDocuments, libraryMetadata, libraryQuicklook, libraryTasks } = require('../../unit/fixtures/canonical-library.ts');
const { libraryMatterFixture, libraryMatterRows } = require('../../unit/fixtures/library-matter.ts');
const root = dirname(fileURLToPath(import.meta.url)), host = resolve(root, '../../..');
const calls = [], denied = new Set();
let version = 2;
const catalog = libraryDocuments(Array.from({ length: 24 }, (_, index) => `fixture-${String(index).padStart(2, '0')}`));
for (const [index, document] of catalog.items.entries()) {
  for (const entry of document.versions) {
    entry.readerWorkItemId = `WI-${entry.documentVersionId}`;
    entry.extractedMetadata = libraryMetadata('32-10', '737-800');
    entry.extractedMetadata.title.observations[0].value = `本地样本 ${index + 1}：起落架收放系统检查与维护条件`;
  }
}
catalog.ataCounts = { '32-10': 24 }; catalog.aircraftModelCounts = { '737-800': 24 };
const rows = Array.from({ length: 24 }, (_, index) => ({ ...libraryMatterRows()[0],
  matterId: `fixture-matter-${index}`, title: `本地样本 ${index + 1}：起落架检查的构型与条件核查`,
}));
const vite = await createViteServer({ configFile: false, root, publicDir: resolve(host, 'client/public'),
  server: { middlewareMode: true, hmr: { port: 8788 }, fs: { allow: [host] } }, appType: 'spa',
  esbuild: { jsx: 'automatic' },
  define: { 'process.env': JSON.stringify({ NODE_ENV: 'development' }), __WISELINK_SOURCE_COMMIT__: JSON.stringify('LOCAL_COMPONENT_FIXTURE'),
    __WISELINK_BUILD_TIME__: JSON.stringify('2026-10-15'), __WISELINK_VISUAL_VERSION__: JSON.stringify('C269') },
  resolve: { alias: [
    { find: '@lark-apaas/client-toolkit/utils/getAxiosForBackend', replacement: resolve(root, 'transport.ts') },
    { find: '@lark-apaas/client-toolkit/auth', replacement: resolve(root, 'transport.ts') },
    { find: '@client', replacement: resolve(host, 'client') },
    { find: '@shared', replacement: resolve(host, 'shared') },
    { find: '@', replacement: resolve(host, 'client/src') },
  ] },
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/') && url.pathname !== '/fixture-control')
    return vite.middlewares(req, res);
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/fixture-control') {
    if (url.searchParams.get('action') === 'deny-documents') denied.add('documents');
    if (url.searchParams.get('action') === 'allow') denied.clear();
    if (url.searchParams.get('action') === 'version') version++;
    return res.end(JSON.stringify({ testingOnly: true, calls, version, denied: [...denied] }));
  }
  calls.push({ path: url.pathname, query: url.search, method: req.method, time: performance.now() });
  if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ code: 'TEST_READ_ONLY' })); }
  if (url.pathname.endsWith('/identity-context')) return res.end(JSON.stringify({
    userId: 'local-fixture-reader', tenantId: 'local-fixture-tenant', appId: 'local-fixture-app',
    developmentIntakeAvailable: false,
  }));
  if (url.pathname.endsWith('/fleet-catalog')) return res.end(JSON.stringify({
    scope: 'CURRENT_TENANT_ACTIVE_FLEET', status: 'AVAILABLE', asOf: '2026-10-15', source: null,
    families: [{ fleetFamily: '737NG', models: ['737-800', '737-700'] }], unclassifiedAssetCount: 0,
    semantics: 'DOCUMENT_MENTION_CLASSIFICATION_ONLY',
  }));
  if (url.pathname.endsWith('/library/directory')) {
    const parent = url.searchParams.get('ata2');
    const values = parent ? [`${parent}-10`, `${parent}-20`] : Array.from({ length: 25 }, (_, index) => String(index + 21));
    return res.end(JSON.stringify({ scope: 'TENANT_DOCUMENT_CATALOG', level: parent ? 'ATA4' : 'ATA2',
      documentCount: 24, versionCount: 48, directDocumentCount: 0, directVersionCount: 0,
      nodes: values.map(value => ({ value, level: parent ? 'ATA4' : 'ATA2', documentCount: 24, versionCount: 48,
        directDocumentCount: 0, directVersionCount: 0, rawValues: [value], hasChildren: !parent })) }));
  }
  if (url.pathname.endsWith('/library/documents')) {
    if (denied.has('documents')) { res.statusCode = 403; return res.end(JSON.stringify({ code: 'TEST_REVOKED' })); }
    const response = structuredClone(catalog);
    response.items[0].versions[0].businessRevision = `R${version}`;
    const search = url.searchParams.get('search');
    if (search) response.items = response.items.filter(document => document.familyId.includes(search));
    return res.end(JSON.stringify(response));
  }
  if (url.pathname.endsWith('/library/tasks')) return res.end(JSON.stringify(libraryTasks(['WI-fixture'])));
  if (url.pathname.endsWith('/quicklook')) {
    const workItemId = decodeURIComponent(url.pathname.split('/').at(-2));
    const response = libraryQuicklook(workItemId);
    const selected = catalog.items.find(document => document.versions.some(entry => entry.readerWorkItemId === workItemId));
    const selectedVersion = selected?.versions.find(entry => entry.readerWorkItemId === workItemId);
    if (selected && selectedVersion) Object.assign(response.document, { familyId: selected.familyId,
      documentVersionId: selectedVersion.documentVersionId, documentCode: selected.documentCode });
    return res.end(JSON.stringify(response));
  }
  if (url.pathname.endsWith('/engineering-matters')) {
    const search = url.searchParams.get('search') ?? '';
    return res.end(JSON.stringify({ items: rows.filter(row => row.title.includes(search)), nextCursor: null, fileReadPerformed: false }));
  }
  if (url.pathname.includes('/engineering-matters/')) {
    const id = decodeURIComponent(url.pathname.split('/')[4]);
    const data = libraryMatterFixture();
    data.matter.matterId = id; data.matter.title = rows.find(row => row.matterId === id)?.title ?? id;
    data.working.matterId = id; data.working.current.matterId = id;
    data.working.current.state.substantiveResult.scope.matterId = id;
    return res.end(JSON.stringify(url.pathname.endsWith('/working') ? data.working : data.matter));
  }
  res.statusCode = 404; res.end(JSON.stringify({ code: 'LOCAL_FIXTURE_PATH_NOT_CONFIGURED' }));
});
const port = Number(process.env.LIBRARY_FIXTURE_PORT ?? 8789);
server.listen(port, '127.0.0.1', () => process.stdout.write(`Local-only library fixture: http://127.0.0.1:${port}/library?mode=document\n`));
process.on('SIGINT', async () => { server.close(); await vite.close(); process.exit(0); });
