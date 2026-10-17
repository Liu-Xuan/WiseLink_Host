// Local component test only: synthetic native rows, no Host/DB/model/Source requests.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
const directory = dirname(fileURLToPath(import.meta.url)), host = resolve(directory, '../../..');
process.env.TS_NODE_PROJECT = resolve(host, 'tsconfig.node.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url); require('ts-node/register/transpile-only');
const { nativeMatrixFixture, nativeSnapshotId } = require('../../unit/lcm-matrix/native-ui-fixtures.ts');
const fixture = nativeMatrixFixture(), counts = { native: 0, authorize: 0, details: 0, personal: 0, snapshots: 0 };
if (process.argv.includes('--selection-followup')) {
  const original = structuredClone(fixture);
  const models = ['B777-300ER', 'A350-900', 'ARJ21-700', 'C919-700'];
  fixture.snapshots = []; fixture.matrices = [];
  for (const [index, model] of models.entries()) {
    const id = 'abcd'[index].repeat(64), snapshot = structuredClone(original.snapshots[0]);
    Object.assign(snapshot, { snapshotId: id, coveredAircraftModels: [model], recordCount: 6,
      originalFileName: `LOCAL_构型统计_${model}_20261017090000.xls` });
    const matrix = structuredClone(original.matrices[0]);
    Object.assign(matrix, { snapshotId: id, managementDomainRef: `LOCAL_TEST_${model}` });
    matrix.matrix.aircraftModel = model; matrix.matrix.range.lastRow = 7;
    matrix.matrix.rows.push({ sourceRow: 6, fixed: ['软件空白示例', 'NONE-PN', '', '22', 'Local'],
      states: matrix.matrix.aircraft.map(() => null) },
    { sourceRow: 7, fixed: ['异常原值示例', 'INVALID-PN', '', '22', 'Local'],
      states: matrix.matrix.aircraft.map(() => 'INVALID') });
    fixture.snapshots.push(snapshot); fixture.matrices.push(matrix);
  }
}
let authorizationStatus = 200;
const hmrProbe = createServer();
await new Promise(resolve => hmrProbe.listen(0, '127.0.0.1', resolve));
const hmrPort = hmrProbe.address().port;
await new Promise(resolve => hmrProbe.close(resolve));
const vite = await createViteServer({ configFile: false, root: directory, appType: 'spa',
  publicDir: resolve(host, 'client/public'), server: { middlewareMode: true,
    hmr: { host: '127.0.0.1', port: hmrPort }, fs: { allow: [host] } },
  resolve: { alias: [
    { find: '@client/src/api/canonical-host', replacement: resolve(directory, 'api.ts') },
    { find: '@client/src/components/business-ui/api/files/service', replacement: resolve(directory, 'api.ts') },
    { find: '@client/src/app/providers/CurrentUserSessionProvider', replacement: resolve(directory, 'session.tsx') },
    { find: '@client', replacement: resolve(host, 'client') }, { find: '@shared', replacement: resolve(host, 'shared') },
    { find: '@', replacement: resolve(host, 'client/src') },
  ] },
});
const server = createServer(async (request, response) => {
  if (!request.url?.startsWith('/fixture-api/')) return vite.middlewares(request, response);
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const path = request.url.slice('/fixture-api/'.length);
    let output;
    if (path in counts) counts[path]++;
    if (path === 'native') output = fixture;
    else if (path === 'authorize') { response.statusCode = authorizationStatus; output = { binding: fixture.binding }; }
    else if (path === 'snapshots') output = { snapshots: fixture.snapshots, hasMore: false, nextAfter: null };
    else if (path === 'personal') output = { hasSource: true,
      latestSnapshotIds: fixture.snapshots.map(snapshot => snapshot.snapshotId), snapshotCount: fixture.snapshots.length };
    else if (path === 'details') output = { binding: fixture.binding, records: [], nextAfter: null, originalUnavailableReason: null };
    else if (path === 'counts') output = counts;
    else if (path === 'control') { authorizationStatus = input.authorizationStatus; output = { localTestOnly: true }; }
    else { response.statusCode = 404; output = { code: 'LOCAL_NOT_FOUND' }; }
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(output));
  } catch { response.statusCode = 500; response.end('{"code":"LOCAL_TEST_FAILED"}'); }
});
server.listen(0, '127.0.0.1', () => process.stdout.write('http://127.0.0.1:' + server.address().port +
  (process.argv.includes('--selection-followup') ? '/library?mode=lcm' : '/library?mode=lcm&lcmSnapshotId=' + nativeSnapshotId) + '\n'));
async function stop() { server.close(); await vite.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
