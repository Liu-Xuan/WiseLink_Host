import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createNativeReviewGatewayPreparer, assertNativeGatewayBinding } from '../scripts/native-temporary-review-gateway.mjs';
import { createSummaryGatewaySession, validateSummaryGatewayReceipt } from '../scripts/derived-summary-native-gateway.mjs';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { invokeHostedDerivedSummaryModel } from '../scripts/invoke-hosted-derived-summary-model.mjs';

test('native preparer uses one official profile, cleans state, and blocks attempt reuse',
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'wl-native-preparer-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const configPath = join(root, 'source.json');
    const source = { models: { providers: { miaoda: {
      baseUrl: 'https://official.example/v1', api: 'openai-completions',
      apiKey: { source: 'file', provider: 'fixture', id: '/key' },
      headers: { 'x-official-lane': {
        source: 'file', provider: 'fixture', id: '/header' } },
      timeoutSeconds: 600,
      models: [{ id: 'glm-5.3', name: 'GLM fixture', input: ['text'],
        contextWindow: 128000, maxTokens: 8192 }],
    } } }, secrets: { providers: { fixture: { source: 'file', path: '/unused' } } } };
    await writeFile(configPath, JSON.stringify(source));
    const resolverPath = join(root, 'resolver.mjs');
    await writeFile(resolverPath, `export async function resolveSecretRefValues(refs) {
      return new Map(refs.map((ref) => [ref.id,
        ref.id === '/key' ? 'fixture-official-key-value-123456' :
          'fixture-official-header-value-123456']));
    }`);
    const commandPath = join(root, 'openclaw-mock.mjs');
    await writeFile(commandPath, `#!/usr/bin/env node
      import { readFileSync, writeFileSync } from 'node:fs';
      import { createServer, connect } from 'node:net';
      import { join } from 'node:path';
      const args = process.argv.slice(2);
      if (args[0] === 'config' && args[1] === 'validate') {
        const c = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
        if (c.plugins.enabled !== false || c.tools.profile !== 'minimal' ||
          c.models.providers.miaoda.apiKey.source !== 'env' ||
          c.agents.defaults.models['miaoda/glm-5.3'].params?.extra_body?.reasoning_effort !== 'low' ||
          c.models.providers.miaoda.timeoutSeconds > 480 ||
          !process.env.WL_REVIEW_UPSTREAM_KEY || !process.env.WL_REVIEW_GATEWAY_TOKEN)
          process.exit(2);
        process.exit(0);
      }
      if (args[0] === 'gateway' && args[1] === 'run') {
        if (process.env.LEAK_MODELS === '1') writeFileSync(
          join(process.env.OPENCLAW_STATE_DIR, 'models.json'),
          process.env.WL_REVIEW_UPSTREAM_KEY);
        if (process.env.NEVER_BIND_MARKER) {
          writeFileSync(process.env.NEVER_BIND_MARKER, 'gateway-run');
          setInterval(() => {}, 1000);
        } else {
          createServer((socket) => socket.end()).listen(Number(args[3]), '127.0.0.1');
        }
      } else if (args[0] === 'gateway' && args[1] === 'health') {
        const c = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
        const port = c.gateway.port;
        if (args.length !== 4 || args[2] !== '--timeout' ||
          !Number.isSafeInteger(Number(args[3])) || Number(args[3]) < 1 ||
          Number(args[3]) > 10_000 || process.env.OPENCLAW_GATEWAY_URL ||
          process.env.OPENCLAW_GATEWAY_PORT !== String(port) ||
          process.env.OPENCLAW_GATEWAY_TOKEN !== process.env.WL_REVIEW_GATEWAY_TOKEN ||
          c.gateway.mode !== 'local' || c.gateway.bind !== 'loopback' ||
          c.gateway.auth.token.id !== 'WL_REVIEW_GATEWAY_TOKEN' ||
          c.models.providers.miaoda.headers['x-wiselink-attempt-nonce'].length !== 64)
          process.exit(5);
        if (process.env.HEALTH_HANG_MARKER) {
          writeFileSync(process.env.HEALTH_HANG_MARKER, 'gateway-health');
          setInterval(() => {}, 1000);
        } else {
          const s = connect(port, '127.0.0.1');
          s.once('connect', () => { s.destroy(); process.exit(0); });
          s.once('error', () => process.exit(3));
        }
      } else process.exit(4);
    `);
    await chmod(commandPath, 0o700);
    const attemptRef = `AQ-${randomUUID()}`;
    const startedAt = new Date().toISOString();
    const taskDeadlineAt = new Date(Date.parse(startedAt) + 300_000).toISOString();
    const binding = { attemptRef, workItemId: 'WI-native-fixture',
      nativeSessionKey: 'agent:wiselink-engineering:review:ACTX-RS-native-fixture',
      executionModel: { modelRef: 'miaoda/glm-5.3' },
      startedAt, taskDeadlineAt, deadlineAt: taskDeadlineAt,
      timeoutMs: 480_000, maxCompletionTokens: 8192,
      maxModelRequests: 2, reasoningEffort: 'low' };
    const make = (extraEnv = {}) => createNativeReviewGatewayPreparer({
      sourceConfigPath: configPath,
      secretResolverModulePath: resolverPath,
      adapterModulePath: resolve(new URL('../scripts/one-shot-outbound-adapter.mjs',
        import.meta.url).pathname),
      command: commandPath,
      env: { ...process.env, ...extraEnv },
    });
    const marker = join(tmpdir(), 'wiselink-native-review-attempt-locks',
      createHash('sha256').update(attemptRef).digest('hex'));
    t.after(() => rm(marker, { force: true }));
    const prepared = await make()(binding);
    assert.match(prepared.gatewayUrl, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.ok(prepared.gatewayToken.length >= 64);
    assert.equal(prepared.getSanitizedReceipt().tempSecretScan, null);
    assert.equal(prepared.getSanitizedReceipt().expectedReasoningEffort, 'low');
    assert.equal(prepared.getSanitizedReceipt().observedReasoningEffort, null);
    const providerTimeout = prepared.getSanitizedReceipt().providerTimeout;
    assert.deepEqual(Object.keys(providerTimeout).sort(),
      ['callerSeconds', 'effectiveSeconds', 'sourceSeconds']);
    assert.equal(providerTimeout.sourceSeconds, 600);
    assert.equal(providerTimeout.callerSeconds, null);
    assert(providerTimeout.effectiveSeconds > 0 &&
      providerTimeout.effectiveSeconds <= 300);
    await prepared.close();
    assert.deepEqual(prepared.getSanitizedReceipt().tempSecretScan,
      { complete: true, found: false });
    assert.equal((await readFile(marker, 'utf8')).includes(attemptRef), false);
    await assert.rejects(make()(binding), /EEXIST/u);
    await assert.rejects(make()({ ...binding, reasoningEffort: 'off' }),
      /NATIVE_GATEWAY_HOST_BINDING_INVALID/u);

    const summaryAttemptRef = `AQ-${randomUUID()}`;
    const summaryId = `DS-${randomUUID()}`;
    const summaryMarker = join(tmpdir(), 'wiselink-native-review-attempt-locks',
      createHash('sha256').update(summaryAttemptRef).digest('hex'));
    t.after(() => rm(summaryMarker, { force: true }));
    const { workItemId: _workItemId, ...summaryBasis } = binding;
    const summaryBinding = { ...summaryBasis, attemptRef: summaryAttemptRef,
      subject: { kind: 'DERIVED_SUMMARY', summaryId },
      nativeSessionKey: `agent:wiselink-engineering:summary:${summaryId}:${summaryAttemptRef}`,
      timeoutMs: 600_000, maxCompletionTokens: 64000, maxModelRequests: 6 };
    assert.equal(assertNativeGatewayBinding(summaryBinding), Date.parse(taskDeadlineAt));
    for (const key of ['workItemId', 'matterId', 'documentVersionId'])
      assert.throws(() => assertNativeGatewayBinding({ ...summaryBinding, [key]: 'legacy-fake' }), /HOST_BINDING_INVALID/);
    assert.throws(() => assertNativeGatewayBinding({ ...summaryBinding,
      subject: { kind: 'DERIVED_SUMMARY', summaryId: 'WI-fake' },
      nativeSessionKey: `agent:wiselink-engineering:summary:WI-fake:${summaryAttemptRef}` }), /HOST_BINDING_INVALID/);
    assert.throws(() => assertNativeGatewayBinding({ ...summaryBinding,
      nativeSessionKey: 'agent:wiselink-engineering:review:ACTX-RS-fake' }), /HOST_BINDING_INVALID/);
    assert.throws(() => assertNativeGatewayBinding({ ...summaryBinding,
      subject: { kind: 'DERIVED_SUMMARY', summaryId: 'DS-other' } }), /HOST_BINDING_INVALID/);
    source.models.providers.miaoda.models[0].maxTokens = 64000;
    await writeFile(configPath, JSON.stringify(source));
    const summaryPrepared = await make()(summaryBinding);
    assert.equal(summaryPrepared.getSanitizedReceipt().maxCompletionTokens, 64000);
    assert.equal(summaryPrepared.getSanitizedReceipt().maxModelRequests, 6);
    await summaryPrepared.close();
    assert.deepEqual(summaryPrepared.getSanitizedReceipt().tempSecretScan, { complete: true, found: false });
    await assert.rejects(make()(summaryBinding), /EEXIST/u);
    source.models.providers.miaoda.models[0].maxTokens = 8192;
    await writeFile(configPath, JSON.stringify(source));

    const pollutedAttemptRef = `AQ-${randomUUID()}`;
    const pollutedMarker = join(tmpdir(), 'wiselink-native-review-attempt-locks',
      createHash('sha256').update(pollutedAttemptRef).digest('hex'));
    t.after(() => rm(pollutedMarker, { force: true }));
    const polluted = await make({
      OPENCLAW_GATEWAY_URL: 'ws://127.0.0.1:1', OPENCLAW_GATEWAY_PORT: '1',
    })({ ...binding, attemptRef: pollutedAttemptRef });
    await polluted.close();

    const leakedAttemptRef = `AQ-${randomUUID()}`;
    const leakedMarker = join(tmpdir(), 'wiselink-native-review-attempt-locks',
      createHash('sha256').update(leakedAttemptRef).digest('hex'));
    t.after(() => rm(leakedMarker, { force: true }));
    const leaking = await make({ LEAK_MODELS: '1' })({ ...binding,
      attemptRef: leakedAttemptRef });
    await assert.rejects(leaking.close(), /NATIVE_GATEWAY_SECRET_PERSISTED_TEMP/u);

    const shortAttemptRef = `AQ-${randomUUID()}`;
    const shortMarker = join(tmpdir(), 'wiselink-native-review-attempt-locks',
      createHash('sha256').update(shortAttemptRef).digest('hex'));
    t.after(() => rm(shortMarker, { force: true }));
    const gatewayRunMarker = join(root, 'never-bind-started');
    const shortStartedAt = new Date().toISOString();
    const shortDeadlineAt = new Date(Date.parse(shortStartedAt) + 4_000).toISOString();
    const beforeShortWait = Date.now();
    await assert.rejects(make({ NEVER_BIND_MARKER: gatewayRunMarker })({ ...binding,
      attemptRef: shortAttemptRef, startedAt: shortStartedAt,
      taskDeadlineAt: shortDeadlineAt, deadlineAt: shortDeadlineAt }),
    /NATIVE_GATEWAY_START_TIMEOUT_UNKNOWN/u);
    assert.equal(await readFile(gatewayRunMarker, 'utf8'), 'gateway-run');
    assert(Date.now() - beforeShortWait < 6_500,
      'loopback startup wait exceeded the shorter task deadline');

    const healthAttemptRef = `AQ-${randomUUID()}`;
    const healthMarker = join(tmpdir(), 'wiselink-native-review-attempt-locks',
      createHash('sha256').update(healthAttemptRef).digest('hex'));
    t.after(() => rm(healthMarker, { force: true }));
    const healthRunMarker = join(root, 'health-hang-started');
    const healthStartedAt = new Date().toISOString();
    const healthDeadlineAt = new Date(Date.parse(healthStartedAt) + 6_000).toISOString();
    const healthFailure = await make({ HEALTH_HANG_MARKER: healthRunMarker })({
      ...binding, attemptRef: healthAttemptRef, startedAt: healthStartedAt,
      taskDeadlineAt: healthDeadlineAt, deadlineAt: healthDeadlineAt,
    }).catch((error) => error);
    assert.equal(await readFile(healthRunMarker, 'utf8'), 'gateway-health');
    assert.equal(healthFailure?.message, 'NATIVE_GATEWAY_HEALTH_UNKNOWN');
    assert.deepEqual(Object.keys(healthFailure.healthExec).sort(),
      ['code', 'elapsedMs', 'killed', 'signal']);
    assert.equal(healthFailure?.healthExec?.killed, true);
    assert.equal(healthFailure?.healthExec?.signal, 'SIGTERM');
    assert(['NONE', 'OTHER', 'CLI_EXIT_NONZERO'].includes(healthFailure?.healthExec?.code));
    assert(healthFailure?.healthExec?.elapsedMs >= 3_000 &&
      healthFailure.healthExec.elapsedMs <= 6_000);
  });

