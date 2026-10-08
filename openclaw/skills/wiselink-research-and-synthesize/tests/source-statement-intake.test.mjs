import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { consumeHostedWorkItem } from '../scripts/consume-hosted-work-item.mjs';
import { invokeHostedInitialModel } from '../scripts/invoke-hosted-initial-model.mjs';
import { canonicalJson, canonicalSha256, validateResultEnvelope, validateTaskEnvelope,
  validateReviewTask, REVIEW_ALLOWED_OPERATIONS, REVIEW_JOBAID_TASK_SCHEMA,
  WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION, WISELINK_MODEL_POLICY_REF,
  WISELINK_RUNTIME_APP_ID, WISELINK_PROFILE_REF, WISELINK_SKILL_COMPATIBILITY_REF,
} from '../scripts/validate-payload.mjs';

// These are constructed transport fixtures. They prove the native intake and
// Host hook wiring, not the quality of a model's engineering interpretation.
const WORK_ITEM = 'WI-statement-intake';
const DOCUMENT_VERSION = 'DV-statement-intake';
const STATEMENT_SCHEMA = 'wiselink.jobaid-problem-task.v3';
const ROOT = 'DOCUMENT_ORIGINAL:DV-statement-intake:PR-1:SR-1';
const STATEMENT_REF = 'DOCUMENT_ACTIVITY:DAR-intake-1:1:DAS-1';

function savedStatement(ref = STATEMENT_REF, suffix = '1', root = ROOT) {
  const reference = { runRef: `DAR-intake-${suffix}`, candidateRevision: 1, statementId: `DAS-${suffix}` };
  const quote = `Action ${suffix} TBD`;
  return {
    ref, reference, candidateOnly: true,
    sourceSchemaVersion: 'wiselink.document.activity-candidate.v1',
    sourceBinding: { original: { documentVersionId: DOCUMENT_VERSION, parseRunId: 'PR-1', parseRevision: 1,
      sourceArtifactId: 'constructed-artifact', sourceSha256: 'a'.repeat(64), sourceByteLength: 123 },
      semanticRevision: 1 },
    statement: { statementId: `DAS-${suffix}`, statementKey: `statement-${suffix}`,
      label: `Constructed action ${suffix}`,
      quotes: [{ anchorId: `anchor-${suffix}`, start: 0, end: quote.length, text: quote }],
      time: null, statusRaw: 'TBD', limitations: ['Only if condition X is confirmed'] },
    semanticFieldsAvailability: 'LEGACY_PARTIAL', scopeBasis: 'LEGACY_RUN_SCOPE',
    rootRefs: [root], requiredContextRootRefs: [root],
    quoteLocators: [{ quoteIndex: 0, anchorId: `anchor-${suffix}`, sourceUnitId: `u-${suffix}`,
      payloadPath: '/payload/text', sourceRefIds: [`SR-${suffix}`], rootRefs: [root] }],
  };
}

function activityContext(record) {
  const suffix = record.reference.statementId.slice('DAS-'.length);
  return { runRef: record.reference.runRef, candidateRevision: record.reference.candidateRevision,
    readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: { sectionIds: ['section:actions'] },
      deliveredRanges: [{ sectionId: 'section:actions', offset: 0, unitIds: [`u-${suffix}`],
        anchorIds: [`anchor-${suffix}`], nextOffset: 1 }],
      sourceCoverage: { knownPageCount: 3, readPageIndexes: [0],
        unresolvedRanges: [{ pageIndexes: [1, 2], unitIds: [], reason: 'UNREAD',
          message: 'Other pages were outside this constructed delivery', readingImpact: 'LIMITATION' }] } } };
}

function source(ref, kind, extra = {}) {
  return { ref, kind, title: `Constructed ${kind}`, versionLabel: kind === 'PRIOR_RESULT' ? 'PR-1' : 'R1',
    locator: kind === 'DOCUMENT_PASSAGE' ? 'page 1, text unit' : null, ...extra };
}

