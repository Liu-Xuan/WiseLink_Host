/** Owner-loaded native transport for the unchanged daily HostSourceClient.
 * Uses one explicitly configured, already authenticated Chrome page. It never
 * reads/exports cookies, invents a principal, starts a login, or retries a POST.
 */
import { readFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

const APP = 'app_17bzc551rsg';
const ORIGIN = 'https://hv5zjf4j8yb.feishuapp.com';
const PREFIX = `/app/${APP}/`;
const BRIDGE = '__wiselinkTdmsNativeBridge';
const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024;
const bindingKeys = ['schemaVersion', 'receiverId', 'tenantRef', 'applicationRef',
  'principalRef', 'sourceSystem', 'sourceInstanceRef', 'authorityRevision',
  'authorityEvidenceRef', 'sessionEvidenceRef', 'observedAt'];

function fail(code, statusCode = 503, reconciliation) {
  throw Object.assign(new Error(code), { code, statusCode,
    ...(reconciliation ? { reconciliation } : {}) });
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('TDMS_NATIVE_TRANSPORT_INPUT_INVALID', 400);
  return value;
}
function exact(value, keys) {
  object(value);
  if (Object.keys(value).some(key => !keys.includes(key)))
    fail('TDMS_NATIVE_TRANSPORT_INPUT_INVALID', 400);
  return value;
}
function text(value, max = 500) {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f]/u.test(value))
    fail('TDMS_NATIVE_TRANSPORT_INPUT_INVALID', 400);
  return value;
}
function loopbackUrl(raw, protocols) {
  const url = new URL(text(raw, 2000));
  if (!protocols.includes(url.protocol) || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      !url.port || url.username || url.password || url.search || url.hash)
    fail('TDMS_NATIVE_CHROME_ENDPOINT_INVALID', 400);
  return url;
}
export function validateNativeTransportConfig(raw) {
  const value = exact(raw, ['schemaVersion', 'chromeDevtoolsEndpoint',
    'sourceStateDirectory', 'targetId', 'receiverId']);
  if (value.schemaVersion !== 'wiselink.tdms-native-host-transport-config.v1')
    fail('TDMS_NATIVE_TRANSPORT_CONFIG_INVALID', 400);
  const browser = /^ws:\/\/(127\.0\.0\.1|\[::1\]|localhost):([1-9]\d{0,4})\/devtools\/browser\/([A-Za-z0-9_-]{1,160})$/u
    .exec(text(value.chromeDevtoolsEndpoint, 2000));
  let endpoint;
  if (browser) {
    if (Number(browser[2]) > 65535) fail('TDMS_NATIVE_CHROME_ENDPOINT_INVALID', 400);
    endpoint = value.chromeDevtoolsEndpoint;
  } else {
    let url;
    try { url = loopbackUrl(value.chromeDevtoolsEndpoint, ['http:']); }
    catch (error) {
      if (error?.code) throw error;
      fail('TDMS_NATIVE_CHROME_ENDPOINT_INVALID', 400);
    }
    if (url.pathname !== '/') fail('TDMS_NATIVE_CHROME_ENDPOINT_INVALID', 400);
    endpoint = url.origin;
  }
  if (!path.isAbsolute(text(value.sourceStateDirectory, 4000)))
    fail('TDMS_NATIVE_SOURCE_STATE_DIRECTORY_INVALID', 400);
  if (value.targetId !== undefined && !/^[A-Za-z0-9_-]{1,160}$/u.test(text(value.targetId)))
    fail('TDMS_NATIVE_CHROME_TARGET_INVALID', 400);
  if (value.receiverId !== undefined) text(value.receiverId);
  return Object.freeze({ ...value, chromeDevtoolsEndpoint: endpoint });
}
export function validateReceiverBinding(raw) {
  const value = exact(raw?.data ?? raw, bindingKeys);
  if (bindingKeys.some(key => !Object.hasOwn(value, key)) ||
      value.schemaVersion !== 'wiselink.tdms-native-host-receiver-binding.v1' ||
      value.sourceSystem !== 'TDMS' || value.applicationRef !== APP)
    fail('TDMS_NATIVE_RECEIVER_IDENTITY_INVALID', 409);
  for (const key of bindingKeys) text(value[key]);
  if (!Number.isFinite(Date.parse(value.observedAt))) fail('TDMS_NATIVE_RECEIVER_TIME_INVALID', 409);
  return Object.freeze({ ...value });
}
function sameReceiver(a, b) {
  return bindingKeys.every(key => key === 'observedAt' || a[key] === b[key]);
}
export function assertNativeClientRoute(route, method) {
  if (typeof route !== 'string' || !route.startsWith('/api/')) fail('TDMS_NATIVE_ROUTE_FORBIDDEN', 400);
  const url = new URL(route, 'https://wiselink.invalid');
  if (url.origin !== 'https://wiselink.invalid' || url.hash || url.username || url.password)
    fail('TDMS_NATIVE_ROUTE_FORBIDDEN', 400);
  if (method === 'POST' && url.pathname === '/api/tdms-source-imports' && !url.search) return;
  if (method === 'GET' && !url.search && /^\/api\/tdms-source-imports\/TDMSIMPORT-[a-f0-9]{64}$/u.test(url.pathname)) return;
  if (method === 'GET' && url.pathname === '/api/tdms-source-refs' &&
      [...url.searchParams.keys()].join() === 'sourceRef' && url.searchParams.getAll('sourceRef').length === 1 &&
      /^TDMS:(?:SNAPSHOT:TDMSSNAP-[a-f0-9]{64}|FIELD:TDMSSNAP-[a-f0-9]{64}:(?:0|[1-9][0-9]{0,3})|RELATION:TDMSEDGE-[a-f0-9]{64}|ARTIFACT:TDMSBIND-[a-f0-9]{64})$/u.test(url.searchParams.get('sourceRef'))) return;
  fail('TDMS_NATIVE_ROUTE_FORBIDDEN', 400);
}
function validTarget(value) {
  if (!value || value.type !== 'page' || typeof value.url !== 'string') return false;
  try {
    const url = new URL(value.url);
    return url.origin === ORIGIN && url.pathname.startsWith(PREFIX) && !url.username && !url.password;
  } catch { return false; }
}
async function currentTarget(config) {
  let response;
  try {
    response = await fetch(`${config.chromeDevtoolsEndpoint}/json/list`,
      { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  } catch { fail('TDMS_NATIVE_CHROME_UNAVAILABLE'); }
  if (!response.ok) fail('TDMS_NATIVE_CHROME_UNAVAILABLE');
  const values = await response.json();
  if (!Array.isArray(values)) fail('TDMS_NATIVE_CHROME_TARGET_INVALID');
  const matches = values.filter(value => validTarget(value) &&
    (!config.targetId || value.id === config.targetId));
  if (matches.length !== 1) fail(matches.length ? 'TDMS_NATIVE_CHROME_TARGET_AMBIGUOUS'
    : 'TDMS_NATIVE_AUTHENTICATED_HOST_PAGE_REQUIRED', 409);
  const url = loopbackUrl(matches[0].webSocketDebuggerUrl, ['ws:']);
  const endpoint = new URL(config.chromeDevtoolsEndpoint);
  if (url.hostname !== endpoint.hostname || url.port !== endpoint.port ||
      url.pathname !== `/devtools/page/${matches[0].id}`)
    fail('TDMS_NATIVE_CHROME_TARGET_INVALID', 409);
  return url.href;
}

// Browser-level CDP is opt-in by the exact configured endpoint. Only existing
// targets are inspected/attached; no profile discovery, launch or navigation.
async function invokeBrowserPage(config, expression, argument) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(config.chromeDevtoolsEndpoint);
    let phase = 1, sessionId, finished = false, cleanupTimer;
    const unknown = () => Object.assign(new Error('TDMS_HOST_RECEIPT_UNKNOWN'), {
      code: 'TDMS_HOST_RECEIPT_UNKNOWN', statusCode: 503,
      reconciliation: { phase: argument.operation, requestId: argument.requestId ?? argument.body?.requestId,
        bindingId: argument.bindingId, nextAction: 'READ_ORIGINAL_REQUEST_AND_EXACT_SOURCE_REFS' },
    });
    let complete;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      let closed = false;
      complete = () => {
        if (closed) return;
        closed = true; clearTimeout(cleanupTimer); socket.close();
        if (error) reject(error); else resolve(value);
      };
      if (sessionId && socket.readyState === WebSocket.OPEN) {
        cleanupTimer = setTimeout(complete, 1000);
        try { socket.send(JSON.stringify({id:4, method:'Target.detachFromTarget', params:{sessionId}})); }
        catch { complete(); }
      } else complete();
    };
    const send = (id, method, params, session) => {
      try { socket.send(JSON.stringify({id, method, params, ...(session ? {sessionId:session} : {})})); }
      catch { finish(unknown()); }
    };
    const timer = setTimeout(() => finish(unknown()), 45_000);
    socket.addEventListener('open', () => send(1, 'Target.getTargets', {}));
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { finish(unknown()); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { finish(unknown()); return; }
      if (finished) { if (message.id === 4 && message.sessionId === undefined) complete(); return; }
      if (message.method === 'Target.detachedFromTarget' && message.params?.sessionId === sessionId) {
        finish(unknown()); return;
      }
      if (message.id !== phase) return;
      if ((phase === 3 ? message.sessionId !== sessionId : message.sessionId !== undefined)) {
        finish(unknown()); return;
      }
      if (phase === 1) {
        if (message.error || !Array.isArray(message.result?.targetInfos)) { finish(unknown()); return; }
        const matches = message.result.targetInfos.filter(value => validTarget(value) &&
          (!config.targetId || value.targetId === config.targetId));
        if (matches.length !== 1) {
          finish(Object.assign(new Error('Host page selection failed'), {
            code:matches.length ? 'TDMS_NATIVE_CHROME_TARGET_AMBIGUOUS' : 'TDMS_NATIVE_AUTHENTICATED_HOST_PAGE_REQUIRED', statusCode:409 }));
          return;
        }
        if (typeof matches[0].targetId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/u.test(matches[0].targetId)) { finish(unknown()); return; }
        phase = 2; send(2, 'Target.attachToTarget', {targetId:matches[0].targetId, flatten:true});
      } else if (phase === 2) {
        if (message.error || typeof message.result?.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/u.test(message.result.sessionId)) {
          finish(Object.assign(new Error('TDMS_NATIVE_CHROME_ATTACH_FAILED'), {code:'TDMS_NATIVE_CHROME_ATTACH_FAILED',statusCode:503}));
          return;
        }
        sessionId = message.result.sessionId; phase = 3;
        send(3, 'Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true, timeout:40_000}, sessionId);
      } else {
        if (message.error || message.result?.exceptionDetails || !message.result?.result ||
            !Object.hasOwn(message.result.result, 'value')) { finish(unknown()); return; }
        finish(null, message.result.result.value);
      }
    });
    socket.addEventListener('error', () => { if (finished) complete(); else finish(unknown()); });
    socket.addEventListener('close', () => { if (finished) complete(); else finish(unknown()); });
  });
}

