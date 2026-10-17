import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
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
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts =
  '../../openclaw/skills/wiselink-research-and-synthesize/scripts/';
const GLM = {
  modelRef: 'miaoda/glm-5.3',
  displayName: 'GLM-5.3',
  providerKind: 'BUILT_IN',
  settingsRevision: 1,
  selectedAt: '2026-10-16T00:00:00.000Z',
};
const transportError = (error) =>
  Object.fromEntries(
    ['message', 'code', 'statusCode', 'hostErrorCode', 'hostToolName']
      .filter((key) => error?.[key] !== undefined)
      .map((key) => [key, error[key]]),
  );

// Reuses the P1/P2 owned-child IPC seam. The actual consumer, model adapter,
// JobAid loop, default HTTP transport and checkpoint store all run in this child.
async function nativeChild() {
  const pending = new Map();
  let ordinal = 0;
  const rpc = (method, input) =>
    new Promise((resolve, reject) => {
      const id = ++ordinal;
      pending.set(id, { resolve, reject });
      process.send({ type: 'request', id, method, input });
    });
  process.on('message', (message) => {
    if (message?.type !== 'response') return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error)
      waiter.reject(
        Object.assign(new Error(message.error.message), message.error),
      );
    else waiter.resolve(message.value);
  });
  const [configuration] = await once(process, 'message');
  const { consumeHostedWorkItem, consumeAutomaticWorkItemQueueTick } =
    await import(`${scripts}consume-hosted-work-item.mjs`);
  const { createCheckpointStore } = await import(
    `${scripts}run-hosted-review-turn.mjs`
  );
  const { invokeHostedInitialModel } = await import(
    `${scripts}invoke-hosted-initial-model.mjs`
  );
  const { invokeHostedJobAidProblemModel } = await import(
    `${scripts}run-jobaid-problem-assessment.mjs`
  );
  const callTool = (name, args) => rpc('callTool', { name, args });
  const createOwnedCheckpoint = async (path) => {
    const checkpoint = await createCheckpointStore(path);
    if (configuration.macSerialOwner)
      checkpoint.withActiveClaimOwner = async (perform) => {
        assert.equal(process.platform, 'darwin');
        await rpc('assertLocalOwner', {
          pid: process.pid,
          checkpointRoot: path,
        });
        return perform();
      };
    return checkpoint;
  };
  const runtime = {
    gatewayChatCompletionsEnabled: true,
    gatewayUrl: configuration.gatewayUrl,
    gatewayToken: 'owned-core-p3-http-fixture-only',
    configuredModelVersion: GLM.modelRef,
    registeredModelRefs: [GLM.modelRef],
  };
  const dependencies = {
    callTool,
    createCheckpoint: createOwnedCheckpoint,
    invokeInitialModel: (input, hooks) =>
      invokeHostedInitialModel(input, { ...runtime, ...hooks }),
    invokeMatterModel: (input, hooks) =>
      invokeHostedJobAidProblemModel(input, { ...runtime, ...hooks }),
  };
  try {
    const checkpoint = await createOwnedCheckpoint(
      configuration.options.checkpointRoot,
    );
    const result =
      configuration.entry === 'matter'
        ? await consumeHostedWorkItem(configuration.options, dependencies)
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
            consumeWorkItem: (input) =>
              consumeHostedWorkItem(input, dependencies),
            now: () => new Date(),
          });
    process.send({ type: 'result', result });
  } catch (error) {
    process.send({ type: 'result', error: transportError(error) });
  } finally {
    process.disconnect();
  }
}

