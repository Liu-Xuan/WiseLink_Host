import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import vm from 'node:vm';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  assertNativeClientRoute, createNativeTransport, createBoundNativeTransport,
  readOriginalBlob, validateNativeTransportConfig, validateReceiverBinding,
} from '../../server/modules/tdms-source/tdms-native-host-transport.mjs';

const digest = 'a'.repeat(64);
const requestId = `TDMSIMPORT-${digest}`;
const bindingId = `TDMSBIND-${'b'.repeat(64)}`;
const sourceRef = `TDMS:SNAPSHOT:TDMSSNAP-${'c'.repeat(64)}`;
const receiver = () => ({
  schemaVersion: 'wiselink.tdms-native-host-receiver-binding.v1', receiverId: 'synthetic-receiver',
  tenantRef: 'synthetic-tenant', applicationRef: 'app_17bzc551rsg', principalRef: 'synthetic-user',
  sourceSystem: 'TDMS', sourceInstanceRef: 'synthetic-source', authorityRevision: 'synthetic-revision-1',
  authorityEvidenceRef: 'synthetic-authority-proof', sessionEvidenceRef: 'synthetic-session-1',
  observedAt: '2026-01-01T00:00:00.000Z',
});
const unavailable = () => Object.assign(new Error('unavailable'),
  { code: 'TDMS_UPLOAD_SELECTION_UNAVAILABLE', statusCode: 404 });

async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'wl-native-transport-test-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('configuration has no actor, credential, external endpoint or relative source fallback', () => {
  const config = { schemaVersion: 'wiselink.tdms-native-host-transport-config.v1',
    chromeDevtoolsEndpoint: 'http://127.0.0.1:9222', sourceStateDirectory: '/synthetic-state' };
  assert.equal(validateNativeTransportConfig(config).chromeDevtoolsEndpoint, 'http://127.0.0.1:9222');
  for (const changed of [{ chromeDevtoolsEndpoint: 'http://example.com:9222' },
    { chromeDevtoolsEndpoint: 'http://user:password@127.0.0.1:9222' },
    { chromeDevtoolsEndpoint: 'http://127.0.0.1:9222/other' },
    { sourceStateDirectory: 'relative' }, { actor: 'synthetic-other-user' }, { cookie: 'never-used' }])
    assert.throws(() => validateNativeTransportConfig({ ...config, ...changed }));
});

test('receiver requires exact Host binding and keeps authority/session distinct', () => {
  assert.equal(validateReceiverBinding(receiver()).principalRef, 'synthetic-user');
  assert.throws(() => validateReceiverBinding({ ...receiver(), applicationRef: 'other-app' }));
  assert.throws(() => validateReceiverBinding({ ...receiver(), unexpectedGrant: true }));
  const missingSession = receiver(); delete missingSession.sessionEvidenceRef;
  assert.throws(() => validateReceiverBinding(missingSession));
});

test('only the three frozen client routes are exposed and GET cannot mutate', () => {
  assertNativeClientRoute('/api/tdms-source-imports', 'POST');
  assertNativeClientRoute(`/api/tdms-source-imports/${requestId}`, 'GET');
  assertNativeClientRoute(`/api/tdms-source-refs?sourceRef=${encodeURIComponent(sourceRef)}`, 'GET');
  for (const [route, method] of [['/api/identity/whoami', 'GET'],
    ['//evil.example/api/tdms-source-imports', 'POST'], ['/api/../admin', 'GET'],
    ['/api/tdms-source-imports?actor=user', 'POST'],
    [`/api/tdms-source-refs?sourceRef=${sourceRef}&sourceRef=${sourceRef}`, 'GET'],
    [`/api/tdms-source-imports/${requestId}`, 'POST']])
    assert.throws(() => assertNativeClientRoute(route, method));
});