// This fixture runs the new preparer and actual adapter with an explicit fake
// resolver, fake child CLI, and in-memory fake upstream. All sockets are loopback.
// It does not use the installed SDK resolver, active config, or real OpenClaw.
async function summaryNativeFixture(t, mode) {
  const root = await mkdtemp(join(tmpdir(), 'wl-p3a-summary-synthetic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const attemptRef = `AQ-${randomUUID()}`;
  const summaryId = `DS-${randomUUID()}`;
  const marker = join(tmpdir(), 'wiselink-native-review-attempt-locks',
    createHash('sha256').update(attemptRef).digest('hex'));
  t.after(() => rm(marker, { force: true }));
  const configPath = join(root, 'synthetic-provider.json');
  await writeFile(configPath, JSON.stringify({ models: { providers: { miaoda: {
    baseUrl: 'https://synthetic.invalid/v1', api: 'openai-completions',
    apiKey: { source: 'file', provider: 'synthetic', id: '/key' },
    headers: { 'x-synthetic-lane': { source: 'file', provider: 'synthetic', id: '/header' } },
    timeoutSeconds: 120, models: [{ id: 'glm-5.3', name: 'Synthetic model',
      input: ['text'], contextWindow: 128000, maxTokens: 64000 }],
  } } }, secrets: { providers: { synthetic: { source: 'file', path: '/unused-synthetic' } } } }));
  const resolverPath = join(root, 'fake-resolver.mjs');
  await writeFile(resolverPath, `export async function resolveSecretRefValues(refs) {
    if (refs.length !== 1 || refs[0].provider !== 'synthetic') throw new Error('FAKE_REF_INVALID');
    return new Map(refs.map(ref => [ref.id, 'synthetic-only-value-' + ref.id.slice(1)]));
  }`);
  const adapterPath = join(root, 'fake-upstream-adapter.mjs');
  const actualAdapter = new URL('../scripts/one-shot-outbound-adapter.mjs', import.meta.url).href;
  await writeFile(adapterPath, `import { createOneShotOutboundAdapter as actual } from ${JSON.stringify(actualAdapter)};
    export const state = { mode: ${JSON.stringify(mode)}, calls: [] };
    export function createOneShotOutboundAdapter(options) {
      return actual({ ...options, fetchUpstream: async (url, init) => {
        state.calls.push({ url, body: JSON.parse(init.body), redirect: init.redirect });
        if (url !== 'https://synthetic.invalid/v1/chat/completions' || init.redirect !== 'error')
          throw new Error('SYNTHETIC_UPSTREAM_BOUNDARY_INVALID');
        if (state.mode === 'RETRY_THEN_STOP' && state.calls.length === 1)
          return Response.json({ error: { message: 'Synthetic busy' } }, { status: 503 });
        if (state.mode === 'UNKNOWN_EOF')
          return Response.json({ choices: [{ message: { role: 'assistant', content: 'No terminal proof' } }] });
        if (state.mode === 'READ_SOURCE') return Response.json({ model: 'synthetic-model-v1', choices: [{
          finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{
            id: 'synthetic-source-read', type: 'function', function: { name: 'return_wiselink_summary_step',
              arguments: JSON.stringify({ step: { action: 'READ_SOURCES', evidenceRefs: ['root-ref'], purpose: 'Exact synthetic root' } }) }
          }] }
        }] });
        return Response.json({ model: 'synthetic-model-v1', choices: [{ finish_reason: 'stop',
          message: { role: 'assistant', content: 'Synthetic complete' } }] });
      } });
    }`);
  const upstream = await import(pathToFileURL(adapterPath).href);
  const commandPath = join(root, 'fake-child.mjs');
  const childMarker = join(root, 'child-state.json');
  await writeFile(commandPath, `#!${process.execPath}
    import { readFileSync, writeFileSync } from 'node:fs';
    import { createServer } from 'node:http';
    import { connect } from 'node:net';
    const args = process.argv.slice(2);
    const config = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));
    const provider = config.models.providers.miaoda;
    if (config.gateway.bind !== 'loopback' || config.plugins.enabled !== false ||
      !provider.baseUrl.startsWith('http://127.0.0.1:') ||
      provider.apiKey.source !== 'env' || !provider.headers['x-wiselink-attempt-nonce']) process.exit(2);
    if (args[0] === 'config' && args[1] === 'validate') process.exit(0);
    if (args[0] === 'gateway' && args[1] === 'health') {
      const socket = connect(config.gateway.port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); process.exit(0); });
      socket.once('error', () => process.exit(3));
    } else if (args[0] === 'gateway' && args[1] === 'run') {
      writeFileSync(process.env.WL_SYNTHETIC_CHILD_MARKER, JSON.stringify({
        pid: process.pid, stateDirectory: process.env.OPENCLAW_STATE_DIR }));
      createServer(async (req, res) => {
        try {
          if (req.headers.authorization !== 'Bearer ' + process.env.WL_REVIEW_GATEWAY_TOKEN) {
            res.writeHead(401); res.end(); return;
          }
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks));
          body.model = 'glm-5.3';
          body.reasoning_effort = config.agents.defaults.models['miaoda/glm-5.3'].params.extra_body.reasoning_effort;
          const send = () => fetch(provider.baseUrl + '/chat/completions', { method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.WL_REVIEW_UPSTREAM_KEY,
              ...provider.headers }, body: JSON.stringify(body), redirect: 'error' });
          let response = await send();
          if (process.env.WL_SYNTHETIC_RETRY === '1' && response.status === 503) {
            await response.arrayBuffer(); response = await send();
          }
          res.writeHead(response.status, { 'content-type': response.headers.get('content-type') || 'application/json' });
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch { res.writeHead(502); res.end(JSON.stringify({ error: { code: 'SYNTHETIC_CHILD_ERROR' } })); }
      }).listen(config.gateway.port, '127.0.0.1');
    } else process.exit(4);
  `);
  await chmod(commandPath, 0o700);
  const cleanEnv = { PATH: process.env.PATH, TMPDIR: tmpdir(),
    WL_SYNTHETIC_CHILD_MARKER: childMarker,
    WL_SYNTHETIC_RETRY: mode === 'RETRY_THEN_STOP' ? '1' : '0' };
  let preparations = 0; let prepared; let binding; let requests = 0;
  const prepareGateway = async value => {
    preparations++; binding = { ...value }; delete binding.signal;
    prepared = await createNativeReviewGatewayPreparer({ sourceConfigPath: configPath,
      secretResolverModulePath: resolverPath, adapterModulePath: adapterPath,
      command: commandPath, env: cleanEnv })(value);
    return prepared;
  };
  const checkpoint = await createCheckpointStore(join(root, 'checkpoint'));
  const options = { attemptRef, summaryId, checkpoint, prepareGateway,
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic route',
      providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-08T00:00:00.000Z' },
    runBudget: { timeoutMs: 60_000, maxCompletionTokens: 64000, maxModelRequests: 3, reasoningEffort: 'low' },
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    requestGateway: async (url, init) => {
      requests++; assert.equal(url.hostname, '127.0.0.1'); return fetch(url, init);
    } };
  const request = () => ({ method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'glm-5.3', messages: [{ role: 'user', content: 'Synthetic input only' }],
      max_completion_tokens: 32000 }), signal: new AbortController().signal });
  const assertCleaned = async () => {
    const childState = JSON.parse(await readFile(childMarker, 'utf8'));
    await assert.rejects(access(childState.stateDirectory), { code: 'ENOENT' });
    assert.throws(() => process.kill(childState.pid, 0), { code: 'ESRCH' });
  };
  return { options, checkpoint, request, upstream, assertCleaned,
    get prepared() { return prepared; }, get binding() { return binding; },
    get preparations() { return preparations; }, get requests() { return requests; } };
}