function sourceEvidence(ref, kind, record = null) {
  const base = { evidenceRef: ref, kind, title: `Constructed ${kind}`,
    versionLabel: kind === 'PRIOR_RESULT' ? record.sourceBinding.original.parseRunId : 'R1',
    excerpt: kind === 'PRIOR_RESULT' ? record.statement.label : `Constructed original ${ref}`,
    locator: kind === 'DOCUMENT_PASSAGE' ? 'page 1, text unit' : null };
  return kind === 'PRIOR_RESULT' ? { ...base,
    originalEvidenceRefs: [...new Set([...record.rootRefs, ...record.requiredContextRootRefs])],
    sourceStatement: { reference: record.reference, sourceBinding: record.sourceBinding },
    sourceContext: { resultRef: record.reference.runRef, resultRevision: record.reference.candidateRevision },
  } : base;
}

function initialInput() {
  const statement = savedStatement();
  return {
    schemaVersion: STATEMENT_SCHEMA, evidenceProjectionVersion: 'SOURCE_CONTEXT_V2',
    purpose: 'INITIAL_PROBLEM_ASSESSMENT', methodBinding: { packRef: 'constructed-method' },
    documentOverview: { title: 'Constructed document', sections: [] },
    sourceStatementAvailability: { status: 'AVAILABLE', semanticFieldsAvailability: 'LEGACY_PARTIAL',
      limitations: ['Only delivered coverage was read'] },
    availableSources: [source(statement.ref, 'PRIOR_RESULT', { sourceStatement: {
      reference: statement.reference, label: statement.statement.label,
      semanticFieldsAvailability: 'LEGACY_PARTIAL', scopeBasis: 'LEGACY_RUN_SCOPE',
    } }), source(ROOT, 'DOCUMENT_PASSAGE')],
    deliveredEvidence: [], expectedWorkRevision: 0, previousWork: null,
  };
}

function overallInput(previous) {
  const first = savedStatement(STATEMENT_REF, '1', ROOT);
  const secondRef = 'DOCUMENT_ACTIVITY:DAR-intake-2:1:DAS-2';
  const secondRoot = 'DOCUMENT_ORIGINAL:DV-statement-intake:PR-1:SR-2';
  const second = savedStatement(secondRef, '2', secondRoot);
  const fillers = Array.from({ length: 93 }, (_, index) => source(`DOCUMENT_ORIGINAL:DV-statement-intake:PR-1:SR-filler-${index}`, 'DOCUMENT_PASSAGE'));
  const availableSources = [source(first.ref, 'PRIOR_RESULT', { sourceStatement: {
    reference: first.reference, label: first.statement.label,
    semanticFieldsAvailability: 'LEGACY_PARTIAL', scopeBasis: 'LEGACY_RUN_SCOPE',
  } }), source(ROOT, 'DOCUMENT_PASSAGE'), ...fillers,
    source(secondRoot, 'DOCUMENT_PASSAGE'), source(second.ref, 'PRIOR_RESULT', { sourceStatement: {
      reference: second.reference, label: second.statement.label,
      semanticFieldsAvailability: 'LEGACY_PARTIAL', scopeBasis: 'LEGACY_RUN_SCOPE',
    } })];
  assert.equal(availableSources.length, 97);
  return { input: {
    schemaVersion: STATEMENT_SCHEMA, evidenceProjectionVersion: 'SOURCE_CONTEXT_V2',
    purpose: 'OVERALL_CONSISTENCY', methodBinding: { packRef: 'constructed-method' },
    sourceStatementAvailability: { status: 'AVAILABLE', semanticFieldsAvailability: 'LEGACY_PARTIAL', limitations: [] },
    availableSources, deliveredEvidence: [], expectedWorkRevision: 1, previousWork: previous,
    externalDiscoveryResults: [],
  }, statements: [first, second], roots: [ROOT, secondRoot] };
}

function envelope(operation, modelInput) {
  const taskType = operation === 'EVALUATE_JOBAID' ? 'OPENCLAW_DYNAMIC_EVALUATION' : 'OPENCLAW_OVERALL_SYNTHESIS';
  const unsealed = {
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: `ATT-${operation}`, operationRef: `AQ-${operation}`,
    taskType, priority: 100, tenantId: 'constructed-tenant', workItemId: WORK_ITEM,
    inputRevision: 1, baseRevision: 1, documentVersionId: DOCUMENT_VERSION,
    sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [],
    modelInput: structuredClone(modelInput), deadline: '2099-01-01T00:00:00.000Z',
    idempotencyKey: `constructed:${operation}`,
  };
  return validateTaskEnvelope({ ...unsealed, inputHash: canonicalSha256(unsealed) });
}