test('retained staged candidate needs no local original and never becomes formal DVI', async () => {
  const artifact = { bindingId, blobSha256: 'd'.repeat(64), byteLength: 9 };
  const pkg = { packageId: 'synthetic-package', artifactBindings: [artifact] };
  const operations = [];
  const transport = createBoundNativeTransport({ sourceStateDirectory: '/does-not-exist' }, async input => {
    operations.push(input.operation);
    if (input.operation === 'RECEIVER') return receiver();
    assert.deepEqual(input.expectedReceiverBinding, receiver());
    if (input.operation === 'PREFLIGHT') return { requestId, bindingId, receiverId: receiver().receiverId,
      payloadDigest: digest, status: 'AUTHORIZED_UPLOAD' };
    if (input.operation === 'FIND_STAGE') return { requestId, bindingId, receiverId: receiver().receiverId,
      packageId: pkg.packageId, payloadDigest: digest, status: 'STAGED_CANDIDATE',
      sha256: artifact.blobSha256, byteLength: artifact.byteLength, readbackVerified: true, documentVersionId: null };
    if (input.operation === 'REQUEST') return { synthetic: 'retained-source-receipt' };
    throw new Error('Unexpected original upload');
  });
  assert.deepEqual(await transport.request('/api/tdms-source-imports', { method: 'POST', body: { requestId, package: pkg } }),
    { synthetic: 'retained-source-receipt' });
  assert.deepEqual(operations, ['RECEIVER', 'PREFLIGHT', 'FIND_STAGE', 'REQUEST']);
});

test('exact member admission precedes local bytes and external original transport', async () => {
  const operations = [];
  const transport = createBoundNativeTransport({ sourceStateDirectory: '/does-not-exist' }, async input => {
    operations.push(input.operation);
    if (input.operation === 'RECEIVER') return receiver();
    throw Object.assign(new Error('denied'), { code: 'TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED', statusCode: 403 });
  });
  await assert.rejects(transport.request('/api/tdms-source-imports', { method: 'POST', body: {
    requestId, package: { artifactBindings: [{ bindingId, blobSha256: 'd'.repeat(64), byteLength: 9 }] },
  } }), error => error.statusCode === 403);
  assert.deepEqual(operations, ['RECEIVER', 'PREFLIGHT']);
});

test('original CAS bytes are hash/length/owner pinned and do not follow an escaping symlink', async () => fixture(async directory => {
  const bytes = Buffer.from('synthetic original PDF bytes');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const folder = path.join(directory, 'blobs', hash.slice(0, 2));
  await mkdir(folder, { recursive: true });
  const filename = path.join(folder, hash);
  await writeFile(filename, bytes);
  assert.deepEqual(await readOriginalBlob(directory, { blobSha256: hash, byteLength: bytes.length }), bytes);
  await writeFile(filename, Buffer.alloc(bytes.length, 0));
  await assert.rejects(readOriginalBlob(directory, { blobSha256: hash, byteLength: bytes.length }),
    error => error.code === 'TDMS_NATIVE_ORIGINAL_IDENTITY_CHANGED');
  await rm(filename); await symlink(path.join(directory, 'missing'), filename);
  await assert.rejects(readOriginalBlob(directory, { blobSha256: hash, byteLength: bytes.length }));
}));