test('Summary prepare through actual adapter records native retry ordinals, strict receipt and owned cleanup', async t => {
  const f = await summaryNativeFixture(t, 'RETRY_THEN_STOP');
  const session = createSummaryGatewaySession(f.options);
  try {
    const response = await session.request(f.request());
    assert.equal(response.status, 200); assert.equal(f.preparations, 1); assert.equal(f.requests, 1);
    assert.equal(f.upstream.state.calls.length, 2, 'one caller request includes two actual native provider dispatches');
    const receipt = validateSummaryGatewayReceipt(response.providerReceipt, f.binding, { terminal: true });
    assert.equal(receipt.upstreamDispatchCount, 2);
    assert.deepEqual(receipt.dispatches.map(value => value.ordinal), [1, 2]);
    assert.deepEqual(receipt.dispatches.map(value => value.upstreamHttpStatus), [503, 200]);
    assert.deepEqual(receipt.dispatches.map(value => value.actualCompletionTokens), [32000, 32000]);
    assert.equal(receipt.maxCompletionTokens, 64000);
    assert.equal(receipt.observedReasoningEffort, 'LOW'); assert.equal(receipt.unknownTerminal, false);
    assert.throws(() => validateSummaryGatewayReceipt({ ...receipt, responseText: 'forbidden' }, f.binding),
      /DERIVED_SUMMARY_GATEWAY_RECEIPT_INVALID/);
    const changed = structuredClone(receipt); changed.dispatches[1].ordinal = 1;
    assert.throws(() => validateSummaryGatewayReceipt(changed, f.binding), /DERIVED_SUMMARY_GATEWAY_RECEIPT_INVALID/);
  } finally { await session.close(); }
  const closed = await f.checkpoint.readOptional('summary-gateway.receipt');
  validateSummaryGatewayReceipt(closed, f.binding, { terminal: true, closed: true });
  assert.deepEqual(closed.tempSecretScan, { complete: true, found: false });
  await f.assertCleaned();
});

