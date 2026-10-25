#!/usr/bin/env node
/** Offline process fixture. It invokes the real summary model adapter and
 * Codex gateway with a synthetic Python runner; no Host or model is contacted. */
import { resolve } from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCheckpointStore, invokeHostedReviewModel } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { invokeHostedDerivedSummaryModel } from '../skills/wiselink-research-and-synthesize/scripts/invoke-hosted-derived-summary-model.mjs';
import { consumeHostedDerivedSummary } from '../skills/wiselink-research-and-synthesize/scripts/consume-hosted-derived-summary.mjs';
import { consumePendingReviewTurn } from '../skills/wiselink-research-and-synthesize/scripts/consume-hosted-review-turn.mjs';
import { canonicalSha256, REVIEW_ALLOWED_OPERATIONS, WL_CODEX_RUNTIME_APP_ID, WISELINK_PROFILE_REF,
  WISELINK_MODEL_POLICY_REF, WISELINK_SKILL_COMPATIBILITY_REF, WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

export const member = { member: { kind: 'MATTER_WORK', matterId: 'MAT-1', workRef: 'work-1',
  workRevision: 1, issueKeys: [] }, evidenceRef: 'member-1', headline: 'Member finding',
  body: 'Exact selected engineering work.', issues: [], evidence: [], rootRefs: [],
  limitations: ['Source currentness not established.'], current: true, overviewStatus: 'CURRENT', leaves: [] };
export const modelInput = { scope: { kind: 'ATA4', title: 'Selected ATA4', fleetFamilyId: 'FAM-1',
  fleetModelIds: ['MODEL-1'], ata2: '27', ata4: '27-10', selectionReason: 'Selected exact work' },
  classificationStatus: 'CANDIDATE', instruction: 'Summarize selected work.', members: [member],
  evidence: [], limitations: ['Source currentness not established.'] };

export async function runWikiFixture(root, mode = 'normal') {
  root = resolve(root);
  const disk = await createCheckpointStore(resolve(root, 'checkpoint'));
  const checkpoint = { ...disk, writeOnce: async (key, value) => {
    await disk.writeOnce(key, value);
    if ((mode === 'after-model-receipt' && key === 'summary-codex.round-0.receipt') ||
        (mode === 'after-second-model-receipt' && key === 'summary-codex.round-1.receipt'))
      process.kill(process.pid, 'SIGKILL');
  } };
  const result = await invokeHostedDerivedSummaryModel(modelInput, {
    modelExecutor: 'CODEX', codexOptions: { codexBinary: '/synthetic/codex',
      configPath: '/synthetic/config', runRoot: resolve(root, 'runner'),
      pythonBinary: resolve(root, 'python-wrapper'),
      onRunPrepared: async () => { if (mode === 'before-codex-launch') process.kill(process.pid, 'SIGKILL'); } },
    executionModel: { modelRef: 'miaoda/glm-5.3' }, checkpoint,
    sessionDiscriminator: 'AQ-wiki-recovery:1', summaryId: 'DS-wiki-recovery',
    attemptRef: 'AQ-wiki-recovery', deadlineAt: '2099-01-01T00:00:00.000Z',
    runBudget: { timeoutMs: 300_000, maxCompletionTokens: 1000,
      maxModelRequests: 2, reasoningEffort: 'low' },
    heartbeat: async () => {}, readMembers: async () => ({ members: [member] }),
    readSources: async () => ({ evidence: [] }),
  });
  return result;
}

export async function runSummaryConsumerFixture(root, mode = 'normal') {
  root = resolve(root);
  const host = await createCheckpointStore(resolve(root, 'host'));
  const target = { summaryId: 'DS-wiki-recovery', attemptRef: 'AQ-wiki-recovery' };
  const taskBasis = { schemaVersion: 'wiselink.derived-summary-task.v1',
    taskType: 'OPENCLAW_DERIVED_SUMMARY', subject: { kind: 'DERIVED_SUMMARY', summaryId: target.summaryId },
    operationRef: target.attemptRef, actionAttemptId: 'synthetic-action-1',
    expectedSummaryRevision: 0, requestId: 'wiki-save-AQ-wiki-recovery',
    deadlineAt: '2099-01-01T00:00:00.000Z',
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3',
      providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' },
    modelInput };
  const task = { ...taskBasis, taskInputHash: canonicalSha256(taskBasis) };
  const callTool = async (name, input) => {
    if (name !== 'derived_summary_attempt') throw new Error('SYNTHETIC_TOOL_INVALID');
    if (input.summaryId !== target.summaryId || input.attemptRef !== target.attemptRef)
      throw new Error('SYNTHETIC_BINDING_INVALID');
    const state = await host.readOptional('state') ?? { claimCalls: 0, saveCalls: 0, committedWrites: 0, saved: null, finished: false };
    const saveState = () => host.write('state', state);
    switch (input.operation) {
      case 'STATUS': return { ...target, status: state.finished ? 'SUCCEEDED' : 'RUNNING', savedSummaryRefs: [] };
      case 'CLAIM': state.claimCalls++; await saveState();
        return { ...target, status: 'RUNNING', leaseToken: `synthetic-lease-${state.claimCalls}`,
          leaseGeneration: state.claimCalls, leaseExpiresAt: '2099-01-01T00:00:00.000Z', task };
      case 'HEARTBEAT':
        if (input.leaseGeneration !== state.claimCalls ||
            input.leaseToken !== `synthetic-lease-${state.claimCalls}`)
          throw new Error('SYNTHETIC_SUMMARY_STALE_LEASE');
        return { ...target, leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
      case 'READ_MEMBER_WORK': return { members: [member] };
      case 'READ_SOURCES': return { evidence: [] };
      case 'READ_SAVED_SUMMARY': {
        if (!state.saved || input.requestId !== task.requestId) {
          const error = new Error('DERIVED_SUMMARY_SAVE_NOT_FOUND');
          error.hostErrorCode = 'DERIVED_SUMMARY_SAVE_NOT_FOUND';
          throw error;
        }
        return structuredClone(state.saved);
      }
      case 'SAVE_SUMMARY': {
        if (mode === 'before-save') process.kill(process.pid, 'SIGKILL');
        state.saveCalls++;
        state.savedFenceGeneration = input.leaseGeneration;
        if (input.leaseGeneration !== state.claimCalls ||
            input.leaseToken !== `synthetic-lease-${state.claimCalls}`)
          throw new Error('SYNTHETIC_SUMMARY_STALE_LEASE');
        if (input.requestId !== task.requestId || input.expectedSummaryRevision !== 0)
          throw new Error('SYNTHETIC_SAVE_BINDING_INVALID');
        const content = JSON.parse(input.contentJson), producer = JSON.parse(input.provenanceJson);
        if (!state.saved) {
          state.committedWrites++;
          const receipt = { summaryId: target.summaryId, summaryRef: 'SREF-synthetic-1',
            revision: 1, replay: true };
          state.saved = { receipt, summary: { ...target, summaryRef: receipt.summaryRef,
            revision: 1, requestId: task.requestId, candidateOnly: true,
            classificationStatus: 'CANDIDATE', scope: modelInput.scope,
            content, producer, members: [{ member: modelInput.members[0].member }],
            coverage: [{ evidenceRef: member.evidenceRef, member: member.member,
              rootRefs: [], delivered: true, used: content.body.includes(`[[${member.evidenceRef}]]`),
              limitation: member.limitations[0] }] } };
        }
        await saveState();
        if (mode === 'lost-save-ack') throw new Error('SYNTHETIC_SAVE_ACK_LOST');
        return state.saved.receipt;
      }
      case 'FINISH': state.finished = true; await saveState();
        return { ...target, status: 'SUCCEEDED', savedSummaryRef: state.saved.receipt.summaryRef };
      default: throw new Error(`SYNTHETIC_OPERATION_${input.operation}`);
    }
  };
  const result = await consumeHostedDerivedSummary({ ...target, modelExecutor: 'CODEX',
    codexOptions: { codexBinary: '/synthetic/codex', configPath: '/synthetic/config',
      runRoot: resolve(root, 'runner'), pythonBinary: resolve(root, 'python-wrapper'),
      onRunPrepared: async () => { if (mode === 'before-codex-launch') process.kill(process.pid, 'SIGKILL'); } },
    runBudget: { timeoutMs: 300_000, maxCompletionTokens: 1000,
      maxModelRequests: 2, reasoningEffort: 'low' }, checkpointRoot: root,
    endpointKey: 'synthetic-host' }, {
    callTool, invokeModel: (input, hooks) => invokeHostedDerivedSummaryModel(input, hooks),
  });
  return { result, state: await host.readOptional('state') };
}

export async function runReviewConsumerFixture(root, mode = 'normal') {
  root = resolve(root);
  const host = await createCheckpointStore(resolve(root, 'review-host'));
  const twoRound = await stat(resolve(root, 'runner', 'review-two-round')).then(() => true, () => false);
  const taskInput = { schemaVersion: 'wiselink.3_1.review_turn_task.v1.c2',
    mode: 'INTERACTIVE_REVIEW', reviewConversationRef: 'RC-review-recovery',
    reviewTurnRef: 'RT-review-recovery', requestId: 'REQ-review-recovery',
    actorContextRef: 'ACTX-review-recovery', inputRevision: 0,
    selectedEvaluationItemId: null,
    userMessage: mode === 'changed-task' ? 'A different task question?' : 'What is the status?',
    allowedOperations: REVIEW_ALLOWED_OPERATIONS, resourceRefs: twoRound ? [{
      sourceRefId: 'SR-1', resourceArtifactRef: 'ART-1',
      resourceArtifactSha256: 'a'.repeat(64), value: { sourceRefId: 'SR-1' },
    }] : [],
    allowedEvaluationItemIds: [], allowedAdoptedInputRefs: [], attachmentRefs: [],
    context: { purpose: 'CHAT' }, executionPolicy: {
      runtimeAppId: WL_CODEX_RUNTIME_APP_ID, profileRef: WISELINK_PROFILE_REF,
      modelPolicyRef: WISELINK_MODEL_POLICY_REF,
      skillPolicyRef: WISELINK_SKILL_COMPATIBILITY_REF,
      toolPolicyRef: `${WISELINK_HOST_MCP_NAME}@${WISELINK_HOST_MCP_VERSION}#interactive-review-c3`,
    } };
  const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3',
    providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' };
  const basis = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-review-recovery', operationRef: 'AQ-review-recovery',
    taskType: 'OPENCLAW_INTERACTIVE_REVIEW', priority: 100,
    tenantId: 'synthetic-tenant', workItemId: 'WI-review-recovery', inputRevision: 0,
    baseRevision: 0, documentVersionId: 'DV-review-recovery',
    sourceRefs: twoRound ? [{ ref: 'ART-1', sha256: 'a'.repeat(64) }] : [],
    allowedConnectors: [], hostResolvedMissingInputs: [], modelInput: taskInput,
    deadline: '2099-01-01T00:00:00.000Z', idempotencyKey: 'synthetic:review-recovery',
    executionModel };
  const task = { ...basis, inputHash: canonicalSha256(basis) };
  const runtime = { modelExecutor: 'CODEX', codexOptions: { codexBinary: '/synthetic/codex',
    configPath: '/synthetic/config', runRoot: resolve(root, 'runner'),
    pythonBinary: resolve(root, 'python-wrapper'),
    onRunPrepared: async () => { if (mode === 'before-codex-launch') process.kill(process.pid, 'SIGKILL'); },
    ...(mode === 'after-runner-receipt' ? { onRunCompleted: () => process.kill(process.pid, 'SIGKILL') }
      : mode === 'after-second-runner-receipt' ? { onRunCompleted: async () => {
        const count = (await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim().split('\n').length;
        if (count === 2) process.kill(process.pid, 'SIGKILL');
      } } : {}) },
    configuredModelVersion: 'configured-route:miaoda/glm-5.3' };
  const callTool = async (name, args) => {
    const state = await host.readOptional('state') ?? { beginCalls: 0, leaseGeneration: 0,
      commitCalls: 0, committedWrites: 0, result: null, leaseExpiresAt: null };
    if (name === 'get_pending_review_turn') return state.leaseExpiresAt &&
      Date.parse(state.leaseExpiresAt) > Date.now() && !state.result
      ? { busy: true, next: null }
      : { busy: false, next: { reviewConversationRef: taskInput.reviewConversationRef,
        reviewTurnRef: taskInput.reviewTurnRef, requestId: taskInput.requestId } };
    if (name === 'begin_review_turn') {
      if (args.reviewConversationRef !== taskInput.reviewConversationRef || args.requestId !== taskInput.requestId)
        throw new Error('SYNTHETIC_REVIEW_BEGIN_BINDING_INVALID');
      state.beginCalls++; state.leaseGeneration++;
      state.leaseExpiresAt = state.beginCalls === 1
        ? new Date(Date.now() + 150).toISOString() : '2099-01-01T00:00:00.000Z';
      await host.write('state', state);
      return { status: 'RUNNING', attemptRef: task.operationRef, task,
        leaseToken: `synthetic-lease-${state.leaseGeneration}`,
        leaseGeneration: state.leaseGeneration, leaseExpiresAt: state.leaseExpiresAt };
    }
    if (name === 'heartbeat_action_attempt') {
      if (args.leaseToken !== `synthetic-lease-${state.leaseGeneration}` ||
          args.leaseGeneration !== state.leaseGeneration)
        throw new Error('SYNTHETIC_REVIEW_STALE_LEASE');
      return { leaseExpiresAt: state.leaseExpiresAt };
    }
    if (name === 'read_source_refs') return {
      schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
      attemptRef: task.operationRef, sourceRefs: args.sourceRefIds.map(sourceRefId => ({
        sourceRefId, evidenceRef: sourceRefId, kind: 'DOCUMENT_PASSAGE',
        title: 'Synthetic source', versionLabel: 'v1',
        excerpt: mode === 'changed-source' ? 'Changed source body.' : 'Synthetic finding.', locator: null,
      })) };
    if (name === 'get_review_turn_context') return {
      schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2', attemptRef: task.operationRef,
      reviewConversationRef: taskInput.reviewConversationRef, reviewTurnRef: taskInput.reviewTurnRef,
      mode: 'INTERACTIVE_REVIEW', selectedEvaluationItemId: null, inputRevision: 0,
      allowedOperations: taskInput.allowedOperations, executionPolicy: taskInput.executionPolicy,
      context: { purpose: 'CHAT', engineerInput: { text: taskInput.userMessage } },
      resourceRefs: taskInput.resourceRefs.map(({ sourceRefId, resourceArtifactRef, resourceArtifactSha256 }) =>
        ({ sourceRefId, resourceArtifactRef, resourceArtifactSha256 })) };
    if (name === 'commit_review_turn_candidate') {
      if (mode === 'before-commit') process.kill(process.pid, 'SIGKILL');
      if (args.leaseToken !== `synthetic-lease-${state.leaseGeneration}` ||
          args.leaseGeneration !== state.leaseGeneration)
        throw new Error('SYNTHETIC_REVIEW_STALE_LEASE');
      state.commitCalls++;
      const result = JSON.parse(args.resultJson);
      if (state.result && canonicalSha256(state.result) !== canonicalSha256(result))
        throw new Error('SYNTHETIC_REVIEW_RESULT_DRIFT');
      if (!state.result) { state.result = result; state.committedWrites++; }
      await host.write('state', state);
      if (mode === 'lost-commit-ack') throw new Error('SYNTHETIC_REVIEW_ACK_LOST');
      return { schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2',
        attemptRef: task.operationRef, status: 'SUCCEEDED',
        authority: { candidatePersisted: true, reviewActionExecuted: false,
          workItemRevisionChanged: false, currentChanged: false, staleMarked: false } };
    }
    if (name === 'get_action_attempt_status') return { attemptRef: task.operationRef,
      taskType: task.taskType, status: state.result ? 'SUCCEEDED' : 'RUNNING',
      resultContentHash: state.result?.contentHash ?? null,
      recoveryAvailable: false, commitStartedAt: state.result ? '2026-10-25T00:00:00.000Z' : null,
      terminalReason: state.result ? 'REVIEW_TURN_CANDIDATE_PERSISTED' : null,
      projectionApplied: Boolean(state.result) };
    throw new Error(`SYNTHETIC_REVIEW_TOOL_${name}`);
  };
  const result = await consumePendingReviewTurn({ workItemId: task.workItemId,
    checkpointRoot: resolve(root, 'review-consumer') }, { callTool,
    modelRuntime: runtime, hasTool: () => true,
    invokeModel: (input, hooks) => invokeHostedReviewModel(input, { ...runtime, ...hooks }),
  });
  return { result, state: await host.readOptional('state') };
}

export async function runReviewFixture(root, mode = 'normal', userMessage = 'What is the status?', attemptRef = 'AQ-review-recovery') {
  root = resolve(root);
  const disk = await createCheckpointStore(resolve(root, 'review-checkpoint'));
  const checkpoint = { ...disk, writeOnce: async (key, value) => {
    await disk.writeOnce(key, value);
    if (mode === 'after-model-receipt' && key === 'review-codex-round-1.result')
      process.kill(process.pid, 'SIGKILL');
  } };
  return invokeHostedReviewModel({ schemaVersion: 'wiselink.3_1.review_generation_input.v1',
    mode: 'INTERACTIVE_REVIEW', purpose: 'SUPERVISED_REVIEW_CANDIDATE', candidateOnly: true,
    input: { userMessage, attachmentRefs: [],
      availableSourceRefIds: [], context: { purpose: 'CHAT' } }, sourceRefs: [] }, {
    modelExecutor: 'CODEX', codexOptions: { codexBinary: '/synthetic/codex',
      configPath: '/synthetic/config', runRoot: resolve(root, 'runner'),
      pythonBinary: resolve(root, 'python-wrapper'),
      onRunPrepared: async () => { if (mode === 'before-codex-launch') process.kill(process.pid, 'SIGKILL'); },
      ...(mode === 'after-runner-receipt' ? { onRunCompleted: () => process.kill(process.pid, 'SIGKILL') }
      : mode === 'after-second-runner-receipt' ? { onRunCompleted: async () => {
        const count = (await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim().split('\n').length;
        if (count === 2) process.kill(process.pid, 'SIGKILL');
      } } : {}) },
    configuredModelVersion: 'configured-route:miaoda/glm-5.3',
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3',
      providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' },
    sessionDiscriminator: 'review-req-1', modelRecoveryCheckpoint: checkpoint,
    modelRecoveryAttemptRef: attemptRef, maxModelRequests: 2,
    validateCandidate: async () => {},
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv[4] === 'review-consumer'
    ? await runReviewConsumerFixture(process.argv[2], process.argv[3])
    : process.argv[4] === 'review'
    ? await runReviewFixture(process.argv[2], process.argv[3])
    : process.argv[4] === 'consumer'
      ? await runSummaryConsumerFixture(process.argv[2], process.argv[3])
      : await runWikiFixture(process.argv[2], process.argv[3]);
  process.stdout.write(JSON.stringify(result) + '\n');
}