test('a newly staged original preserves the unchanged package and exact candidate binding', async () => fixture(async directory => {
  const bytes = Buffer.from('synthetic original');
  const sha = createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.join(directory, 'blobs', sha.slice(0, 2)), { recursive: true });
  await writeFile(path.join(directory, 'blobs', sha.slice(0, 2), sha), bytes);
  const artifact = { bindingId, blobSha256: sha, byteLength: bytes.length };
  const pkg = { packageId: 'synthetic-pkg', artifactBindings: [artifact], untouched: { version: null } };
  let postCount = 0, stageCount = 0;
  const transport = createBoundNativeTransport({ sourceStateDirectory: directory }, async input => {
    if (input.operation === 'RECEIVER') return receiver();
    assert.deepEqual(input.expectedReceiverBinding, receiver());
    if (input.operation === 'PREFLIGHT') return { requestId, bindingId, receiverId: receiver().receiverId,
      payloadDigest: digest, status: 'AUTHORIZED_UPLOAD' };
    if (input.operation === 'FIND_STAGE') throw unavailable();
    if (input.operation === 'STAGE') {
      stageCount++; assert.equal(input.package, pkg); assert.equal(input.bytesBase64, bytes.toString('base64'));
      return { status: 'STAGED_CANDIDATE', requestId, bindingId, receiverId: receiver().receiverId,
        packageId: pkg.packageId, payloadDigest: digest, sha256: sha, byteLength: bytes.length,
        readbackVerified: true, documentVersionId: null };
    }
    postCount++; assert.equal(input.body.package, pkg); return { imported: true };
  });
  await transport.request('/api/tdms-source-imports', { method: 'POST', body: { requestId, package: pkg } });
  assert.equal(stageCount, 1); assert.equal(postCount, 1);
}));

test('authority revocation after an unavailable lookup stops before CAS bytes or STAGE', async () => {
  const operations = [];
  let revoked = false;
  const transport = createBoundNativeTransport({ sourceStateDirectory: '/must-not-be-read' }, async input => {
    operations.push(input.operation);
    if (input.operation === 'RECEIVER') return revoked
      ? { ...receiver(), authorityRevision: 'synthetic-revision-2' } : receiver();
    if (input.operation === 'PREFLIGHT') return { requestId, bindingId, receiverId: receiver().receiverId,
      payloadDigest: digest, status: 'AUTHORIZED_UPLOAD' };
    if (input.operation === 'FIND_STAGE') { revoked = true; throw unavailable(); }
    throw new Error('Revoked member must not reach STAGE or import');
  });
  await assert.rejects(transport.request('/api/tdms-source-imports', { method: 'POST', body: {
    requestId, package: { artifactBindings: [{ bindingId, blobSha256: 'd'.repeat(64), byteLength: 9 }] },
  } }), error => error.code === 'TDMS_NATIVE_RECEIVER_CHANGED' && error.statusCode === 409);
  assert.deepEqual(operations, ['RECEIVER', 'PREFLIGHT', 'FIND_STAGE', 'RECEIVER']);
});

test('an unrelated 404 never authorizes fresh local bytes or STAGE', async () => {
  const operations = [];
  const transport = createBoundNativeTransport({ sourceStateDirectory: '/must-not-be-read' }, async input => {
    operations.push(input.operation);
    if (input.operation === 'RECEIVER') return receiver();
    if (input.operation === 'PREFLIGHT') return { requestId, bindingId, receiverId: receiver().receiverId,
      payloadDigest: digest, status: 'AUTHORIZED_UPLOAD' };
    throw Object.assign(new Error('source unavailable'), { code: 'TDMS_SOURCE_NOT_FOUND', statusCode: 404 });
  });
  await assert.rejects(transport.request('/api/tdms-source-imports', { method: 'POST', body: {
    requestId, package: { artifactBindings: [{ bindingId, blobSha256: 'd'.repeat(64), byteLength: 9 }] },
  } }), error => error.code === 'TDMS_SOURCE_NOT_FOUND');
  assert.deepEqual(operations, ['RECEIVER', 'PREFLIGHT', 'FIND_STAGE']);
});

test('a changed receiver/session stops before POST and never silently rebinds', async () => {
  let observed = 0, posts = 0;
  const transport = createBoundNativeTransport({}, async input => {
    if (input.operation === 'RECEIVER') return { ...receiver(), sessionEvidenceRef: `synthetic-session-${++observed}` };
    posts++; return {};
  });
  await transport.currentReceiverBinding();
  await assert.rejects(transport.request('/api/tdms-source-imports',
    { method: 'POST', body: { requestId, package: { artifactBindings: [] } } }),
  error => error.code === 'TDMS_NATIVE_RECEIVER_CHANGED');
  assert.equal(posts, 0);
});

