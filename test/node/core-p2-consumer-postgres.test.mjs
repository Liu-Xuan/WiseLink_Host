import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createConnection } from 'node:net';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeScripts =
  '../../openclaw/skills/wiselink-research-and-synthesize/scripts/';

// This file runs its actual Native consumer in a child only to stop it between
// the real Host transaction and its transport reply. Host services and PG stay
// in the parent; killing this child cannot execute the consumer's catch/finally.
async function runNativeChild() {
  let nextRequest = 0;
  const pending = new Map();
  function rpc(method, input) {
    return new Promise((resolve, reject) => {
      const id = ++nextRequest;
      pending.set(id, { resolve, reject });
      process.send({ type: 'request', id, method, input });
    });
  }
  process.on('message', (message) => {
    if (message?.type !== 'response') return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(
        Object.assign(new Error(message.error.message), message.error),
      );
    } else waiter.resolve(message.value);
  });
  const [configuration] = await once(process, 'message');
  assert.equal(configuration.type, 'start');
  if (configuration.hostClockOffsetMs !== undefined) {
    // Match the fixture's existing controlled Host clock in this owned child.
    // Database leases, task deadlines and recovery decisions stay unchanged.
    assert.ok(Number.isSafeInteger(configuration.hostClockOffsetMs));
    assert.ok(configuration.hostClockOffsetMs >= 0);
    const OriginalDate = globalThis.Date;
    const offset = configuration.hostClockOffsetMs;
    globalThis.Date = class extends OriginalDate {
      constructor(...args) {
        super(...(args.length ? args : [OriginalDate.now() + offset]));
      }
      static now() {
        return OriginalDate.now() + offset;
      }
    };
  }
  const { consumeAutomaticWorkItemQueueTick, consumeHostedWorkItem } =
    await import(`${nativeScripts}consume-hosted-work-item.mjs`);
  const { createCheckpointStore, resolveRuntimeConfig } = await import(
    `${nativeScripts}run-hosted-review-turn.mjs`
  );
  const { invokeHostedInitialModel } = await import(
    `${nativeScripts}invoke-hosted-initial-model.mjs`
  );
  const configuredRuntime = configuration.runtimeConfigPath
    ? await resolveRuntimeConfig(
        ['--openclaw-config', configuration.runtimeConfigPath],
        {
          WL_REVIEW_GATEWAY_URL: configuration.gatewayUrl,
          WL_REVIEW_HOST_MCP_URL: 'http://constructed.invalid/core-p2-ipc-only',
        },
      )
    : null;
  const callTool = (name, args) => rpc('callTool', { name, args });
  // Only the owned HTTP response endpoint is fake. This calls the same model
  // adapter, JobAid loop and default core-HTTP transport as the actual consumer.
  const invokeInitialModel = (input, hooks) =>
    invokeHostedInitialModel(input, {
      ...hooks,
      ...(configuredRuntime ?? {
        gatewayChatCompletionsEnabled: true,
        gatewayUrl: configuration.gatewayUrl,
        gatewayToken: 'offline-core-p2-fixture-only',
        configuredModelVersion: hooks.executionModel.modelRef,
        registeredModelRefs: [hooks.executionModel.modelRef],
      }),
    });
  const nativeDependencies = { callTool, invokeInitialModel };
  try {
    const checkpoint = await createCheckpointStore(
      configuration.options.checkpointRoot,
    );
    if (configuration.macSerialOwner) {
      // Production flock is Linux-only. The test parent holds this exact child
      // and checkpoint namespace exclusively, and releases it only after exit.
      checkpoint.withActiveClaimOwner = async (perform) => {
        assert.equal(process.platform, 'darwin');
        await rpc('assertLocalOwner', {
          checkpointRoot: configuration.options.checkpointRoot,
          pid: process.pid,
        });
        return perform();
      };
    }
    const result =
      configuration.entry === 'work-item'
        ? await consumeHostedWorkItem(configuration.options, nativeDependencies)
        : await consumeAutomaticWorkItemQueueTick(configuration.options, {
            checkpoint,
            callTool,
            nextWorkItem: (input) => rpc('nextWorkItem', input),
            acknowledgeWorkItem: (input) => rpc('acknowledgeWorkItem', input),
            blockWorkItem: (input) => rpc('blockWorkItem', input),
            readInitialStatus: (workItemId) =>
              rpc('readInitialStatus', workItemId),
            readSavedWork: (attemptRef, workItemId) =>
              callTool('read_assessment_work', { attemptRef, workItemId }),
            consumeWorkItem: async (input) => {
              const report = await consumeHostedWorkItem(
                input,
                nativeDependencies,
              );
              process.send({ type: 'consumerReport', report });
              return report;
            },
            now: () => new Date(configuration.nowIso),
          });
    process.send({ type: 'result', result });
  } catch (error) {
    process.send({ type: 'result', error: transportError(error) });
  } finally {
    process.disconnect();
  }
}

function transportError(error) {
  const result = {
    message: error instanceof Error ? error.message : String(error),
  };
  for (const name of ['code', 'statusCode', 'hostErrorCode', 'hostToolName']) {
    if (error?.[name] !== undefined) result[name] = error[name];
  }
  return result;
}

async function runConsumerChild(
  host,
  configuration,
  { beforeCall, afterCall } = {},
) {
  const checkpointRoot = resolve(configuration.options.checkpointRoot);
  await mkdir(checkpointRoot, { recursive: true, mode: 0o700 });
  const ownerPath = join(
    dirname(checkpointRoot),
    `.${basename(checkpointRoot)}.c284-p2-owner.lock`,
  );
  const owner = await open(ownerPath, 'wx', 0o600);
  try {
    await owner.writeFile(
      JSON.stringify({ parentPid: process.pid, checkpointRoot }),
    );
    return await runOwnedConsumerChild(
      host,
      {
        ...configuration,
        options: { ...configuration.options, checkpointRoot },
        macSerialOwner: process.platform === 'darwin',
      },
      { beforeCall, afterCall },
      owner,
    );
  } finally {
    await owner.close();
    await unlink(ownerPath);
  }
}

async function runOwnedConsumerChild(
  host,
  configuration,
  { beforeCall, afterCall },
  owner,
) {
  const child = fork(fileURLToPath(import.meta.url), [], {
    execArgv: [],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      CORE_P2_NATIVE_TEST_CHILD: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const trace = [];
  const consumerReports = [];
  let output = '';
  child.stdout.on('data', (bytes) => {
    output += bytes;
  });
  child.stderr.on('data', (bytes) => {
    output += bytes;
  });
  let result;
  let handlerError;
  let timedOut = false;
  const handlers = new Set();
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, 30000);
  async function handleMessage(message) {
    if (message?.type === 'consumerReport') {
      consumerReports.push(message.report);
      return;
    }
    if (message?.type === 'result') {
      result = message;
      return;
    }
    if (message?.type !== 'request') return;
    const { id, method, input } = message;
    const call = { method, input };
    trace.push(call);
    try {
      const localOwner = method === 'assertLocalOwner';
      if (localOwner) {
        assert.equal(input.pid, child.pid);
        assert.equal(
          input.checkpointRoot,
          configuration.options.checkpointRoot,
        );
        assert.ok(
          owner.fd >= 0,
          'The parent must still hold its exclusive owner file',
        );
      }
      await beforeCall?.({ child, method, input });
      const value = localOwner
        ? { owned: true }
        : method === 'callTool'
          ? await host.callTool(input.name, input.args)
          : await host[method](input);
      call.value = value;
      // Returning false deliberately drops the committed transport response.
      if ((await afterCall?.({ child, method, input, value })) === false)
        return;
      if (child.connected) child.send({ type: 'response', id, value });
    } catch (error) {
      handlerError = error;
      call.error = transportError(error);
      if (child.connected)
        child.send({ type: 'response', id, error: transportError(error) });
    }
  }
  child.on('message', (message) => {
    const handling = handleMessage(message);
    handlers.add(handling);
    handling
      .finally(() => handlers.delete(handling))
      .catch((error) => {
        handlerError = error;
      });
  });
  try {
    child.send({ type: 'start', ...configuration });
    const [code, signal] = await exited;
    const settled = Promise.all([...handlers]);
    if (!configuration.keepHostCallPendingOnCrash) await settled;
    return {
      pid: child.pid,
      code,
      signal,
      timedOut,
      result,
      trace,
      consumerReports,
      output,
      handlerError,
      settled,
    };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }
}

function assertConsumerExit(run, crashed = false) {
  assert.equal(run.timedOut, false, run.output);
  if (crashed) {
    assert.equal(
      run.signal,
      'SIGKILL',
      JSON.stringify({
        result: run.result,
        error: run.handlerError?.message,
        output: run.output,
      }),
    );
    assert.equal(
      run.result,
      undefined,
      'No Native catch/finally result may replace the crash',
    );
  } else {
    assert.equal(run.code, 0, run.output);
    assert.ok(run.result, run.output);
    assert.equal(run.result.error, undefined, JSON.stringify(run.result.error));
  }
  assert.throws(() => process.kill(run.pid, 0), { code: 'ESRCH' });
}

function consumerHost(host) {
  return {
    ...host,
    blockWorkItem: (body) =>
      host.hosted(() => host.dispatch.blockWorkItem(body)),
    readInitialStatus: async (workItemId) => {
      const wire = await host.readInitialStatus(workItemId);
      assert.equal(wire.entry.workItemId, workItemId);
      return { ...wire.initialAnalysis, workItemId };
    },
  };
}

async function withHostFixture(t, body) {
  const { startCoreP1HostFixture } =
    await import('./helpers/core-p1-host-postgres.fixture.mjs');
  const host = await startCoreP1HostFixture();
  const checkpointRoot = await mkdtemp(
    join(tmpdir(), 'wiselink-core-p2-native-'),
  );
  const pid = Number(
    (await readFile(join(host.ownership.data, 'postmaster.pid'), 'utf8')).split(
      '\n',
    )[0],
  );
  const receipt = {
    ownership: host.ownership,
    postgresPid: pid,
    macSerialOwner: process.platform === 'darwin',
    linuxFlockIntegration: 'NOT_RUN',
  };
  try {
    const [role] = await host.roleEvidence();
    assert.equal(role.session_user, host.ownership.applicationLogin);
    assert.equal(role.superuser, false);
    assert.equal(role.bypassrls, false);
    assert.notEqual(role.current_user, role.table_owner);
    receipt.consumerRole = role;
    await body(host, { checkpointRoot, receipt });
  } finally {
    await host.close();
    await rm(checkpointRoot, { recursive: true, force: true });
    await assert.rejects(access(host.ownership.root), { code: 'ENOENT' });
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const closed = await new Promise((resolveClosed) => {
      const connection = createConnection({
        host: '127.0.0.1',
        port: host.ownership.instance.port,
      });
      connection.once('error', () => resolveClosed(true));
      connection.once('connect', () => {
        connection.destroy();
        resolveClosed(false);
      });
    });
    assert.equal(closed, true);
    receipt.cleanup = {
      ownedPidExited: true,
      portClosed: true,
      clusterRemoved: true,
      checkpointRemoved: true,
    };
    t.diagnostic(`CORE_P2_RECEIPT ${JSON.stringify(receipt)}`);
  }
}

async function startOwnedModelEndpoint(respond) {
  const requests = [];
  const errors = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    try {
      for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      const payload = JSON.parse(raw.toString('utf8'));
      const call = {
        ordinal: requests.length + 1,
        receivedAtMonotonicMs: performance.now(),
        path: request.url,
        method: request.method,
        modelHeader: request.headers['x-openclaw-model'] ?? null,
        requestBytes: raw.length,
        request: payload,
      };
      requests.push(call);
      const body = await respond(call);
      if (body.fixtureSocketCut) {
        const partial = '{"choices":[{"message":';
        call.status = 200;
        call.responseBytes = Buffer.byteLength(partial);
        call.connectionTerminatedBeforeEnd = true;
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': '10000',
        });
        response.flushHeaders();
        response.write(partial);
        await new Promise((resolveWritten) => setTimeout(resolveWritten, 20));
        response.destroy();
        return;
      }
      const status = body.fixtureHttpStatus ?? 200;
      const payloadBody = body.fixturePayload ?? {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `core-p2-offline-${call.ordinal}`,
                  type: 'function',
                  function: {
                    name: 'return_wiselink_assessment_step',
                    arguments: JSON.stringify({ step: body }),
                  },
                },
              ],
            },
          },
        ],
      };
      const serialized =
        typeof body.fixtureRaw === 'string'
          ? body.fixtureRaw
          : JSON.stringify(payloadBody);
      call.responseBytes = Buffer.byteLength(serialized);
      call.status = status;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(serialized);
    } catch (error) {
      errors.push(error);
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { type: 'fixture_error' } }));
    }
  });
  await new Promise((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListening);
  });
  const port = server.address().port;
  return {
    gatewayUrl: `http://127.0.0.1:${port}`,
    requests,
    errors,
    async close() {
      await new Promise((resolveClosed) => server.close(resolveClosed));
      assert.equal(server.listening, false);
    },
  };
}

