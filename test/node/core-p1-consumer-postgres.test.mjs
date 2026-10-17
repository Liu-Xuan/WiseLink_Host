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
  const { consumeAutomaticWorkItemQueueTick, consumeHostedWorkItem } =
    await import(`${nativeScripts}consume-hosted-work-item.mjs`);
  const { createCheckpointStore } = await import(
    `${nativeScripts}run-hosted-review-turn.mjs`
  );
  const { invokeHostedJobAidProblemModel } = await import(
    `${nativeScripts}run-jobaid-problem-assessment.mjs`
  );
  const callTool = (name, args) => rpc('callTool', { name, args });
  const invokeInitialModel = (input, hooks) =>
    invokeHostedJobAidProblemModel(
      input,
      {
        ...hooks,
        gatewayChatCompletionsEnabled: true,
        gatewayUrl: 'http://127.0.0.1:1',
        gatewayToken: 'offline-core-p1-fixture-only',
        registeredModelRefs: [hooks.executionModel.modelRef],
      },
      {
        requestGateway: async (_url, request) => {
          const step = await rpc('modelRound', {
            operation: input.operation,
            request: JSON.parse(request.body),
          });
          if (typeof step.fixtureCompletedText === 'string') {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: 'stop',
                    message: {
                      role: 'assistant',
                      content: step.fixtureCompletedText,
                    },
                  },
                ],
                usage: { prompt_tokens: 30, completion_tokens: 40 },
              }),
              { status: 200 },
            );
          }
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: 'tool_calls',
                  message: {
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                      {
                        id: `core-p1-offline-${nextRequest}`,
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
              usage: { prompt_tokens: 30, completion_tokens: 40 },
            }),
            { status: 200 },
          );
        },
      },
    );
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
  { beforeCall, afterCall, modelRound } = {},
) {
  const checkpointRoot = resolve(configuration.options.checkpointRoot);
  await mkdir(checkpointRoot, { recursive: true, mode: 0o700 });
  const ownerPath = join(
    dirname(checkpointRoot),
    `.${basename(checkpointRoot)}.c284-owner.lock`,
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
      { beforeCall, afterCall, modelRound },
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
  { beforeCall, afterCall, modelRound },
  owner,
) {
  const child = fork(fileURLToPath(import.meta.url), [], {
    execArgv: [],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      CORE_P1_NATIVE_TEST_CHILD: '1',
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
        : method === 'modelRound'
          ? await modelRound(input)
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
    join(tmpdir(), 'wiselink-core-p1-native-'),
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
    t.diagnostic(`CORE_P1_RECEIPT ${JSON.stringify(receipt)}`);
  }
}

async function runSyntheticAnalysisStage(
  host,
  checkpointRoot,
  { entry = 'queue', crash = true } = {},
) {
  let claim;
  let save;
  let originalGrant =
    entry === 'work-item' ? await host.nextWorkItem() : undefined;
  let modelCalls = 0;
  const first = await runConsumerChild(
    consumerHost(host),
    {
      entry,
      nowIso: new Date().toISOString(),
      options: {
        checkpointRoot,
        ...(entry === 'work-item'
          ? {
              workItemId: originalGrant.workItemId,
              initialStageOnly: true,
              maxInitialStages: 1,
            }
          : {}),
      },
    },
    {
      afterCall: ({ child, method, input, value }) => {
        if (method === 'nextWorkItem') originalGrant = value;
        if (method === 'callTool' && input.name === 'begin_dynamic_evaluation')
          claim = value;
        if (method === 'callTool' && input.name === 'save_assessment_work') {
          save = { args: input.args, value };
          if (crash) {
            child.kill('SIGKILL');
            return false;
          }
        }
      },
      modelRound: ({ operation }) => {
        assert.equal(operation, 'EVALUATE_JOBAID');
        modelCalls++;
        if (modelCalls === 1) {
          const source = claim.modelInput.availableSources.find(
            (item) => item.kind === 'DOCUMENT_PASSAGE',
          );
          assert.ok(source);
          return {
            action: 'READ_SOURCES',
            sourceRefs: [source.ref],
            purpose: 'READ',
            context: 'PAGE',
          };
        }
        assert.equal(
          modelCalls,
          2,
          'Only the first synthetic analysis may generate',
        );
        return {
          action: 'FINISH',
          workJson: JSON.stringify(host.proposal(claim)),
        };
      },
    },
  );
  assertConsumerExit(first, crash);
  assert.ok(save);
  const afterSave = await host.snapshot();
  const rows = afterSave.work.filter(
    (row) => row.work_item_id === save.args.workItemId,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].request_id, save.args.requestId);
  assert.equal(rows[0].assessment_work_revision_id, save.value.workRevisionRef);
  const projection = JSON.parse(
    afterSave.workItems.find((row) => row.work_item_id === save.args.workItemId)
      .projection_json,
  );
  assert.equal(
    projection.revision,
    claim.task.baseRevision + (crash ? 0 : 1),
    'Reads, heartbeat and SAVE must not advance business input; only final projection may do so',
  );
  if (crash)
    assert.equal(projection.integratedAssessment?.baseRules ?? null, null);
  return { first, claim, save, originalGrant, afterSave };
}

// Complete missing-tool responses exhaust P2's one stage protocol repair;
// a thrown transport has no provider terminal evidence and remains UNKNOWN.
async function runStoppedAnalysisProbe(host, checkpointRoot, kind) {
  let claim;
  let modelCalls = 0;
  const run = await runConsumerChild(
    consumerHost(host),
    {
      entry: 'queue',
      nowIso: new Date().toISOString(),
      options: { checkpointRoot },
    },
    {
      afterCall: ({ method, input, value }) => {
        if (method === 'callTool' && input.name === 'begin_dynamic_evaluation')
          claim = value;
      },
      modelRound: () => {
        modelCalls++;
        if (modelCalls === 1)
          return {
            action: 'READ_SOURCES',
            purpose: 'READ',
            context: 'PAGE',
            sourceRefs: [
              claim.modelInput.availableSources.find(
                (item) => item.kind === 'DOCUMENT_PASSAGE',
              ).ref,
            ],
          };
        if (modelCalls === 2)
          return {
            action: 'SAVE_WORK',
            workJson: JSON.stringify(host.proposal(claim, 'IN_PROGRESS')),
          };
        if (kind === 'FAILED') {
          assert.ok(
            modelCalls <= 4,
            'One stage protocol repair permits only two complete missing-tool responses',
          );
          return {
            fixtureCompletedText:
              'Synthetic complete response did not return the required assessment step.',
          };
        }
        throw Object.assign(
          new Error(
            'Synthetic transport disconnected after SAVE; provider state is unknown.',
          ),
          { code: 'ECONNRESET' },
        );
      },
    },
  );
  assertConsumerExit(run);
  assert.equal(run.result.result.status, 'REQUIRES_ATTENTION');
  const stopped = JSON.parse(
    await readFile(join(checkpointRoot, 'active-claim.json'), 'utf8'),
  );
  assert.equal(stopped.consumerStopped, true);
  const snapshot = await host.snapshot();
  assert.equal(snapshot.work.length, 1);
  assert.equal(
    JSON.parse(snapshot.work[0].content_json).roundCompletion,
    'IN_PROGRESS',
  );
  const attempt = snapshot.attempts.find(
    (row) => row.operation_ref === claim.attemptRef,
  );
  assert.equal(attempt.status, kind === 'FAILED' ? 'FAILED' : 'RUNNING');
  assert.equal(attempt.cancel_reason, null);
  let unknownReports = [];
  if (kind === 'FAILED') {
    assert.equal(
      modelCalls,
      4,
      'One READ, one SAVE and two complete missing-tool responses exhaust one protocol repair',
    );
    assert.equal(attempt.terminal_reason, 'JOBAID_PROTOCOL_REPAIR_EXHAUSTED');
    const result = JSON.parse(attempt.result_envelope_json);
    assert.equal(result.status, 'FAILED');
    assert.equal(result.errorCode, 'JOBAID_PROTOCOL_REPAIR_EXHAUSTED');
    assert.equal(result.contentHash, attempt.result_content_hash);
  } else {
    const reports = (await readdir(checkpointRoot, { recursive: true })).filter(
      (name) => name.endsWith('run-result.json'),
    );
    unknownReports = await Promise.all(
      reports.map(async (name) => {
        const bytes = await readFile(join(checkpointRoot, name));
        return { name, bytes, report: JSON.parse(bytes) };
      }),
    );
    assert.ok(
      unknownReports.some(({ report }) => report.attemptStatus === 'UNKNOWN'),
    );
  }
  return { run, claim, stopped, snapshot, attempt, unknownReports };
}

async function loseCommittedBlockReply(host, checkpointRoot) {
  const stopped = await runStoppedAnalysisProbe(host, checkpointRoot, 'FAILED');
  let blocked;
  const crashed = await runConsumerChild(
    consumerHost(host),
    {
      entry: 'queue',
      nowIso: new Date().toISOString(),
      options: { checkpointRoot },
    },
    {
      modelRound: () => assert.fail('BLOCK must not invoke a model'),
      afterCall: ({ child, method, input, value }) => {
        if (method !== 'blockWorkItem') return;
        assert.equal(value.status, 'BLOCKED');
        assert.equal(value.replayed, false);
        blocked = { args: input, receipt: value };
        child.kill('SIGKILL');
        return false;
      },
    },
  );
  assertConsumerExit(crashed, true);
  assert.ok(
    blocked,
    'The real Host BLOCK must commit before the reply is dropped',
  );
  const claimBytes = await readFile(join(checkpointRoot, 'active-claim.json'));
  const claim = JSON.parse(claimBytes);
  assert.ok(claim.blockReady);
  assert.equal(claim.stoppedStageRequest.attemptRef, stopped.claim.attemptRef);
  const snapshot = await host.snapshot();
  assert.equal(
    snapshot.grants.find(
      (row) => row.work_item_id === stopped.stopped.workItemId,
    ).status,
    'BLOCKED',
  );
  assert.deepEqual(snapshot.work, stopped.snapshot.work);
  return { stopped, crashed, blocked, claimBytes, claim, snapshot };
}

if (process.env.CORE_P1_NATIVE_TEST_CHILD === '1') {
  await runNativeChild();
} else {
  const { default: test } = await import('node:test');
  test(
    'C284 real PG authorization and actual queue consumer reach IDLE without model or business writes',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        const before = await host.snapshot();
        const run = await runConsumerChild(
          consumerHost(host),
          {
            entry: 'queue',
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          },
          { modelRound: () => assert.fail('IDLE must never request a model') },
        );
        assertConsumerExit(run);
        assert.equal(run.result.result.status, 'IDLE');
        assert.equal(
          run.trace.filter((call) => call.method === 'nextWorkItem').length,
          1,
        );
        assert.equal(
          run.trace.filter((call) => call.method === 'modelRound').length,
          0,
        );
        assert.deepEqual(await host.snapshot(), before);
        receipt.checks = [
          'actual queue IDLE',
          'zero model requests',
          'zero business writes',
        ];
      }),
  );

  test(
    'C284 real SAVE prefix through direct actual consumer survives a lost committed reply',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed();
        const { first, save } = await runSyntheticAnalysisStage(
          host,
          checkpointRoot,
          { entry: 'work-item' },
        );
        const before = await host.snapshot();
        const readback = await host.callTool('read_assessment_work', {
          workItemId: save.args.workItemId,
          attemptRef: save.args.attemptRef,
          requestId: save.args.requestId,
        });
        assert.equal(readback.revision.requestId, save.args.requestId);
        assert.equal(
          readback.revision.workRevisionRef,
          save.value.workRevisionRef,
        );
        assert.deepEqual(await host.snapshot(), before);
        receipt.checks = [
          'actual consumeHostedWorkItem',
          'real SAVE commit before SIGKILL',
          'original key authorized readback',
        ];
        receipt.fullCombination = 'NOT_RUN in this prefix-only case';
        receipt.nativeChildren = [
          { pid: first.pid, code: first.code, signal: first.signal },
        ];
      }),
  );

  test(
    'Q03 corrupt active claim does not block an independently authorized successor',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        const successor = await host.seed('WI-core-p1-successor');
        const broken = '{"workItemId":"WI-untrusted-local-target",';
        await writeFile(join(checkpointRoot, 'active-claim.json'), broken, {
          mode: 0o600,
        });
        let claim;
        let modelCalls = 0;
        const run = await runConsumerChild(
          consumerHost(host),
          {
            entry: 'queue',
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
            modelRound: ({ operation }) => {
              assert.equal(operation, 'EVALUATE_JOBAID');
              modelCalls++;
              if (modelCalls === 1)
                return {
                  action: 'READ_SOURCES',
                  purpose: 'READ',
                  context: 'PAGE',
                  sourceRefs: [
                    claim.modelInput.availableSources.find(
                      (item) => item.kind === 'DOCUMENT_PASSAGE',
                    ).ref,
                  ],
                };
              assert.equal(modelCalls, 2);
              return {
                action: 'FINISH',
                workJson: JSON.stringify(host.proposal(claim)),
              };
            },
          },
        );
        assertConsumerExit(run);
        assert.equal(
          run.result.result.status,
          'IN_PROGRESS',
          JSON.stringify(run.result.result),
        );
        assert.equal(run.result.result.consumerStatus, 'INITIAL_STAGE_SAVED');
        const next = run.trace.find((call) => call.method === 'nextWorkItem');
        assert.equal(next.input?.resumeWorkItemId, undefined);
        assert.equal(next.value.status, 'CLAIMED');
        assert.equal(next.value.workItemId, successor.workItemId);
        assert.equal(claim.task.workItemId, successor.workItemId);
        const stored = await host.snapshot();
        assert.equal(stored.work.length, 1);
        assert.equal(stored.work[0].work_item_id, successor.workItemId);
        const quarantine = (await readdir(checkpointRoot)).find((name) =>
          name.startsWith('quarantine-active-claim-'),
        );
        assert.ok(quarantine);
        assert.equal(
          await readFile(join(checkpointRoot, quarantine), 'utf8'),
          broken,
        );
        receipt.checks = [
          'Q03',
          'Q02 corrupt record quarantined without reconstructing local fields',
        ];
        receipt.consumerStatus = run.result.result.consumerStatus;
        receipt.nativeChildren = [
          { pid: run.pid, code: run.code, signal: run.signal },
        ];
      }),
  );

  test(
    'W09 actual authorized status is read-only while queue dispatch still reconciles an expired attempt',
    { timeout: 60000 },
    async (t) =>
      withHostFixture(t, async (host, { receipt }) => {
        const item = await host.seed();
        await host.nextWorkItem();
        const requested = await host.reserveInitial({
          workItemId: item.workItemId,
          deadlineMs: 5000,
        });
        const claim = await host.callTool('begin_dynamic_evaluation', {
          workItemId: item.workItemId,
          requestId: requested.requestId,
        });
        await host.advance(10000);
        const before = await host.snapshot();
        for (let read = 0; read < 3; read++) {
          const status = await host.callTool('get_parse_status', {
            workItemId: item.workItemId,
          });
          assert.equal(status.entry.workItemId, item.workItemId);
        }
        const observed = await host.snapshot();
        assert.deepEqual(
          observed,
          before,
          'Status reads may not terminalize or alter business rows',
        );
        assert.equal(
          observed.attempts.find(
            (row) => row.operation_ref === claim.attemptRef,
          ).status,
          'RUNNING',
        );
        await host.advance();
        const scheduled = await host.nextWorkItem({
          resumeWorkItemId: item.workItemId,
        });
        assert.equal(scheduled.status, 'CLAIMED');
        const reconciled = await host.snapshot();
        const old = reconciled.attempts.find(
          (row) => row.operation_ref === claim.attemptRef,
        );
        assert.equal(old.status, 'TIMED_OUT');
        assert.equal(old.terminal_reason, 'ACTION_ATTEMPT_DEADLINE_EXCEEDED');
        assert.equal(
          reconciled.attempts.filter(
            (row) => row.action_type === 'OPENCLAW_DYNAMIC_EVALUATION',
          ).length,
          1,
          'Expiry must not manufacture another model attempt for an UNKNOWN executed task',
        );
        receipt.checks = [
          'W09 zero business writes across real status reads',
          'authorized dispatch reconciles deadline',
          'UNKNOWN is not regenerated',
        ];
      }),
  );

  test(
    'COMMITTING keeps the original expired checkpoint and replays only the original sealed result',
    { timeout: 120000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        const { canonicalSha256 } = await import(
          `${nativeScripts}validate-payload.mjs`
        );
        await host.seed();
        let releaseArtifact;
        const heldArtifact = new Promise((resolveArtifact) => {
          releaseArtifact = resolveArtifact;
        });
        let claim;
        let originalCommit;
        let paused;
        let modelCalls = 0;
        const first = await runConsumerChild(
          consumerHost(host),
          {
            entry: 'queue',
            nowIso: new Date().toISOString(),
            keepHostCallPendingOnCrash: true,
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
            beforeCall: ({ child, method, input }) => {
              if (
                method !== 'callTool' ||
                input.name !== 'commit_dynamic_evaluation_candidate'
              )
                return;
              originalCommit = input.args;
              host.armArtifactPersistHook(async () => {
                paused = await host.snapshot();
                assert.equal(
                  paused.attempts.find(
                    (row) => row.operation_ref === claim.attemptRef,
                  ).status,
                  'COMMITTING',
                );
                child.kill('SIGKILL');
                await heldArtifact;
              });
            },
            modelRound: () => {
              modelCalls++;
              if (modelCalls === 1)
                return {
                  action: 'READ_SOURCES',
                  purpose: 'READ',
                  context: 'PAGE',
                  sourceRefs: [
                    claim.modelInput.availableSources.find(
                      (item) => item.kind === 'DOCUMENT_PASSAGE',
                    ).ref,
                  ],
                };
              assert.equal(modelCalls, 2);
              return {
                action: 'FINISH',
                workJson: JSON.stringify(host.proposal(claim)),
              };
            },
          },
        );
        try {
          assertConsumerExit(first, true);
          assert.ok(paused);
          const originalResult = originalCommit.result;
          const oldGrant = JSON.parse(
            await readFile(join(checkpointRoot, 'active-claim.json'), 'utf8'),
          );
          const started = (
            await readdir(checkpointRoot, { recursive: true })
          ).find((name) =>
            name.endsWith('commit_dynamic_evaluation_candidate-1.started.json'),
          );
          assert.ok(
            started,
            'The interrupted real commit checkpoint must be retained',
          );
          const startedBytes = await readFile(join(checkpointRoot, started));
          // Deliberately alter only a replay payload, retaining its real task and
          // attempt identity. The Host must reject this different sealed result.
          const { contentHash: _originalHash, ...changed } =
            structuredClone(originalResult);
          changed.warnings.push(
            'Deliberately invalid COMMITTING replay payload',
          );
          await assert.rejects(
            host.callTool('commit_dynamic_evaluation_candidate', {
              ...originalCommit,
              result: {
                ...changed,
                contentHash: canonicalSha256(changed),
              },
            }),
            (error) => {
              assert.equal(error.message, 'RESULT_ENVELOPE_REPLAY_MISMATCH');
              receipt.wrongResultDenial = transportError(error);
              return true;
            },
          );
          assert.deepEqual(await host.snapshot(), paused);
          await host.advance();
          const resumed = await runConsumerChild(
            consumerHost(host),
            {
              entry: 'queue',
              nowIso: new Date().toISOString(),
              options: { checkpointRoot },
            },
            {
              modelRound: () =>
                assert.fail('COMMITTING recovery must not invoke a model'),
            },
          );
          assertConsumerExit(resumed);
          const renewed = resumed.trace.find(
            (call) => call.method === 'nextWorkItem',
          ).value;
          assert.equal(renewed.leaseToken, oldGrant.leaseToken);
          assert.equal(renewed.leaseGeneration, oldGrant.leaseGeneration);
          const observed = resumed.trace.find(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'get_action_attempt_status' &&
              call.value?.status === 'COMMITTING',
          );
          assert.ok(observed);
          assert.equal(
            observed.value.resultContentHash,
            originalResult.contentHash,
          );
          const replay = resumed.trace.find(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'commit_dynamic_evaluation_candidate',
          );
          assert.ok(replay);
          assert.deepEqual(replay.input.args.result, originalResult);
          assert.deepEqual(
            await readFile(join(checkpointRoot, started)),
            startedBytes,
          );
          const committed = await host.snapshot();
          assert.equal(committed.work.length, 1);
          assert.equal(
            committed.attempts.find(
              (row) => row.operation_ref === claim.attemptRef,
            ).status,
            'SUCCEEDED',
          );
          assert.equal(
            resumed.trace.filter((call) => call.method === 'modelRound').length,
            0,
          );
          assert.equal(
            resumed.trace.some(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'save_assessment_work',
            ),
            false,
          );
          releaseArtifact();
          await first.settled;
          const late = first.trace.find(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'commit_dynamic_evaluation_candidate',
          );
          assert.equal(
            late.error?.message,
            'AUTO_WORK_ITEM_ATTEMPT_LEASE_REJECTED',
          );
          receipt.lateCommitDenial = late.error;
          assert.deepEqual(
            await host.snapshot(),
            committed,
            'Late original Host I/O may not apply another projection',
          );
          receipt.checks = [
            'COMMITTING same queue token/generation',
            'original checkpoint retained',
            'wrong result rejected',
            'original sealed commit replayed',
            'zero restart model/SAVE',
            'late original Host request rejected after grant completion',
          ];
          receipt.commitRecovery = {
            attemptRef: claim.attemptRef,
            originalResultContentHash: originalResult.contentHash,
            originalQueueGeneration: oldGrant.leaseGeneration,
            recoveredQueueGeneration: renewed.leaseGeneration,
            unchangedQueueToken: renewed.leaseToken === oldGrant.leaseToken,
            originalCheckpointRetained: true,
            modelRequests: resumed.trace.filter(
              (call) => call.method === 'modelRound',
            ).length,
            saveRequests: resumed.trace.filter(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'save_assessment_work',
            ).length,
            finalAttemptStatus: committed.attempts.find(
              (row) => row.operation_ref === claim.attemptRef,
            ).status,
          };
          receipt.nativeChildren = [first, resumed].map((run) => ({
            pid: run.pid,
            code: run.code,
            signal: run.signal,
          }));
        } finally {
          releaseArtifact();
          await first.settled;
        }
      }),
  );

  test(
    'W03/Q02/Q04/Q08 actual consumer recovers committed SAVE after reply loss and corrupt checkpoint',
    { timeout: 120000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed();
        const { first, save, originalGrant, afterSave } =
          await runSyntheticAnalysisStage(host, checkpointRoot);

        await writeFile(join(checkpointRoot, 'active-claim.json'), '{broken', {
          mode: 0o600,
        });
        await host.advance();
        let staleQualificationsRejected = false;
        const restarted = await runConsumerChild(
          consumerHost(host),
          {
            entry: 'queue',
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          },
          {
            modelRound: () =>
              assert.fail(
                'Host saved-work reconciliation must execute zero model requests',
              ),
            afterCall: async ({ method, input, value }) => {
              if (
                method !== 'callTool' ||
                input.name !== 'begin_dynamic_evaluation'
              )
                return;
              assert.ok(value.task.modelInput.savedWorkReconciliation);
              const occupied = await host.snapshot();
              const newAttempt = occupied.attempts.find(
                (row) => row.attempt_id === value.task.actionAttemptId,
              );
              assert.equal(newAttempt.status, 'RUNNING');
              assert.ok(
                occupied.grants[0].lease_generation >
                  originalGrant.leaseGeneration,
              );
              await assert.rejects(
                host.callTool('save_assessment_work', {
                  ...save.args,
                  requestId: `late-${save.args.requestId}`,
                  expectedWorkRevision: save.value.workRevision,
                }),
                (error) => {
                  assert.match(
                    error.message,
                    /(?:AUTO_WORK_ITEM_ATTEMPT_LEASE_REJECTED|JOBAID_WORK.*FENCE|ACTION_ATTEMPT.*(?:FENCE|LEASE|TERMINAL)|JOBAID_ATTEMPT_NOT_FOUND|CANONICAL_WORK_ITEM_NOT_FOUND)/u,
                  );
                  receipt.oldAttemptDenial = transportError(error);
                  return true;
                },
              );
              await assert.rejects(
                host.acknowledgeWorkItem({
                  workItemId: originalGrant.workItemId,
                  leaseToken: originalGrant.leaseToken,
                  leaseGeneration: originalGrant.leaseGeneration,
                }),
                (error) => {
                  assert.match(
                    error.message,
                    /(?:CANONICAL_WORK_ITEM_NOT_FOUND|AUTO_WORK_ITEM.*(?:FENCE|LEASE))/u,
                  );
                  receipt.oldQueueDenial = transportError(error);
                  return true;
                },
              );
              const unchanged = await host.snapshot();
              assert.deepEqual(
                unchanged.grants,
                occupied.grants,
                'Old qualifications cannot release the current queue grant',
              );
              assert.deepEqual(
                unchanged.attempts.find(
                  (row) => row.attempt_id === newAttempt.attempt_id,
                ),
                newAttempt,
                'Old qualifications cannot release the new RUNNING attempt',
              );
              assert.deepEqual(unchanged.work, occupied.work);
              staleQualificationsRejected = true;
            },
          },
        );
        assertConsumerExit(restarted);
        assert.equal(staleQualificationsRejected, true);
        const afterBridge = await host.snapshot();
        assert.equal(
          afterBridge.work.length,
          1,
          'Recovery must not append a second SAVE',
        );
        assert.equal(
          restarted.trace.filter(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'save_assessment_work',
          ).length,
          0,
        );
        const exactRead = restarted.trace.find(
          (call) =>
            call.method === 'callTool' &&
            call.input.name === 'read_assessment_work' &&
            call.input.args.requestId === save.args.requestId,
        );
        assert.ok(
          exactRead,
          'The restarted consumer must authorize and verify the original SAVE key',
        );
        assert.equal(
          exactRead.value.revision.workRevisionRef,
          save.value.workRevisionRef,
        );
        const bridge = afterBridge.attempts.find(
          (row) =>
            JSON.parse(row.task_envelope_json).modelInput
              .savedWorkReconciliation,
        );
        assert.ok(
          bridge,
          'Only a sealed Host-authorized reconciliation task can close the missing projection',
        );
        const result = JSON.parse(bridge.result_envelope_json);
        assert.equal(result.executionKind, 'HOST_SAVED_WORK_RECONCILIATION');
        assert.equal(result.modelRequests, 0);
        assert.equal(result.modelVersion, null);
        assert.deepEqual(result.sourceWork, {
          workRevisionRef: save.value.workRevisionRef,
          sourceActionAttemptId: afterSave.work[0].action_attempt_id,
        });
        assert.equal(
          JSON.parse(afterBridge.workItems[0].projection_json)
            .integratedAssessment.baseRules.workRevisionRef,
          save.value.workRevisionRef,
        );
        const overall = await runConsumerChild(
          consumerHost(host),
          {
            entry: 'queue',
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          },
          {
            modelRound: ({ operation }) => {
              assert.equal(
                operation,
                'SYNTHESIZE_OVERALL',
                'An existing base projection must not be bridged twice',
              );
              return {
                action: 'FINISH',
                consistencyCheck:
                  '核对已保存问题与概览，保留构造来源的条件和未知。',
              };
            },
          },
        );
        assertConsumerExit(overall);
        const finished = await host.snapshot();
        assert.equal(finished.work.length, 1);
        const projection = JSON.parse(finished.workItems[0].projection_json);
        assert.equal(
          projection.integratedAssessment.overallSynthesis
            .basedOnJobAidWorkRevisionRef,
          save.value.workRevisionRef,
        );
        assert.equal(finished.grants[0].status, 'COMPLETED');
        assert.equal(
          finished.attempts.filter(
            (row) =>
              JSON.parse(row.task_envelope_json).modelInput
                .savedWorkReconciliation,
          ).length,
          1,
        );
        assert.ok(
          restarted.trace.some(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'commit_dynamic_evaluation_candidate',
          ),
        );
        assert.ok(
          overall.trace.some(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'begin_overall_synthesis',
          ),
        );
        assert.equal(
          overall.trace.some(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'begin_dynamic_evaluation',
          ),
          false,
        );
        const successor = await host.seed('WI-core-p1-independent');
        const following = await runSyntheticAnalysisStage(
          host,
          checkpointRoot,
          { crash: false },
        );
        assert.equal(following.originalGrant.workItemId, successor.workItemId);
        assert.equal(
          following.first.result.result.consumerStatus,
          'INITIAL_STAGE_SAVED',
        );
        receipt.checks = [
          'W03',
          'Q02',
          'Q04',
          'Q08',
          'W07 old attempt and queue grant preserve new occupant',
        ];
        receipt.checks.push(
          'Q03 independent successor continues after the complete recovery chain',
        );
        receipt.savedWorkRecovery = {
          originalSaveKey: save.args.requestId,
          originalWorkRevisionRef: save.value.workRevisionRef,
          recoveredWorkRevisionRef: exactRead.value.revision.workRevisionRef,
          originalQueueGeneration: originalGrant.leaseGeneration,
          recoveredQueueGeneration: restarted.trace.find(
            (call) => call.method === 'nextWorkItem',
          ).value.leaseGeneration,
          bridgeExecutionKind: result.executionKind,
          bridgeModelVersion: result.modelVersion,
          bridgeModelRequests: result.modelRequests,
          sourceWork: result.sourceWork,
          overallBasedOnWorkRevisionRef:
            projection.integratedAssessment.overallSynthesis
              .basedOnJobAidWorkRevisionRef,
          completedGrantStatus: finished.grants[0].status,
          independentSuccessor: following.originalGrant.workItemId,
        };
        receipt.nativeChildren = [
          first,
          restarted,
          overall,
          following.first,
        ].map((run) => ({ pid: run.pid, code: run.code, signal: run.signal }));
      }),
  );

  for (const [kind, correction] of [
    ['input', 'correctInput'],
    ['source', 'correctSource'],
  ]) {
    test(
      `Q08 sealed saved-work bridge refuses a subsequent ${kind} change`,
      { timeout: 120000 },
      async (t) =>
        withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
          await host.seed();
          const { first, save, afterSave, originalGrant } =
            await runSyntheticAnalysisStage(host, checkpointRoot);
          assert.equal(
            afterSave.attempts.find(
              (row) => row.operation_ref === save.args.attemptRef,
            ).status,
            'RUNNING',
          );
          if (kind === 'input') {
            await rm(checkpointRoot, { recursive: true, force: true });
          } else {
            const retained = JSON.parse(
              await readFile(join(checkpointRoot, 'active-claim.json'), 'utf8'),
            );
            assert.equal(retained.leaseToken, originalGrant.leaseToken);
            assert.equal(
              retained.leaseGeneration,
              originalGrant.leaseGeneration,
            );
          }
          await host.advance();
          let correctionApplied = false;
          let corrected;
          const restarted = await runConsumerChild(
            consumerHost(host),
            {
              entry: 'queue',
              nowIso: new Date().toISOString(),
              options: { checkpointRoot },
            },
            {
              modelRound: () =>
                assert.fail('Invalidated reconciliation cannot invoke a model'),
              afterCall: async ({ method, input, value }) => {
                if (
                  method !== 'callTool' ||
                  input.name !== 'begin_dynamic_evaluation'
                )
                  return;
                assert.ok(value.task.modelInput.savedWorkReconciliation);
                await host[correction](save.args.workItemId);
                corrected = await host.snapshot();
                correctionApplied = true;
              },
            },
          );
          assert.equal(restarted.timedOut, false);
          assert.equal(restarted.code, 0, restarted.output);
          assert.throws(() => process.kill(restarted.pid, 0), {
            code: 'ESRCH',
          });
          assert.equal(
            correctionApplied,
            true,
            JSON.stringify(restarted.result),
          );
          const renewed = restarted.trace.find(
            (call) => call.method === 'nextWorkItem',
          ).value;
          assert.ok(renewed.leaseGeneration > originalGrant.leaseGeneration);
          assert.notEqual(renewed.leaseToken, originalGrant.leaseToken);
          assert.equal(
            restarted.trace.some(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'get_action_attempt_status' &&
                call.value?.status === 'COMMITTING',
            ),
            false,
            'A retained RUNNING checkpoint cannot enter same-qualification COMMITTING recovery',
          );
          const denied = restarted.trace.find(
            (call) =>
              call.method === 'callTool' &&
              call.error &&
              [
                'read_assessment_work',
                'commit_dynamic_evaluation_candidate',
              ].includes(call.input.name),
          );
          assert.ok(
            denied,
            'The real Host must reject the invalidated bridge read or commit',
          );
          const after = await host.snapshot();
          assert.deepEqual(after.work, afterSave.work);
          assert.deepEqual(
            after.workItems,
            corrected.workItems,
            'Rejected bridge may not install a stale base projection',
          );
          assert.equal(
            restarted.trace.some(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'begin_overall_synthesis',
            ),
            false,
          );
          assert.equal(
            restarted.trace.filter((call) => call.method === 'modelRound')
              .length,
            0,
          );
          receipt.checks = [
            `Q08 ${kind} change rejected`,
            kind === 'input'
              ? 'deleted local checkpoint'
              : 'retained expired RUNNING checkpoint requires a new queue grant',
            'no extra SAVE or model',
            'no Overall bypass',
          ];
          receipt.denial = denied.error;
          receipt.nativeChildren = [first, restarted].map((run) => ({
            pid: run.pid,
            code: run.code,
            signal: run.signal,
          }));
        }),
    );
  }

  for (const kind of ['FAILED', 'UNKNOWN']) {
    test(
      `P1 stopped claim ${kind}: natural terminal finalization admits an independent successor without operator flags`,
      { timeout: 120000 },
      async (t) =>
        withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
          await host.seed();
          const stopped = await runStoppedAnalysisProbe(
            host,
            checkpointRoot,
            kind,
          );
          const consumers = [stopped.run];
          const successor = await host.seed('WI-core-p1-stopped-successor');
          const tick = async () => {
            const run = await runConsumerChild(
              consumerHost(host),
              {
                entry: 'queue',
                nowIso: new Date().toISOString(),
                options: { checkpointRoot },
              },
              {
                modelRound: () =>
                  assert.fail(
                    'Terminal finalization cannot invoke another model',
                  ),
              },
            );
            consumers.push(run);
            assertConsumerExit(run);
            return run;
          };
          if (kind === 'UNKNOWN') {
            const before = await host.snapshot();
            await assert.rejects(
              consumerHost(host).blockWorkItem({
                workItemId: stopped.stopped.workItemId,
                leaseToken: stopped.stopped.leaseToken,
                leaseGeneration: stopped.stopped.leaseGeneration,
              }),
              (error) => {
                assert.equal(
                  error.message,
                  'AUTO_WORK_ITEM_FAILURE_NOT_CONFIRMED',
                );
                receipt.runningBlockDenial = transportError(error);
                return true;
              },
            );
            assert.deepEqual(
              await host.snapshot(),
              before,
              'RUNNING UNKNOWN is not confirmed terminal',
            );
            const running = await tick();
            assert.equal(running.result.result.status, 'REQUIRES_ATTENTION');
            assert.equal(
              running.trace.some((call) => call.method === 'blockWorkItem'),
              false,
            );
            assert.deepEqual(await host.snapshot(), before);
            await host.advance();
          }
          const finalized = await tick();
          assert.equal(
            finalized.result.result.status,
            'BLOCKED_CLAIM_FINALIZED',
            'A natural tick must finalize the actual terminal old claim without an operator',
          );
          const blocks = finalized.trace.filter(
            (call) => call.method === 'blockWorkItem',
          );
          assert.equal(
            blocks.length,
            2,
            'Fresh ordinary BLOCK requires an exact persisted receipt replay',
          );
          assert.equal(blocks[0].value.replayed, false);
          assert.deepEqual(blocks[1].value, {
            ...blocks[0].value,
            replayed: true,
          });
          assert.equal(
            finalized.trace.some(
              (call) => call.method === 'acknowledgeWorkItem',
            ),
            false,
          );
          assert.equal(
            finalized.trace.some(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'save_assessment_work',
            ),
            false,
          );
          assert.equal(
            JSON.parse(
              await readFile(join(checkpointRoot, 'active-claim.json'), 'utf8'),
            ),
            null,
          );
          const archive = JSON.parse(
            await readFile(
              join(
                checkpointRoot,
                `blocked-claim-${stopped.stopped.workItemId}-g${blocks[0].input.leaseGeneration}.json`,
              ),
              'utf8',
            ),
          );
          assert.equal(
            archive.schemaVersion,
            'wiselink.auto_work_item_blocked_claim_archive.v1',
          );
          assert.equal(
            archive.claim.stoppedStageRequest.attemptRef,
            stopped.claim.attemptRef,
          );
          assert.deepEqual(archive.receipt, blocks[1].value);
          const afterFinalization = await host.snapshot();
          const terminal = afterFinalization.attempts.find(
            (row) => row.operation_ref === stopped.claim.attemptRef,
          );
          assert.equal(
            terminal.status,
            kind === 'UNKNOWN' ? 'TIMED_OUT' : 'FAILED',
          );
          assert.equal(terminal.cancel_reason, null);
          for (const history of stopped.unknownReports) {
            assert.deepEqual(
              await readFile(join(checkpointRoot, history.name)),
              history.bytes,
              'Queue finalization must retain the original provider UNKNOWN observation',
            );
          }
          assert.deepEqual(afterFinalization.work, stopped.snapshot.work);
          assert.equal(
            afterFinalization.attempts.filter(
              (row) =>
                row.work_item_id === stopped.claim.task.workItemId &&
                row.action_type === 'OPENCLAW_DYNAMIC_EVALUATION',
            ).length,
            1,
            'No extra model attempt is created',
          );
          assert.equal(
            afterFinalization.grants.find(
              (row) => row.work_item_id === stopped.claim.task.workItemId,
            ).status,
            'BLOCKED',
          );
          if (kind === 'UNKNOWN') {
            const reclaimed = finalized.trace.find(
              (call) => call.method === 'nextWorkItem',
            );
            assert.equal(
              reclaimed.input.resumeWorkItemId,
              stopped.stopped.workItemId,
            );
            assert.ok(
              reclaimed.value.leaseGeneration > stopped.stopped.leaseGeneration,
            );
          }
          const following = await runSyntheticAnalysisStage(
            host,
            checkpointRoot,
            { crash: false },
          );
          consumers.push(following.first);
          assert.equal(
            following.originalGrant.workItemId,
            successor.workItemId,
            'The next natural tick must admit the independent successor without operator flags',
          );
          assert.equal(
            following.first.result.result.consumerStatus,
            'INITIAL_STAGE_SAVED',
          );
          assert.equal(
            following.first.trace.find((call) => call.method === 'nextWorkItem')
              .input?.resumeWorkItemId,
            undefined,
          );
          receipt.stoppedProbe = {
            kind,
            savedWorkRevisionRef:
              stopped.snapshot.work[0].assessment_work_revision_id,
            initialHostAttemptStatus: stopped.attempt.status,
            terminalHostAttemptStatus: terminal.status,
            providerTerminalClaimed: kind === 'FAILED',
            finalized: finalized.result.result,
            freshBlock: blocks[0].value,
            exactReplay: blocks[1].value,
            archived: archive,
            independentlyClaimed: following.originalGrant.workItemId,
          };
          receipt.nativeChildren = consumers.map((run) => ({
            pid: run.pid,
            code: run.code,
            signal: run.signal,
          }));
          receipt.checks = [
            'real saved work retained',
            'natural terminal BLOCK and exact receipt',
            'archive and clear local pointer',
            'zero terminal-finalization model/SAVE/ACK',
            'independent next natural consumer succeeds',
            'no operator/PARK flags',
          ];
        }),
    );
  }

  test(
    'P1 stopped claim CANCELLED control: ordinary BLOCK refuses the separate cancellation path',
    { timeout: 120000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed();
        const stopped = await runStoppedAnalysisProbe(
          host,
          checkpointRoot,
          'UNKNOWN',
        );
        await host.callTool('cancel_action_attempt', {
          workItemId: stopped.claim.task.workItemId,
          attemptRef: stopped.claim.attemptRef,
          reason: 'EXPLICIT_USER_CANCELLED',
        });
        const before = await host.snapshot();
        assert.equal(
          before.attempts.find(
            (row) => row.operation_ref === stopped.claim.attemptRef,
          ).status,
          'CANCELLED',
        );
        await assert.rejects(
          consumerHost(host).blockWorkItem({
            workItemId: stopped.stopped.workItemId,
            leaseToken: stopped.stopped.leaseToken,
            leaseGeneration: stopped.stopped.leaseGeneration,
          }),
          (error) => {
            assert.equal(error.message, 'AUTO_WORK_ITEM_FAILURE_NOT_CONFIRMED');
            receipt.cancellationOrdinaryBlockDenial = transportError(error);
            return true;
          },
        );
        assert.deepEqual(await host.snapshot(), before);
        receipt.checks = [
          'CANCELLED stays distinct from FAILED and TIMED_OUT',
          'ordinary BLOCK rejects CANCELLED; no cancellation PARK invoked',
          'saved work retained; provider UNKNOWN not called stopped',
        ];
        receipt.nativeChildren = [
          {
            pid: stopped.run.pid,
            code: stopped.run.code,
            signal: stopped.run.signal,
          },
        ];
      }),
  );

  test(
    'P1 BLOCK lost reply restarts the actual consumer and requires an exact authorized receipt',
    { timeout: 120000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed();
        const lost = await loseCommittedBlockReply(host, checkpointRoot);
        const successor = await host.seed('WI-core-p1-block-reply-successor');
        const before = await host.snapshot();
        const noReceipt = await runConsumerChild(
          consumerHost(host),
          {
            entry: 'queue',
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          },
          {
            modelRound: () =>
              assert.fail(
                'A missing BLOCK receipt cannot authorize generation',
              ),
            beforeCall: ({ method }) => {
              if (method === 'blockWorkItem')
                throw new Error('C284_BLOCK_RECEIPT_TRANSPORT_UNAVAILABLE');
            },
          },
        );
        assertConsumerExit(noReceipt);
        assert.equal(noReceipt.result.result.status, 'REQUIRES_ATTENTION');
        assert.deepEqual(
          await readFile(join(checkpointRoot, 'active-claim.json')),
          lost.claimBytes,
        );
        assert.deepEqual(
          await host.snapshot(),
          before,
          'No response is not a release receipt',
        );
        const resumed = await runConsumerChild(
          consumerHost(host),
          {
            entry: 'queue',
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          },
          {
            modelRound: () =>
              assert.fail('Exact BLOCK replay cannot invoke a model'),
          },
        );
        assertConsumerExit(resumed);
        assert.equal(resumed.result.result.status, 'BLOCKED_CLAIM_FINALIZED');
        for (const run of [noReceipt, resumed]) {
          assert.equal(
            run.trace.some((call) => call.method === 'acknowledgeWorkItem'),
            false,
          );
          assert.equal(
            run.trace.some(
              (call) =>
                call.method === 'callTool' &&
                call.input.name === 'save_assessment_work',
            ),
            false,
          );
        }
        const exact = resumed.trace.find(
          (call) => call.method === 'blockWorkItem',
        );
        assert.deepEqual(exact.input, lost.blocked.args);
        assert.deepEqual(exact.value, {
          ...lost.blocked.receipt,
          replayed: true,
        });
        assert.deepEqual(
          await host.snapshot(),
          before,
          'Exact BLOCK replay and local finalization do not write business state',
        );
        assert.equal(
          JSON.parse(
            await readFile(join(checkpointRoot, 'active-claim.json'), 'utf8'),
          ),
          null,
        );
        const following = await runSyntheticAnalysisStage(
          host,
          checkpointRoot,
          { crash: false },
        );
        assert.equal(following.originalGrant.workItemId, successor.workItemId);
        receipt.blockReplyRecovery = {
          originalReceipt: lost.blocked.receipt,
          noReceipt: noReceipt.result.result,
          exactReplay: exact.value,
          finalization: resumed.result.result,
          nextIndependentWorkItem: following.originalGrant.workItemId,
        };
        receipt.nativeChildren = [
          lost.stopped.run,
          lost.crashed,
          noReceipt,
          resumed,
          following.first,
        ].map((run) => ({ pid: run.pid, code: run.code, signal: run.signal }));
        receipt.checks = [
          'real BLOCK committed before SIGKILL',
          'real blockReady checkpoint retained',
          'transport missing receipt cannot clear',
          'actual restarted exact authorized replay',
          'zero recovery model/SAVE/ACK',
          'independent normal next tick',
        ];
      }),
  );

  for (const mutation of ['actor', 'source']) {
    test(
      `P1 BLOCK lost reply ${mutation} revocation cannot clear the old claim`,
      { timeout: 120000 },
      async (t) =>
        withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
          await host.seed();
          const lost = await loseCommittedBlockReply(host, checkpointRoot);
          if (mutation === 'actor') await host.revokeActor();
          else await host.correctSource(lost.claim.workItemId);
          const before = await host.snapshot();
          const resumed = await runConsumerChild(
            consumerHost(host),
            {
              entry: 'queue',
              nowIso: new Date().toISOString(),
              options: { checkpointRoot },
            },
            {
              modelRound: () =>
                assert.fail(
                  'Invalid BLOCK authorization cannot invoke a model',
                ),
            },
          );
          assertConsumerExit(resumed);
          assert.equal(resumed.result.result.status, 'REQUIRES_ATTENTION');
          const denied = resumed.trace.find(
            (call) => call.method === 'blockWorkItem' && call.error,
          );
          assert.ok(
            denied,
            'The real Host must refuse the now unauthorized release receipt',
          );
          assert.deepEqual(
            await readFile(join(checkpointRoot, 'active-claim.json')),
            lost.claimBytes,
          );
          assert.deepEqual(await host.snapshot(), before);
          assert.equal(
            (await readdir(checkpointRoot)).some((name) =>
              name.startsWith('blocked-claim-'),
            ),
            false,
          );
          receipt.blockReplyRevocation = {
            mutation,
            denial: denied.error,
            originalReceipt: lost.blocked.receipt,
            claimRetained: true,
            archived: false,
          };
          receipt.nativeChildren = [
            lost.stopped.run,
            lost.crashed,
            resumed,
          ].map((run) => ({
            pid: run.pid,
            code: run.code,
            signal: run.signal,
          }));
        }),
    );
  }

  test(
    'P1 BLOCK with an old grant cannot clear the actual replacement Host slot',
    { timeout: 120000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed();
        const stopped = await runStoppedAnalysisProbe(
          host,
          checkpointRoot,
          'FAILED',
        );
        let replacement;
        let occupied;
        const resumed = await runConsumerChild(
          consumerHost(host),
          {
            entry: 'queue',
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          },
          {
            modelRound: () =>
              assert.fail('An old grant cannot authorize a new model run'),
            beforeCall: async ({ method }) => {
              if (method !== 'blockWorkItem') return;
              await host.advance();
              replacement = await host.nextWorkItem({
                resumeWorkItemId: stopped.stopped.workItemId,
              });
              assert.equal(replacement.status, 'CLAIMED');
              assert.ok(
                replacement.leaseGeneration > stopped.stopped.leaseGeneration,
              );
              assert.notEqual(
                replacement.leaseToken,
                stopped.stopped.leaseToken,
              );
              occupied = await host.snapshot();
            },
          },
        );
        assertConsumerExit(resumed);
        assert.equal(resumed.result.result.status, 'REQUIRES_ATTENTION');
        const denied = resumed.trace.find(
          (call) => call.method === 'blockWorkItem' && call.error,
        );
        assert.ok(
          denied,
          'Real Host BLOCK must reject the stale grant after the replacement was claimed',
        );
        assert.deepEqual(
          await host.snapshot(),
          occupied,
          'The stale BLOCK cannot release or alter the replacement slot',
        );
        const claim = JSON.parse(
          await readFile(join(checkpointRoot, 'active-claim.json'), 'utf8'),
        );
        assert.equal(claim.leaseGeneration, stopped.stopped.leaseGeneration);
        assert.equal(claim.leaseToken, stopped.stopped.leaseToken);
        assert.ok(claim.blockReady);
        assert.equal(
          (await readdir(checkpointRoot)).some((name) =>
            name.startsWith('blocked-claim-'),
          ),
          false,
        );
        receipt.staleBlock = {
          denial: denied.error,
          staleGeneration: stopped.stopped.leaseGeneration,
          replacementGeneration: replacement.leaseGeneration,
          replacementPreserved: true,
          localClaimRetained: true,
        };
        receipt.nativeChildren = [stopped.run, resumed].map((run) => ({
          pid: run.pid,
          code: run.code,
          signal: run.signal,
        }));
      }),
  );

  test(
    'P1 BLOCK replay must reauthorize a revoked actor before returning a release receipt',
    { timeout: 120000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed();
        const stopped = await runStoppedAnalysisProbe(
          host,
          checkpointRoot,
          'FAILED',
        );
        const blockWorkItem = consumerHost(host).blockWorkItem;
        const args = {
          workItemId: stopped.stopped.workItemId,
          leaseToken: stopped.stopped.leaseToken,
          leaseGeneration: stopped.stopped.leaseGeneration,
        };
        const blocked = await blockWorkItem(args);
        assert.equal(blocked.status, 'BLOCKED');
        await host.revokeActor();
        const beforeReplay = await host.snapshot();
        let replay;
        let denial;
        try {
          replay = await blockWorkItem(args);
        } catch (error) {
          denial = transportError(error);
        }
        assert.deepEqual(await host.snapshot(), beforeReplay);
        assert.deepEqual(
          JSON.parse(
            await readFile(join(checkpointRoot, 'active-claim.json'), 'utf8'),
          ),
          stopped.stopped,
        );
        receipt.blockReplayAuthorization = {
          originalReceipt: blocked,
          revokedActorReplay: replay ?? null,
          denial: denial ?? null,
          activeClaim: stopped.stopped,
          workRetained: true,
        };
        receipt.nativeChildren = [
          {
            pid: stopped.run.pid,
            code: stopped.run.code,
            signal: stopped.run.signal,
          },
        ];
        assert.ok(
          denial,
          'A BLOCKED grant receipt may not authorize local release after current actor authorization is revoked',
        );
        assert.equal(replay, undefined);
      }),
  );

  test(
    'Q06 actual queue preserves a real saved stage and bounded auxiliary warnings after run-result write failure',
    { timeout: 120000 },
    async (t) =>
      withHostFixture(t, async (host, { checkpointRoot, receipt }) => {
        await host.seed();
        let claim;
        let saved;
        let committed;
        let faultRelativePath;
        let afterHostCommit;
        let modelCalls = 0;
        const run = await runConsumerChild(
          consumerHost(host),
          {
            entry: 'queue',
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          },
          {
            modelRound: ({ operation }) => {
              assert.equal(operation, 'EVALUATE_JOBAID');
              modelCalls++;
              if (modelCalls === 1)
                return {
                  action: 'READ_SOURCES',
                  purpose: 'READ',
                  context: 'PAGE',
                  sourceRefs: [
                    claim.modelInput.availableSources.find(
                      (item) => item.kind === 'DOCUMENT_PASSAGE',
                    ).ref,
                  ],
                };
              assert.equal(
                modelCalls,
                2,
                'An auxiliary failure cannot resend the model',
              );
              return {
                action: 'FINISH',
                workJson: JSON.stringify(host.proposal(claim)),
              };
            },
            afterCall: async ({ method, input, value }) => {
              if (method !== 'callTool') return;
              if (input.name === 'begin_dynamic_evaluation') claim = value;
              if (input.name === 'save_assessment_work') saved = value;
              if (input.name !== 'commit_dynamic_evaluation_candidate') return;
              committed = value;
              afterHostCommit = await host.snapshot();
              assert.equal(afterHostCommit.work.length, 1);
              assert.equal(
                afterHostCommit.attempts.find(
                  (row) => row.operation_ref === claim.attemptRef,
                ).status,
                'SUCCEEDED',
              );
              assert.equal(
                JSON.parse(afterHostCommit.workItems[0].projection_json)
                  .integratedAssessment.baseRules.workRevisionRef,
                saved.workRevisionRef,
              );
              const started = (
                await readdir(checkpointRoot, { recursive: true })
              ).find((name) =>
                name.endsWith(
                  'commit_dynamic_evaluation_candidate-1.started.json',
                ),
              );
              assert.ok(
                started,
                'Use the actual stage checkpoint created before the real Host commit',
              );
              faultRelativePath = join(dirname(started), 'run-result.json');
              await mkdir(join(checkpointRoot, faultRelativePath), {
                mode: 0o700,
              });
              assert.deepEqual(
                await readdir(join(checkpointRoot, faultRelativePath)),
                [],
              );
            },
          },
        );
        assertConsumerExit(run);
        assert.ok(committed);
        assert.ok(faultRelativePath);
        assert.deepEqual(
          await readdir(join(checkpointRoot, faultRelativePath)),
          [],
        );
        const after = await host.snapshot();
        assert.deepEqual(
          after,
          afterHostCommit,
          'The auxiliary filesystem failure cannot undo or duplicate Host business state',
        );
        assert.equal(after.work.length, 1);
        assert.equal(
          after.work[0].assessment_work_revision_id,
          saved.workRevisionRef,
        );
        assert.equal(run.result.result.status, 'IN_PROGRESS');
        assert.equal(run.result.result.consumerStatus, 'INITIAL_STAGE_SAVED');
        assert.equal(modelCalls, 2);
        assert.equal(
          run.trace.filter((call) => call.method === 'modelRound').length,
          2,
        );
        assert.equal(
          run.trace.filter(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'save_assessment_work',
          ).length,
          1,
        );
        assert.equal(
          run.trace.filter(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'commit_dynamic_evaluation_candidate',
          ).length,
          1,
        );
        assert.equal(run.consumerReports.length, 1);
        const actualConsumer = run.consumerReports[0];
        assert.equal(actualConsumer.status, 'INITIAL_STAGE_SAVED');
        assert.deepEqual(actualConsumer.localCheckpointWarnings, [
          {
            step: 'run-result',
            code: 'REVIEW_CHECKPOINT_AUXILIARY_WRITE_FAILED',
          },
        ]);
        receipt.q06 = {
          faultRelativePath,
          hostCommittedWorkRevisionRef: saved.workRevisionRef,
          hostAttemptStatus: after.attempts.find(
            (row) => row.operation_ref === claim.attemptRef,
          ).status,
          actualSaveCount: 1,
          actualModelGatewayRequests: modelCalls,
          consumerStatus: actualConsumer.status,
          consumerWarnings: actualConsumer.localCheckpointWarnings,
          queueConsumerStatus: run.result.result.consumerStatus,
          queueWarnings: run.result.result.localCheckpointWarnings ?? null,
        };
        receipt.nativeChildren = [
          { pid: run.pid, code: run.code, signal: run.signal },
        ];
        receipt.checks = [
          'Q06 real filesystem directory collision after real Host commit',
          'one JAWR and projected base retained',
          'INITIAL_STAGE_SAVED preserved',
          'zero extra SAVE/model/commit',
          'bounded actual consumer warning reaches production queue report',
        ];
        assert.deepEqual(
          run.result.result.localCheckpointWarnings,
          actualConsumer.localCheckpointWarnings,
          'The actual production queue report must retain the bounded warning from its actual stage consumer',
        );
        const originalWork = after.work[0];
        const originalAttempt = after.attempts.find(
          (row) => row.operation_ref === claim.attemptRef,
        );
        const originalSave = run.trace.find(
          (call) =>
            call.method === 'callTool' &&
            call.input.name === 'save_assessment_work',
        );
        const originalSaveKey = originalSave.input.args.requestId;
        assert.equal(originalWork.request_id, originalSaveKey);
        assert.ok(originalWork.command_json);
        assert.equal(
          JSON.parse(originalAttempt.result_envelope_json).status,
          'SUCCEEDED',
        );
        assert.equal(
          JSON.parse(originalAttempt.result_envelope_json).contentHash,
          originalAttempt.result_content_hash,
        );
        const sourceReads = JSON.parse(
          originalAttempt.review_activity_json ?? '[]',
        ).filter((activity) => activity.kind === 'ASSESSMENT_SOURCES_READ');
        assert.ok(
          sourceReads.length > 0,
          'Actual Host source-read audit must remain available',
        );
        const actualReadback = run.trace
          .slice(run.trace.indexOf(originalSave) + 1)
          .find(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'read_assessment_work' &&
              call.input.args.requestId === originalSaveKey,
          );
        assert.ok(
          actualReadback,
          'The real SAVE must have an authorized original-key readback after it commits',
        );
        assert.equal(
          actualReadback.value.revision.workRevisionRef,
          saved.workRevisionRef,
        );

        let overallModelCalls = 0;
        const overall = await runConsumerChild(
          consumerHost(host),
          {
            entry: 'queue',
            nowIso: new Date().toISOString(),
            options: { checkpointRoot },
          },
          {
            modelRound: ({ operation }) => {
              assert.equal(
                operation,
                'SYNTHESIZE_OVERALL',
                'An auxiliary log failure cannot repeat the original analysis',
              );
              overallModelCalls++;
              assert.equal(overallModelCalls, 1);
              return {
                action: 'FINISH',
                consistencyCheck: '核对已保存分析与概览，保留真实条件和未知。',
              };
            },
          },
        );
        assertConsumerExit(overall);
        assert.equal(overall.result.result.status, 'ACKNOWLEDGED');
        const acknowledgement = overall.trace.filter(
          (call) => call.method === 'acknowledgeWorkItem',
        );
        assert.equal(acknowledgement.length, 1);
        assert.equal(acknowledgement[0].value.status, 'ACKNOWLEDGED');
        assert.equal(
          overall.trace.some(
            (call) =>
              call.method === 'callTool' &&
              ['begin_dynamic_evaluation', 'save_assessment_work'].includes(
                call.input.name,
              ),
          ),
          false,
        );
        assert.ok(
          overall.trace.some(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'begin_overall_synthesis',
          ),
        );
        assert.ok(
          overall.trace.some(
            (call) =>
              call.method === 'callTool' &&
              call.input.name === 'commit_overall_candidate',
          ),
        );
        const finished = await host.snapshot();
        assert.deepEqual(
          finished.work.filter(
            (row) => row.work_item_id === claim.task.workItemId,
          ),
          [originalWork],
        );
        assert.deepEqual(
          finished.attempts.find(
            (row) => row.operation_ref === claim.attemptRef,
          ),
          originalAttempt,
        );
        const overallAttempt = finished.attempts.find(
          (row) =>
            row.work_item_id === claim.task.workItemId &&
            row.action_type === 'OPENCLAW_OVERALL_SYNTHESIS',
        );
        assert.equal(overallAttempt.status, 'SUCCEEDED');
        assert.equal(
          JSON.parse(overallAttempt.result_envelope_json).status,
          'SUCCEEDED',
        );
        assert.equal(
          JSON.parse(overallAttempt.result_envelope_json).contentHash,
          overallAttempt.result_content_hash,
        );
        const completedGrant = finished.grants.find(
          (row) => row.work_item_id === claim.task.workItemId,
        );
        assert.equal(completedGrant.status, 'COMPLETED');
        assert.equal(completedGrant.lease_owner, null);
        assert.equal(completedGrant.lease_token, null);
        assert.equal(completedGrant.lease_expires_at, null);
        assert.equal(
          JSON.parse(
            finished.workItems.find(
              (row) => row.work_item_id === claim.task.workItemId,
            ).projection_json,
          ).integratedAssessment.overallSynthesis.basedOnJobAidWorkRevisionRef,
          saved.workRevisionRef,
        );
        assert.equal(
          JSON.parse(
            await readFile(join(checkpointRoot, 'active-claim.json'), 'utf8'),
          ),
          null,
        );
        assert.deepEqual(
          await readdir(join(checkpointRoot, faultRelativePath)),
          [],
          'Keep the original filesystem fault in place through Overall/ACK',
        );

        const successor = await host.seed('WI-core-p1-q06-successor');
        const following = await runSyntheticAnalysisStage(
          host,
          checkpointRoot,
          { crash: false },
        );
        assert.equal(following.originalGrant.workItemId, successor.workItemId);
        assert.equal(
          following.first.result.result.consumerStatus,
          'INITIAL_STAGE_SAVED',
        );
        assert.equal(
          following.first.trace.find((call) => call.method === 'nextWorkItem')
            .input?.resumeWorkItemId,
          undefined,
        );
        const final = await host.snapshot();
        assert.deepEqual(
          final.work.filter(
            (row) => row.work_item_id === claim.task.workItemId,
          ),
          [originalWork],
        );
        assert.deepEqual(
          final.attempts.find((row) => row.operation_ref === claim.attemptRef),
          originalAttempt,
        );
        assert.deepEqual(
          final.attempts.find(
            (row) => row.operation_ref === overallAttempt.operation_ref,
          ),
          overallAttempt,
        );
        assert.deepEqual(
          final.grants.find(
            (row) => row.work_item_id === claim.task.workItemId,
          ),
          completedGrant,
        );
        const originalSaves = [
          ...run.trace,
          ...overall.trace,
          ...following.first.trace,
        ].filter(
          (call) =>
            call.method === 'callTool' &&
            call.input.name === 'save_assessment_work' &&
            call.input.args.workItemId === claim.task.workItemId,
        );
        assert.equal(
          originalSaves.length,
          1,
          'Exactly the original SAVE key persists throughout completion and successor dispatch',
        );
        receipt.q06.completion = {
          originalSaveKey,
          originalReadbackWorkRevisionRef:
            actualReadback.value.revision.workRevisionRef,
          sourceReadAuditCount: sourceReads.length,
          originalResultContentHash: originalAttempt.result_content_hash,
          overallResultContentHash: overallAttempt.result_content_hash,
          overallBasedOnWorkRevisionRef: saved.workRevisionRef,
          overallModelGatewayRequests: overallModelCalls,
          acknowledgement: acknowledgement[0].value,
          originalGrantStatus: completedGrant.status,
          independentSuccessor: following.originalGrant.workItemId,
          independentSavedWorkRevisionRef: following.save.value.workRevisionRef,
          duplicateOriginalSaveCount: originalSaves.length - 1,
        };
        receipt.nativeChildren = [run, overall, following.first].map(
          (child) => ({
            pid: child.pid,
            code: child.code,
            signal: child.signal,
          }),
        );
        receipt.checks.push(
          'real Overall then ACK releases original grant',
          'fault directory persists without blocking the next stage',
          'independent normal successor SAVE/commit',
          'original save key/JAWR/source-read/Result audits retained',
        );
      }),
  );
}