test('Summary unknown provider terminal cannot redispatch or rearm and still closes with a sanitized receipt', async t => {
  const f = await summaryNativeFixture(t, 'UNKNOWN_EOF');
  const session = createSummaryGatewaySession(f.options);
  try {
    await assert.rejects(session.request(f.request()), /DERIVED_SUMMARY_PROVIDER_TERMINAL_UNVERIFIED/);
    assert.equal(f.prepared.getSanitizedReceipt().unknownTerminal, true);
    await assert.rejects(session.request(f.request()), /DERIVED_SUMMARY_PROVIDER_TERMINAL_UNVERIFIED/);
    assert.equal(f.upstream.state.calls.length, 1, 'unknown terminal permanently closes actual provider dispatch');
    assert.equal(f.prepared.getSanitizedReceipt().upstreamDispatchCount, 1);
  } finally { await session.close(); }
  const receipt = await f.checkpoint.readOptional('summary-gateway.receipt');
  validateSummaryGatewayReceipt(receipt, f.binding, { closed: true });
  assert.equal(receipt.unknownTerminal, true);
  assert.throws(() => validateSummaryGatewayReceipt(receipt, f.binding, { terminal: true }),
    /DERIVED_SUMMARY_PROVIDER_TERMINAL_UNVERIFIED/);
  await f.assertCleaned();
  const reentry = createSummaryGatewaySession(f.options);
  await assert.rejects(reentry.request(f.request()), /DERIVED_SUMMARY_GATEWAY_REARM_REQUIRES_NEW_REQUEST/);
  await reentry.close(); assert.equal(f.preparations, 1); assert.equal(f.upstream.state.calls.length, 1);
});