function namedStepPayload(step, { omitFinishReason = false } = {}) {
  return {
    choices: [
      {
        ...(omitFinishReason ? {} : { finish_reason: 'tool_calls' }),
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'core-p2-synthetic-named-step',
              type: 'function',
              function: {
                name: 'return_wiselink_assessment_step',
                arguments: JSON.stringify({ step }),
              },
            },
          ],
        },
      },
    ],
  };
}

async function readModelShapes(root) {
  const shapes = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) shapes.push(...(await readModelShapes(path)));
    else if (/\.output-shape(?:-\d+)?\.json$/u.test(entry.name))
      shapes.push(JSON.parse(await readFile(path, 'utf8')));
  }
  return shapes;
}

async function readCandidateRejections(root) {
  const reports = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory())
      reports.push(...(await readCandidateRejections(path)));
    else if (/\.candidate-rejection-[^.]+\.json$/u.test(entry.name))
      reports.push(JSON.parse(await readFile(path, 'utf8')));
  }
  return reports;
}

function completedTextPayload() {
  return {
    choices: [
      {
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: 'Synthetic completed reply without the required named tool.',
        },
      },
    ],
  };
}

function currentModelContext(request) {
  for (const message of [...request.messages].reverse()) {
    if (message.role !== 'user') continue;
    try {
      const value = JSON.parse(message.content);
      if (
        [
          'wiselink.jobaid-problem-task.v2',
          'wiselink.jobaid-problem-task.v3',
        ].includes(value.schemaVersion)
      )
        return value;
    } catch {
      /* Other user messages are protocol feedback, not the Host input. */
    }
  }
  // A later request in the same native session may contain only tool deltas.
  // Do not invent a retransmitted body or require a duplicate whole context.
  return null;
}

function sourceBodyOccurrences(request) {
  const byBody = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (
      typeof value.evidenceRef === 'string' &&
      typeof value.excerpt === 'string'
    ) {
      const key = JSON.stringify([value.evidenceRef, value.excerpt]);
      const previous = byBody.get(key);
      byBody.set(key, {
        evidenceRef: value.evidenceRef,
        bodyBytes: Buffer.byteLength(value.excerpt),
        count: (previous?.count ?? 0) + 1,
      });
    }
    for (const child of Object.values(value)) visit(child);
  }
  for (const message of request.messages) {
    if (typeof message.content !== 'string') continue;
    try {
      visit(JSON.parse(message.content));
    } catch {
      /* Instructions and prose have no projected evidence record. */
    }
  }
  return [...byBody.values()];
}