test('the actual POST carries the original full condition when identity switches within one request', async () => {
  let writes = 0, requests = 0;
  const original = receiver();
  const transport = createBoundNativeTransport({}, async input => {
    if (input.operation === 'RECEIVER') return original;
    assert.equal(input.operation, 'REQUEST');
    requests++;
    assert.deepEqual(input.expectedReceiverBinding, original);
    // Synthetic Host-side condition, changed after the preliminary read. The
    // transport must not omit this pin or silently use the current identity.
    const actual = { ...original, principalRef: 'synthetic-user-B', sessionEvidenceRef: 'synthetic-session-B' };
    if (input.expectedReceiverBinding.principalRef !== actual.principalRef)
      throw Object.assign(new Error('changed'), { code: 'TDMS_RECEIVER_IDENTITY_CHANGED', statusCode: 409 });
    writes++;
    return { imported: true };
  });
  await assert.rejects(transport.request('/api/tdms-source-imports', { method: 'POST',
    body: { requestId, package: { artifactBindings: [] } } }),
  error => error.code === 'TDMS_RECEIVER_IDENTITY_CHANGED' && error.statusCode === 409);
  assert.equal(requests, 1); assert.equal(writes, 0);
});

test('no-argument factory uses actual local CDP HTTP/WebSocket framing; lost POST is read back once', async () => fixture(async directory => {
  // The page and authority below are synthetic. This verifies the actual native
  // transport mechanics, not a production login, Source grant or Host receipt.
  let posts = 0, reads = 0, sockets = 0;
  const server = createServer((req, res) => {
    assert.equal(req.url, '/json/list');
    const port = server.address().port;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify([{ id: 'syntheticPage', type: 'page',
      url: 'https://hv5zjf4j8yb.feishuapp.com/app/app_17bzc551rsg/library',
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/syntheticPage` }]));
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', socket => {
    sockets++;
    socket.on('message', async data => {
      const command = JSON.parse(String(data));
      assert.equal(command.method, 'Runtime.evaluate');
      let drop = false;
      const value = await vm.runInNewContext(command.params.expression, {
        location: { origin: 'https://hv5zjf4j8yb.feishuapp.com', pathname: '/app/app_17bzc551rsg/library' },
        window: { __wiselinkTdmsNativeBridge: { schemaVersion: 'wiselink.tdms-native-host-bridge.v1',
          async invoke(input) {
            if (input.operation === 'RECEIVER') return receiver();
            assert.equal(input.operation, 'REQUEST');
            assert.deepEqual(JSON.parse(JSON.stringify(input.expectedReceiverBinding)), receiver());
            if (input.method === 'POST') { posts++; drop = true; return { saved: true }; }
            reads++; return { saved: true, requestId };
          } } },
      });
      if (drop) { socket.close(); return; }
      socket.send(JSON.stringify({ id: command.id, result: { result: { value } } }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const configFile = path.join(directory, 'config.json');
  await writeFile(configFile, JSON.stringify({ schemaVersion: 'wiselink.tdms-native-host-transport-config.v1',
    chromeDevtoolsEndpoint: `http://127.0.0.1:${server.address().port}`, sourceStateDirectory: directory }), { mode: 0o600 });
  const old = process.env.WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG;
  process.env.WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG = configFile;
  try {
    const transport = await createNativeTransport();
    assert.equal(transport.evidence.mode, 'AUTHENTICATED_NATIVE_SESSION');
    await assert.rejects(transport.request('/api/tdms-source-imports', { method: 'POST',
      body: { requestId, package: { artifactBindings: [] } } }),
    error => error.code === 'TDMS_HOST_RECEIPT_UNKNOWN');
    assert.equal(posts, 1);
    assert.deepEqual(await transport.request(`/api/tdms-source-imports/${requestId}`, { method: 'GET' }),
      { saved: true, requestId });
    assert.equal(posts, 1); assert.equal(reads, 1); assert.ok(sockets >= 4);
  } finally {
    if (old === undefined) delete process.env.WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG;
    else process.env.WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG = old;
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
}));
