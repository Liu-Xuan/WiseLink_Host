#!/usr/bin/env node
/** A real Matter model loop and durable Codex gateway, with file-backed fake Host. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { invokeHostedJobAidProblemModel } from '../skills/wiselink-research-and-synthesize/scripts/run-jobaid-problem-assessment.mjs';
import { createSummaryCodexGatewaySession } from '../skills/wiselink-research-and-synthesize/scripts/derived-summary-codex-gateway.mjs';
import { consumeHostedMatter } from '../skills/wiselink-research-and-synthesize/scripts/consume-hosted-matter.mjs';

const matterId = 'MAT-fixture-1', attemptRef = 'AQ-matter-fixture-1';
const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3',
  providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' };
const modelInput = { schemaVersion: 'wiselink.matter-jobaid-task.v2',
  subject: { kind: 'ENGINEERING_MATTER', matterId }, methodBinding: { packRef: 'method-fixture' },
  expectedWorkRevision: 0, availableSources: [], availableDocuments: [], deliveredEvidence: [] };

export async function runMatterFixture(root, mode = 'normal') {
  root = resolve(root);
  const host = await createCheckpointStore(resolve(root, 'host'));
  const disk = await createCheckpointStore(resolve(root, 'checkpoint'));
  const checkpoint = { ...disk, writeOnce: async (key, value) => {
    await disk.writeOnce(key, value);
    if ((mode === 'after-model-receipt' && key === 'summary-codex.round-0.receipt') ||
        (mode === 'after-final-model-receipt' && key === 'summary-codex.round-1.receipt') ||
        (mode === 'after-round-result' && key === 'assessment-round-1.result') ||
        (mode === 'after-final-round-result' && key === 'assessment-round-2.result'))
      process.kill(process.pid, 'SIGKILL');
  } };
  const saved = await host.readOptional('saved');
  const gateway = createSummaryCodexGatewaySession({ matterId, attemptRef, executionModel,
    deadlineAt: '2099-01-01T00:00:00.000Z', checkpoint, durableRounds: true,
    runBudget: { timeoutMs: 300_000, maxCompletionTokens: 1000,
      maxModelRequests: 3, reasoningEffort: 'low' },
    codexOptions: { codexBinary: '/synthetic/codex', configPath: '/synthetic/config',
      runRoot: resolve(root, 'runner'), pythonBinary: resolve(root, 'python-wrapper'),
      onRunPrepared: async () => { if (mode === 'before-codex-launch') process.kill(process.pid, 'SIGKILL'); } } });
  const options = { modelExecutor: 'CODEX', codexOptions: { codexBinary: '/synthetic/codex',
      configPath: '/synthetic/config', runRoot: resolve(root, 'runner') },
    executionModel, assessmentCheckpoint: checkpoint,
    sessionDiscriminator: `${attemptRef}:1`, taskDeadline: '2099-01-01T00:00:00.000Z',
    heartbeat: async () => ({ status: 'RUNNING' }),
    readAssessmentSources: async () => { throw new Error('UNEXPECTED_SOURCE_READ'); },
    readAssessmentWork: async ({ requestId }) => ({ revision: (await host.readOptional('saved'))?.requestId === requestId
      ? await host.readOptional('saved') : null }),
    saveAssessmentWork: async args => {
      const prior = await host.readOptional('saved');
      if (prior) throw new Error('DUPLICATE_SAVE');
      const revision = { requestId: args.requestId, workRevisionRef: 'matter-work-1', workRevision: 1,
        content: JSON.parse(args.workJson) };
      await host.writeOnce('saved', revision);
      if (mode === 'after-save') process.kill(process.pid, 'SIGKILL');
      return { workRevisionRef: revision.workRevisionRef, workRevision: 1,
        roundCompletion: revision.content.roundCompletion };
    },
  };
  const input = structuredClone(modelInput);
  if (mode === 'drift-task') input.subject.matterId = 'MAT-foreign';
  let result;
  try {
    result = await invokeHostedJobAidProblemModel({ operation: 'ASSESS_MATTER', modelInput: input }, options, {
      requestGateway: (_endpoint, init) => {
        gateway.setRound(init.codexRound, init.codexRecoverOnly);
        return gateway.request(init);
      },
    });
  } finally { await gateway.close(); }
  return { result, saved: await host.readOptional('saved'), previousSaved: saved };
}

export async function runMatterConsumerFixture(root, mode = 'normal') {
  root = resolve(root);
  const host = await createCheckpointStore(resolve(root, 'consumer-host'));
  const task = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v2',
    taskType: 'OPENCLAW_MATTER_ASSESSMENT', subject: { kind: 'ENGINEERING_MATTER', matterId },
    operationRef: attemptRef, actionAttemptId: 'AA-matter-fixture-1', inputHash: 'fixture-input-hash',
    baseRevision: 0, sourceRefs: [], deadline: '2099-01-01T00:00:00.000Z', executionModel,
    modelInput: { schemaVersion: 'wiselink.matter-jobaid-task.v2', modelInput,
      sourceCatalog: [] } };
  const createCheckpoint = async path => {
    const disk = await createCheckpointStore(path);
    return { ...disk, writeOnce: async (key, value) => {
      await disk.writeOnce(key, value);
      if (mode === 'after-model-receipt' && key === 'summary-codex.round-0.receipt')
        process.kill(process.pid, 'SIGKILL');
    } };
  };
  const callTool = async (name, args) => {
    if (name === 'next_matter_assessment') return { matterId, next: { attemptRef, status: 'RUNNING' } };
    if (name !== 'matter_action_attempt') throw new Error(`UNEXPECTED_TOOL:${name}`);
    if (args.operation === 'CLAIM') {
      const count = (await host.readOptional('claim-count') ?? 0) + 1;
      await host.write('claim-count', count);
      return { attemptRef, status: 'RUNNING', leaseToken: `lease-${count}`,
        leaseGeneration: count, task };
    }
    if (args.operation === 'READ_SAVED_WORK') return (await host.readOptional('saved'))?.requestId === args.requestId
      ? await host.readOptional('saved') : null;
    if (args.operation === 'STATUS') return { attemptRef, status: 'RUNNING' };
    const count = await host.readOptional('claim-count');
    if (args.leaseToken !== `lease-${count}` || args.leaseGeneration !== count)
      throw new Error('STALE_HOST_LEASE');
    await host.write('last-lease', { token: args.leaseToken, generation: args.leaseGeneration });
    if (args.operation === 'HEARTBEAT') return { status: 'RUNNING' };
    if (args.operation === 'SAVE_WORK') {
      const previous = await host.readOptional('saved');
      if (previous) throw new Error('DUPLICATE_SAVE');
      const work = JSON.parse(args.workJson);
      const revision = { matterId, matterWorkRevisionId: 'matter-work-1', workingRevision: 1,
        requestId: args.requestId, source: { actionAttemptId: task.actionAttemptId },
        state: { problemWork: { ...work, understanding: work.overview,
          issues: work.issues } } };
      await host.writeOnce('saved', revision);
      if (mode === 'after-consumer-save') process.kill(process.pid, 'SIGKILL');
      return { workRevisionRef: revision.matterWorkRevisionId, workRevision: 1,
        roundCompletion: work.roundCompletion };
    }
    if (args.operation === 'FINISH') {
      await host.writeOnce('finished', args.result);
      return { status: 'SUCCEEDED', attemptRef, workRevisionRef: 'matter-work-1' };
    }
    throw new Error(`UNEXPECTED_OPERATION:${args.operation}`);
  };
  const result = await consumeHostedMatter({ matterId, checkpointRoot: resolve(root, 'consumer-checkpoint'),
    modelExecutor: 'CODEX' }, { createCheckpoint, callTool,
    invokeMatterModel: async (input, hooks) => {
      const gateway = createSummaryCodexGatewaySession({ matterId, attemptRef,
        executionModel: hooks.executionModel, deadlineAt: hooks.taskDeadline,
        checkpoint: hooks.assessmentCheckpoint, durableRounds: true,
        runBudget: { timeoutMs: 300_000, maxCompletionTokens: 1000,
          maxModelRequests: 3, reasoningEffort: 'low' },
        codexOptions: { codexBinary: '/synthetic/codex', configPath: '/synthetic/config',
          runRoot: resolve(root, 'runner'), pythonBinary: resolve(root, 'python-wrapper'),
          onRunPrepared: async () => { if (mode === 'before-codex-launch') process.kill(process.pid, 'SIGKILL'); } } });
      try {
        return await invokeHostedJobAidProblemModel(input, { ...hooks, modelExecutor: 'CODEX',
          codexOptions: { codexBinary: '/synthetic/codex', configPath: '/synthetic/config',
            runRoot: resolve(root, 'runner') } }, { requestGateway: (_endpoint, init) => {
          gateway.setRound(init.codexRound, init.codexRecoverOnly);
          return gateway.request(init);
        } });
      } finally { await gateway.close(); }
    } });
  return { result, claimCount: await host.readOptional('claim-count'),
    lastLease: await host.readOptional('last-lease'), saved: await host.readOptional('saved'),
    finished: await host.readOptional('finished') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outcome = await createCheckpointStore(resolve(process.argv[2]));
  try {
    const value = process.argv[4] === 'consumer'
      ? await runMatterConsumerFixture(process.argv[2], process.argv[3])
      : await runMatterFixture(process.argv[2], process.argv[3]);
    await outcome.write('fixture-outcome', value);
    process.stdout.write(JSON.stringify(value) + '\n');
  } catch (error) {
    await outcome.write('fixture-outcome', { errorCode: error.message });
    process.stderr.write(error.stack + '\n');
    process.exitCode = 1;
  }
}