function gatewayStep(step, index) {
  return new Response(JSON.stringify({ model: 'constructed-model-v1', choices: [{ finish_reason: 'tool_calls',
    message: { role: 'assistant', content: null, tool_calls: [{ id: `call-${index}`, type: 'function',
      function: { name: 'return_wiselink_assessment_step', arguments: JSON.stringify({ step }) } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200 });
}

function status(operation, done = false, workRevision = 1) {
  const stage = operation === 'EVALUATE_JOBAID' ? 'jobAid' : 'overall';
  const nextOperation = done ? (stage === 'jobAid' ? 'SYNTHESIZE_OVERALL' : null) : operation;
  return { entry: { workItemId: WORK_ITEM }, initialAnalysis: {
    candidateOnly: true, documentVersionId: DOCUMENT_VERSION, workItemRevision: workRevision,
    status: done && stage === 'overall' ? 'SUCCEEDED' : 'REQUIRED', nextOperation,
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'SUCCEEDED' },
      jobAid: { status: stage === 'jobAid' && !done ? 'PENDING' : 'SUCCEEDED' },
      overall: { status: stage === 'overall' && done ? 'SUCCEEDED' : 'PENDING' } },
  }, integratedAssessmentSummary: stage === 'overall' ? { baseRules: {
    schemaVersion: 'wiselink.jobaid-problem-result.v2', status: 'CANDIDATE_ONLY',
    workRevisionRef: 'JAWR-initial', workRevision: 1, roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
  } } : null };
}

async function withScratch(run) {
  const root = await mkdtemp(join(tmpdir(), 'statement-intake-'));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function harness({ operation, input, steps, readReceipt }) {
  const task = envelope(operation, input);
  const requests = [], tools = [], saves = [], readbacks = new Map();
  let committed = false;
  const requestGateway = async (_url, request) => {
    requests.push(JSON.parse(request.body));
    assert.ok(steps.length, 'the fake gateway has no remaining step');
    return gatewayStep(steps.shift(), requests.length);
  };
  const callTool = async (name, args) => {
    tools.push({ name, args });
    if (name === 'get_parse_status') return status(operation, committed, committed ? 2 : 1);
    if (name === 'begin_dynamic_evaluation' || name === 'begin_overall_synthesis') return {
      attemptRef: task.operationRef, status: 'RUNNING', leaseToken: 'constructed-lease', leaseGeneration: 1,
      task, modelInput: input, ...(operation === 'SYNTHESIZE_OVERALL' ? { selectedDiscoveryRefs: [] } : {}),
    };
    if (name === 'heartbeat_action_attempt') return { attemptRef: task.operationRef, status: 'RUNNING',
      leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
    if (name === 'read_assessment_sources') return readReceipt(args);
    if (name === 'save_assessment_work') {
      saves.push(args);
      const content = JSON.parse(args.workJson);
      const revision = { requestId: args.requestId, workRevisionRef: `JAWR-${operation}`, workRevision: args.expectedWorkRevision + 1,
        content: { ...content, readSourceRefs: input.availableSources.map(x => x.ref) } };
      readbacks.set(args.requestId, revision);
      return { workRevisionRef: revision.workRevisionRef, workRevision: revision.workRevision,
        roundCompletion: content.roundCompletion };
    }
    if (name === 'read_assessment_work') return { revision: readbacks.get(args.requestId) ?? null };
    if (name === 'commit_dynamic_evaluation_candidate' || name === 'commit_overall_candidate') {
      validateResultEnvelope(task, args.result);
      assert.equal(JSON.parse(args.result.modelOutput).workRevisionRef, `JAWR-${operation}`);
      assert.equal(args.result.promptVersion, 'wiselink-jobaid-problem@v3');
      assert.equal(args.result.toolVersions['jobaid-problem-protocol'], '3');
      committed = true;
      return name === 'commit_dynamic_evaluation_candidate'
        ? { workItemId: WORK_ITEM, workItemRevision: 2, status: 'BASE_RULE_CANDIDATE_READY' }
        : { workItemId: WORK_ITEM, workItemRevision: 2, status: 'OVERALL_CANDIDATE_READY',
          overallSynthesis: { status: 'CANDIDATE_ONLY', authorityLevel: 'candidate_only', externalDiscoveryIsEvidence: false } };
    }
    if (name === 'get_deep_link') return { workItemId: WORK_ITEM, deepLink: '/constructed/work-item' };
    if (name === 'cancel_action_attempt') return { attemptRef: task.operationRef, status: 'CANCELLED' };
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const invokeInitialModel = (modelRequest, runtimeOptions) => invokeHostedInitialModel(modelRequest, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://constructed.invalid', gatewayToken: 'constructed-only',
    configuredModelVersion: 'constructed-model-v1', ...runtimeOptions,
  }, { requestGateway });
  return { task, requests, tools, saves, invokeInitialModel, callTool, remainingSteps: steps };
}

test('initial v3 consumes directory then reads full saved statement and roots before SAVE and FINISH', () => withScratch(async checkpointRoot => {
  const input = initialInput();
  const record = savedStatement();
  const context = activityContext(record);
  const receipt = { schemaVersion: 'wiselink.jobaid-source-read.v3', status: 'AVAILABLE', scope: 'EXACT',
    completeRequestedScope: true, sourceRefs: [STATEMENT_REF, ROOT], sourceStatements: [record], activityContexts: [context],
    evidence: [sourceEvidence(STATEMENT_REF, 'PRIOR_RESULT', record), sourceEvidence(ROOT, 'DOCUMENT_PASSAGE')] };
  const work = { schemaVersion: 'wiselink.jobaid-problem-work.v3', roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
    overview: `Condition X remains unconfirmed [[${STATEMENT_REF}]]`,
    issues: [{ issueKey: 'x', question: 'Does X hold?', body: `Source action is conditional [[${STATEMENT_REF}]]` }] };
  const fixture = harness({ operation: 'EVALUATE_JOBAID', input,
    steps: [{ action: 'READ_SOURCES', sourceRefs: [STATEMENT_REF], purpose: 'Read saved statement and root', context: 'EXACT' },
      { action: 'SAVE_WORK', workJson: JSON.stringify(work) }, { action: 'FINISH' }],
    readReceipt: args => { assert.deepEqual(args.sourceRefs, [STATEMENT_REF]); return receipt; } });
  const result = await consumeHostedWorkItem({ workItemId: WORK_ITEM, checkpointRoot,
    initialStageOnly: true, maxInitialStages: 1 }, { callTool: fixture.callTool, invokeInitialModel: fixture.invokeInitialModel });
  assert.equal(result.status, 'INITIAL_STAGE_SAVED', JSON.stringify(result));
  assert.equal(result.operation, 'EVALUATE_JOBAID');
  assert.equal(result.modelCallCount, 1);
  assert.equal(fixture.remainingSteps.length, 0);
  assert.equal(fixture.saves.length, 1);
  assert.equal(fixture.tools.filter(x => x.name === 'read_assessment_sources').length, 1);
  assert.equal(fixture.tools.filter(x => x.name === 'read_assessment_work').length > 0, true);
  assert.equal(fixture.tools.filter(x => x.name === 'commit_dynamic_evaluation_candidate').length, 1);
  const first = JSON.parse(fixture.requests[0].messages[1].content);
  assert.deepEqual(first.availableSources, input.availableSources);
  assert.equal(first.sourceStatements, undefined);
  assert.equal(first.activityContexts, undefined);
  assert.equal(first.availableSources.some(x => x.sourceStatement?.statement || x.sourceStatement?.quotes), false);
  const continuation = fixture.requests[1].messages.map(x => { try { return JSON.parse(x.content); } catch { return null; } })
    .find(x => x?.sourceReadReceipt)?.sourceReadReceipt;
  assert.deepEqual(continuation.sourceStatements, [record]);
  assert.deepEqual(continuation.activityContexts, [context]);
  assert.deepEqual(continuation.evidence, receipt.evidence);
  assert.deepEqual(continuation.sourceRefs, [STATEMENT_REF, ROOT]);
  assert.deepEqual(Object.keys(continuation.sourceStatements[0].statement).sort(),
    ['statementId', 'statementKey', 'label', 'quotes', 'time', 'statusRaw', 'limitations'].sort(),
    'the consumer transports the saved v1 fields without inventing semantic fields');
  assert.deepEqual(fixture.saves[0].expectedWorkRevision, 0);
  assert.deepEqual(JSON.parse(fixture.saves[0].workJson), work);
}));

test('Overall v3 consumes split >96-ref READ receipts with every full statement and context before save', () => withScratch(async checkpointRoot => {
  const previous = { workRevisionRef: 'JAWR-initial', workRevision: 1,
    content: { schemaVersion: 'wiselink.jobaid-problem-work.v3',
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS', overview: 'Existing initial work',
      readSourceRefs: [STATEMENT_REF, ROOT], issues: [] } };
  const { input, statements, roots } = overallInput(previous);
  const allRefs = input.availableSources.map(x => x.ref);
  const contexts = statements.map(activityContext);
  const work = { schemaVersion: 'wiselink.jobaid-problem-work.v3',
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
    overview: `Both saved source candidates retain unconfirmed conditions [[${statements[0].ref}]] [[${statements[1].ref}]]`,
    issues: [] };
  const hostReads = [];
  const readReceipt = args => {
    hostReads.push(args);
    const selected = new Set(args.sourceRefs);
    const included = statements.filter(record => selected.has(record.ref));
    const sourceRefs = [...args.sourceRefs];
    for (const record of included) if (!sourceRefs.includes(record.requiredContextRootRefs[0]))
      sourceRefs.push(record.requiredContextRootRefs[0]);
    const evidence = sourceRefs.map(ref => {
      const statement = statements.find(record => record.ref === ref);
      return sourceEvidence(ref, statement ? 'PRIOR_RESULT' : 'DOCUMENT_PASSAGE', statement);
    });
    return { schemaVersion: 'wiselink.jobaid-source-read.v3', status: 'AVAILABLE', scope: 'EXACT',
      completeRequestedScope: true, sourceRefs, evidence, sourceStatements: included,
      activityContexts: included.map(record => contexts.find(context => context.runRef === record.reference.runRef)) };
  };
  const fixture = harness({ operation: 'SYNTHESIZE_OVERALL', input, readReceipt,
    steps: [{ action: 'READ_SOURCES', sourceRefs: allRefs, purpose: 'Read all selected original and saved sources', context: 'EXACT' },
      { action: 'SAVE_WORK', workJson: JSON.stringify(work) },
      { action: 'FINISH', consistencyCheck: 'Saved conditions and unresolved applicability remain explicit.' }] });
  const result = await consumeHostedWorkItem({ workItemId: WORK_ITEM, checkpointRoot,
    initialStageOnly: true, maxInitialStages: 1 }, { callTool: fixture.callTool, invokeInitialModel: fixture.invokeInitialModel });
  assert.equal(result.status, 'INITIAL_STAGE_SAVED', JSON.stringify(result));
  assert.equal(result.operation, 'SYNTHESIZE_OVERALL');
  assert.equal(result.modelCallCount, 1);
  assert.equal(fixture.remainingSteps.length, 0);
  assert.equal(fixture.saves.length, 1);
  assert.equal(hostReads.length, 2, 'the native runner splits this single model request at 96 refs');
  assert.deepEqual(hostReads.map(x => x.sourceRefs.length), [96, 1]);
  assert.equal(fixture.tools.filter(x => x.name === 'commit_overall_candidate').length, 1);
  const first = JSON.parse(fixture.requests[0].messages[1].content);
  assert.deepEqual(first.availableSources, input.availableSources);
  assert.equal(first.sourceStatements, undefined);
  assert.equal(first.activityContexts, undefined);
  assert.equal(first.availableSources.some(x => x.sourceStatement?.statement || x.sourceStatement?.quotes), false);
  const readMessages = fixture.requests[1].messages.filter(x => x.role === 'tool')
    .map(x => JSON.parse(x.content));
  assert.equal(readMessages.length, 1, 'one aggregated Host receipt enters the model session');
  const delivered = readMessages[0];
  assert.equal(delivered.schemaVersion, 'wiselink.jobaid-source-read.v3');
  assert.deepEqual(delivered.sourceStatements, statements);
  assert.deepEqual(delivered.activityContexts, contexts);
  assert.deepEqual(delivered.sourceRefs, allRefs);
  assert.deepEqual(delivered.evidence.map(x => x.evidenceRef), allRefs);
  assert.deepEqual(roots.every(root => delivered.evidence.some(x => x.evidenceRef === root)), true);
  assert.deepEqual(new Set(delivered.evidence.map(x => x.evidenceRef)).size, 97);
  assert.deepEqual(JSON.parse(fixture.saves[0].workJson), work);
}));

test('v3 availability states remain explicit while a sealed v2 envelope remains valid', () => {
  const v2 = initialInput();
  v2.schemaVersion = 'wiselink.jobaid-problem-task.v2';
  delete v2.evidenceProjectionVersion;
  delete v2.sourceStatementAvailability;
  v2.availableSources = v2.availableSources.map(({ sourceStatement: _directory, ...entry }) => entry);
  const oldBytes = canonicalJson(envelope('EVALUATE_JOBAID', v2));
  assert.equal(canonicalJson(validateTaskEnvelope(JSON.parse(oldBytes))), oldBytes);
  for (const state of ['NOT_SAVED', 'NOT_INDEXED']) {
    const next = initialInput();
    next.sourceStatementAvailability = { status: state, semanticFieldsAvailability: 'LEGACY_PARTIAL',
      limitations: [`Constructed ${state} case`] };
    next.availableSources = [source(ROOT, 'DOCUMENT_PASSAGE')];
    assert.equal(validateTaskEnvelope(envelope('EVALUATE_JOBAID', next)).modelInput.sourceStatementAvailability.status, state);
  }
});

test('known terminal gateway failure retains v3 provenance without reading or saving', async () => {
  const input = initialInput();
  let calls = 0;
  await assert.rejects(invokeHostedInitialModel({ operation: 'EVALUATE_JOBAID', modelInput: input }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://constructed.invalid',
    gatewayToken: 'constructed-only', configuredModelVersion: 'constructed-model-v1',
    sessionDiscriminator: 'constructed-terminal', heartbeat: async () => {},
    readAssessmentSources: async () => assert.fail('failure cannot read sources'),
    saveAssessmentWork: async () => assert.fail('failure cannot save work'),
    readAssessmentWork: async () => assert.fail('failure cannot read work'),
  }, { requestGateway: async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'constructed/model ended with an incomplete terminal response' } }),
      { status: 400 });
  } }), error => {
    assert.equal(error.message, 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE');
    assert.equal(error.terminalAssessmentFailure.errorCode, 'JOBAID_INCOMPLETE_TERMINAL_RESPONSE');
    assert.equal(error.terminalAssessmentFailure.provenance.promptVersion, 'wiselink-jobaid-problem@v3');
    assert.equal(error.terminalAssessmentFailure.provenance.toolVersions['jobaid-problem-protocol'], '3');
    return true;
  });
  assert.equal(calls, 1);
});

test('Review keeps its v2 JobAid task branch and rejects an initial/Overall v3 task there', () => {
  const problemAssessment = { schemaVersion: 'wiselink.jobaid-problem-task.v2',
    purpose: 'PROBLEM_REVIEW', deliveredEvidence: [] };
  const task = {
    schemaVersion: REVIEW_JOBAID_TASK_SCHEMA, mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: 'RC-constructed', reviewTurnRef: 'RT-constructed', requestId: 'REQ-constructed',
    actorContextRef: 'AC-constructed', inputRevision: 1, selectedEvaluationItemId: null,
    userMessage: 'Check the assessment', allowedOperations: [...REVIEW_ALLOWED_OPERATIONS], resourceRefs: [],
    allowedEvaluationItemIds: [], allowedAdoptedInputRefs: [], attachmentRefs: [],
    context: { purpose: 'CHAT', problemAssessment },
    executionPolicy: { runtimeAppId: WISELINK_RUNTIME_APP_ID, profileRef: WISELINK_PROFILE_REF,
      modelPolicyRef: WISELINK_MODEL_POLICY_REF, skillPolicyRef: WISELINK_SKILL_COMPATIBILITY_REF,
      toolPolicyRef: `${WISELINK_HOST_MCP_NAME}@${WISELINK_HOST_MCP_VERSION}#interactive-jobaid-review-c5` },
    jobAidContext: { schemaVersion: 'wiselink.jobaid-problem-task.v2', sourceCatalog: [], sourceBindings: [],
      initiallyDeliveredRefs: [], modelInput: problemAssessment, previousWork: null },
  };
  assert.doesNotThrow(() => validateReviewTask(task));
  const invalid = structuredClone(task);
  invalid.jobAidContext.schemaVersion = STATEMENT_SCHEMA;
  invalid.jobAidContext.modelInput.schemaVersion = STATEMENT_SCHEMA;
  assert.throws(() => validateReviewTask(invalid), /REVIEW_JOBAID_CONTEXT_INVALID/u);
});
