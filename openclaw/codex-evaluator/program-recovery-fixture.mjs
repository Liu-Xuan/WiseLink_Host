#!/usr/bin/env node
/** Offline crash fixture. The real program consumer and checkpoint store run
 * in child processes; Host and model are explicitly synthetic, backed by files.
 * No network, credential, production task, or real model is used. */
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { invokeHostedProgramAssessment } from '../skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs';
import { createCodexGateway } from './codex-generation.mjs';
import { runHostedInitialStage } from '../skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs';
import { initialStageCheckpointPath } from '../skills/wiselink-research-and-synthesize/scripts/initial-assessment-recovery.mjs';

export function programRecoveryData() {
  const documentVersionId = 'fixture-document-recovery', parseRunId = 'fixture-parse-1';
  const sourceRefId = 'fixture-source-1';
  const evidenceRef = `DOCUMENT_ORIGINAL:${documentVersionId}:${parseRunId}:${sourceRefId}`;
  const originalBinding = { documentVersionId, parseRunId, parseRevision: 1 };
  const locator = JSON.stringify({ parseRunId, sourceRefId, page: 1 });
  const sourceText = '仅用于离线软件测试：打开虚构测试泵的防护罩前，应断电并确认停转。';
  const modelInput = {
    schemaVersion: 'wiselink.jobaid-problem-task.v2', purpose: 'INITIAL_PROBLEM_ASSESSMENT',
    executionMode: 'PROGRAM_CONTROLLED_V1', expectedWorkRevision: 0,
    methodBinding: { packRef: 'fixture-method-v1' },
    documentOverview: { title: '离线恢复测试材料', original: { binding: originalBinding } },
    programOriginal: { binding: originalBinding,
      units: [{ unitId: 'fixture-unit-1', kind: 'paragraph', payload: { text: sourceText }, sourceRefIds: [sourceRefId] }],
      sourceLocators: [{ sourceRefId, page: 1 }], coverage: { status: 'COMPLETE' }, findings: [] },
    availableSources: [{ ref: evidenceRef, kind: 'DOCUMENT_PASSAGE', documentVersionId,
      versionLabel: parseRunId, sourceRefId, parseRunId, locator, carrierRangeRef: evidenceRef, title: '合成材料' }],
    deliveredEvidence: [{ evidenceRef, kind: 'DOCUMENT_PASSAGE', documentVersionId,
      versionLabel: parseRunId, sourceRefId, locator, excerpt: sourceText }],
  };
  const work = {
    schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: '测试泵防护罩操作',
    listBrief: '打开防护罩前断电并确认停转。', overview: '  打开测试泵防护罩前应断电并确认停转。  ',
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS', completionReason: '保留实施记录待核。',
    changeSummary: '首次形成合成测试工作。',
    issues: [{ issueKey: 'pump-guard', question: '  如何控制防护罩打开时的旋转件接触风险？  ',
      body: `  打开防护罩前断电并确认停转，实施记录仍需确认。[[${evidenceRef}]]  `,
      riskScenarios: [], measures: [], otherClassifications: [], requirementHandling: [],
      openQuestions: [{ question: '措施是否已实施？', affects: '实施状态', nextEvidence: '现场记录', reason: '合成资料未提供。' }] }],
    unchangedIssueKeys: [], retiredIssues: [],
  };
  const assessmentBinding = { attemptRef: 'AQ-fixture-program-recovery', actionAttemptId: 'fixture-action-attempt-1',
    workItemId: 'WI-fixture-program-recovery', documentVersionId, inputRevision: 7, baseRevision: 7 };
  return { modelInput, work, assessmentBinding };
}

const freshState = () => ({ realHostCalled: false, realModelCalled: false,
  modelRequests: 0, modelRecoveryRequests: 0,
  saveCalls: 0, committedWrites: 0, reads: 0, actions: [], saved: null });
const sha256 = value => createHash('sha256').update(value).digest('hex');
function crash() { process.kill(process.pid, 'SIGKILL'); }