if (process.env.CORE_P2_NATIVE_TEST_CHILD === '1') {
  await runNativeChild();
} else {
  const { default: test } = await import('node:test');
  test(
    'G07 identical read without new recognition stops once and ordinary terminal BLOCK releases an independent successor',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        const workItemId = 'WI-core-p2-no-progress';
        const successorId = 'WI-core-p2-after-no-progress';
        await host.seed(workItemId);
        let claim;
        let following = false;
        let successorRequests = 0;
        const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
          assert.ok(claim);
          if (following) {
            assert.equal(claim.task.workItemId, successorId);
            successorRequests++;
            if (successorRequests === 1)
              return {
                action: 'SAVE_WORK',
                workJson: JSON.stringify(host.proposal(claim)),
              };
            assert.equal(successorRequests, 2);
            return { action: 'FINISH' };
          }
          if (ordinal === 1)
            return {
              action: 'SAVE_WORK',
              workJson: JSON.stringify(host.proposal(claim, 'IN_PROGRESS')),
            };
          assert.ok(
            ordinal <= 4,
            'One no-progress correction cannot leave an unbounded loop',
          );
          return {
            action: 'READ_SOURCES',
            sourceRefs: [
              claim.modelInput.availableSources.find(
                (source) => source.kind === 'DOCUMENT_PASSAGE',
              ).ref,
            ],
            purpose:
              'Read the same exact original interval with no changed recognition',
            context: 'EXACT',
          };
        });
        const runs = [];
        const configuration = {
          entry: 'queue',
          gatewayUrl: gateway.gatewayUrl,
          nowIso: new Date().toISOString(),
          options: { checkpointRoot },
        };
        const hooks = {
          afterCall: ({ method, input, value }) => {
            if (
              method === 'callTool' &&
              input.name === 'begin_dynamic_evaluation'
            )
              claim = value;
          },
        };
        try {
          const failed = await runConsumerChild(
            consumerHost(host),
            configuration,
            hooks,
          );
          runs.push(failed);
          assertConsumerExit(failed);
          assert.deepEqual(gateway.errors, []);
          assert.equal(gateway.requests.length, 4);
          const bodyCounts = gateway.requests.map((request) =>
            sourceBodyOccurrences(request.request),
          );
          assert.ok(
            bodyCounts.flat().every((body) => body.count === 1),
            'Repeated exact source reads must not duplicate source bodies in a request',
          );
          const snapshot = await host.snapshot();
          assert.equal(snapshot.work.length, 1);
          const attempt = snapshot.attempts.find(
            (row) => row.attempt_id === claim.task.actionAttemptId,
          );
          assert.equal(attempt.status, 'FAILED');
          const result = JSON.parse(attempt.result_envelope_json);
          assert.equal(result.status, 'FAILED');
          assert.equal(result.errorCode, 'JOBAID_NO_PROGRESS');
          const noProgress = (
            await readCandidateRejections(checkpointRoot)
          ).filter((report) => report.repairScope === 'STAGE_PROGRESS');
          assert.equal(noProgress.length, 1);
          assert.equal(noProgress[0].code, 'JOBAID_NO_PROGRESS');
          assert.equal(noProgress[0].maxRepairs, 1);
          assert.equal(
            failed.trace.filter(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'cancel_action_attempt',
            ).length,
            0,
          );
          const originalSaveKey = snapshot.work[0].request_id;
          await host.seed(successorId);
          const blocked = await runConsumerChild(
            consumerHost(host),
            configuration,
            hooks,
          );
          runs.push(blocked);
          assertConsumerExit(blocked);
          assert.equal(blocked.result.result.status, 'BLOCKED_CLAIM_FINALIZED');
          assert.equal(
            gateway.requests.length,
            4,
            'Terminal BLOCK cannot repeat the model',
          );
          following = true;
          const successor = await runConsumerChild(
            consumerHost(host),
            configuration,
            hooks,
          );
          runs.push(successor);
          assertConsumerExit(successor);
          assert.equal(successor.result.result.workItemId, successorId);
          assert.equal(successor.result.result.status, 'IN_PROGRESS');
          assert.equal(successorRequests, 2);
          const final = await host.snapshot();
          const original = final.work.filter(
            (row) => row.work_item_id === workItemId,
          );
          assert.equal(original.length, 1);
          assert.equal(original[0].request_id, originalSaveKey);
          assert.equal(
            final.work.filter((row) => row.work_item_id === successorId).length,
            1,
          );
          receipt.noProgress = {
            originalHttpRequests: 4,
            originalSavedWorkCount: original.length,
            originalSaveKeyPreserved: true,
            noProgressReports: noProgress,
            hostFailure: result.errorCode,
            stageProviderCancellation: 0,
            finalizedStatus: blocked.result.result.status,
            independentSuccessor: successorId,
            successorHttpRequests: successorRequests,
            linuxProductionFlock: 'NOT_RUN',
            sourceBodyCounts: bodyCounts,
          };
        } finally {
          await gateway.close();
          receipt.nativeChildren = runs.map((run) => ({
            pid: run.pid,
            code: run.code,
            signal: run.signal,
          }));
          receipt.gatewayCleanup = { ownedListenerClosed: true };
        }
      }),
  );

  test(
    'G04 actual Host preparation survives SAVE READ_WORK and a new model session without losing pending correction',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        const workItemId = 'WI-core-p2-preparation-continuation';
        await host.seed(workItemId);
        const contributionText =
          '请纠正温度条件已满足的表述，必须保留尚未核实的限制。';
        const contribution = await host.seedEngineerContribution({
          workItemId,
          text: contributionText,
        });
        const reviewText = '请核对 condition 问题，温度条件尚未确认。';
        const turn = await host.seedReviewTurn({
          workItemId,
          text: reviewText,
        });
        let claim;
        const modelContexts = [];
        const gateway = await startOwnedModelEndpoint(
          ({ ordinal, request }) => {
            const context = currentModelContext(request);
            modelContexts.push(context);
            if (context?.purpose === 'OVERALL_CONSISTENCY') {
              assert.equal(
                ordinal,
                5,
                'Overall must not restart the original investigation',
              );
              return {
                action: 'FINISH',
                consistencyCheck:
                  '核对准确已保存更正与概览，保留温度条件未核实的限制。',
              };
            }
            if (ordinal === 1)
              return {
                action: 'SAVE_WORK',
                workJson: JSON.stringify(host.proposal(claim, 'IN_PROGRESS')),
              };
            if (ordinal === 2)
              return {
                action: 'READ_WORK',
                workRevisionRef: context.previousWork.workRevisionRef,
                issueKeys: ['condition'],
                includeOverview: true,
              };
            if (ordinal === 3) {
              const work = host.proposal(claim, 'COMPLETE_WITH_OPEN_QUESTIONS');
              work.issues[0].body +=
                ' 工程师指出温度条件尚未确认，保留核实限制。';
              work.overview += ' 温度条件仍待核实。';
              work.changeSummary = '按工程师更正保留未确认条件。';
              return { action: 'SAVE_WORK', workJson: JSON.stringify(work) };
            }
            assert.equal(ordinal, 4);
            return { action: 'FINISH' };
          },
        );
        let run;
        let overallRun;
        try {
          run = await runConsumerChild(
            consumerHost(host),
            {
              entry: 'queue',
              gatewayUrl: gateway.gatewayUrl,
              nowIso: new Date().toISOString(),
              options: { checkpointRoot },
            },
            {
              afterCall: ({ method, input, value }) => {
                if (
                  method === 'callTool' &&
                  input.name === 'begin_dynamic_evaluation'
                )
                  claim = value;
              },
            },
          );
          assertConsumerExit(run);
          assert.deepEqual(gateway.errors, []);
          const snapshot = await host.snapshot();
          const saves = run.trace.filter(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'save_assessment_work',
          );
          const reads = run.trace.filter(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'read_assessment_work',
          );
          receipt.preparationContinuation = {
            sourceContributionRef: contribution.contribution.contribution_ref,
            sourceReviewInputRef: turn.engineerSuppliedInputId,
            actualHttpRequests: gateway.requests.length,
            modelPreparations: modelContexts.map(
              (context) => context?.preparation ?? null,
            ),
            savePreparations: saves.map(
              (call) => call.value?.preparation ?? null,
            ),
            readPreparations: reads.map(
              (call) => call.value?.preparation ?? null,
            ),
            savedWorkCount: snapshot.work.length,
            nativeSessions: gateway.requests.map((call) => call.request.user),
          };
          t.diagnostic(
            `CORE_P2_PREPARATION ${JSON.stringify(receipt.preparationContinuation)}`,
          );
          assert.equal(saves.length, 2);
          assert.equal(snapshot.work.length, 2);
          const initial = modelContexts[0].preparation;
          assert.equal(initial.schemaVersion, 'wiselink.jobaid-preparation.v1');
          assert.equal(initial.taskInputRevision, claim.task.inputRevision);
          assert.equal(initial.currentInputRevision, claim.task.inputRevision);
          assert.equal(initial.currentInputChanged, false);
          assert.equal(initial.documentVersionId, claim.task.documentVersionId);
          assert.deepEqual(initial.originalBinding, host.original.binding);
          assert.equal(initial.lastSaved, null);
          for (const context of modelContexts.filter(Boolean)) {
            const prepared = context.preparation;
            assert.equal(prepared.goal, initial.goal);
            assert.deepEqual(prepared.targetIssueKeys, initial.targetIssueKeys);
            assert.ok(
              prepared.pendingEngineerInputs.some(
                (input) =>
                  input.ref === contribution.contribution.contribution_ref &&
                  input.text === contributionText,
              ),
            );
            assert.ok(
              prepared.pendingEngineerInputs.some(
                (input) =>
                  input.ref === turn.engineerSuppliedInputId &&
                  input.text === reviewText,
              ),
            );
            assert.equal(prepared.humanConfirmationStatus, 'NOT_RECORDED');
            assert.deepEqual(prepared.humanConfirmedDecisions, []);
          }
          assert.equal(
            modelContexts[1].preparation.lastSaved?.workRevisionRef,
            saves[0].value.workRevisionRef,
            'The actual next model context must consume Host refreshed preparation after SAVE',
          );
          if (modelContexts[2])
            assert.equal(
              modelContexts[2].preparation.lastSaved?.workRevisionRef,
              saves[0].value.workRevisionRef,
            );
          else
            assert.equal(
              gateway.requests[2].request.user,
              gateway.requests[1].request.user,
              'A delta-only READ_WORK continuation must retain its exact native session',
            );
          if (modelContexts[2]?.targetWork) {
            assert.ok(
              modelContexts[2].targetWork.issues.some(
                (issue) => issue.issueKey === 'condition' && issue.body,
              ),
            );
            assert.equal(
              modelContexts[2].previousWork.content.issues.find(
                (issue) => issue.issueKey === 'condition',
              ).body,
              undefined,
              'The complete read target and the saved index must not carry duplicate issue bodies',
            );
          }
          assert.equal(
            modelContexts[3].preparation.lastSaved?.workRevisionRef,
            saves[1].value.workRevisionRef,
          );
          assert.notEqual(
            gateway.requests[0].request.user,
            gateway.requests[1].request.user,
            'This case crosses the actual saved-work native session rebuild',
          );
          assert.equal(run.result.result.status, 'IN_PROGRESS');
          receipt.preparationContinuation.confirmedDecisionPositive = 'NOT_RUN';
          receipt.preparationContinuation.appliedReviewReceiptPositive =
            'NOT_RUN';
          overallRun = await runConsumerChild(consumerHost(host), {
            entry: 'queue',
            gatewayUrl: gateway.gatewayUrl,
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          });
          assertConsumerExit(overallRun);
          assert.deepEqual(gateway.errors, []);
          assert.equal(gateway.requests.length, 5);
          assert.equal(overallRun.result.result.status, 'ACKNOWLEDGED');
          assert.equal(
            overallRun.trace.filter(
              (call) => call.method === 'acknowledgeWorkItem',
            ).length,
            1,
          );
          assert.equal(
            overallRun.trace.filter(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'begin_overall_synthesis',
            ).length,
            1,
          );
          assert.equal(
            overallRun.trace.filter(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'commit_overall_candidate',
            ).length,
            1,
          );
          assert.equal(
            overallRun.trace.filter(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'save_assessment_work',
            ).length,
            0,
          );
          const afterOverall = await host.snapshot();
          assert.equal(afterOverall.work.length, 2);
          assert.equal(
            afterOverall.grants.find(
              (grant) => grant.work_item_id === workItemId,
            ).status,
            'COMPLETED',
          );
          receipt.preparationContinuation.overall = {
            actualHostBeginAndCommit: true,
            savedWorkCountUnchanged: true,
            originalLastSaveKey: afterOverall.work[1].request_id,
            acknowledgement: overallRun.result.result.status,
            modelRequests: 1,
            preparation: modelContexts.at(-1).preparation,
          };
        } finally {
          await gateway.close();
          receipt.nativeChildren = [run, overallRun]
            .filter(Boolean)
            .map((child) => ({
              pid: child.pid,
              code: child.code,
              signal: child.signal,
            }));
          receipt.gatewayCleanup = { ownedListenerClosed: true };
        }
      }),
  );

  test(
    'G04 actual Review APPLIED and UNCHANGED receipts reach Overall READ_WORK and rebuilt messages',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        const workItemId = 'WI-core-p2-review-to-native';
        await host.seed(workItemId);
        const oldIncorrectBody = '温度条件已经满足。';
        const correctedBody = '温度条件尚未核实，保留准确原文的条件和例外。';
        let phase = 'INITIAL';
        let initial;
        let initialSave;
        let overall;
        let overallRequests = 0;
        const messages = [];
        const gateway = await startOwnedModelEndpoint(
          ({ ordinal, request }) => {
            const context = currentModelContext(request);
            messages.push({ phase, nativeSession: request.user, context });
            if (phase === 'INITIAL') {
              if (ordinal === 1) {
                const work = host.proposal(initial);
                // Intentionally wrong synthetic candidate, corrected through the
                // real Review service below; no real engineering fact is asserted.
                work.issues[0].body = `${oldIncorrectBody} [[${
                  initial.modelInput.availableSources.find(
                    (source) => source.kind === 'DOCUMENT_PASSAGE',
                  ).ref
                }]]`;
                return { action: 'SAVE_WORK', workJson: JSON.stringify(work) };
              }
              assert.equal(ordinal, 2);
              return { action: 'FINISH' };
            }
            overallRequests++;
            assert.equal(context.purpose, 'OVERALL_CONSISTENCY');
            if (overallRequests === 1)
              return {
                action: 'READ_WORK',
                workRevisionRef: context.previousWork.workRevisionRef,
                issueKeys: ['condition'],
                includeOverview: true,
              };
            assert.equal(overallRequests, 2);
            return {
              action: 'FINISH',
              consistencyCheck:
                '已按准确已保存的温度限制更正复核概览，不恢复旧错误，也不将候选更正冒充人工确认。',
            };
          },
        );
        const runs = [];
        const configuration = {
          entry: 'queue',
          gatewayUrl: gateway.gatewayUrl,
          nowIso: new Date().toISOString(),
          options: { checkpointRoot },
        };
        const hooks = {
          afterCall: ({ method, input, value }) => {
            if (method !== 'callTool') return;
            if (input.name === 'begin_dynamic_evaluation') initial = value;
            if (input.name === 'save_assessment_work') initialSave = value;
            if (input.name === 'begin_overall_synthesis') overall = value;
          },
        };
        try {
          const analyzed = await runConsumerChild(
            consumerHost(host),
            configuration,
            hooks,
          );
          runs.push(analyzed);
          assertConsumerExit(analyzed);
          assert.equal(analyzed.result.result.status, 'IN_PROGRESS');
          assert.equal((await host.snapshot()).work.length, 1);
          const { createRequire } = await import('node:module');
          const require = createRequire(import.meta.url);
          const {
            sealResultEnvelope,
          } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');

          async function commitReview(turn, withDelta) {
            return host.withReviewScope(workItemId, async (service) => {
              const claim = await service.begin(
                turn.reviewConversationId,
                turn.requestId,
                workItemId,
              );
              const task = claim.task.modelInput;
              const source = task.jobAidContext.sourceCatalog.find(
                (item) => item.kind === 'DOCUMENT_PASSAGE',
              );
              await service.readSourceRefs(
                claim.attemptRef,
                [source.evidenceRef],
                workItemId,
              );
              const delta = withDelta
                ? host.proposal({ task: { modelInput: task.jobAidContext } })
                : null;
              if (delta) {
                delta.issues[0].body = `${correctedBody} [[${source.evidenceRef}]]`;
                delta.changeSummary = '按真实本轮工程师输入修正候选温度判断。';
              }
              const candidate = {
                schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c5',
                mode: 'INTERACTIVE_REVIEW',
                reviewConversationRef: turn.reviewConversationId,
                reviewTurnRef: turn.reviewTurnId,
                responseType: 'ANSWER',
                answer: withDelta
                  ? '已保存候选更正，尚未人工确认。'
                  : '复核后保持当前候选认识。',
                sourceRefs: [source.evidenceRef],
                missingInputs: [],
                candidateEvidenceRefs: [],
                reviewActionDraft: null,
                affectedItemIds: [],
                warnings: [],
                jobAidWorkingDelta: delta,
                runtime: {
                  runtimeAppId: 'app_17c3zn24kv2',
                  profileRef: 'wiselink-engineering',
                },
              };
              const { contentHash: _hash, ...base } = host.result(
                claim,
                initialSave.workRevisionRef,
              );
              const result = sealResultEnvelope({
                ...base,
                modelOutput: JSON.stringify(candidate),
                promptVersion: 'synthetic-review@v1',
                modelVersion: 'synthetic/offline-review',
              });
              const committed = await service.commit(
                claim.attemptRef,
                claim.leaseToken,
                claim.leaseGeneration,
                result,
                workItemId,
              );
              return { claim, committed };
            });
          }

          const applyTurn = await host.seedReviewTurn({
            workItemId,
            text: '温度条件尚未核实，请更正 condition 问题并保留限制。',
            purpose: 'UPDATE_ASSESSMENT',
            targetIssueKeys: ['condition'],
          });
          const applied = await commitReview(applyTurn, true);
          const appliedUpdate =
            applied.committed.assistantCandidate.jobAidWorkingUpdate;
          assert.equal(appliedUpdate.status, 'APPLIED');
          assert.equal(appliedUpdate.workRevision, 2);
          assert.notEqual(
            appliedUpdate.workRevisionRef,
            initialSave.workRevisionRef,
          );
          assert.equal(
            applied.claim.task.modelInput.jobAidContext.modelInput.preparation
              .goal,
            applyTurn.userMessage,
          );
          assert.deepEqual(
            applied.claim.task.modelInput.jobAidContext.modelInput.preparation
              .targetIssueKeys,
            ['condition'],
          );
          const unchangedTurn = await host.seedReviewTurn({
            workItemId,
            text: '核对后保持刚才已保存的温度条件更正。',
            purpose: null,
          });
          const unchanged = await commitReview(unchangedTurn, false);
          const unchangedUpdate =
            unchanged.committed.assistantCandidate.jobAidWorkingUpdate;
          assert.equal(unchangedUpdate.status, 'UNCHANGED');
          assert.equal(
            unchangedUpdate.workRevisionRef,
            appliedUpdate.workRevisionRef,
          );
          const pending = await host.seedEngineerContribution({
            workItemId,
            text: '本轮继续保留温度条件未核实的更正，不得恢复旧判断。',
          });
          const beforeOverall = await host.snapshot();
          assert.equal(beforeOverall.work.length, 2);
          assert.equal(
            beforeOverall.work.find((row) => row.work_revision === 2)
              .action_attempt_id,
            applied.claim.task.actionAttemptId,
          );
          const status = await host.readInitialStatus(workItemId);
          receipt.reviewToNative = {
            applied: appliedUpdate,
            unchanged: unchangedUpdate,
            statusBeforeOverall: status.initialAnalysis,
            savedWorkCountBeforeOverall: beforeOverall.work.length,
          };
          assert.equal(
            status.initialAnalysis.nextOperation,
            'SYNTHESIZE_OVERALL',
            'Use the existing actual authorized Overall stage, never invent an automatic successor',
          );
          phase = 'OVERALL';
          const synthesized = await runConsumerChild(
            consumerHost(host),
            configuration,
            hooks,
          );
          runs.push(synthesized);
          assertConsumerExit(synthesized);
          assert.deepEqual(gateway.errors, []);
          assert.equal(synthesized.result.result.status, 'ACKNOWLEDGED');
          assert.equal(overallRequests, 2);
          const actualContexts = messages.filter(
            (message) => message.phase === 'OVERALL',
          );
          assert.equal(actualContexts.length, 2);
          const sealedPreparation = overall.modelInput.preparation;
          for (const message of actualContexts) {
            const context = message.context;
            assert.equal(
              context.previousWork.workRevisionRef,
              appliedUpdate.workRevisionRef,
            );
            assert.equal(
              context.preparation.lastSaved.workRevisionRef,
              appliedUpdate.workRevisionRef,
            );
            assert.equal(context.preparation.goal, sealedPreparation.goal);
            assert.deepEqual(
              context.preparation.targetIssueKeys,
              sealedPreparation.targetIssueKeys,
            );
            assert.ok(
              context.preparation.savedUpdates.some(
                (update) =>
                  update.status === 'APPLIED' &&
                  update.workRevisionRef === appliedUpdate.workRevisionRef &&
                  update.affectedIssueKeys.includes('condition') &&
                  update.instruction === applyTurn.userMessage,
              ),
            );
            assert.ok(
              context.preparation.savedUpdates.some(
                (update) =>
                  update.status === 'UNCHANGED' &&
                  update.workRevisionRef === appliedUpdate.workRevisionRef &&
                  update.instruction === unchangedTurn.userMessage,
              ),
            );
            assert.ok(
              context.preparation.pendingEngineerInputs.some(
                (input) => input.ref === pending.contribution.contribution_ref,
              ),
            );
            assert.deepEqual(context.preparation.humanConfirmedDecisions, []);
            assert.equal(
              context.preparation.humanConfirmationStatus,
              'NOT_RECORDED',
            );
            assert.equal(
              JSON.stringify(context.previousWork).includes(oldIncorrectBody),
              false,
            );
          }
          const target = actualContexts[1].context.targetWork;
          assert.ok(
            target.issues
              .find((issue) => issue.issueKey === 'condition')
              .body.includes(correctedBody),
          );
          assert.equal(
            JSON.stringify(target).includes(oldIncorrectBody),
            false,
          );
          assert.notEqual(
            actualContexts[0].nativeSession,
            actualContexts[1].nativeSession,
            'The exact READ_WORK target must survive the actual session rebuild',
          );
          assert.equal(
            synthesized.trace.filter(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'save_assessment_work',
            ).length,
            0,
          );
          const final = await host.snapshot();
          assert.equal(final.work.length, 2);
          assert.equal(
            final.grants.find((grant) => grant.work_item_id === workItemId)
              .status,
            'COMPLETED',
          );
          receipt.reviewToNative.actualModelPreparations = actualContexts.map(
            (message) => message.context.preparation,
          );
          receipt.reviewToNative.actualReadTarget = {
            workRevisionRef: target.workRevisionRef,
            issueKeys: target.issues.map((issue) => issue.issueKey),
            correctedBodyPreserved: true,
          };
          receipt.reviewToNative.actualHttpRequests = gateway.requests.length;
          receipt.reviewToNative.overallHttpRequests = overallRequests;
          receipt.reviewToNative.extraSaveCount = 0;
          receipt.reviewToNative.acknowledged = true;
          receipt.reviewToNative.formalHumanConfirmationPositive = 'NOT_RUN';
        } finally {
          await gateway.close();
          receipt.nativeChildren = runs.map((run) => ({
            pid: run.pid,
            code: run.code,
            signal: run.signal,
          }));
          receipt.gatewayCleanup = { ownedListenerClosed: true };
        }
      }),
  );

  for (const registered of [true, false]) {
    test(
      `G08 actual config codec ${registered ? 'routes the frozen GLM binding' : 'rejects an unregistered frozen binding'} before HTTP`,
      { timeout: 60000 },
      async (t) =>
        withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
          const selected = {
            modelRef: 'miaoda/glm-5.3',
            displayName: 'GLM-5.3',
            providerKind: 'BUILT_IN',
            settingsRevision: 8,
            selectedAt: '2026-10-15T00:00:00.000Z',
          };
          await host.seed(
            `WI-core-p2-glm-${registered ? 'registered' : 'missing'}`,
            { executionModel: selected },
          );
          const runtimeConfigPath = join(
            checkpointRoot,
            'synthetic-runtime-config.json',
          );
          await writeFile(
            runtimeConfigPath,
            JSON.stringify({
              agents: {
                defaults: {
                  model: { primary: selected.modelRef, fallbacks: [] },
                  models: {
                    [registered ? selected.modelRef : 'miaoda/minimax-m3']: {},
                  },
                },
              },
              gateway: {
                auth: { token: 'offline-core-p2-fixture-only' },
                http: { endpoints: { chatCompletions: { enabled: true } } },
              },
            }),
            { mode: 0o600 },
          );
          let claim;
          const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
            assert.equal(
              registered,
              true,
              'Unregistered settings cannot dispatch',
            );
            if (ordinal === 1)
              return {
                action: 'SAVE_WORK',
                workJson: JSON.stringify(host.proposal(claim)),
              };
            assert.equal(ordinal, 2);
            return { action: 'FINISH' };
          });
          let run;
          try {
            run = await runConsumerChild(
              consumerHost(host),
              {
                entry: 'queue',
                gatewayUrl: gateway.gatewayUrl,
                runtimeConfigPath,
                nowIso: new Date().toISOString(),
                options: { checkpointRoot },
              },
              {
                afterCall: ({ method, input, value }) => {
                  if (
                    method === 'callTool' &&
                    input.name === 'begin_dynamic_evaluation'
                  )
                    claim = value;
                },
              },
            );
            assertConsumerExit(run);
            assert.deepEqual(gateway.errors, []);
            assert.deepEqual(claim.task.executionModel, selected);
            const snapshot = await host.snapshot();
            assert.equal(gateway.requests.length, registered ? 2 : 0);
            assert.equal(snapshot.work.length, registered ? 1 : 0);
            if (registered) {
              assert.ok(
                gateway.requests.every(
                  (request) => request.modelHeader === selected.modelRef,
                ),
              );
              assert.ok(
                gateway.requests.every(
                  (request) =>
                    !Object.hasOwn(request.request, 'max_completion_tokens'),
                ),
              );
              assert.equal(run.result.result.status, 'IN_PROGRESS');
            } else {
              assert.equal(run.result.result.status, 'REQUIRES_ATTENTION');
              assert.ok(
                JSON.stringify(run.result).includes(
                  'HOSTED_SELECTED_MODEL_NOT_REGISTERED',
                ),
              );
            }
            receipt.runtimeModelBinding = {
              configuration:
                'synthetic private file read by actual resolveRuntimeConfig',
              selected,
              registered,
              actualHttpRequests: gateway.requests.length,
              modelHeaders: gateway.requests.map(
                (request) => request.modelHeader,
              ),
              savedWorkCount: snapshot.work.length,
              providerReportedModel: null,
              actualProvider: 'NOT_RUN',
              modelShapes: await readModelShapes(checkpointRoot),
            };
          } finally {
            await gateway.close();
            if (run)
              receipt.nativeChildren = [
                { pid: run.pid, code: run.code, signal: run.signal },
              ];
            receipt.gatewayCleanup = { ownedListenerClosed: true };
          }
        }),
    );
  }

  const wrongName = namedStepPayload({ action: 'FINISH' });
  wrongName.choices[0].message.tool_calls[0].function.name = 'unapproved_tool';
  const protocolCases = [
    {
      category: 'NAMED_TOOL_MISSING',
      payload: completedTextPayload(),
      repair: true,
    },
    { category: 'NAMED_TOOL_MISMATCH', payload: wrongName, repair: true },
    {
      category: 'TOOL_SCHEMA_INVALID',
      payload: namedStepPayload({ action: 37 }),
      repair: true,
    },
    {
      category: 'UPSTREAM_ERROR_REPORTED',
      status: 503,
      repair: false,
      payload: {
        error: {
          type: 'api_error',
          message: 'PRIVATE_SYNTHETIC_ERROR_MUST_NOT_LEAVE_ADAPTER',
        },
      },
    },
    {
      category: 'GATEWAY_TOOL_CONVERSION_FAILED',
      status: 502,
      repair: false,
      payload: {
        error: {
          message:
            'tool_choice required a return_wiselink_assessment_step tool call, but the agent did not produce one',
        },
      },
    },
    ...[503, 200].map((status) => ({
      label: `UPSTREAM_ERROR_REPORTED_HTTP_${status}_WITH_LENGTH`,
      category: 'UPSTREAM_ERROR_REPORTED',
      status,
      repair: false,
      payload: {
        error: {
          type: 'api_error',
          message: 'PRIVATE_SYNTHETIC_ERROR_MUST_NOT_LEAVE_ADAPTER',
        },
        choices: [
          {
            finish_reason: 'length',
            message: {
              role: 'assistant',
              content: 'Conflicting synthetic partial output.',
            },
          },
        ],
      },
    })),
    {
      category: 'OUTPUT_LENGTH',
      repair: false,
      knownFailure: true,
      payload: {
        choices: [
          {
            finish_reason: 'length',
            message: {
              role: 'assistant',
              content: 'Synthetic truncated output.',
            },
          },
        ],
      },
    },
    {
      category: 'TERMINAL_RESPONSE_MISSING',
      status: 400,
      repair: false,
      payload: {
        error: {
          message: 'Agent run ended with an incomplete terminal response.',
        },
      },
    },
    {
      category: 'GATEWAY_JSON_INVALID',
      repair: false,
      raw: '{"choices":[',
    },
  ];
  for (const fixture of protocolCases) {
    test(
      `G02 protocol ${fixture.label ?? fixture.category} is classified after real SAVE with a bounded repair budget`,
      { timeout: 60000 },
      async (t) =>
        withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
          await host.seed(`WI-core-p2-${fixture.category.toLowerCase()}`);
          let claim;
          const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
            if (ordinal === 1)
              return {
                action: 'SAVE_WORK',
                workJson: JSON.stringify(host.proposal(claim, 'IN_PROGRESS')),
              };
            assert.ok(
              ordinal <= (fixture.repair ? 3 : 2),
              'No additional loop may multiply the request budget',
            );
            return {
              fixturePayload: fixture.payload,
              fixtureHttpStatus: fixture.status ?? 200,
              ...(fixture.raw ? { fixtureRaw: fixture.raw } : {}),
            };
          });
          let run;
          try {
            run = await runConsumerChild(
              consumerHost(host),
              {
                entry: 'queue',
                gatewayUrl: gateway.gatewayUrl,
                nowIso: new Date().toISOString(),
                options: { checkpointRoot },
              },
              {
                afterCall: ({ method, input, value }) => {
                  if (
                    method === 'callTool' &&
                    input.name === 'begin_dynamic_evaluation'
                  )
                    claim = value;
                },
              },
            );
            assertConsumerExit(run);
            assert.deepEqual(gateway.errors, []);
            assert.equal(gateway.requests.length, fixture.repair ? 3 : 2);
            const snapshot = await host.snapshot();
            assert.equal(snapshot.work.length, 1);
            assert.equal(
              run.trace.filter(
                (call) =>
                  call.method === 'callTool' &&
                  call.input.name === 'save_assessment_work',
              ).length,
              1,
            );
            const shapes = await readModelShapes(checkpointRoot);
            const failures = shapes.filter(
              (shape) => shape.protocolCategory === fixture.category,
            );
            receipt.protocolCase = {
              category: fixture.category,
              label: fixture.label ?? null,
              actualHttpRequests: gateway.requests.length,
              savedWorkCount: snapshot.work.length,
              observedFailures: failures,
            };
            assert.equal(failures.length, fixture.repair ? 2 : 1);
            assert.ok(
              failures.every((shape) => shape.upstreamDispatchCount === null),
            );
            assert.ok(
              failures.every(
                (shape) =>
                  shape.maxProtocolRepairs === 1 && shape.protocolRepairs <= 1,
              ),
            );
            assert.ok(
              failures.every(
                (shape) =>
                  shape.requestBudget.maxRounds === 64 &&
                  shape.requestBudget.transportRetries === 0,
              ),
            );
            assert.ok(
              failures.every((shape) =>
                Number.isSafeInteger(shape.localTransportRequestOrdinal),
              ),
            );
            assert.ok(
              failures.every(
                (shape) =>
                  shape.inputTokens === null && shape.outputTokens === null,
              ),
            );
            assert.equal(
              JSON.stringify(failures).includes(
                'PRIVATE_SYNTHETIC_ERROR_MUST_NOT_LEAVE_ADAPTER',
              ),
              false,
            );
            const rejections = await readCandidateRejections(checkpointRoot);
            const repairs = rejections.filter(
              (report) => report.repairScope === 'STAGE_PROTOCOL',
            );
            assert.equal(repairs.length, fixture.repair ? 1 : 0);
            if (fixture.repair) {
              assert.equal(repairs[0].delayMs, 1000);
              assert.equal(repairs[0].maxRepairs, 1);
              assert.ok(
                gateway.requests[2].receivedAtMonotonicMs -
                  gateway.requests[1].receivedAtMonotonicMs >=
                  900,
                'The actual transport must observe the declared one-second repair backoff',
              );
            } else
              assert.equal(
                failures[0].upstreamOutcome,
                fixture.knownFailure ? 'TERMINAL_RESPONSE_OBSERVED' : 'UNKNOWN',
              );
            const attempt = snapshot.attempts.find(
              (row) => row.attempt_id === claim.task.actionAttemptId,
            );
            assert.equal(
              attempt.status,
              fixture.repair || fixture.knownFailure ? 'FAILED' : 'RUNNING',
            );
            if (!fixture.repair && !fixture.knownFailure) {
              assert.equal(
                run.trace.filter((call) => call.method === 'blockWorkItem')
                  .length,
                0,
                'An error with conflicting length metadata cannot release UNKNOWN work',
              );
              assert.equal(
                run.trace.filter(
                  (call) =>
                    call.method === 'callTool' &&
                    call.input.name === 'cancel_action_attempt',
                ).length,
                0,
              );
            }
            receipt.protocolCase = {
              category: fixture.category,
              actualHttpRequests: gateway.requests.length,
              savedWorkCount: snapshot.work.length,
              attemptStatus: attempt.status,
              shapes: failures,
              repairReports: repairs,
              requestIntervalsMs: gateway.requests
                .slice(1)
                .map(
                  (request, index) =>
                    request.receivedAtMonotonicMs -
                    gateway.requests[index].receivedAtMonotonicMs,
                ),
              providerRequests: 'UNKNOWN',
              actualProvider: 'NOT_RUN',
            };
          } finally {
            await gateway.close();
            if (run)
              receipt.nativeChildren = [
                { pid: run.pid, code: run.code, signal: run.signal },
              ];
            receipt.gatewayCleanup = { ownedListenerClosed: true };
          }
        }),
    );
  }

  test(
    'G03 one stage protocol repair survives a valid intervening READ without resetting',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed('WI-core-p2-protocol-stage-budget');
        let claim;
        const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
          if (ordinal === 1)
            return {
              action: 'SAVE_WORK',
              workJson: JSON.stringify(host.proposal(claim, 'IN_PROGRESS')),
            };
          if (ordinal === 2 || ordinal === 4)
            return { fixturePayload: completedTextPayload() };
          assert.equal(
            ordinal,
            3,
            'A valid action must not authorize a second protocol repair',
          );
          return {
            action: 'READ_SOURCES',
            sourceRefs: [
              claim.modelInput.availableSources.find(
                (source) => source.kind === 'DOCUMENT_PASSAGE',
              ).ref,
            ],
            purpose: 'Real read between invalid replies',
            context: 'EXACT',
          };
        });
        let run;
        try {
          run = await runConsumerChild(
            consumerHost(host),
            {
              entry: 'queue',
              gatewayUrl: gateway.gatewayUrl,
              nowIso: new Date().toISOString(),
              options: { checkpointRoot },
            },
            {
              afterCall: ({ method, input, value }) => {
                if (
                  method === 'callTool' &&
                  input.name === 'begin_dynamic_evaluation'
                )
                  claim = value;
              },
            },
          );
          assertConsumerExit(run);
          assert.deepEqual(gateway.errors, []);
          assert.equal(gateway.requests.length, 4);
          const bodyCounts = gateway.requests.map((request) =>
            sourceBodyOccurrences(request.request),
          );
          assert.ok(
            bodyCounts.flat().every((body) => body.count === 1),
            'Each same-version source interval has one complete evidence body in the actual wire request',
          );
          const snapshot = await host.snapshot();
          assert.equal(snapshot.work.length, 1);
          const reads = run.trace.filter(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'read_assessment_sources',
          );
          assert.equal(reads.length, 1);
          assert.equal(reads[0].value.status, 'AVAILABLE');
          const attempt = snapshot.attempts.find(
            (row) => row.attempt_id === claim.task.actionAttemptId,
          );
          assert.equal(attempt.status, 'FAILED');
          const repairs = (
            await readCandidateRejections(checkpointRoot)
          ).filter((report) => report.repairScope === 'STAGE_PROTOCOL');
          assert.equal(repairs.length, 1);
          assert.equal(repairs[0].delayMs, 1000);
          receipt.stageProtocolBudget = {
            actualHttpRequests: gateway.requests.length,
            actualValidInterveningReads: reads.length,
            savedWorkCount: snapshot.work.length,
            attemptStatus: attempt.status,
            repairReports: repairs,
            shapes: await readModelShapes(checkpointRoot),
            sourceBodyCounts: bodyCounts,
          };
        } finally {
          await gateway.close();
          if (run)
            receipt.nativeChildren = [
              { pid: run.pid, code: run.code, signal: run.signal },
            ];
          receipt.gatewayCleanup = { ownedListenerClosed: true };
        }
      }),
  );

  for (const counter of ['missing', 'null', 'valid']) {
    test(
      `G03 actual consumer repair checkpoint ${counter} keeps one stage budget across restart`,
      { timeout: 60000 },
      async (t) =>
        withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
          const workItemId = `WI-core-p2-repair-checkpoint-${counter}`;
          await host.seed(workItemId);
          const { createCheckpointStore } = await import(
            `${nativeScripts}run-hosted-review-turn.mjs`
          );
          const { initialStageCheckpointPath } = await import(
            `${nativeScripts}initial-assessment-recovery.mjs`
          );
          const claims = [];
          let checkpoint;
          let save;
          let crashBoundary;
          let liveLeaseAttention;
          const successorId = `WI-core-p2-after-policy-${counter}`;
          let following = false;
          let successorClaim;
          let successorRequests = 0;
          const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
            if (following) {
              assert.equal(successorClaim.task.workItemId, successorId);
              successorRequests++;
              if (successorRequests === 1)
                return {
                  action: 'SAVE_WORK',
                  workJson: JSON.stringify(host.proposal(successorClaim)),
                };
              assert.equal(successorRequests, 2);
              return { action: 'FINISH' };
            }
            if (ordinal === 1)
              return {
                action: 'SAVE_WORK',
                workJson: JSON.stringify(
                  host.proposal(claims[0], 'IN_PROGRESS'),
                ),
              };
            if (ordinal === 3)
              return {
                action: 'READ_SOURCES',
                sourceRefs: [
                  claims[0].modelInput.availableSources.find(
                    (source) => source.kind === 'DOCUMENT_PASSAGE',
                  ).ref,
                ],
                purpose: 'Use the only protocol repair for a valid real read',
                context: 'EXACT',
              };
            assert.ok(
              ordinal === 2 || (counter === 'valid' && ordinal === 4),
              'A missing or null persisted budget must never start another HTTP request',
            );
            return { fixturePayload: completedTextPayload() };
          });
          const runs = [];
          const configuration = {
            entry: 'queue',
            gatewayUrl: gateway.gatewayUrl,
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          };
          const hooks = {
            afterCall: async ({ child, method, input, value }) => {
              if (method !== 'callTool') return;
              if (input.name === 'begin_dynamic_evaluation') {
                if (value.task.workItemId === successorId) {
                  successorClaim = value;
                  const occupied = await host.snapshot();
                  await assert.rejects(
                    host.callTool('save_assessment_work', {
                      ...save.args,
                      requestId: `late2-${save.args.requestId}`,
                      expectedWorkRevision: save.value.workRevision,
                    }),
                    (error) => {
                      assert.equal(
                        error.message,
                        'CANONICAL_WORK_ITEM_NOT_FOUND',
                      );
                      assert.equal(error.statusCode, 404);
                      receipt.repairCheckpoint.finalization.staleWriteWhileSuccessorOwnsSlot =
                        transportError(error);
                      return true;
                    },
                  );
                  assert.deepEqual(
                    await host.snapshot(),
                    occupied,
                    'An old attempt cannot alter saved work or the independent successor slot',
                  );
                  return;
                }
                claims.push(value);
                checkpoint = await createCheckpointStore(
                  initialStageCheckpointPath(
                    { checkpointRoot, workItemId },
                    'EVALUATE_JOBAID',
                    input.args.requestId,
                  ),
                );
              }
              if (
                input.name === 'save_assessment_work' &&
                input.args.workItemId === workItemId
              )
                save = { args: input.args, value };
              if (
                crashBoundary ||
                input.name !== 'heartbeat_action_attempt' ||
                gateway.requests.length !== 3
              )
                return;
              const state = await checkpoint.readOptional('assessment-state');
              if (state?.round !== 4) return;
              assert.equal(state.protocolRepairs, 1);
              assert.equal(state.noProgressRepairs, 0);
              crashBoundary = {
                operation: 'EVALUATE_JOBAID',
                attemptRef: claims[0].attemptRef,
                actionAttemptId: claims[0].task.actionAttemptId,
                taskType: claims[0].task.taskType,
                taskInputHash: claims[0].task.inputHash,
                persistedNextRound: state.round,
                protocolRepairs: state.protocolRepairs,
                boundary:
                  'Real heartbeat after repair HTTP 3 and persisted READ result; before HTTP 4',
              };
              child.kill('SIGKILL');
              return false;
            },
          };
          try {
            const stopped = await runConsumerChild(
              consumerHost(host),
              configuration,
              hooks,
            );
            runs.push(stopped);
            assertConsumerExit(stopped, true);
            assert.ok(crashBoundary);
            assert.equal(gateway.requests.length, 3);
            assert.deepEqual(gateway.errors, []);
            assert.ok(
              gateway.requests[2].receivedAtMonotonicMs -
                gateway.requests[1].receivedAtMonotonicMs >=
                1000,
              'The actual protocol repair HTTP follows its real one-second backoff',
            );
            const sourceReads = stopped.trace.filter(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'read_assessment_sources',
            );
            assert.equal(sourceReads.length, 1);
            assert.equal(sourceReads[0].value.status, 'AVAILABLE');
            const state = await checkpoint.readOptional('assessment-state');
            assert.equal(state.protocolRepairs, 1);
            assert.equal(state.round, 4);
            const binding = await checkpoint.readOptional('binding');
            const enabled = await checkpoint.readOptional('assessment-enabled');
            assert.equal(binding.operation, 'EVALUATE_JOBAID');
            assert.equal(
              enabled.generationPolicy.loopPolicyVersion,
              'stage-protocol-progress-v1',
            );
            if (counter === 'missing') delete state.protocolRepairs;
            if (counter === 'null') state.protocolRepairs = null;
            await checkpoint.write('assessment-state', state);
            const stageDirectory = initialStageCheckpointPath(
              { checkpointRoot, workItemId },
              'EVALUATE_JOBAID',
              binding.requestId ?? undefined,
            );
            const auditNames =
              counter === 'valid'
                ? []
                : (await readdir(stageDirectory)).filter((name) =>
                    /^(?:binding|assessment-enabled|assessment-state|assessment-round-[1-3]\.result|model\.(?:output-shape|candidate-rejection)[A-Za-z0-9.-]*)\.json$/u.test(
                      name,
                    ),
                  );
            const audit = await Promise.all(
              auditNames.map(async (name) => ({
                name,
                bytes: await readFile(join(stageDirectory, name)),
              })),
            );
            const before = await host.snapshot();
            assert.equal(before.work.length, 1);
            assert.equal(before.work[0].request_id, save.args.requestId);
            const priorAttempt = before.attempts.find(
              (row) => row.attempt_id === claims[0].task.actionAttemptId,
            );
            assert.equal(priorAttempt.status, 'RUNNING');
            if (counter === 'null') {
              assert.ok(Date.parse(claims[0].leaseExpiresAt) > Date.now());
              const observed = await runConsumerChild(
                consumerHost(host),
                configuration,
                hooks,
              );
              runs.push(observed);
              assertConsumerExit(observed);
              assert.equal(observed.result.result.status, 'REQUIRES_ATTENTION');
              assert.equal(
                observed.result.result.errorCode,
                'JOBAID_CHECKPOINT_POLICY_CHANGED',
              );
              assert.equal(claims.length, 1);
              assert.equal(gateway.requests.length, 3);
              assert.deepEqual(
                await host.snapshot(),
                before,
                'A still-live Host lease permits only saved-work observation, not close-only takeover',
              );
              const reads = observed.trace.filter(
                (call) =>
                  call.method === 'callTool' &&
                  call.input.name === 'read_assessment_work',
              );
              assert.equal(reads.length, 2);
              assert.equal(reads[1].input.args.requestId, save.args.requestId);
              assert.equal(
                reads[1].value.revision.workRevisionRef,
                save.value.workRevisionRef,
              );
              const stoppedClaim = JSON.parse(
                await readFile(
                  join(checkpointRoot, 'active-claim.json'),
                  'utf8',
                ),
              );
              assert.equal(stoppedClaim.consumerStopped, true);
              assert.equal(
                stoppedClaim.attentionCode,
                'JOBAID_CHECKPOINT_POLICY_CHANGED',
              );
              liveLeaseAttention = {
                actualResult: observed.result.result,
                hostWorkReads: reads.length,
                beginCountStillOne: claims.length,
                actualConsumerStoppedRecorded: true,
                businessSnapshotUnchanged: true,
              };
            }
            const advanced = await host.advance(31 * 60_000);
            const resumed = await runConsumerChild(
              consumerHost(host),
              {
                ...configuration,
                nowIso: advanced.hostNow,
                hostClockOffsetMs: advanced.offsetMs,
              },
              hooks,
            );
            runs.push(resumed);
            assertConsumerExit(resumed);
            if (counter !== 'valid') {
              receipt.policyCloseoutProgress = {
                counter,
                result: resumed.result.result,
                actualHttpCount: gateway.requests.length,
                leaseGenerations: claims.map((claim) => claim.leaseGeneration),
                tools: resumed.trace.map((call) =>
                  call.method === 'callTool' ? call.input.name : call.method,
                ),
              };
            }
            assert.equal(claims.length, 2);
            assert.equal(claims[1].attemptRef, claims[0].attemptRef);
            assert.deepEqual(claims[1].task, claims[0].task);
            assert.ok(claims[1].leaseGeneration > claims[0].leaseGeneration);
            assert.notEqual(claims[1].leaseToken, claims[0].leaseToken);
            assert.deepEqual(await checkpoint.readOptional('binding'), binding);
            assert.deepEqual(
              await checkpoint.readOptional('assessment-enabled'),
              enabled,
            );
            const after = await host.snapshot();
            assert.deepEqual(after.work, before.work);
            const current = after.attempts.find(
              (row) => row.attempt_id === priorAttempt.attempt_id,
            );
            assert.equal(
              current.task_envelope_json,
              priorAttempt.task_envelope_json,
            );
            assert.equal(current.status, 'FAILED');
            assert.equal(gateway.requests.length, counter === 'valid' ? 4 : 3);
            const errorCode =
              counter === 'valid'
                ? 'JOBAID_PROTOCOL_REPAIR_EXHAUSTED'
                : 'JOBAID_CHECKPOINT_POLICY_CHANGED';
            assert.equal(
              resumed.result.result.errorCode,
              'AUTO_WORK_ITEM_CONSUMER_STOPPED',
            );
            const failureResult = JSON.parse(current.result_envelope_json);
            assert.equal(failureResult.status, 'FAILED');
            assert.equal(failureResult.errorCode, errorCode);
            assert.equal(resumed.consumerReports.length, 1);
            assert.equal(
              resumed.consumerReports[0].modelCallCount,
              counter === 'valid' ? 1 : 0,
            );
            const restoredState =
              await checkpoint.readOptional('assessment-state');
            assert.equal(
              Object.hasOwn(restoredState, 'protocolRepairs'),
              counter !== 'missing',
            );
            if (counter !== 'missing')
              assert.equal(
                restoredState.protocolRepairs,
                counter === 'null' ? null : 1,
              );
            const repairs = (
              await readCandidateRejections(checkpointRoot)
            ).filter((report) => report.repairScope === 'STAGE_PROTOCOL');
            assert.equal(repairs.length, 1);
            assert.equal(repairs[0].correctionNo, 1);
            assert.equal(repairs[0].code, 'JOBAID_PROTOCOL_NAMED_TOOL_MISSING');
            assert.equal(
              resumed.trace.some(
                (call) =>
                  call.method === 'blockWorkItem' ||
                  (call.method === 'callTool' &&
                    ['save_assessment_work', 'cancel_action_attempt'].includes(
                      call.input.name,
                    )),
              ),
              false,
            );
            // A local policy rejection cannot revoke access to real saved work.
            const readback = await host.callTool('read_assessment_work', {
              attemptRef: claims[0].attemptRef,
              workItemId,
              requestId: save.args.requestId,
            });
            assert.equal(readback.revision.requestId, save.args.requestId);
            assert.equal(
              readback.revision.workRevisionRef,
              save.value.workRevisionRef,
            );
            assert.deepEqual(await host.snapshot(), after);
            const recoveryTools = resumed.trace
              .filter((call) => call.method === 'callTool')
              .map((call) => ({
                name: call.input.name,
                attemptRef: call.input.args.attemptRef ?? null,
                requestId: call.input.args.requestId ?? null,
                executionStatus: call.value?.executionStatus ?? null,
                workRevisionRef: call.value?.revision?.workRevisionRef ?? null,
                errorCode: call.error?.message ?? null,
              }));
            const consumerReads = resumed.trace.filter(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'read_assessment_work',
            );
            if (counter === 'valid') assert.equal(consumerReads.length, 0);
            if (counter !== 'valid') {
              const beginIndex = resumed.trace.findIndex(
                (call) =>
                  call.method === 'callTool' &&
                  call.input.name === 'begin_dynamic_evaluation',
              );
              for (const reads of [
                consumerReads.filter(
                  (call) => resumed.trace.indexOf(call) < beginIndex,
                ),
                consumerReads.filter(
                  (call) => resumed.trace.indexOf(call) > beginIndex,
                ),
              ]) {
                assert.ok(
                  reads.length >= 2,
                  'The exact Host work/key pair is checked both before and after taking the new lease',
                );
                assert.equal(reads.length % 2, 0);
              }
              assert.equal(consumerReads.length % 2, 0);
              for (let pair = 0; pair < consumerReads.length; pair += 2) {
                assert.equal(
                  consumerReads[pair].input.args.requestId,
                  undefined,
                );
                assert.equal(
                  consumerReads[pair + 1].input.args.requestId,
                  save.args.requestId,
                );
              }
              for (const call of consumerReads) {
                assert.equal(call.input.args.attemptRef, claims[0].attemptRef);
                assert.equal(call.input.args.workItemId, workItemId);
                assert.equal(
                  call.value.revision.workRevisionRef,
                  save.value.workRevisionRef,
                );
                assert.equal(
                  call.value.revision.requestId,
                  save.args.requestId,
                );
              }
              assert.deepEqual(
                consumerReads[0].value.revision,
                consumerReads[1].value.revision,
              );
              assert.equal(resumed.result.result.status, 'REQUIRES_ATTENTION');
              assert.equal(resumed.consumerReports[0].stageStatus, 'FAILED');
            }
            receipt.repairCheckpoint = {
              counter,
              liveLeaseAttention: liveLeaseAttention ?? null,
              crashBoundary,
              resumedLogicalClock: advanced,
              childClockSeam:
                'Only owned child Date matches existing Host fixture.advance; no database, task, lease or recovery marker edit',
              initialHttp: [1, 2],
              actualRepairHttp: 3,
              resumedHttp: counter === 'valid' ? [4] : [],
              actualHttpCount: gateway.requests.length,
              actualSourceReads: sourceReads.length,
              protocolBackoffActualMs:
                gateway.requests[2].receivedAtMonotonicMs -
                gateway.requests[1].receivedAtMonotonicMs,
              leaseGenerations: claims.map((claim) => claim.leaseGeneration),
              sameOperationAttemptTask: true,
              errorCode,
              queueErrorCode: resumed.result.result.errorCode,
              actualConsumerReports: resumed.consumerReports,
              hostAttemptStatus: current.status,
              savedWorkCount: after.work.length,
              originalSaveKeyPreserved: true,
              authorizedHostReadback: readback.revision.workRevisionRef,
              hostReadWasZeroWrite: true,
              recoveryTools,
              consumerWorkReadCount: consumerReads.length,
              consumerOriginalSaveKeyVerified: counter !== 'valid',
              consumerBusinessWrites: 'FAILED Result commit',
              readbackScope:
                'Missing/null reads Host latest/original SAVE key before and after the same-task lease takeover; completed-response proof permits only FAILED/POLICY_CHANGED with zero new model/SAVE. Valid budget continues the original protocol stage.',
              repairReports: repairs,
              shapes: await readModelShapes(checkpointRoot),
            };
            if (counter !== 'valid') {
              assert.equal(
                await checkpoint.readOptional('assessment-round-4.started'),
                null,
              );
              const finalization = {
                initialHostStatus: current.status,
                originalSaveKey: save.args.requestId,
                originalWorkRevisionRef: save.value.workRevisionRef,
                knownCompleteHttpRounds: [1, 2, 3],
                nextHttpNeverStarted: true,
                auditFiles: auditNames,
                naturalTicks: [],
              };
              receipt.repairCheckpoint.finalization = finalization;
              const staleWriteBefore = await host.snapshot();
              await assert.rejects(
                host.callTool('save_assessment_work', {
                  ...save.args,
                  requestId: `late-${save.args.requestId}`,
                  expectedWorkRevision: save.value.workRevision,
                }),
                (error) => {
                  assert.equal(
                    error.message,
                    'JOBAID_WORK_LEASE_FENCE_REJECTED',
                  );
                  finalization.expiredOriginalLeaseWrite =
                    transportError(error);
                  return true;
                },
              );
              assert.deepEqual(await host.snapshot(), staleWriteBefore);
              await host.seed(successorId);
              let finalized;
              for (let tick = 1; tick <= 2; tick++) {
                finalized = await runConsumerChild(
                  consumerHost(host),
                  {
                    ...configuration,
                    nowIso: new Date().toISOString(),
                    hostClockOffsetMs: advanced.offsetMs,
                  },
                  hooks,
                );
                runs.push(finalized);
                assertConsumerExit(finalized);
                const observed = await host.snapshot();
                const originalAttempt = observed.attempts.find(
                  (row) => row.attempt_id === priorAttempt.attempt_id,
                );
                finalization.naturalTicks.push({
                  tick,
                  result: finalized.result.result,
                  hostAttemptStatus: originalAttempt.status,
                  hostTerminalReason: originalAttempt.terminal_reason,
                  tools: finalized.trace.map((call) =>
                    call.method === 'callTool' ? call.input.name : call.method,
                  ),
                });
                assert.equal(
                  gateway.requests.length,
                  3,
                  'Natural policy finalization cannot dispatch the original model again',
                );
                if (
                  finalized.result.result.status === 'BLOCKED_CLAIM_FINALIZED'
                )
                  break;
              }
              assert.equal(
                finalized.result.result.status,
                'BLOCKED_CLAIM_FINALIZED',
                'A known settled local policy failure must not keep its automatic queue slot indefinitely',
              );
              assert.equal(
                JSON.parse(
                  await readFile(
                    join(checkpointRoot, 'active-claim.json'),
                    'utf8',
                  ),
                ),
                null,
              );
              const released = await host.snapshot();
              const originalRows = released.work.filter(
                (row) => row.work_item_id === workItemId,
              );
              assert.deepEqual(originalRows, Array.from(after.work));
              assert.equal(
                released.grants.find((row) => row.work_item_id === workItemId)
                  .status,
                'BLOCKED',
              );
              following = true;
              const successor = await runConsumerChild(
                consumerHost(host),
                {
                  ...configuration,
                  nowIso: new Date().toISOString(),
                  hostClockOffsetMs: advanced.offsetMs,
                },
                hooks,
              );
              runs.push(successor);
              assertConsumerExit(successor);
              assert.equal(successor.result.result.workItemId, successorId);
              assert.equal(
                successor.result.result.consumerStatus,
                'INITIAL_STAGE_SAVED',
              );
              const next = successor.trace.find(
                (call) => call.method === 'nextWorkItem',
              );
              assert.equal(next.input?.resumeWorkItemId, undefined);
              assert.equal(next.value.workItemId, successorId);
              assert.equal(successorRequests, 2);
              const final = await host.snapshot();
              assert.deepEqual(
                final.work.filter((row) => row.work_item_id === workItemId),
                originalRows,
              );
              assert.equal(
                final.work.filter((row) => row.work_item_id === successorId)
                  .length,
                1,
              );
              assert.equal(
                final.attempts.find(
                  (row) =>
                    row.attempt_id === successorClaim.task.actionAttemptId,
                ).status,
                'SUCCEEDED',
              );
              for (const entry of audit)
                assert.deepEqual(
                  await readFile(join(stageDirectory, entry.name)),
                  entry.bytes,
                  'Original bad-budget evidence and complete HTTP audit remain byte-for-byte through closure and successor commit',
                );
              finalization.finalStatus = finalized.result.result.status;
              finalization.originalSavedWorkCount = originalRows.length;
              finalization.originalAuditRetained = true;
              finalization.independentSuccessor = successorId;
              finalization.successorHttpRequests = successorRequests;
              finalization.successorSavedAndCommitted = true;
              finalization.totalActualHttpRequests = gateway.requests.length;
              finalization.successorClaimGeneration =
                next.value.leaseGeneration;
            }
          } finally {
            await gateway.close();
            receipt.nativeChildren = runs.map((run) => ({
              pid: run.pid,
              code: run.code,
              signal: run.signal,
            }));
            receipt.gatewayCleanup = { ownedListenerClosed: true };
          }
        }),
    );
  }

  test(
    'G03 damaged repair budget with an actual unknown HTTP outcome never closes or replays the attempt',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        const workItemId = 'WI-core-p2-policy-unknown';
        await host.seed(workItemId);
        const { createCheckpointStore } = await import(
          `${nativeScripts}run-hosted-review-turn.mjs`
        );
        const { initialStageCheckpointPath } = await import(
          `${nativeScripts}initial-assessment-recovery.mjs`
        );
        let claim;
        let save;
        let begins = 0;
        const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
          if (ordinal === 1)
            return {
              action: 'SAVE_WORK',
              workJson: JSON.stringify(host.proposal(claim, 'IN_PROGRESS')),
            };
          if (ordinal === 2) return { fixturePayload: completedTextPayload() };
          if (ordinal === 3)
            return {
              action: 'READ_SOURCES',
              sourceRefs: [
                claim.modelInput.availableSources.find(
                  (source) => source.kind === 'DOCUMENT_PASSAGE',
                ).ref,
              ],
              purpose: 'Real source read after the only protocol repair',
              context: 'EXACT',
            };
          assert.equal(
            ordinal,
            4,
            'An unknown HTTP result cannot be redispatched',
          );
          return { fixtureSocketCut: true };
        });
        const runs = [];
        const configuration = {
          entry: 'queue',
          gatewayUrl: gateway.gatewayUrl,
          nowIso: new Date().toISOString(),
          options: { checkpointRoot },
        };
        const hooks = {
          afterCall: ({ method, input, value }) => {
            if (method !== 'callTool') return;
            if (input.name === 'begin_dynamic_evaluation') {
              claim = value;
              begins++;
            }
            if (input.name === 'save_assessment_work')
              save = { args: input.args, value };
          },
        };
        try {
          const unknown = await runConsumerChild(
            consumerHost(host),
            configuration,
            hooks,
          );
          runs.push(unknown);
          assertConsumerExit(unknown);
          assert.equal(unknown.result.result.status, 'REQUIRES_ATTENTION');
          assert.equal(unknown.consumerReports[0].attemptStatus, 'UNKNOWN');
          assert.equal(gateway.requests.length, 4);
          assert.equal(gateway.requests[3].connectionTerminatedBeforeEnd, true);
          const stageDirectory = initialStageCheckpointPath(
            { checkpointRoot, workItemId },
            'EVALUATE_JOBAID',
          );
          const checkpoint = await createCheckpointStore(stageDirectory);
          const state = await checkpoint.readOptional('assessment-state');
          assert.equal(state.round, 4);
          assert.equal(state.protocolRepairs, 1);
          assert.ok(
            await checkpoint.readOptional('assessment-round-4.started'),
          );
          assert.equal(
            await checkpoint.readOptional('assessment-round-4.result'),
            null,
          );
          assert.equal(
            (await checkpoint.readOptional('run-result')).attemptStatus,
            'UNKNOWN',
          );
          state.protocolRepairs = null;
          await checkpoint.write('assessment-state', state);
          const auditNames = [
            'assessment-round-4.started.json',
            'run-result.json',
            'assessment-state.json',
          ];
          const audit = await Promise.all(
            auditNames.map(async (name) => ({
              name,
              bytes: await readFile(join(stageDirectory, name)),
            })),
          );
          const before = await host.snapshot();
          assert.equal(before.work.length, 1);
          const advanced = await host.advance(31 * 60_000);
          const resumed = await runConsumerChild(
            consumerHost(host),
            {
              ...configuration,
              nowIso: advanced.hostNow,
              hostClockOffsetMs: advanced.offsetMs,
            },
            hooks,
          );
          runs.push(resumed);
          assertConsumerExit(resumed);
          assert.equal(resumed.result.result.status, 'REQUIRES_ATTENTION');
          assert.equal(gateway.requests.length, 4);
          assert.equal(begins, 1);
          const after = await host.snapshot();
          assert.deepEqual(
            after,
            before,
            'Unknown provider outcome and saved work are never forced terminal or released by a damaged local counter',
          );
          const attempt = after.attempts.find(
            (row) => row.attempt_id === claim.task.actionAttemptId,
          );
          assert.equal(attempt.status, 'RUNNING');
          assert.equal(attempt.result_envelope_json, null);
          assert.equal(after.work[0].request_id, save.args.requestId);
          assert.equal(
            after.work[0].assessment_work_revision_id,
            save.value.workRevisionRef,
          );
          assert.equal(
            resumed.trace.some(
              (call) =>
                [
                  'blockWorkItem',
                  'acknowledgeWorkItem',
                  'nextWorkItem',
                ].includes(call.method) ||
                (call.method === 'callTool' &&
                  [
                    'begin_dynamic_evaluation',
                    'heartbeat_action_attempt',
                    'save_assessment_work',
                    'cancel_action_attempt',
                    'commit_dynamic_evaluation_candidate',
                  ].includes(call.input.name)),
            ),
            false,
          );
          const reads = resumed.trace.filter(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'read_assessment_work',
          );
          assert.equal(reads.length, 2);
          assert.equal(reads[1].input.args.requestId, save.args.requestId);
          assert.equal(
            reads[1].value.revision.workRevisionRef,
            save.value.workRevisionRef,
          );
          const active = JSON.parse(
            await readFile(join(checkpointRoot, 'active-claim.json'), 'utf8'),
          );
          assert.equal(active.workItemId, workItemId);
          assert.equal(active.consumerStopped, true);
          for (const entry of audit)
            assert.deepEqual(
              await readFile(join(stageDirectory, entry.name)),
              entry.bytes,
            );
          const shapes = await readModelShapes(checkpointRoot);
          assert.ok(
            shapes.some(
              (shape) =>
                shape.protocolCategory === 'TRANSPORT_OUTCOME_UNKNOWN' &&
                shape.upstreamOutcome === 'UNKNOWN',
            ),
          );
          assert.deepEqual(gateway.errors, []);
          receipt.policyUnknownControl = {
            workItemId,
            attemptRef: claim.attemptRef,
            taskInputHash: claim.task.inputHash,
            initialHttpCount: 4,
            actualProtocolRepairHttp: 3,
            socketCutHttp: 4,
            resumedHttpCount: 0,
            initialOnlyBeginCount: begins,
            queueErrorCode: resumed.result.result.errorCode,
            hostAttemptStatus: attempt.status,
            consumerWorkReadCount: reads.length,
            originalSaveKey: save.args.requestId,
            originalWorkRevisionRef: save.value.workRevisionRef,
            unchangedUnknownAudit: auditNames,
            businessRowsUnchanged: true,
            originalClaimRetained: true,
            providerTerminalClaimed: false,
            shapes,
          };
        } finally {
          await gateway.close();
          receipt.nativeChildren = runs.map((run) => ({
            pid: run.pid,
            code: run.code,
            signal: run.signal,
          }));
          receipt.gatewayCleanup = { ownedListenerClosed: true };
        }
      }),
  );

  for (const tamper of [false, true]) {
    test(
      `G08 persisted model binding ${tamper ? 'rejects a replaced sealed task' : 'reaches actual HTTP unchanged'}`,
      { timeout: 60000 },
      async (t) =>
        withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
          const workItemId = `WI-core-p2-model-${tamper ? 'tampered' : 'bound'}`;
          const selected = {
            modelRef: 'miaoda/minimax-m3',
            displayName: 'MiniMax-M3',
            providerKind: 'BUILT_IN',
            settingsRevision: 7,
            selectedAt: '2026-10-15T00:00:00.000Z',
          };
          await host.seed(workItemId, { executionModel: selected });
          assert.deepEqual(
            await host.hosted(() =>
              host.modelSettings.readWorkItemModel(host.tenantId, workItemId),
            ),
            selected,
          );
          let claim;
          let originalTask;
          const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
            assert.equal(
              tamper,
              false,
              'A modified sealed task cannot reach HTTP',
            );
            if (ordinal === 1)
              return {
                action: 'SAVE_WORK',
                workJson: JSON.stringify(host.proposal(claim)),
              };
            assert.equal(ordinal, 2);
            return { action: 'FINISH' };
          });
          let run;
          try {
            run = await runConsumerChild(
              consumerHost(host),
              {
                entry: 'queue',
                gatewayUrl: gateway.gatewayUrl,
                nowIso: new Date().toISOString(),
                options: { checkpointRoot },
              },
              {
                afterCall: ({ method, input, value }) => {
                  if (
                    method !== 'callTool' ||
                    input.name !== 'begin_dynamic_evaluation'
                  )
                    return;
                  claim = value;
                  originalTask = structuredClone(value.task);
                  if (tamper)
                    value.task.executionModel = {
                      ...value.task.executionModel,
                      modelRef: 'unapproved/replacement',
                      settingsRevision:
                        value.task.executionModel.settingsRevision + 1,
                    };
                },
              },
            );
            assert.equal(run.timedOut, false);
            assert.equal(run.code, 0, run.output);
            assert.throws(() => process.kill(run.pid, 0), { code: 'ESRCH' });
            assert.deepEqual(originalTask.executionModel, selected);
            assert.deepEqual(gateway.errors, []);
            const snapshot = await host.snapshot();
            const attempt = snapshot.attempts.find(
              (row) => row.attempt_id === originalTask.actionAttemptId,
            );
            assert.deepEqual(
              JSON.parse(attempt.execution_model_json),
              selected,
            );
            if (tamper) {
              assert.equal(gateway.requests.length, 0);
              assert.equal(snapshot.work.length, 0);
              assert.notEqual(attempt.status, 'SUCCEEDED');
              assert.ok(
                JSON.stringify(run.result).includes('HASH'),
                'The actual consumer must reject the changed sealed envelope',
              );
            } else {
              assertConsumerExit(run);
              assert.equal(gateway.requests.length, 2);
              assert.ok(
                gateway.requests.every(
                  (request) => request.modelHeader === selected.modelRef,
                ),
              );
              assert.equal(snapshot.work.length, 1);
              assert.equal(attempt.status, 'SUCCEEDED');
              const shapes = await readModelShapes(checkpointRoot);
              assert.ok(shapes.length >= 2);
              assert.ok(
                shapes.every(
                  (shape) =>
                    shape.inputTokens === null && shape.outputTokens === null,
                ),
              );
            }
            receipt.modelBinding = {
              actualPersistedSelection: selected,
              mutatedTransportOnly: tamper,
              actualHttpRequests: gateway.requests.length,
              observedModelHeaders: gateway.requests.map(
                (request) => request.modelHeader,
              ),
              savedWorkCount: snapshot.work.length,
              providerReportedModel: null,
              providerUsage: null,
              globalSettingsManagement: 'NOT_RUN',
              result: run.result,
            };
          } finally {
            await gateway.close();
            if (run)
              receipt.nativeChildren = [
                { pid: run.pid, code: run.code, signal: run.signal },
              ];
            receipt.gatewayCleanup = { ownedListenerClosed: true };
          }
        }),
    );
  }

  for (const invalidation of ['actor', 'source']) {
    test(
      `G03 actual ${invalidation} invalidation after SAVE forbids further HTTP dispatch and preserves work`,
      { timeout: 60000 },
      async (t) =>
        withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
          const workItemId = `WI-core-p2-invalidated-${invalidation}`;
          await host.seed(workItemId);
          let claim;
          let invalidated = false;
          const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
            assert.equal(
              ordinal,
              1,
              'Invalid authorization cannot be repaired by retrying the model',
            );
            return {
              action: 'SAVE_WORK',
              workJson: JSON.stringify(host.proposal(claim, 'IN_PROGRESS')),
            };
          });
          let run;
          try {
            run = await runConsumerChild(
              consumerHost(host),
              {
                entry: 'queue',
                gatewayUrl: gateway.gatewayUrl,
                nowIso: new Date().toISOString(),
                options: { checkpointRoot },
              },
              {
                afterCall: async ({ method, input, value }) => {
                  if (method !== 'callTool') return;
                  if (input.name === 'begin_dynamic_evaluation') claim = value;
                  if (input.name !== 'save_assessment_work') return;
                  assert.equal(invalidated, false);
                  if (invalidation === 'actor') await host.revokeActor();
                  else await host.correctSource(workItemId);
                  invalidated = true;
                },
              },
            );
            assert.equal(run.timedOut, false);
            assert.equal(run.code, 0, run.output);
            assert.throws(() => process.kill(run.pid, 0), { code: 'ESRCH' });
            assert.equal(invalidated, true);
            assert.deepEqual(gateway.errors, []);
            assert.equal(gateway.requests.length, 1);
            const snapshot = await host.snapshot();
            assert.equal(snapshot.work.length, 1);
            assert.equal(
              run.trace.filter(
                (call) =>
                  call.method === 'callTool' &&
                  call.input.name === 'save_assessment_work',
              ).length,
              1,
            );
            const rejected = run.trace.filter((call) => call.error);
            assert.ok(
              rejected.length > 0,
              'The actual Host must reject the invalid qualification',
            );
            assert.notEqual(
              snapshot.attempts.find(
                (item) => item.attempt_id === claim.task.actionAttemptId,
              ).status,
              'SUCCEEDED',
            );
            receipt.qualificationInvalidation = {
              kind: invalidation,
              afterActualSave: true,
              actualHttpRequests: gateway.requests.length,
              savedWorkCount: snapshot.work.length,
              rejections: rejected.map((call) => ({
                method: call.method,
                tool: call.input?.name ?? null,
                error: call.error,
              })),
              result: run.result,
              retryDispatchCount: 0,
            };
          } finally {
            await gateway.close();
            if (run)
              receipt.nativeChildren = [
                { pid: run.pid, code: run.code, signal: run.signal },
              ];
            receipt.gatewayCleanup = { ownedListenerClosed: true };
          }
        }),
    );
  }

  test(
    'G02 complete named tool without finish_reason executes and keeps unknown usage honest',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed('WI-core-p2-no-finish-field');
        let claim;
        const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
          assert.ok(claim);
          if (ordinal === 1)
            return {
              fixturePayload: namedStepPayload(
                {
                  action: 'READ_SOURCES',
                  sourceRefs: [
                    claim.modelInput.availableSources.find(
                      (source) => source.kind === 'DOCUMENT_PASSAGE',
                    ).ref,
                  ],
                  purpose: 'Read exact original with complete named tool',
                  context: 'EXACT',
                },
                { omitFinishReason: true },
              ),
            };
          if (ordinal === 2)
            return {
              action: 'SAVE_WORK',
              workJson: JSON.stringify(host.proposal(claim)),
            };
          assert.equal(ordinal, 3);
          return { action: 'FINISH' };
        });
        let run;
        try {
          run = await runConsumerChild(
            consumerHost(host),
            {
              entry: 'queue',
              gatewayUrl: gateway.gatewayUrl,
              nowIso: new Date().toISOString(),
              options: { checkpointRoot },
            },
            {
              afterCall: ({ method, input, value }) => {
                if (
                  method === 'callTool' &&
                  input.name === 'begin_dynamic_evaluation'
                )
                  claim = value;
              },
            },
          );
          assertConsumerExit(run);
          assert.deepEqual(gateway.errors, []);
          assert.equal(gateway.requests.length, 3);
          assert.equal(
            run.trace.filter(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'read_assessment_sources',
            ).length,
            1,
          );
          const snapshot = await host.snapshot();
          assert.equal(snapshot.work.length, 1);
          assert.equal(
            snapshot.attempts.find(
              (attempt) => attempt.attempt_id === claim.task.actionAttemptId,
            ).status,
            'SUCCEEDED',
          );
          const shapes = await readModelShapes(checkpointRoot);
          const first = shapes.find((shape) => shape.round === 1);
          assert.ok(first);
          assert.equal(first.finishReason, null);
          assert.equal(first.inputTokens, null);
          assert.equal(first.outputTokens, null);
          receipt.missingFinishField = {
            actualHttpRequests: gateway.requests.length,
            hostReadCount: 1,
            savedWorkCount: snapshot.work.length,
            observedShape: first,
            meaning:
              'Missing finish_reason is unknown metadata, not truncation or business completion',
          };
        } finally {
          await gateway.close();
          if (run)
            receipt.nativeChildren = [
              { pid: run.pid, code: run.code, signal: run.signal },
            ];
          receipt.gatewayCleanup = { ownedListenerClosed: true };
        }
      }),
  );

  test(
    'G02 actual interrupted HTTP body stays UNKNOWN and restart does not replay or duplicate saved work',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed('WI-core-p2-interrupted-http');
        let claim;
        const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
          assert.ok(claim);
          if (ordinal === 1)
            return {
              action: 'SAVE_WORK',
              workJson: JSON.stringify(host.proposal(claim, 'IN_PROGRESS')),
            };
          assert.equal(
            ordinal,
            2,
            'An unknown response cannot authorize a new dispatch',
          );
          return { fixtureSocketCut: true };
        });
        const runs = [];
        try {
          const configuration = {
            entry: 'queue',
            gatewayUrl: gateway.gatewayUrl,
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          };
          const hooks = {
            afterCall: ({ method, input, value }) => {
              if (
                method === 'callTool' &&
                input.name === 'begin_dynamic_evaluation'
              )
                claim = value;
            },
          };
          const first = await runConsumerChild(
            consumerHost(host),
            configuration,
            hooks,
          );
          runs.push(first);
          assertConsumerExit(first);
          const after = await host.snapshot();
          const second = await runConsumerChild(
            consumerHost(host),
            configuration,
            hooks,
          );
          runs.push(second);
          assertConsumerExit(second);
          assert.deepEqual(gateway.errors, []);
          assert.equal(gateway.requests.length, 2);
          assert.equal(after.work.length, 1);
          const final = await host.snapshot();
          assert.equal(final.work.length, 1);
          assert.equal(final.work[0].request_id, after.work[0].request_id);
          assert.equal(
            runs
              .flatMap((run) => run.trace)
              .filter(
                (call) =>
                  call.method === 'callTool' &&
                  call.input.name === 'save_assessment_work',
              ).length,
            1,
          );
          const attempt = final.attempts.find(
            (item) => item.attempt_id === claim.task.actionAttemptId,
          );
          assert.equal(attempt.status, 'RUNNING');
          assert.equal(first.result.result.status, 'REQUIRES_ATTENTION');
          assert.equal(second.result.result.status, 'REQUIRES_ATTENTION');
          assert.equal(gateway.requests[1].connectionTerminatedBeforeEnd, true);
          receipt.interruptedHttp = {
            actualHttpRequests: gateway.requests.length,
            actualSocketTerminatedBeforeEnd: true,
            statuses: runs.map((run) => run.result.result.status),
            attemptStatus: attempt.status,
            savedWorkCount: final.work.length,
            saveKeyPreserved:
              final.work[0].request_id === after.work[0].request_id,
            modelShapes: await readModelShapes(checkpointRoot),
            providerTerminal: 'UNKNOWN',
            extraDispatchesOnRestart: 0,
          };
          const unknownShape = receipt.interruptedHttp.modelShapes.find(
            (shape) => shape.protocolCategory === 'TRANSPORT_OUTCOME_UNKNOWN',
          );
          assert.ok(unknownShape);
          assert.equal(unknownShape.upstreamOutcome, 'UNKNOWN');
          assert.equal(unknownShape.upstreamDispatchCount, null);
          assert.equal(unknownShape.localTransportRequestOrdinal, 2);
          assert.equal(unknownShape.requestBudget.maxRounds, 64);
          assert.equal(unknownShape.requestBudget.transportRetries, 0);
          assert.equal(
            unknownShape.metricUnits.tokens,
            'REPORTED_USAGE_OR_NULL',
          );
          assert.equal(unknownShape.inputTokens, null);
          assert.equal(unknownShape.outputTokens, null);
        } finally {
          await gateway.close();
          receipt.nativeChildren = runs.map((run) => ({
            pid: run.pid,
            code: run.code,
            signal: run.signal,
          }));
          receipt.gatewayCleanup = { ownedListenerClosed: true };
        }
      }),
  );

  test(
    'G01 G06 actual HTTP consumer permits two distinct source READs before one substantive SAVE',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed('WI-core-p2-continuous-read');
        let claim;
        let sources;
        const gateway = await startOwnedModelEndpoint(({ ordinal }) => {
          assert.ok(claim);
          sources ??= claim.modelInput.availableSources.filter(
            (source) =>
              source.kind === 'DOCUMENT_PASSAGE' &&
              source.ref.startsWith('DOCUMENT_ORIGINAL:'),
          );
          assert.ok(sources.length >= 2);
          if (ordinal <= 2)
            return {
              action: 'READ_SOURCES',
              sourceRefs: [sources[ordinal - 1].ref],
              purpose: `Read distinct exact original interval ${ordinal}`,
              context: 'EXACT',
            };
          if (ordinal === 3)
            return {
              action: 'SAVE_WORK',
              workJson: JSON.stringify(host.proposal(claim)),
            };
          assert.equal(ordinal, 4);
          return { action: 'FINISH' };
        });
        let run;
        try {
          run = await runConsumerChild(
            consumerHost(host),
            {
              entry: 'queue',
              gatewayUrl: gateway.gatewayUrl,
              nowIso: new Date().toISOString(),
              options: { checkpointRoot, maxInitialStages: 1 },
            },
            {
              afterCall: ({ method, input, value }) => {
                if (
                  method === 'callTool' &&
                  input.name === 'begin_dynamic_evaluation'
                )
                  claim = value;
              },
            },
          );
          assertConsumerExit(run);
          assert.deepEqual(gateway.errors, []);
          const sourceReads = run.trace.filter(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'read_assessment_sources',
          );
          const saves = run.trace.filter(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'save_assessment_work',
          );
          const snapshot = await host.snapshot();
          receipt.continuousRead = {
            actualHttpRequests: gateway.requests.map((call) => ({
              ordinal: call.ordinal,
              path: call.path,
              method: call.method,
              modelHeader: call.modelHeader,
              requestBytes: call.requestBytes,
              responseBytes: call.responseBytes,
              status: call.status,
              toolChoice: call.request.tool_choice,
              actionEnum:
                call.request.tools[0].function.parameters.properties.step
                  .properties.action.enum,
              feedbackCodes: call.request.messages.flatMap((message) => {
                if (!['tool', 'user'].includes(message.role)) return [];
                try {
                  const data = JSON.parse(message.content);
                  return data.errorCode ? [data.errorCode] : [];
                } catch {
                  return [];
                }
              }),
            })),
            authorizedSourceReads: sourceReads.map((call) => ({
              refs: call.input.args.sourceRefs,
              status: call.value?.status,
              evidenceRefs: call.value?.evidence?.map(
                (item) => item.evidenceRef,
              ),
            })),
            saveCount: saves.length,
            savedWorkCount: snapshot.work.length,
            consumerStatus: run.result.result.status,
          };
          t.diagnostic(
            `CORE_P2_CONTINUOUS_READ ${JSON.stringify(receipt.continuousRead)}`,
          );
          assert.equal(
            sourceReads.length,
            2,
            'Two different valid source intervals must reach the actual Host reader before SAVE',
          );
          assert.deepEqual(
            sourceReads.map((call) => call.input.args.sourceRefs),
            sources.slice(0, 2).map((source) => [source.ref]),
          );
          assert.ok(
            sourceReads.every((call) => call.value.status === 'AVAILABLE'),
          );
          assert.ok(
            gateway.requests[1].request.tools[0].function.parameters.properties.step.properties.action.enum.includes(
              'READ_SOURCES',
            ),
            'The second named-tool schema must still allow a valid source READ',
          );
          assert.equal(saves.length, 1);
          assert.equal(snapshot.work.length, 1);
          assert.equal(gateway.requests.length, 4);
          const bodyCounts = gateway.requests.map((request) =>
            sourceBodyOccurrences(request.request),
          );
          assert.ok(
            bodyCounts.flat().every((body) => body.count === 1),
            'Each same-version source interval has one complete body in the actual wire request',
          );
          receipt.continuousRead.sourceBodyCounts = bodyCounts;
          assert.equal(run.result.result.status, 'IN_PROGRESS');
          receipt.checks = [
            'actual queue/consumer/initial adapter/JobAid driver/default HTTP',
            'two authorized distinct original READs before one SAVE',
            'real SAVE and dynamic commit with one JAWR',
            'model/provider are synthetic; no production calls',
          ];
        } finally {
          await gateway.close();
          if (run)
            receipt.nativeChildren = [
              { pid: run.pid, code: run.code, signal: run.signal },
            ];
          receipt.gatewayCleanup = { ownedListenerClosed: true };
        }
      }),
  );
}