async function runNative(host, configuration, { afterCall } = {}) {
  const root = resolve(configuration.options.checkpointRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = `${root}.owned-child.lock`;
  const owner = await open(lockPath, 'wx', 0o600);
  const child = fork(fileURLToPath(import.meta.url), [], {
    execArgv: [],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      CORE_P3_NATIVE_CHILD: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const trace = [];
  const handlers = new Set();
  let result;
  let output = '';
  let killedAfterCommit = false;
  const exited = once(child, 'exit');
  child.stdout.on('data', (value) => {
    output += value;
  });
  child.stderr.on('data', (value) => {
    output += value;
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 35000);
  async function handle(message) {
    if (message.type === 'result') {
      result = message;
      return;
    }
    if (message.type !== 'request') return;
    const record = { method: message.method, input: message.input };
    trace.push(record);
    try {
      if (message.method === 'assertLocalOwner') {
        assert.equal(message.input.pid, child.pid);
        const requested = resolve(message.input.checkpointRoot);
        const matterRoot = join(
          root,
          'matter',
          encodeURIComponent(configuration.options.matterId ?? ''),
        );
        assert.ok(
          requested === root ||
            (configuration.entry === 'matter' &&
              (requested === matterRoot ||
                requested.startsWith(`${matterRoot}/`))),
        );
        assert.equal((await owner.stat()).isFile(), true);
        record.value = true;
      } else if (message.method === 'callTool')
        record.value = await host.callTool(
          message.input.name,
          message.input.args,
        );
      else if (message.method === 'blockWorkItem')
        record.value = await host.hosted(() =>
          host.dispatch.blockWorkItem(message.input),
        );
      else if (message.method === 'readInitialStatus') {
        const wire = await host.readInitialStatus(message.input);
        assert.equal(wire.entry.workItemId, message.input);
        record.value = { ...wire.initialAnalysis, workItemId: message.input };
      } else record.value = await host[message.method](message.input);
      if ((await afterCall?.(record)) === 'kill') {
        killedAfterCommit = true;
        child.kill('SIGKILL');
        return;
      }
      if (child.connected)
        child.send({ type: 'response', id: message.id, value: record.value });
    } catch (error) {
      record.error = transportError(error);
      if (child.connected)
        child.send({ type: 'response', id: message.id, error: record.error });
    }
  }
  child.on('message', (message) => {
    const handled = handle(message);
    handlers.add(handled);
    handled.finally(() => handlers.delete(handled));
  });
  try {
    await owner.writeFile(
      JSON.stringify({
        parentPid: process.pid,
        childPid: child.pid,
        checkpointRoot: root,
      }),
    );
    child.send({
      type: 'start',
      ...configuration,
      options: { ...configuration.options, checkpointRoot: root },
      macSerialOwner: process.platform === 'darwin',
    });
    const [exitCode, signal] = await exited;
    await Promise.allSettled([...handlers]);
    return {
      pid: child.pid,
      exitCode,
      signal,
      killedAfterCommit,
      result,
      output,
      trace,
      serialOwner:
        'exact child PID and exclusive checkpoint namespace; Linux production flock NOT_RUN on Darwin',
    };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    await owner.close();
    await unlink(lockPath);
  }
}

async function endpoint(program) {
  const requests = [],
    errors = [];
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      requests.push({
        ordinal: requests.length + 1,
        payload,
        headers: request.headers,
      });
      const step = await program({ ordinal: requests.length, payload });
      if (step.fixtureSocketCut) {
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': '20000',
        });
        response.write('{"choices":[');
        response.socket.destroy();
        return;
      }
      const result = step.fixturePayload ?? {
        model: 'constructed-offline-GLM-response',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `owned-${requests.length}`,
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
      response.writeHead(step.fixtureStatus ?? 200, {
        'content-type': 'application/json',
      });
      response.end(JSON.stringify(result));
    } catch (error) {
      errors.push(transportError(error));
      response.writeHead(500);
      response.end('{"error":{"type":"api_error"}}');
    }
  });
  await new Promise((resolve, reject) =>
    server.listen(0, '127.0.0.1', resolve).once('error', reject),
  );
  return {
    gatewayUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    errors,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
const calls = (runs, name) =>
  runs
    .flatMap((run) => run.trace)
    .filter((call) => call.method === 'callTool' && call.input.name === name);
const succeeded = (run) => {
  assert.equal(run.exitCode, 0, run.output);
  assert.equal(run.result?.error, undefined, JSON.stringify(run.result));
  return run.result.result;
};
const saveArgs = (claim, key, revision, work) => ({
  workItemId: claim.task.workItemId,
  attemptRef: claim.attemptRef,
  leaseToken: claim.leaseToken,
  leaseGeneration: claim.leaseGeneration,
  requestId: key,
  expectedWorkRevision: revision,
  workJson: JSON.stringify(work),
});
const commitArgs = (host, claim, ref) => ({
  workItemId: claim.task.workItemId,
  attemptRef: claim.attemptRef,
  leaseToken: claim.leaseToken,
  leaseGeneration: claim.leaseGeneration,
  result: host.result(
    claim,
    ref,
    'Compare the exact saved synthetic work and current overview.',
  ),
});
const readStep = (claim) => ({
  action: 'READ_SOURCES',
  sourceRefs: [
    claim.task.modelInput.sourceCatalog.find(
      (source) => source.kind === 'DOCUMENT_PASSAGE',
    ).evidenceRef,
  ],
  purpose: 'Read exact constructed original condition',
  context: 'EXACT',
});
const isBegin = (call) =>
  call.method === 'callTool' &&
  ['begin_dynamic_evaluation', 'begin_overall_synthesis'].includes(
    call.input.name,
  );
async function checkpointFiles(root) {
  const found = {};
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const p = join(path, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.name.endsWith('.json'))
        found[p.slice(root.length + 1)] = JSON.parse(await readFile(p, 'utf8'));
    }
  }
  await walk(root);
  return found;
}

