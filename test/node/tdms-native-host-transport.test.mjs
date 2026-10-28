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

const hostPage = targetId => ({ targetId, type: 'page',
  url: 'https://hv5zjf4j8yb.feishuapp.com/app/app_17bzc551rsg/library' });
async function browserPeer(run, options = {}) {
  await fixture(async directory => {
    const commands = [], operations = [], clients = new Set(); let httpCalls = 0;
    const server = createServer((_req, res) => { httpCalls++; res.writeHead(500); res.end('HTTP discovery forbidden'); });
    const wss = new WebSocketServer({ server });
    wss.on('connection', socket => {
      clients.add(socket);
      socket.on('close', () => clients.delete(socket));
      socket.on('message', async data => {
        const c = JSON.parse(String(data)); commands.push(c);
        const reply = (result, sessionId = c.sessionId) => socket.send(JSON.stringify({id:c.id,
          ...(sessionId === undefined ? {} : {sessionId}), result}));
        if (c.method === 'Target.getTargets') { reply({targetInfos:options.targets ?? [hostPage('pageA')]},options.controlSession); return; }
        if (c.method === 'Target.attachToTarget') {
          if (options.attachError) socket.send(JSON.stringify({id:c.id,error:{code:-32000,message:'synthetic attach failed'}}));
          else if (options.attachClose) socket.close();
          else if (options.badSession) reply({sessionId:42});
          else reply({sessionId:'sessionA'});
          return;
        }
        if (c.method === 'Target.detachFromTarget') {
          if(options.detachError) socket.send(JSON.stringify({id:c.id,error:{code:-32000,message:'synthetic detach failure'}}));
          else if(options.detachSession) reply({},'otherSession');
          else reply({}); return;
        }
        assert.equal(c.method, 'Runtime.evaluate'); assert.equal(c.sessionId, 'sessionA');
        assert.equal(c.params.awaitPromise,true); assert.equal(c.params.returnByValue,true); assert.equal(c.params.timeout,40_000);
        const value = await vm.runInNewContext(c.params.expression, {
          location:{origin:options.pageOrigin ?? 'https://hv5zjf4j8yb.feishuapp.com',pathname:'/app/app_17bzc551rsg/library'},
          window:{__wiselinkTdmsNativeBridge:{schemaVersion:'wiselink.tdms-native-host-bridge.v1',invoke:async input => {
            operations.push(input);
            return options.invoke ? options.invoke(input, socket) : input.operation === 'RECEIVER' ? receiver() : {saved:true,requestId};
          }}},
        });
        if (options.drop?.(operations.at(-1),socket)) return;
        if (options.malformedReply) socket.send('null');
        else if (options.wrongSession) reply({result:{value}},'otherSession');
        else reply({result:{value}});
      });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const filename = path.join(directory,'config.json');
    await writeFile(filename,JSON.stringify({schemaVersion:'wiselink.tdms-native-host-transport-config.v1',
      chromeDevtoolsEndpoint:`ws://127.0.0.1:${server.address().port}/devtools/browser/syntheticBrowser`,
      sourceStateDirectory:directory,...(options.targetId ? {targetId:options.targetId} : {})}),{mode:0o600});
    const old = process.env.WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG;
    process.env.WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG=filename;
    const waitClosed = () => Promise.all([...clients].map(socket=>new Promise(resolve=>socket.once('close',resolve))));
    try { await run({commands,operations,clients,directory,create:createNativeTransport,waitClosed}); assert.equal(httpCalls,0); }
    finally {
      if(old===undefined) delete process.env.WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG; else process.env.WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG=old;
      for(const socket of wss.clients) socket.terminate();
      await new Promise(resolve=>wss.close(resolve)); await new Promise(resolve=>server.close(resolve));
    }
  });
}

test('explicit browser WebSocket configuration accepts only exact loopback authority/port/browser path', () => {
  const config = {schemaVersion:'wiselink.tdms-native-host-transport-config.v1',sourceStateDirectory:'/synthetic-state'};
  for(const host of ['127.0.0.1','[::1]','localhost'])
    assert.equal(validateNativeTransportConfig({...config,chromeDevtoolsEndpoint:`ws://${host}:9222/devtools/browser/synthetic-id`}).chromeDevtoolsEndpoint,
      `ws://${host}:9222/devtools/browser/synthetic-id`);
  for(const endpoint of ['wss://localhost:9222/devtools/browser/id','ws://localhost/devtools/browser/id',
    'ws://localhost:0/devtools/browser/id','ws://localhost:65536/devtools/browser/id',
    'ws://127.1:9222/devtools/browser/id','ws://2130706433:9222/devtools/browser/id',
    'ws://localhost.evil:9222/devtools/browser/id','ws://remote.invalid:9222/devtools/browser/id',
    'ws://user:secret@localhost:9222/devtools/browser/id','ws://localhost:9222/devtools/page/id',
    'ws://localhost:9222/devtools/browser/id?token=synthetic','ws://localhost:9222/devtools/browser/id#fragment',
    'ws://localhost:9222/devtools/browser/','ws://localhost:9222/devtools/browser/id/../other'])
    assert.throws(()=>validateNativeTransportConfig({...config,chromeDevtoolsEndpoint:endpoint}),error=>error.code==='TDMS_NATIVE_CHROME_ENDPOINT_INVALID'&&error.statusCode===400);
});

test('actual browser-WebSocket factory selects and attaches existing Host page, pins each call, detaches/closes', async () => {
  await browserPeer(async peer => {
    const transport = await peer.create();
    assert.deepEqual(await transport.request(`/api/tdms-source-imports/${requestId}`,{method:'GET'}),{saved:true,requestId});
    assert.deepEqual(peer.commands.map(c=>c.method),Array(3).fill(['Target.getTargets','Target.attachToTarget','Runtime.evaluate','Target.detachFromTarget']).flat());
    assert.ok(peer.commands.filter(c=>c.method==='Target.attachToTarget').every(c=>c.params.targetId==='pageA'&&c.params.flatten===true));
    assert.ok(peer.commands.filter(c=>c.method==='Target.detachFromTarget').every(c=>c.params.sessionId==='sessionA'&&c.sessionId===undefined));
    assert.deepEqual(peer.operations.map(i=>i.operation),['RECEIVER','RECEIVER','REQUEST']);
    assert.deepEqual(JSON.parse(JSON.stringify(peer.operations[2].expectedReceiverBinding)),receiver());
    await peer.waitClosed(); assert.equal(peer.clients.size,0);
  });
});

test('browser target selection refuses ambiguity, foreign origin/app and non-page targets before attachment', async t => {
  for(const [name,targets,code] of [
    ['ambiguous',[hostPage('pageA'),hostPage('pageB')],'TDMS_NATIVE_CHROME_TARGET_AMBIGUOUS'],
    ['origin',[{...hostPage('pageA'),url:'https://other.invalid/app/app_17bzc551rsg/'}],'TDMS_NATIVE_AUTHENTICATED_HOST_PAGE_REQUIRED'],
    ['app',[{...hostPage('pageA'),url:'https://hv5zjf4j8yb.feishuapp.com/app/app_other/'}],'TDMS_NATIVE_AUTHENTICATED_HOST_PAGE_REQUIRED'],
    ['non-page',[{...hostPage('pageA'),type:'service_worker'}],'TDMS_NATIVE_AUTHENTICATED_HOST_PAGE_REQUIRED'],
    ['credential',[{...hostPage('pageA'),url:'https://user@hv5zjf4j8yb.feishuapp.com/app/app_17bzc551rsg/'}],'TDMS_NATIVE_AUTHENTICATED_HOST_PAGE_REQUIRED'],
  ]) await t.test(name,()=>browserPeer(async peer=>{
    await assert.rejects(peer.create(),error=>error.code===code&&error.statusCode===409);
    assert.deepEqual(peer.commands.map(c=>c.method),['Target.getTargets']);
    assert.equal(peer.operations.length,0); await peer.waitClosed();
  },{targets}));
  await browserPeer(async peer=>{
    await peer.create();
    assert.equal(peer.commands.find(c=>c.method==='Target.attachToTarget').params.targetId,'pageB');
  },{targets:[hostPage('pageA'),hostPage('pageB')],targetId:'pageB'});
});

test('browser attachment and session/protocol failures never reach a Host POST and release sockets', async t => {
  for(const [name,options,code] of [
    ['attach-error',{attachError:true},'TDMS_NATIVE_CHROME_ATTACH_FAILED'],
    ['invalid-session-type',{badSession:true},'TDMS_NATIVE_CHROME_ATTACH_FAILED'],
    ['attach-close',{attachClose:true},'TDMS_HOST_RECEIPT_UNKNOWN'],
    ['wrong-evaluate-session',{wrongSession:true},'TDMS_HOST_RECEIPT_UNKNOWN'],
    ['wrong-control-session',{controlSession:'unrelated-session'},'TDMS_HOST_RECEIPT_UNKNOWN'],
    ['malformed-response',{malformedReply:true},'TDMS_HOST_RECEIPT_UNKNOWN'],
    ['page-changed-after-selection',{pageOrigin:'https://other.invalid'},'TDMS_NATIVE_HOST_PAGE_CHANGED'],
  ]) await t.test(name,()=>browserPeer(async peer=>{
    await assert.rejects(peer.create(),error=>error.code===code);
    assert.equal(peer.operations.filter(i=>i.method==='POST').length,0);
    assert.ok(peer.commands.every(c=>['Target.getTargets','Target.attachToTarget','Runtime.evaluate','Target.detachFromTarget'].includes(c.method)));
    if(options.wrongSession||options.malformedReply||options.pageOrigin)
      assert.equal(peer.commands.filter(c=>c.method==='Target.detachFromTarget').length,1);
    await peer.waitClosed(); assert.equal(peer.clients.size,0);
  },options));
});

test('WS preflight exact-member rejection precedes missing bytes and never uploads or imports', async () => {
  await browserPeer(async peer=>{
    const transport=await peer.create();
    await assert.rejects(transport.request('/api/tdms-source-imports',{method:'POST',body:{requestId,
      package:{artifactBindings:[{bindingId,blobSha256:'d'.repeat(64),byteLength:9}]}}}),
      error=>error.code==='TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED'&&error.statusCode===403);
    assert.deepEqual(peer.operations.map(i=>i.operation),['RECEIVER','RECEIVER','PREFLIGHT']);
    assert.deepEqual(JSON.parse(JSON.stringify(peer.operations.at(-1).expectedReceiverBinding)),receiver());
  },{invoke:async input=>{
    if(input.operation==='RECEIVER') return receiver();
    throw Object.assign(new Error('synthetic denied'),{code:'TDMS_IMPORT_MEMBER_SCOPE_ADMISSION_REQUIRED',statusCode:403});
  }});
});

test('WS lost/expired POST remains unknown; only explicit original-request GET follows, with no resend', async t => {
  for(const mode of ['close','timeout']) await t.test(mode,async t=>{
    let posts=0,reads=0;
    if(mode==='timeout') {
      const original=setTimeout;
      t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>original(fn,ms===45_000?25:ms,...args));
    }
    await browserPeer(async peer=>{
      const transport=await peer.create();
      await assert.rejects(transport.request('/api/tdms-source-imports',{method:'POST',body:{requestId,package:{artifactBindings:[]}}}),
        error=>error.code==='TDMS_HOST_RECEIPT_UNKNOWN'&&error.reconciliation.requestId===requestId&&
          error.reconciliation.nextAction==='READ_ORIGINAL_REQUEST_AND_EXACT_SOURCE_REFS');
      assert.equal(posts,1); assert.equal(reads,0);
      assert.deepEqual(await transport.request(`/api/tdms-source-imports/${requestId}`,{method:'GET'}),{saved:true,requestId});
      assert.equal(posts,1); assert.equal(reads,1);
      await peer.waitClosed(); assert.equal(peer.clients.size,0);
    },{invoke:async input=>{
      if(input.operation==='RECEIVER') return receiver();
      if(input.method==='POST') {posts++; return {saved:true};}
      reads++; assert.equal(input.route,`/api/tdms-source-imports/${requestId}`); return {saved:true,requestId};
    },drop:(input,socket)=>{
      if(input.method!=='POST') return false;
      if(mode==='close') socket.close(); return true;
    }});
  });
});

test('actual browser WS carries admitted synthetic original CAS bytes through one STAGE and one POST unchanged', async () => {
  const bytes=Buffer.from('owned synthetic browser WS original'),sha=createHash('sha256').update(bytes).digest('hex');
  const artifact={bindingId,blobSha256:sha,byteLength:bytes.length};
  const pkg={packageId:'synthetic-ws-stage',artifactBindings:[artifact],untouched:{version:null}};
  await browserPeer(async peer=>{
    const dir=path.join(peer.directory,'blobs',sha.slice(0,2));
    await mkdir(dir,{recursive:true}); await writeFile(path.join(dir,sha),bytes);
    const transport=await peer.create();
    assert.deepEqual(await transport.request('/api/tdms-source-imports',{method:'POST',body:{requestId,package:pkg}}),{saved:true});
    assert.deepEqual(peer.operations.map(i=>i.operation),['RECEIVER','RECEIVER','PREFLIGHT','FIND_STAGE','RECEIVER','RECEIVER','STAGE','REQUEST']);
    assert.equal(peer.operations.filter(i=>i.operation==='STAGE').length,1);
    assert.equal(peer.operations.filter(i=>i.method==='POST').length,1);
  },{invoke:async input=>{
    if(input.operation==='RECEIVER') return receiver();
    assert.deepEqual(JSON.parse(JSON.stringify(input.expectedReceiverBinding)),receiver());
    if(input.operation==='PREFLIGHT') return {requestId,bindingId,receiverId:receiver().receiverId,payloadDigest:digest,status:'AUTHORIZED_UPLOAD'};
    if(input.operation==='FIND_STAGE') throw unavailable();
    if(input.operation==='STAGE') {
      assert.equal(input.bytesBase64,bytes.toString('base64')); assert.deepEqual(JSON.parse(JSON.stringify(input.package)),pkg);
      return {requestId,bindingId,receiverId:receiver().receiverId,packageId:pkg.packageId,payloadDigest:digest,
        status:'STAGED_CANDIDATE',sha256:sha,byteLength:bytes.length,readbackVerified:true,documentVersionId:null};
    }
    assert.deepEqual(JSON.parse(JSON.stringify(input.body.package)),pkg); return {saved:true};
  }});
});

test('detach failure closes the socket without rewriting a determined bridge response', async () => {
  await browserPeer(async peer=>{
    const transport=await peer.create();
    assert.deepEqual(await transport.request(`/api/tdms-source-imports/${requestId}`,{method:'GET'}),{saved:true,requestId});
    assert.equal(peer.commands.filter(c=>c.method==='Target.detachFromTarget').length,3);
    await peer.waitClosed(); assert.equal(peer.clients.size,0);
  },{detachError:true});
});

test('existing HTTP URL normalization still accepts its original uppercase protocol spelling', () => {
  assert.equal(validateNativeTransportConfig({schemaVersion:'wiselink.tdms-native-host-transport-config.v1',
    chromeDevtoolsEndpoint:'HTTP://127.0.0.1:9222/',sourceStateDirectory:'/synthetic-state'}).chromeDevtoolsEndpoint,'http://127.0.0.1:9222');
});

test('a session-bearing browser detach reply is ignored until bounded close, preserving the known result', async t => {
  const original=setTimeout; let deadlines=0;
  t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>original(ms===1000?()=>{deadlines++;fn();}:fn,ms===1000?25:ms,...args));
  await browserPeer(async peer=>{
    const transport=await peer.create();
    assert.deepEqual(await transport.request(`/api/tdms-source-imports/${requestId}`,{method:'GET'}),{saved:true,requestId});
    assert.equal(deadlines,3);
    await peer.waitClosed(); assert.equal(peer.clients.size,0);
  },{detachSession:true});
});