/** Each invocation closes its connection; CLI completion leaves no live socket.
 * A disconnected/expired invocation is never resubmitted automatically. */
async function invokeInExistingPage(config, argument) {
  const browser = config.chromeDevtoolsEndpoint.startsWith('ws:');
  const endpoint = browser ? null : await currentTarget(config);
  const expression = `(async () => {
    if (location.origin !== ${JSON.stringify(ORIGIN)} ||
        !location.pathname.startsWith(${JSON.stringify(PREFIX)}))
      return {ok:false,code:'TDMS_NATIVE_HOST_PAGE_CHANGED',statusCode:409};
    const bridge = window[${JSON.stringify(BRIDGE)}];
    if (!bridge || bridge.schemaVersion !== 'wiselink.tdms-native-host-bridge.v1')
      return {ok:false,code:'TDMS_NATIVE_HOST_BRIDGE_UNAVAILABLE',statusCode:503};
    try { return {ok:true,value:await bridge.invoke(${JSON.stringify(argument)})}; }
    catch (error) { return {ok:false,
      code:/^[A-Z0-9_]{1,160}$/.test(error?.code||'')?error.code:'TDMS_HOST_RECEIPT_UNKNOWN',
      statusCode:Number.isInteger(error?.statusCode)?error.statusCode:503,
      phase:error?.phase,requestId:error?.requestId,bindingId:error?.bindingId,
      filePath:error?.filePath,nextAction:error?.nextAction}; }
  })()`;
  const result = browser ? await invokeBrowserPage(config, expression, argument) : await new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error); else resolve(value);
    };
    const unknown = () => Object.assign(new Error('TDMS_HOST_RECEIPT_UNKNOWN'),
      { code: 'TDMS_HOST_RECEIPT_UNKNOWN', statusCode: 503 });
    const timer = setTimeout(() => finish(unknown()), 45_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1,
      method: 'Runtime.evaluate', params: { expression, awaitPromise: true,
        returnByValue: true, timeout: 40_000 } })));
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { finish(unknown()); return; }
      if (message.id !== 1) return;
      if (message.error || message.result?.exceptionDetails ||
          !message.result?.result || !Object.hasOwn(message.result.result, 'value')) {
        finish(unknown()); return;
      }
      finish(null, message.result.result.value);
    });
    socket.addEventListener('error', () => finish(unknown()));
    socket.addEventListener('close', () => { if (!settled) finish(unknown()); });
  });
  if (result?.ok !== true) {
    const code = typeof result?.code === 'string' && /^[A-Z0-9_]{1,160}$/u.test(result.code)
      ? result.code : 'TDMS_HOST_RECEIPT_UNKNOWN';
    fail(code, Number.isInteger(result?.statusCode) ? result.statusCode : 503,
      { phase: result?.phase ?? argument.operation, requestId: result?.requestId ?? argument.requestId,
        bindingId: result?.bindingId ?? argument.bindingId, filePath: result?.filePath,
        nextAction: result?.nextAction ?? 'READ_ORIGINAL_REQUEST_AND_EXACT_SOURCE_REFS' });
  }
  return result.value;
}