if (process.env.CORE_P3_NATIVE_CHILD === '1') await nativeChild();
else {
  const { default: test } = await import('node:test');
  const { startCoreP1HostFixture } =
    await import('./helpers/core-p1-host-postgres.fixture.mjs');
  test(
    'P3 actual consumers and default owned HTTP on one real Host/PostgreSQL fixture',
    { timeout: 240000 },
    async (t) => {
      let host;
      try {
        host = await startCoreP1HostFixture({ matter: true, browser: true });
      } catch (error) {
        const destination = process.env.WL_CORE_P3_EVIDENCE_DIR;
        if (destination) {
          await mkdir(destination, { recursive: true, mode: 0o700 });
          await writeFile(
            join(destination, 'startup-error.actual.private.json'),
            JSON.stringify(
              {
                ...transportError(error),
                command: error.command,
                exitCode: error.exitCode,
                diagnostic: error.diagnostic,
                scope: 'STARTUP_ERROR; no business cases entered',
              },
              null,
              2,
            ) + '\n',
            { mode: 0o600 },
          );
        }
        throw error;
      }
      const root = await mkdtemp(join(tmpdir(), 'wiselink-core-p3-consumers-'));
      const ownedPgPid = Number(
        (
          await readFile(join(host.ownership.data, 'postmaster.pid'), 'utf8')
        ).split('\n')[0],
      );
      const proof = {
        scope:
          'synthetic materials + owned HTTP only; actual consumers/driver/default transport/Host services/PG',
        ownership: host.ownership,
        ownedPgPid,
        role: await host.roleEvidence(),
        model: GLM,
        cases: [],
        realProvider: 'NOT_RUN',
        platform: 'NOT_RUN',
        linuxFlock:
          process.platform === 'linux'
            ? 'UNOBSERVED'
            : 'NOT_RUN_DARWIN_SERIAL_CHILD_SEAM',
      };
      assert.equal(proof.role[0].superuser, false);
      assert.equal(proof.role[0].bypassrls, false);
      async function caseOf(name, perform) {
        const selected =
          !process.env.WL_CORE_P3_CASE_PATTERN ||
          new RegExp(process.env.WL_CORE_P3_CASE_PATTERN, 'u').test(name);
        return t.test(name, { skip: !selected }, async () => {
          const entry = { name, status: 'RUNNING' };
          proof.cases.push(entry);
          try {
            await perform(entry);
            entry.status = 'PASS';
          } catch (error) {
            entry.status = 'FAIL';
            entry.error = transportError(error);
            throw error;
          } finally {
            entry.finalSnapshot = await host.snapshot();
          }
        });
      }
      try {
        await caseOf(
          'Overall repairs NOT_AVAILABLE through overview-only SAVE, ACK and current browser/preparation/knowledge reads',
          async (evidence) => {
            const id = 'WI-core-p3-current';
            await host.seed(id, { executionModel: GLM });
            const checkpointRoot = join(root, 'current');
            const runs = [];
            let claim;
            const rounds = new Map();
            const saves = [];
            let beforeWork;
            const gateway = await endpoint(() => {
              assert.ok(claim);
              const n = (rounds.get(claim.attemptRef) ?? 0) + 1;
              rounds.set(claim.attemptRef, n);
              if (claim.task.taskType === 'OPENCLAW_DYNAMIC_EVALUATION') {
                if (n === 1) return readStep(claim);
                if (n === 2) {
                  const work = host.proposal(claim);
                  delete work.overview;
                  return {
                    action: 'SAVE_WORK',
                    workJson: JSON.stringify(work),
                  };
                }
                assert.equal(n, 3);
                return { action: 'FINISH' };
              }
              if (n === 1)
                return {
                  action: 'FINISH',
                  consistencyCheck:
                    'A check sentence cannot replace absent overview.',
                };
              if (n === 2)
                return {
                  action: 'READ_WORK',
                  workRevisionRef: saves[0].workRevisionRef,
                  issueKeys: [],
                  includeOverview: true,
                };
              if (n === 3) {
                const work = host.proposal(claim);
                work.issues = [];
                work.overview = `Current independent overview [[${claim.task.modelInput.sourceCatalog.find((x) => x.kind === 'DOCUMENT_PASSAGE').evidenceRef}]]`;
                return { action: 'SAVE_WORK', workJson: JSON.stringify(work) };
              }
              assert.equal(n, 4);
              return {
                action: 'FINISH',
                consistencyCheck:
                  'The overview was actually saved against exact original questions.',
              };
            });
            const configuration = {
              entry: 'queue',
              gatewayUrl: gateway.gatewayUrl,
              options: {
                checkpointRoot,
                initialStageOnly: true,
                maxInitialStages: 1,
              },
            };
            const afterCall = async (call) => {
              if (isBegin(call)) {
                claim = call.value;
                assert.equal(claim.task.executionModel.modelRef, GLM.modelRef);
                if (
                  call.input.name === 'begin_overall_synthesis' &&
                  !beforeWork
                ) {
                  const before = await host.snapshot();
                  beforeWork = before.work.filter(
                    (row) => row.work_item_id === id,
                  )[0];
                  assert.equal(
                    JSON.parse(beforeWork.content_json).overviewStatus,
                    'NOT_AVAILABLE',
                  );
                }
              }
              if (
                call.method === 'callTool' &&
                call.input.name === 'save_assessment_work'
              )
                saves.push(call.value);
            };
            try {
              runs.push(await runNative(host, configuration, { afterCall }));
              succeeded(runs.at(-1));
              runs.push(await runNative(host, configuration, { afterCall }));
              succeeded(runs.at(-1));
              if (runs.at(-1).result.result.status !== 'ACKNOWLEDGED') {
                runs.push(await runNative(host, configuration, { afterCall }));
                succeeded(runs.at(-1));
              }
              evidence.runs = runs;
              evidence.requests = gateway.requests;
              assert.equal(runs.at(-1).result.result.status, 'ACKNOWLEDGED');
              assert.equal(saves.length, 2);
              const snap = await host.snapshot();
              const work = snap.work.filter((row) => row.work_item_id === id);
              assert.equal(work.length, 2);
              assert.equal(work[0].content_json, beforeWork.content_json);
              const prior = JSON.parse(work[0].content_json),
                current = JSON.parse(work[1].content_json);
              assert.deepEqual(current.issues, prior.issues);
              assert.equal(current.overviewStatus, 'CURRENT');
              for (const source of prior.evidence)
                assert.deepEqual(
                  current.evidence.find(
                    (x) => x.evidenceRef === source.evidenceRef,
                  ),
                  source,
                );
              const browser = await host.withBrowser(() =>
                host.problem.readBrowser(id, host.actor),
              );
              const knowledge = await host.withBrowser(() =>
                host.problem.readBrowserKnowledgeRevision(
                  id,
                  work[1].assessment_work_revision_id,
                  host.actor,
                ),
              );
              evidence.browser = browser;
              evidence.knowledge = knowledge;
              assert.equal(
                browser.currentInputChanged,
                false,
                'Overall projection CAS must not make its own saved work stale',
              );
              assert.equal(browser.overallStatus, 'CURRENT');
              assert.equal(knowledge.overall.status, 'CANDIDATE_ONLY');
              assert.equal(
                knowledge.overall.readingResult.resultRef,
                work[1].assessment_work_revision_id,
              );
              assert.deepEqual(knowledge.revision.content, current);
              assert.equal(
                browser.overallBasedOnWorkRevisionRef,
                work[1].assessment_work_revision_id,
              );
              const turn = await host.seedReviewTurn({
                workItemId: id,
                text: 'Check current saved overview without changing the source.',
                purpose: 'UPDATE_ASSESSMENT',
                targetIssueKeys: ['condition'],
              });
              const prep = await host.withReviewScope(id, async (service) => {
                const review = await service.begin(
                  turn.reviewConversationId,
                  turn.requestId,
                  id,
                );
                const view =
                  review.task.modelInput.jobAidContext.modelInput.preparation;
                return {
                  task: review.task,
                  view,
                };
              });
              evidence.newReviewPreparation = prep;
              assert.equal(prep.view.currentInputChanged, false);
              assert.equal(
                prep.view.lastSaved.workRevisionRef,
                work[1].assessment_work_revision_id,
              );
              assert.equal(
                prep.view.goal,
                'Check current saved overview without changing the source.',
              );
              assert.deepEqual(prep.view.targetIssueKeys, ['condition']);
              assert.equal(
                prep.view.taskInputRevision,
                prep.view.currentInputRevision,
              );
              assert.deepEqual(gateway.errors, []);
            } finally {
              evidence.runs = runs;
              evidence.requests = gateway.requests;
              await gateway.close();
            }
          },
        );

        await caseOf(
          'Overall committed projection with lost reply resumes original stage without another model or problem SAVE',
          async (evidence) => {
            const id = 'WI-core-p3-overall-lost';
            await host.seed(id, { executionModel: GLM });
            const checkpointRoot = join(root, 'overall-lost');
            const runs = [];
            let claim;
            const rounds = new Map();
            let killed = false;
            const gateway = await endpoint(() => {
              const n = (rounds.get(claim.attemptRef) ?? 0) + 1;
              rounds.set(claim.attemptRef, n);
              if (claim.task.taskType === 'OPENCLAW_OVERALL_SYNTHESIS')
                return {
                  action: 'FINISH',
                  consistencyCheck:
                    'Compare exact current saved synthetic overview.',
                };
              if (n === 1) return readStep(claim);
              if (n === 2)
                return {
                  action: 'SAVE_WORK',
                  workJson: JSON.stringify(host.proposal(claim)),
                };
              assert.equal(n, 3);
              return { action: 'FINISH' };
            });
            const configuration = {
              entry: 'queue',
              gatewayUrl: gateway.gatewayUrl,
              options: {
                checkpointRoot,
                initialStageOnly: true,
                maxInitialStages: 1,
              },
            };
            const afterCall = (call) => {
              if (isBegin(call)) {
                claim = call.value;
                assert.equal(claim.task.executionModel.modelRef, GLM.modelRef);
              }
              if (
                !killed &&
                call.method === 'callTool' &&
                call.input.name === 'commit_overall_candidate'
              ) {
                killed = true;
                return 'kill';
              }
            };
            try {
              runs.push(await runNative(host, configuration, { afterCall }));
              succeeded(runs.at(-1));
              runs.push(await runNative(host, configuration, { afterCall }));
              assert.equal(runs.at(-1).killedAfterCommit, true);
              const committed = await host.snapshot();
              const requestsBefore = gateway.requests.length;
              runs.push(await runNative(host, configuration, { afterCall }));
              succeeded(runs.at(-1));
              assert.equal(runs.at(-1).result.result.status, 'ACKNOWLEDGED');
              assert.equal(gateway.requests.length, requestsBefore);
              assert.equal(calls(runs, 'save_assessment_work').length, 1);
              const after = await host.snapshot();
              assert.deepEqual(
                after.work.filter((row) => row.work_item_id === id),
                committed.work.filter((row) => row.work_item_id === id),
              );
              evidence.runs = runs;
              evidence.requests = gateway.requests;
            } finally {
              evidence.runs = runs;
              evidence.requests = gateway.requests;
              await gateway.close();
            }
          },
        );

        await caseOf(
          'Host exact Overall commit rejects absent or stale overview and newer saved work or input',
          async (evidence) => {
            evidence.variants = [];
            for (const variant of [
              'NOT_AVAILABLE',
              'STALE',
              'NEWER_WORK',
              'NEWER_INPUT',
            ]) {
              const id = `WI-core-p3-guard-${variant.toLowerCase().replaceAll('_', '-')}`;
              const detail = { variant, runs: [] };
              evidence.variants.push(detail);
              await host.seed(id, { executionModel: GLM });
              let dynamic;
              const gateway = await endpoint(({ ordinal }) => {
                if (ordinal === 1) return readStep(dynamic);
                if (ordinal === 2) {
                  const work = host.proposal(dynamic);
                  if (variant === 'NOT_AVAILABLE') delete work.overview;
                  return {
                    action: 'SAVE_WORK',
                    workJson: JSON.stringify(work),
                  };
                }
                assert.equal(ordinal, 3);
                return { action: 'FINISH' };
              });
              try {
                const run = await runNative(
                  host,
                  {
                    entry: 'queue',
                    gatewayUrl: gateway.gatewayUrl,
                    options: {
                      checkpointRoot: join(root, `guard-${variant}`),
                      initialStageOnly: true,
                      maxInitialStages: 1,
                    },
                  },
                  {
                    afterCall: (call) => {
                      if (isBegin(call)) dynamic = call.value;
                    },
                  },
                );
                detail.runs.push(run);
                assert.equal(
                  succeeded(run).consumerStatus,
                  'INITIAL_STAGE_SAVED',
                );
                const queue = run.trace.find(
                  (call) => call.method === 'nextWorkItem',
                ).value;
                const original = calls([run], 'save_assessment_work')[0].value;
                const overall = await host.callTool('begin_overall_synthesis', {
                  workItemId: id,
                  providers: [],
                });
                assert.equal(
                  overall.task.executionModel.modelRef,
                  GLM.modelRef,
                );
                detail.overall = overall;
                let finishRef = original.workRevisionRef;
                if (variant === 'STALE' || variant === 'NEWER_WORK') {
                  const next = host.proposal(overall);
                  if (variant === 'STALE') {
                    delete next.overview;
                    next.issues[0].body +=
                      ' A new explicit unresolved condition is retained.';
                  } else {
                    next.issues = [];
                    next.overview +=
                      ' A later exact overview replaces the earlier version.';
                  }
                  detail.laterSave = await host.callTool(
                    'save_assessment_work',
                    saveArgs(
                      overall,
                      `guard-${variant.toLowerCase()}`,
                      original.workRevision,
                      next,
                    ),
                  );
                  if (variant === 'STALE')
                    finishRef = detail.laterSave.workRevisionRef;
                }
                if (variant === 'NEWER_INPUT')
                  detail.inputCorrection = await host.correctInput(id);
                const before = await host.snapshot();
                // Deliberately invalid candidate at the real API boundary. No
                // Overall model run is claimed for this direct Host guard probe.
                if (variant === 'NEWER_INPUT') {
                  await assert.rejects(
                    host.callTool(
                      'commit_overall_candidate',
                      commitArgs(host, overall, finishRef),
                    ),
                    (error) => {
                      detail.rejection = transportError(error);
                      return error.message === 'WORK_ITEM_REVISION_CONFLICT';
                    },
                  );
                } else {
                  detail.receipt = await host.callTool(
                    'commit_overall_candidate',
                    commitArgs(host, overall, finishRef),
                  );
                }
                const after = await host.snapshot();
                const row = after.attempts.find(
                  (item) => item.operation_ref === overall.attemptRef,
                );
                detail.before = before;
                detail.after = after;
                detail.directCandidatePurpose =
                  'Host rejection probe only; not an observed model execution';
                assert.equal(
                  variant === 'NEWER_INPUT'
                    ? row.status
                    : detail.receipt.status,
                  variant === 'NEWER_INPUT' ? 'CONFLICT' : 'FAILED',
                );
                const stored = after.workItems.find(
                  (item) => item.work_item_id === id,
                );
                assert.equal(
                  stored.projection_json,
                  before.workItems.find((item) => item.work_item_id === id)
                    .projection_json,
                );
                assert.equal(
                  JSON.parse(stored.projection_json).integratedAssessment
                    .overallSynthesis,
                  null,
                );
                assert.deepEqual(
                  after.work.filter((item) => item.work_item_id === id),
                  before.work.filter((item) => item.work_item_id === id),
                );
                if (variant === 'NOT_AVAILABLE' || variant === 'STALE') {
                  assert.equal(
                    row.terminal_reason,
                    'HOST_RESULT_GATE_REJECTED',
                  );
                  assert.equal(
                    row.error_code,
                    'JOBAID_OVERALL_EXACT_WORK_REQUIRED',
                  );
                  assert.match(
                    row.error_message,
                    new RegExp(
                      `^JOBAID_OVERALL_EXACT_WORK_REQUIRED:${finishRef}:OVERVIEW_${variant}$`,
                      'u',
                    ),
                  );
                } else if (variant === 'NEWER_WORK') {
                  assert.equal(
                    row.error_code,
                    'JOBAID_COMPLETED_WORK_REQUIRED',
                  );
                }
                if (variant !== 'NEWER_INPUT') {
                  detail.block = await host.hosted(() =>
                    host.dispatch.blockWorkItem({
                      workItemId: id,
                      leaseToken: queue.leaseToken,
                      leaseGeneration: queue.leaseGeneration,
                    }),
                  );
                  assert.equal(detail.block.status, 'BLOCKED');
                }
                assert.equal(gateway.requests.length, 3);
                detail.requests = gateway.requests;
              } finally {
                detail.requests = gateway.requests;
                await gateway.close();
              }
            }
          },
        );

        await caseOf(
          'Overall known FAILED commit with lost reply retains original stage and exact problem SAVE',
          async (evidence) => {
            const id = 'WI-core-p3-overall-failed-lost';
            await host.seed(id, { executionModel: GLM });
            let claim;
            let killed = false;
            const rounds = new Map();
            const runs = [];
            const checkpointRoot = join(root, 'overall-failed-lost');
            const gateway = await endpoint(() => {
              const round = (rounds.get(claim.attemptRef) ?? 0) + 1;
              rounds.set(claim.attemptRef, round);
              if (claim.task.taskType === 'OPENCLAW_OVERALL_SYNTHESIS')
                return {
                  fixturePayload: {
                    choices: [
                      {
                        finish_reason: 'tool_calls',
                        message: {
                          role: 'assistant',
                          content: null,
                          tool_calls: [
                            {
                              id: 'owned-wrong-tool',
                              type: 'function',
                              function: {
                                name: 'wrong_wiselink_tool',
                                arguments: '{}',
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                };
              if (round === 1) return readStep(claim);
              if (round === 2)
                return {
                  action: 'SAVE_WORK',
                  workJson: JSON.stringify(host.proposal(claim)),
                };
              assert.equal(round, 3);
              return { action: 'FINISH' };
            });
            const configuration = {
              entry: 'queue',
              gatewayUrl: gateway.gatewayUrl,
              options: {
                checkpointRoot,
                initialStageOnly: true,
                maxInitialStages: 1,
              },
            };
            const afterCall = (call) => {
              if (isBegin(call)) claim = call.value;
              if (
                !killed &&
                call.method === 'callTool' &&
                call.input.name === 'commit_overall_candidate'
              ) {
                assert.equal(call.value.status, 'FAILED');
                killed = true;
                return 'kill';
              }
            };
            try {
              runs.push(await runNative(host, configuration, { afterCall }));
              assert.equal(
                succeeded(runs.at(-1)).consumerStatus,
                'INITIAL_STAGE_SAVED',
              );
              runs.push(await runNative(host, configuration, { afterCall }));
              assert.equal(runs.at(-1).killedAfterCommit, true);
              const committed = await host.snapshot();
              const original = committed.work.filter(
                (row) => row.work_item_id === id,
              );
              assert.equal(original.length, 1);
              const failed = committed.attempts.find(
                (row) => row.operation_ref === claim.attemptRef,
              );
              assert.equal(failed.status, 'FAILED');
              assert.equal(
                failed.terminal_reason,
                'JOBAID_PROTOCOL_REPAIR_EXHAUSTED',
              );
              assert.equal(
                JSON.parse(
                  committed.workItems.find((row) => row.work_item_id === id)
                    .projection_json,
                ).integratedAssessment.overallSynthesis,
                null,
              );
              const requestsBefore = gateway.requests.length;
              evidence.checkpointsBeforeRestart =
                await checkpointFiles(checkpointRoot);
              runs.push(await runNative(host, configuration, { afterCall }));
              const recovered = succeeded(runs.at(-1));
              assert.ok(
                ['REQUIRES_ATTENTION', 'BLOCKED_CLAIM_FINALIZED'].includes(
                  recovered.status,
                ),
                JSON.stringify(recovered),
              );
              assert.equal(gateway.requests.length, requestsBefore);
              assert.equal(calls(runs, 'save_assessment_work').length, 1);
              assert.equal(calls(runs, 'begin_dynamic_evaluation').length, 1);
              assert.equal(calls(runs, 'begin_overall_synthesis').length, 1);
              const after = await host.snapshot();
              assert.deepEqual(
                after.work.filter((row) => row.work_item_id === id),
                original,
              );
              assert.equal(
                after.attempts.find(
                  (row) => row.operation_ref === claim.attemptRef,
                ).result_content_hash,
                failed.result_content_hash,
              );
              evidence.originalAttempt = failed;
              evidence.recovered = recovered;
            } finally {
              evidence.runs = runs;
              evidence.requests = gateway.requests;
              await gateway.close();
            }
          },
        );

        for (const failureCode of [
          'JOBAID_PROTOCOL_REPAIR_EXHAUSTED',
          'JOBAID_NO_PROGRESS',
          'SOCKET_UNKNOWN',
        ]) {
          await caseOf(
            `Matter ${failureCode} uses actual terminal discovery and preserves exact saved work`,
            async (evidence) => {
              const id = `WI-core-p3-matter-${failureCode.toLowerCase().replaceAll('_', '-')}`;
              await host.seed(id, { executionModel: GLM });
              const seeded = await host.seedMatter(id);
              const matterId = seeded.matter.matterId;
              const checkpointRoot = join(root, failureCode);
              const runs = [];
              let claim;
              let readRef;
              let killed = false;
              const gateway = await endpoint(({ ordinal }) => {
                assert.ok(claim);
                const source =
                  claim.task.modelInput.modelInput.availableDocuments[0];
                const ref = readRef;
                if (ordinal === 1)
                  return {
                    action: 'READ_SOURCES',
                    sourceRefs: [source.originalReadRef],
                    purpose: 'Read exact constructed condition',
                    context: 'EXACT',
                  };
                assert.ok(
                  ref,
                  'Use only the source ref returned by actual Host READ_ORIGINAL',
                );
                if (ordinal === 2)
                  return {
                    action: 'SAVE_WORK',
                    workJson: JSON.stringify({
                      schemaVersion: 'wiselink.jobaid-problem-work.v3',
                      headline: 'Constructed conditions remain unverified',
                      listBrief: 'Exact source retained',
                      overview: `Synthetic source-limited overview [[${ref}]]`,
                      issues: [
                        {
                          issueKey: 'condition',
                          question: 'Which condition is not established?',
                          body: `Synthetic original remains target-specific [[${ref}]]`,
                        },
                      ],
                      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
                      completionReason: 'No real target evidence supplied.',
                      changeSummary: 'Save exact constructed source.',
                    }),
                  };
                if (failureCode === 'SOCKET_UNKNOWN') {
                  assert.equal(ordinal, 3);
                  return { fixtureSocketCut: true };
                }
                if (failureCode === 'JOBAID_PROTOCOL_REPAIR_EXHAUSTED')
                  return { action: 'SAVE_WORK', workJson: '{"issues":[' };
                return {
                  action: 'READ_SOURCES',
                  sourceRefs: [source.originalReadRef],
                  purpose: 'Read the same unchanged constructed condition',
                  context: 'EXACT',
                };
              });
              const configuration = {
                entry: 'matter',
                gatewayUrl: gateway.gatewayUrl,
                options: { matterId, checkpointRoot },
              };
              const afterCall = (call) => {
                if (
                  call.method === 'callTool' &&
                  call.input.name === 'matter_action_attempt' &&
                  call.input.args.operation === 'READ_ORIGINAL'
                )
                  readRef = call.value.sourceRefs[0];
                if (
                  call.method === 'callTool' &&
                  call.input.name === 'matter_action_attempt' &&
                  call.input.args.operation === 'CLAIM'
                ) {
                  claim = call.value;
                  assert.equal(
                    claim.task.executionModel.modelRef,
                    GLM.modelRef,
                  );
                }
                if (
                  failureCode !== 'SOCKET_UNKNOWN' &&
                  !killed &&
                  call.method === 'callTool' &&
                  call.input.name === 'matter_action_attempt' &&
                  call.input.args.operation === 'FINISH'
                ) {
                  killed = true;
                  return 'kill';
                }
              };
              try {
                runs.push(await runNative(host, configuration, { afterCall }));
                const saved = await host.snapshot();
                const requestsBefore = gateway.requests.length;
                const originalRows = saved.matterWork.filter(
                  (row) => row.matter_id === matterId,
                );
                assert.equal(originalRows.length, 1);
                evidence.originalIdentity = {
                  matterId,
                  attemptRef: claim.attemptRef,
                  actionAttemptId: claim.task.actionAttemptId,
                  inputHash: claim.task.inputHash,
                  baseRevision: claim.task.baseRevision,
                  executionModel: claim.task.executionModel,
                };
                evidence.checkpointsBeforeRestart =
                  await checkpointFiles(checkpointRoot);
                if (failureCode === 'SOCKET_UNKNOWN') {
                  assert.match(
                    runs[0].result.error.message,
                    /^HOSTED_GATEWAY_REQUEST_FAILED$/u,
                  );
                  assert.equal(
                    saved.attempts.find(
                      (row) => row.attempt_id === claim.task.actionAttemptId,
                    ).status,
                    'RUNNING',
                  );
                } else {
                  assert.equal(runs[0].killedAfterCommit, true);
                  const attempt = saved.attempts.find(
                    (row) => row.attempt_id === claim.task.actionAttemptId,
                  );
                  assert.equal(attempt.status, 'FAILED');
                  assert.equal(attempt.terminal_reason, failureCode);
                  evidence.pendingFinishLocator =
                    evidence.checkpointsBeforeRestart[
                      `matter/${encodeURIComponent(matterId)}/pending-finish.json`
                    ];
                  assert.deepEqual(evidence.pendingFinishLocator, {
                    matterId,
                    attemptRef: evidence.originalIdentity.attemptRef,
                    inputHash: evidence.originalIdentity.inputHash,
                    contentHash: attempt.result_content_hash,
                  });
                }
                runs.push(await runNative(host, configuration, { afterCall }));
                evidence.runs = runs;
                evidence.requests = gateway.requests;
                evidence.checkpointsAfterRestart =
                  await checkpointFiles(checkpointRoot);
                assert.equal(
                  gateway.requests.length,
                  requestsBefore,
                  'restart must not redispatch a model',
                );
                const final = await host.snapshot();
                assert.deepEqual(
                  final.matterWork.filter((row) => row.matter_id === matterId),
                  originalRows,
                );
                const originalSave = calls(runs, 'matter_action_attempt').find(
                  (call) => call.input.args.operation === 'SAVE_WORK',
                );
                evidence.savedByOriginalKey = await host.callTool(
                  'matter_action_attempt',
                  {
                    matterId,
                    attemptRef: evidence.originalIdentity.attemptRef,
                    operation: 'READ_SAVED_WORK',
                    requestId: originalSave.input.args.requestId,
                  },
                );
                assert.equal(
                  evidence.savedByOriginalKey.matterWorkRevisionId,
                  originalSave.value.workRevisionRef,
                );
                assert.deepEqual(
                  evidence.savedByOriginalKey.state,
                  JSON.parse(originalRows[0].state_json),
                );
                assert.equal(
                  calls(runs, 'matter_action_attempt').filter(
                    (call) => call.input.args.operation === 'SAVE_WORK',
                  ).length,
                  1,
                );
                if (failureCode === 'SOCKET_UNKNOWN') {
                  assert.equal(
                    calls(runs, 'matter_action_attempt').filter(
                      (call) => call.input.args.operation === 'CANCEL',
                    ).length,
                    0,
                  );
                  assert.match(
                    runs.at(-1).result.error.message,
                    /^REVIEW_ASSESSMENT-ROUND-3_OUTCOME_UNKNOWN$/u,
                  );
                  assert.equal(
                    calls(runs, 'matter_action_attempt').filter(
                      (call) => call.input.args.operation === 'FINISH',
                    ).length,
                    0,
                  );
                  assert.equal(
                    final.attempts.find(
                      (row) => row.attempt_id === claim.task.actionAttemptId,
                    ).status,
                    'RUNNING',
                  );
                  assert.equal(
                    final.attempts.find(
                      (row) =>
                        row.attempt_id ===
                        evidence.originalIdentity.actionAttemptId,
                    ).result_content_hash,
                    null,
                  );
                } else {
                  assert.equal(
                    evidence.checkpointsAfterRestart[
                      `matter/${encodeURIComponent(matterId)}/pending-finish.json`
                    ] ?? null,
                    null,
                  );
                  const sealed = Object.entries(
                    evidence.checkpointsBeforeRestart,
                  ).find(([key]) => key.endsWith('/finish-result.json'))[1];
                  const recoveredCalls = calls(
                    [runs.at(-1)],
                    'matter_action_attempt',
                  );
                  assert.equal(
                    recoveredCalls.filter(
                      (call) => call.input.args.operation === 'CLAIM',
                    ).length,
                    0,
                  );
                  assert.equal(
                    recoveredCalls.filter(
                      (call) => call.input.args.operation === 'FINISH',
                    ).length,
                    0,
                  );
                  const confirmed = recoveredCalls.find(
                    (call) => call.input.args.operation === 'STATUS',
                  );
                  assert.ok(
                    confirmed,
                    'Recovery must authorize STATUS for the exact original result',
                  );
                  assert.equal(
                    confirmed.input.args.attemptRef,
                    evidence.originalIdentity.attemptRef,
                  );
                  assert.equal(
                    confirmed.value.resultContentHash,
                    sealed.contentHash,
                  );
                  assert.equal(
                    final.attempts.find(
                      (row) =>
                        row.attempt_id ===
                        evidence.originalIdentity.actionAttemptId,
                    ).result_content_hash,
                    sealed.contentHash,
                  );
                  assert.equal(
                    succeeded(runs.at(-1)).status,
                    'MATTER_ASSESSMENT_FAILED',
                    'real terminal discovery must confirm the original result, not claim FAILED as RUNNING',
                  );
                  const successorId = `${id}-next`;
                  await host.seed(successorId, { executionModel: GLM });
                  const successor = await host.seedMatter(successorId);
                  const successorRuns = [];
                  let successorClaim;
                  let successorReadRef;
                  const nextGateway = await endpoint(({ ordinal }) => {
                    const source =
                      successorClaim.task.modelInput.modelInput
                        .availableDocuments[0];
                    const ref = successorReadRef;
                    if (ordinal === 1)
                      return {
                        action: 'READ_SOURCES',
                        sourceRefs: [source.originalReadRef],
                        purpose: 'Independent successor original',
                        context: 'EXACT',
                      };
                    assert.ok(ref);
                    if (ordinal === 2)
                      return {
                        action: 'SAVE_WORK',
                        workJson: JSON.stringify({
                          schemaVersion: 'wiselink.jobaid-problem-work.v3',
                          headline: 'Independent constructed result',
                          listBrief: 'Source remains limited',
                          overview: `Independent overview [[${ref}]]`,
                          issues: [
                            {
                              issueKey: 'independent',
                              question: 'What remains unknown?',
                              body: `Target evidence unavailable [[${ref}]]`,
                            },
                          ],
                          roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
                          completionReason: 'No target evidence.',
                          changeSummary: 'Independent constructed SAVE.',
                        }),
                      };
                    assert.equal(ordinal, 3);
                    return { action: 'FINISH' };
                  });
                  try {
                    successorRuns.push(
                      await runNative(
                        host,
                        {
                          entry: 'matter',
                          gatewayUrl: nextGateway.gatewayUrl,
                          options: {
                            matterId: successor.matter.matterId,
                            checkpointRoot,
                          },
                        },
                        {
                          afterCall: (call) => {
                            if (
                              call.method === 'callTool' &&
                              call.input.name === 'matter_action_attempt' &&
                              call.input.args.operation === 'READ_ORIGINAL'
                            )
                              successorReadRef = call.value.sourceRefs[0];
                            if (
                              call.method === 'callTool' &&
                              call.input.name === 'matter_action_attempt' &&
                              call.input.args.operation === 'CLAIM'
                            )
                              successorClaim = call.value;
                          },
                        },
                      ),
                    );
                    assert.equal(
                      succeeded(successorRuns[0]).status,
                      'MATTER_WORK_SAVED',
                    );
                    assert.equal(
                      (await host.snapshot()).matterWork.filter(
                        (row) => row.matter_id === successor.matter.matterId,
                      ).length,
                      1,
                    );
                    const afterSuccessor = await host.snapshot();
                    assert.deepEqual(
                      afterSuccessor.matterWork.filter(
                        (row) => row.matter_id === matterId,
                      ),
                      originalRows,
                    );
                    assert.deepEqual(
                      afterSuccessor.attempts.find(
                        (row) =>
                          row.attempt_id ===
                          evidence.originalIdentity.actionAttemptId,
                      ),
                      saved.attempts.find(
                        (row) =>
                          row.attempt_id ===
                          evidence.originalIdentity.actionAttemptId,
                      ),
                    );
                    evidence.successor = {
                      runs: successorRuns,
                      requests: nextGateway.requests,
                      originalAuditByteStable: true,
                      sameCheckpointRoot: checkpointRoot,
                    };
                  } finally {
                    await nextGateway.close();
                  }
                }
              } finally {
                evidence.runs = runs;
                evidence.requests = gateway.requests;
                evidence.gatewayErrors = gateway.errors;
                await gateway.close();
              }
            },
          );
        }
      } finally {
        await host.close();
        let ownedPgPidExited = false;
        try {
          process.kill(ownedPgPid, 0);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
          ownedPgPidExited = true;
        }
        let clusterRootExists = true;
        try {
          await access(host.ownership.root);
        } catch {
          clusterRootExists = false;
        }
        proof.cleanup = {
          exactOwnedClusterClosed: true,
          clusterRootExists,
          ownedPgPidExited,
          noRunningChild: true,
        };
        const destination = process.env.WL_CORE_P3_EVIDENCE_DIR;
        if (destination) {
          await mkdir(destination, { recursive: true, mode: 0o700 });
          await writeFile(
            join(destination, 'consumer.actual.private.json'),
            JSON.stringify(proof, null, 2) + '\n',
            { mode: 0o600 },
          );
        }
        await rm(root, { recursive: true, force: true });
        assert.equal(ownedPgPidExited, true);
        assert.equal(clusterRootExists, false);
      }
    },
  );
}