test('Summary saved model response replay repeats the exact source read without preparing the native gateway again', async t => {
  const f = await summaryNativeFixture(t, 'READ_SOURCE');
  const member = { kind: 'WORK_ITEM_WORK', workItemId: 'WI-synthetic', documentVersionId: 'DV-synthetic',
    workRef: 'WR-synthetic', workRevision: 1, issueKeys: ['issue-synthetic'] };
  const evidence = { evidenceRef: 'root-ref', kind: 'DOCUMENT_PASSAGE', title: 'Synthetic source', versionLabel: '1',
    excerpt: 'Applies only if installed.', workItemId: null, documentVersionId: 'DV-synthetic',
    sourceRefId: 'SRC-synthetic', locator: 'p. 1' };
  const input = { scope: { kind: 'ATA4', title: 'Synthetic selected scope', fleetFamilyId: 'B787',
    fleetModelIds: ['B787-9'], ata2: '46', ata4: '46-00', selectionReason: 'Synthetic explicit selection' },
    classificationStatus: 'CANDIDATE', instruction: 'Synthetic exact read', limitations: ['Synthetic only.'],
    evidence: [evidence], members: [{ member, evidenceRef: 'member-ref', headline: 'Synthetic work',
      body: 'Synthetic saved conditions.', issues: [{ issueKey: 'issue-synthetic', question: 'Condition?', body: 'Synthetic issue.' }],
      evidence: [evidence], rootRefs: ['root-ref'], limitations: ['Synthetic only.'],
      current: true, overviewStatus: 'CURRENT', leaves: [member] }] };
  const reads = [];
  const options = { ...f.options, gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1',
    gatewayToken: 'synthetic-placeholder', registeredModelRefs: ['miaoda/glm-5.3'],
    sessionDiscriminator: 'synthetic-exact-session', heartbeat: async () => {},
    readMembers: async () => assert.fail('model requests a source read'),
    readSources: async step => { reads.push(structuredClone(step)); throw new Error('SYNTHETIC_SOURCE_TIMEOUT'); } };
  const run = () => invokeHostedDerivedSummaryModel(input, options, { requestGateway: f.options.requestGateway });
  await assert.rejects(run(), /SYNTHETIC_SOURCE_TIMEOUT/);
  assert.equal(f.preparations, 1); assert.equal(f.upstream.state.calls.length, 1); assert.equal(reads.length, 1);
  const response = await f.checkpoint.readOptional('summary-round-0.result');
  const receipt = await f.checkpoint.readOptional('summary-gateway.receipt');
  const state = await f.checkpoint.readOptional('summary-model-state');
  assert.ok(response); validateSummaryGatewayReceipt(receipt, f.binding, { terminal: true, closed: true });
  await f.assertCleaned();
  await assert.rejects(run(), /SYNTHETIC_SOURCE_TIMEOUT/);
  assert.equal(reads.length, 2); assert.deepEqual(reads[1], reads[0]);
  assert.equal(f.preparations, 1); assert.equal(f.requests, 1); assert.equal(f.upstream.state.calls.length, 1);
  assert.deepEqual(await f.checkpoint.readOptional('summary-round-0.result'), response);
  assert.deepEqual(await f.checkpoint.readOptional('summary-gateway.receipt'), receipt);
  assert.deepEqual(await f.checkpoint.readOptional('summary-model-state'), state);
});