export async function readOriginalBlob(stateDirectory, binding) {
  const digest = text(binding.blobSha256);
  const size = binding.byteLength;
  if (!/^[a-f0-9]{64}$/u.test(digest) || !Number.isSafeInteger(size) || size < 1 || size > MAX_ORIGINAL_BYTES)
    fail('TDMS_NATIVE_ORIGINAL_IDENTITY_INVALID', 400);
  const root = await realpath(stateDirectory);
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.uid !== process.getuid())
    fail('TDMS_NATIVE_SOURCE_STATE_OWNER_INVALID', 403);
  const filename = path.join(root, 'blobs', digest.slice(0, 2), digest);
  const before = await lstat(filename);
  const resolved = await realpath(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.getuid() ||
      before.size !== size || !resolved.startsWith(root + path.sep))
    fail('TDMS_NATIVE_ORIGINAL_FILE_INVALID', 403);
  const bytes = await readFile(filename);
  const after = await lstat(filename);
  if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key]) ||
      bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== digest)
    fail('TDMS_NATIVE_ORIGINAL_IDENTITY_CHANGED', 409);
  return bytes;
}

export function createBoundNativeTransport(config, invoke) {
  let baseline;
  const binding = async () => {
    const current = validateReceiverBinding(await invoke({ operation: 'RECEIVER',
      ...(baseline ? { expectedReceiverBinding: baseline } : {}),
      ...(config.receiverId ? { receiverId: config.receiverId } : {}) }));
    if (baseline && !sameReceiver(baseline, current)) fail('TDMS_NATIVE_RECEIVER_CHANGED', 409);
    baseline ??= current;
    return current;
  };
  const invokeBound = argument => invoke({ ...argument, expectedReceiverBinding: baseline });
  return Object.freeze({
    evidence: Object.freeze({ mode: 'AUTHENTICATED_NATIVE_SESSION' }),
    currentReceiverBinding: binding,
    async request(route, input) {
      if (typeof route !== 'string' || !route.startsWith('/api/') ||
          !input || !['GET', 'POST'].includes(input.method)) fail('TDMS_NATIVE_REQUEST_INVALID', 400);
      assertNativeClientRoute(route, input.method);
      if (input.method === 'GET' && input.body !== undefined) fail('TDMS_NATIVE_GET_BODY_FORBIDDEN', 400);
      await binding();
      if (input.method === 'POST') {
        if (route !== '/api/tdms-source-imports') fail('TDMS_NATIVE_ROUTE_FORBIDDEN', 400);
        const body = exact(input.body, ['requestId', 'package']);
        const pkg = object(body.package);
        text(body.requestId, 160);
        if (!Array.isArray(pkg.artifactBindings)) fail('TDMS_NATIVE_PACKAGE_REQUIRED', 400);
        for (const item of pkg.artifactBindings) {
          const artifact = object(item);
          const bindingId = text(artifact.bindingId, 160);
          const preflight = await invokeBound({ operation: 'PREFLIGHT', requestId: body.requestId, bindingId, package: pkg });
          if (preflight?.status !== 'AUTHORIZED_UPLOAD' || preflight.requestId !== body.requestId ||
              preflight.bindingId !== bindingId || preflight.receiverId !== baseline.receiverId ||
              body.requestId !== `TDMSIMPORT-${preflight.payloadDigest}`)
            fail('TDMS_NATIVE_UPLOAD_PREFLIGHT_MISMATCH', 409);
          let staged;
          try {
            staged = await invokeBound({ operation: 'FIND_STAGE', requestId: body.requestId, bindingId });
          } catch (error) {
            if (error?.code !== 'TDMS_UPLOAD_SELECTION_UNAVAILABLE' || error?.statusCode !== 404) throw error;
            // No visible association does not prove physical absence. Fresh
            // acquisition relies on the exact package admission above and the
            // unchanged authority/session pin; STAGE checks admission again.
            await binding();
            const bytes = await readOriginalBlob(config.sourceStateDirectory, artifact);
            await binding();
            staged = await invokeBound({ operation: 'STAGE', requestId: body.requestId,
              bindingId, package: pkg, bytesBase64: bytes.toString('base64') });
          }
          if (staged?.status !== 'STAGED_CANDIDATE' || staged.receiverId !== baseline.receiverId ||
              staged.requestId !== body.requestId || staged.bindingId !== artifact.bindingId ||
              staged.payloadDigest !== preflight.payloadDigest || staged.packageId !== pkg.packageId ||
              staged.sha256 !== artifact.blobSha256 || staged.byteLength !== artifact.byteLength ||
              staged.readbackVerified !== true || staged.documentVersionId !== null)
            fail('TDMS_NATIVE_UPLOAD_ASSOCIATION_MISMATCH', 409);
        }
      }
      return invokeBound({ operation: 'REQUEST', route, method: input.method,
        ...(input.body === undefined ? {} : { body: input.body }) });
    },
  });
}

/** Factory called with no arguments by the existing reviewed Source loader. */
export async function createNativeTransport() {
  const filename = process.env.WISELINK_TDMS_NATIVE_TRANSPORT_CONFIG ||
    path.join(homedir(), 'Library', 'Application Support', 'WiseLink', 'tdms-host-native-transport.json');
  if (!path.isAbsolute(filename)) fail('TDMS_NATIVE_TRANSPORT_CONFIG_INVALID', 400);
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.getuid() || (before.mode & 0o022))
    fail('TDMS_NATIVE_TRANSPORT_CONFIG_OWNER_INVALID', 403);
  const raw = await readFile(filename, 'utf8');
  const after = await lstat(filename);
  if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key]))
    fail('TDMS_NATIVE_TRANSPORT_CONFIG_CHANGED', 409);
  const config = validateNativeTransportConfig(JSON.parse(raw));
  const transport = createBoundNativeTransport(config, argument => invokeInExistingPage(config, argument));
  await transport.currentReceiverBinding();
  return transport;
}