export async function runProgramRecoveryFixture(root, mode = 'normal') {
  root = resolve(root);
  const { modelInput, work, assessmentBinding } = programRecoveryData();
  const budgeted = mode.startsWith('budget:');
  if (budgeted) mode = mode.slice('budget:'.length);
  const stageOptions = { checkpointRoot: root, workItemId: assessmentBinding.workItemId,
    operation: 'EVALUATE_JOBAID', expectedInitialOperation: 'EVALUATE_JOBAID',
    initialStageOnly: true, maxInitialStages: 1, modelExecutor: 'CODEX',
    jobAidRunLimits: { modelRequests: 1, saves: 1, finishes: 1 } };
  const host = await createCheckpointStore(resolve(root, 'synthetic-host'));
  const model = await createCheckpointStore(resolve(root, 'synthetic-model'));
  const disk = await createCheckpointStore(budgeted
    ? initialStageCheckpointPath(stageOptions, 'EVALUATE_JOBAID') : resolve(root, 'checkpoint'));
  const checkpoint = { ...disk, writeOnce: async (key, value) => {
    await disk.writeOnce(key, value);
    if ((mode === 'after-started' && key === 'assessment-round-1.started') ||
        (mode === 'after-response' && key === 'assessment-round-1.result') ||
        (mode === 'after-readback' && key === 'program-work-readback')) crash();
  } };
  const update = async perform => {
    const state = await host.readOptional('state') ?? freshState();
    const value = await perform(state);
    await host.write('state', state);
    return value;
  };
  const readWork = async args => update(state => {
    state.reads += 1;
    if (mode === 'read-unavailable') throw new Error('FIXTURE_READ_UNAVAILABLE');
    const packet = { schemaVersion: 'wiselink.jobaid-work-read.v2',
      attemptId: assessmentBinding.actionAttemptId, inputWorkRevision: 0, executionStatus: 'RUNNING',
      revision: state.saved?.requestId === args.requestId ? structuredClone(state.saved) : null,
      observationSequence: state.reads };
    if (mode === 'wrong-read-identity') packet.attemptId = 'fixture-foreign-attempt';
    if (mode === 'wrong-read-issue' && packet.revision)
      packet.revision.content.issues[0].body = '错误的另一份正文。';
    state.actions.push({ tool: 'read_assessment_work', request: args, response: structuredClone(packet) });
    return packet;
  });
  const codexOptions = { codexBinary: '/fixture/no-real-codex', configPath: '/fixture/no-credentials',
    runRoot: resolve(root, 'synthetic-model'), pythonBinary: '/fixture/runner-must-not-launch', timeoutSeconds: 1,
    onRunPrepared: async () => { if (mode === 'before-codex-launch') crash(); } };
  const options = {
    modelExecutor: 'CODEX', codexOptions,
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'synthetic', providerKind: 'BUILT_IN',
      settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' },
    assessmentCheckpoint: checkpoint, assessmentBinding,
    sessionDiscriminator: assessmentBinding.attemptRef, taskDeadline: '2099-01-01T00:00:00.000Z',
    heartbeat: async () => ({ status: 'RUNNING' }),
    readAssessmentSources: async () => { throw new Error('FIXTURE_UNEXPECTED_SOURCE_READ'); },
    readAssessmentWork: readWork,
    recordAssessmentProgramProgress: async args => update(state => {
      state.actions.push({ tool: 'record_assessment_program_progress', request: args });
      return { phase: args.phase, checkpointRef: args.checkpointRef };
    }),
    saveAssessmentWork: async args => {
      if (mode === 'before-save') crash();
      const receipt = await update(state => {
        state.saveCalls += 1;
        if (state.saved) {
          if (state.saved.requestId !== args.requestId || state.saveRequest.workJson !== args.workJson ||
              state.saveRequest.expectedWorkRevision !== args.expectedWorkRevision)
            throw new Error('FIXTURE_IDEMPOTENCY_CONFLICT');
          return { workRevisionRef: state.saved.workRevisionRef, workRevision: 1, replayed: true };
        }
        if (args.expectedWorkRevision !== 0) throw new Error('FIXTURE_CAS_CONFLICT');
        const command = JSON.parse(args.workJson);
        state.saveRequest = structuredClone(args);
        state.saved = { requestId: args.requestId, workRevisionRef: 'fixture-work-revision-1', workRevision: 1,
          actionAttemptId: assessmentBinding.actionAttemptId, workItemId: assessmentBinding.workItemId,
          documentVersionId: assessmentBinding.documentVersionId, basedOnWorkItemRevision: assessmentBinding.baseRevision,
          content: { ...command, understanding: command.overview.trim(), overviewStatus: 'CURRENT',
            issues: command.issues.map(issue => ({ ...issue, question: issue.question.trim(), body: issue.body.trim(),
              issueRef: `fixture-issue:${issue.issueKey}`, sourceDependencies: [] })) } };
        state.committedWrites += 1;
        state.actions.push({ tool: 'save_assessment_work', request: args,
          response: { workRevisionRef: state.saved.workRevisionRef, workRevision: 1 } });
        return { workRevisionRef: state.saved.workRevisionRef, workRevision: 1 };
      });
      if (mode === 'after-save') crash();
      if (mode === 'lose-save-ack') throw new Error('FIXTURE_ACK_LOST_AFTER_COMMIT');
      return receipt;
    },
  };
  const actualGateway = createCodexGateway(codexOptions);
  const gateway = async (_endpoint, init) => {
    const parent = await disk.readOptional('assessment-round-1.codex-run');
    if (mode === 'before-codex-launch' || parent?.runRoot === await realpath(codexOptions.runRoot))
      return actualGateway(_endpoint, init);
    if (init.codexRecovery?.recoverOnly)
      await update(state => { state.modelRecoveryRequests += 1; });
    let record = await model.readOptional('response');
    const prepared = { runRoot: root, runDirectory: resolve(root, 'synthetic-model'),
      requestId: init.codexRecovery.requestId,
      bindingSha256: sha256(JSON.stringify({ synthetic: true,
        requestId: init.codexRecovery.requestId, requestBody: init.body })),
      promptSha256: sha256(init.body) };
    if (!record) {
      if (init.codexRecovery?.recoverOnly) throw new Error('CODEX_GENERATION_OUTCOME_UNKNOWN');
      await init.codexRecovery.onRunPrepared?.(prepared);
      await update(state => { state.modelRequests += 1; });
      const raw = JSON.stringify({ id: 'fixture-model-response-1', object: 'chat.completion', model: 'glm-5.3',
        choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
          tool_calls: [{ id: 'fixture-result-call-1', type: 'function', function: {
            name: 'return_wiselink_program_assessment', arguments: JSON.stringify({ workJson: JSON.stringify(work) }) } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
      record = { raw, responseSha256: sha256(raw), status: 200, ok: true,
        requestBody: init.body, requestId: init.codexRecovery.requestId };
      await model.writeOnce('response', record);
      await model.writeOnce('transport-summary', { synthetic: true, model_requests: 1, closure: 'completed' });
      if (mode === 'after-model-receipt') crash();
      if (mode === 'throw-after-model-receipt') throw new Error('FIXTURE_RESPONSE_ACK_LOST');
    } else await init.codexRecovery.onRunPrepared?.(prepared);
    if (record.requestBody !== init.body || record.requestId !== init.codexRecovery.requestId)
      throw new Error('FIXTURE_MODEL_BINDING_CHANGED');
    if (typeof record.raw !== 'string' || record.responseSha256 !== sha256(record.raw) ||
        record.status !== 200 || record.ok !== true)
      throw new Error('CODEX_GENERATION_RECOVERY_MISMATCH');
    const summary = await model.readOptional('transport-summary');
    if (!summary) throw new Error('CODEX_GENERATION_OUTCOME_UNKNOWN');
    if (summary.synthetic !== true || summary.model_requests !== 1 || summary.closure !== 'completed')
      throw new Error('CODEX_GENERATION_RECOVERY_MISMATCH');
    return { status: record.status, ok: record.ok, text: async () => record.raw,
      codexReceipt: { requestId: record.requestId, runDirectory: resolve(root, 'synthetic-model'),
        responseSha256: record.responseSha256,
        transportSummaryRef: resolve(root, 'synthetic-model', 'transport-summary.json'),
        recovered: Boolean(init.codexRecovery.recoverOnly) } };
  };
  let execution, report;
  if (budgeted) {
    // Exercise the real consumer's budget closure. Only orchestration and Host
    // transport are synthetic; model/SAVE reservation handling is production code.
    const initial = { workItemId: assessmentBinding.workItemId,
      documentVersionId: assessmentBinding.documentVersionId, workItemRevision: 7,
      status: 'REQUIRED', nextOperation: 'EVALUATE_JOBAID', candidateOnly: true,
      stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
        jobAid: { status: 'PENDING' }, overall: { status: 'PENDING' } } };
    const previousClaim = await disk.readOptional('assessment-current-claim');
    const task = { ...assessmentBinding, operationRef: assessmentBinding.attemptRef,
      taskType: 'OPENCLAW_DYNAMIC_EVALUATION', deadline: options.taskDeadline,
      executionModel: options.executionModel, idempotencyKey: 'fixture-budget-original-request' };
    const claim = { status: 'RUNNING', attemptRef: assessmentBinding.attemptRef, task, modelInput,
      leaseGeneration: (previousClaim?.leaseGeneration ?? 0) + 1,
      leaseToken: 'fixture-budget-current-fence', leaseExpiresAt: options.taskDeadline };
    report = await runHostedInitialStage({ ...stageOptions, initial,
      ...(previousClaim ? { assessmentRecovery: { status: 'RECOVERY_CANDIDATE', previousClaim } } : {}) }, {
      callTool: async (name, args) => {
        if (name === 'begin_dynamic_evaluation') return claim;
        if (name === 'get_parse_status') return { entry: { workItemId: assessmentBinding.workItemId }, initialAnalysis: initial };
        if (name === 'read_assessment_work') return options.readAssessmentWork(args);
        if (name === 'save_assessment_work') return options.saveAssessmentWork(args);
        if (name === 'record_assessment_program_progress') return options.recordAssessmentProgramProgress(args);
        throw new Error(`FIXTURE_UNEXPECTED_BUDGET_TOOL:${name}`);
      },
      invokeInitialModel: (input, hooks) => invokeHostedProgramAssessment(input,
        { ...options, ...hooks, assessmentCheckpoint: checkpoint }, { requestGateway: gateway }),
      runInitial: async ({ callTool, evaluateDynamicRules }) => {
        await callTool('begin_dynamic_evaluation', { workItemId: assessmentBinding.workItemId });
        execution = await evaluateDynamicRules(modelInput, { assessmentBinding,
          heartbeat: options.heartbeat, sessionDiscriminator: assessmentBinding.attemptRef,
          readAssessmentSources: options.readAssessmentSources,
          readAssessmentWork: args => callTool('read_assessment_work', args),
          saveAssessmentWork: args => callTool('save_assessment_work', args),
          recordAssessmentProgramProgress: args => callTool('record_assessment_program_progress', args) });
        return { outcome: 'SYNTHETIC_SAVE_READ_ONLY', provenance: execution.provenance };
      },
    });
  } else execution = await invokeHostedProgramAssessment({ operation: 'EVALUATE_JOBAID', modelInput }, options,
    { requestGateway: gateway });
  return { execution, ...(budgeted ? { report, budget: await disk.readOptional('jobaid-run-budget') } : {}),
    state: await host.readOptional('state'),
    receiptLinks: await disk.readOptional('program-receipt-links') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outcome = await createCheckpointStore(resolve(process.argv[2]));
  try {
    const result = await runProgramRecoveryFixture(process.argv[2], process.argv[3]);
    await outcome.write('fixture-outcome', result);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const result = { errorCode: error.message };
    await outcome.write('fixture-outcome', result);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = 1;
  }
}
