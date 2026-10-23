import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalSha256, validatePayload, validateReviewTask } from '../scripts/validate-payload.mjs';
import { invokeHostedReviewModel, projectJobAidUpdateInput, runHostedReviewTurn } from '../scripts/run-hosted-review-turn.mjs';
import { packet, record } from './fixtures/source-statement-v2-wire.fixture.mjs';

// Synthetic saved carriers, not new READs or proof of current Host authority.
const legacy = readFileSync(new URL('./fixtures/review-turn-task.c2.json', import.meta.url), 'utf8');
const common = { title: 'Saved conditional judgment', versionLabel: 'R1',
  excerpt: 'Only for configuration A; implementation remains unverified.', locator: null };
const plain = item => ({ evidenceRef: item.evidenceRef, kind: item.kind,
  title: item.title, versionLabel: item.versionLabel, excerpt: item.excerpt, locator: item.locator ?? null });

function nativeCarrier(index) {
  const sourceVersion = { rawRevision: 'R1', rawIteration: '1', confirmation: 'SOURCE_DECLARED' };
  const state = { rawName: 'Estimated', rawCode: 'Estimated' };
  const sourceRecordId = `assessment-${index}`;
  const sourceRevisionRef = `retained-observation-${index}`;
  const observation = { sourceRecordId, sourceVersion, state, recordKind: 'ENGINEER_ASSESSMENT',
    objectBinding: 'EXACT_CURRENT_DETAIL', observedAt: '2026-10-01T10:00:00Z' };
  return { ...common, kind: 'TDMS_NATIVE_RECORD', evidenceRef: `native:saved-${index}`,
    nativeSource: { sourceRecordId, sourceVersion, state, sourceRevisionRef,
      recordKind: 'ENGINEER_ASSESSMENT', recordRef: `record-${index}`, sourceKey: 'TDMS',
      sourceInstanceId: 'synthetic-instance', title: common.title, fileType: null,
      authors: [], observedAt: observation.observedAt, capturedAt: '2026-10-02T10:00:00Z',
      coverage: { status: 'PARTIAL', gaps: ['Latestness not provided'], readback: 'CONSISTENT' },
      relatedDocumentVersionIds: [], fieldSelectors: [{ fieldPath: 'content.opinions[0]', selector: '#opinion' }],
      sourceVerification: 'DECLARED_ONLY', currentness: 'SELECTED_HOST_OBSERVATION' },
    nativeScope: { sourceRevisionRef, fieldSelectors: [{ fieldPath: 'content.opinions[0]', selector: '#opinion' }],
      grouping: 'TRANSPARENT_FIELDS', limitations: ['Not proof of implementation'],
      processingSetBinding: { scope: { tenantId: 'synthetic', sourceKey: 'TDMS',
        sourceInstanceId: 'synthetic-instance', scopeId: 'scope' }, setRevisionRef: 'set',
      generation: 2, processingFamilyRef: 'family', cohortRef: 'cohort',
      processingObservationRef: 'processing', memberRef: `member-${index}`, assessmentObservationRef: sourceRevisionRef },
      approval: { captureRef: `capture-${index}`, mode: 'EXACT_VERSION',
        evidencePath: 'rawFields.opinionCollection', approvalSubject: { sourceRecordId, sourceVersion },
        before: observation, after: observation } },
    nativeReadReceipt: { receiptRef: `saved-receipt-${index}`, sourceRevisionRef,
      readAt: '2026-10-03T11:12:13+08:00', purpose: 'JOB_AID_NATIVE_RECORD',
      fieldPaths: ['content.opinions[0]'], taskContextRef: `original-ordinary-task-${index}`,
      readPerformed: true, permissionRevision: 'original-source-permission',
      engineeringAdoption: 'NOT_CREATED', executionVerified: false } };
}

function sync(review) {
  review.context.problemAssessment = structuredClone(review.jobAidContext.modelInput);
  return review;
}
function addon(review, mutate) {
  mutate(review.jobAidContext.tdmsReviewContext);
  review.jobAidContext.modelInput.tdmsReviewContext = structuredClone(review.jobAidContext.tdmsReviewContext);
}
function fixture() {
  const review = JSON.parse(legacy);
  review.schemaVersion = 'wiselink.3_1.review_turn_task.v1.c5';
  review.selectedEvaluationItemId = null;
  review.allowedEvaluationItemIds = [];
  review.allowedAdoptedInputRefs = [];
  review.context.purpose = 'UPDATE_ASSESSMENT';
  const document = { ...common, kind: 'DOCUMENT_PASSAGE', evidenceRef: 'document:page-1',
    workItemId: review.context.workItem.workItemId, documentVersionId: 'DV-synthetic', sourceRefId: 'page-1' };
  const native = [nativeCarrier(1), nativeCarrier(2)];
  const sourceCatalog = [document, ...native];
  const tdmsReviewContext = { schemaVersion: 'wiselink.tdms-review-saved-context.v1',
    mode: 'SAVED_EVIDENCE_ONLY', reviewConversationRef: review.reviewConversationRef,
    reviewTurnRef: review.reviewTurnRef, requestId: review.requestId, inputRevision: review.inputRevision,
    workRevisionRef: 'saved-work-3', workRevision: 3, evidenceRefs: native.map(item => item.evidenceRef) };
  const previousWork = { requestId: 'original-saved-request', workRevisionRef: 'saved-work-3', workRevision: 3,
    content: { issues: [], evidence: native, readSourceRefs: native.map(item => item.evidenceRef) } };
  review.jobAidContext = { schemaVersion: 'wiselink.jobaid-problem-task.v2',
    sourceCatalog, initiallyDeliveredRefs: sourceCatalog.map(item => item.evidenceRef),
    sourceBindings: [{ workItemId: document.workItemId,
      artifactRef: 'artifact://synthetic-original', artifactSha256: 'a'.repeat(64) }],
    previousWork, tdmsReviewContext, modelInput: { schemaVersion: 'wiselink.jobaid-problem-task.v2',
      purpose: 'PROBLEM_REVIEW', tdmsReviewContext: structuredClone(tdmsReviewContext),
      expectedWorkRevision: 3, previousWork: { workRevisionRef: 'saved-work-3', workRevision: 3,
        content: { issues: [] } },
      availableSources: sourceCatalog.map(item => ({ ref: item.evidenceRef, kind: item.kind,
        title: item.title, versionLabel: item.versionLabel, locator: item.locator })),
      deliveredEvidence: sourceCatalog.map(item => ({ ...plain(item), ...(item.kind === 'TDMS_NATIVE_RECORD'
        ? { nativeSource: item.nativeSource, nativeScope: item.nativeScope, nativeReadReceipt: item.nativeReadReceipt } : {}) })) } };
  review.resourceRefs = [{ sourceRefId: document.evidenceRef, resourceArtifactRef: 'artifact://synthetic-original',
    resourceArtifactSha256: 'a'.repeat(64), value: { ...plain(document), sourceRefId: document.evidenceRef } }];
  review.executionPolicy.toolPolicyRef = 'wiselink-openclaw-engineering-assessment@1.2.0#interactive-jobaid-review-c5';
  return JSON.parse(JSON.stringify(sync(review)));
}

test('actual Review validator and model projection preserve two exact saved carriers and original receipts', () => {
  const review = fixture();
  const before = JSON.stringify(review);
  assert.equal(validateReviewTask(review), review);
  assert.doesNotThrow(() => validatePayload('review-task', review));
  const projected = projectJobAidUpdateInput({ context: review.context });
  const evidence = projected.context.problemAssessment.deliveredEvidence;
  assert.equal(evidence.length, 2, 'ordinary document preview is omitted; both saved native bodies remain');
  assert.deepEqual(evidence, review.jobAidContext.modelInput.deliveredEvidence.slice(1));
  assert.equal(evidence[0].nativeReadReceipt.taskContextRef, 'original-ordinary-task-1');
  assert.equal(evidence[0].nativeReadReceipt.permissionRevision, 'original-source-permission');
  assert.equal(evidence[0].nativeReadReceipt.readAt, '2026-10-03T11:12:13+08:00');
  assert.deepEqual(review.resourceRefs.map(item => item.sourceRefId), ['document:page-1'],
    'saved native refs never become READ_SOURCE_REFS artifact resources');
  assert.equal(JSON.stringify(review), before);
});

test('ordinary historical Review without addon/native keeps its original bytes and requirements', () => {
  const review = fixture();
  const jobAid = review.jobAidContext;
  delete jobAid.tdmsReviewContext;
  delete jobAid.modelInput.tdmsReviewContext;
  jobAid.sourceCatalog = jobAid.sourceCatalog.slice(0, 1);
  jobAid.initiallyDeliveredRefs = ['document:page-1'];
  jobAid.previousWork = { content: { issues: [] } };
  jobAid.modelInput.previousWork = { content: { issues: [] } };
  delete jobAid.modelInput.expectedWorkRevision;
  jobAid.modelInput.availableSources = jobAid.modelInput.availableSources.slice(0, 1);
  jobAid.modelInput.deliveredEvidence = jobAid.modelInput.deliveredEvidence.slice(0, 1);
  sync(review);
  const before = JSON.stringify(review);
  validateReviewTask(review);
  assert.equal(JSON.stringify(review), before);
  const old = JSON.parse(legacy);
  const oldBytes = JSON.stringify(old);
  validateReviewTask(old);
  assert.equal(JSON.stringify(old), oldBytes);
});

test('SOURCE_CONTEXT_V2 keeps the existing statement branch and appends native fields', () => {
  const review = fixture();
  const receipt = packet([record()]);
  const jobAid = review.jobAidContext;
  jobAid.sourceActivityProjections = [{ records: receipt.sourceStatements, activityContexts: receipt.activityContexts }];
  jobAid.modelInput.evidenceProjectionVersion = 'SOURCE_CONTEXT_V2';
  jobAid.modelInput.sourceStatements = receipt.sourceStatements;
  jobAid.modelInput.activityContexts = receipt.activityContexts;
  const statementCatalog = receipt.evidence.map(item => item.kind === 'PRIOR_RESULT'
    ? { ...item, resultRef: item.sourceStatement.reference.runRef,
      resultRevision: item.sourceStatement.reference.candidateRevision } : { ...item });
  jobAid.sourceCatalog.push(...statementCatalog);
  jobAid.initiallyDeliveredRefs.push(...receipt.sourceRefs);
  jobAid.modelInput.availableSources.push(...receipt.evidence.map(item => ({
    ref: item.evidenceRef, kind: item.kind, title: item.title, versionLabel: item.versionLabel, locator: item.locator })));
  jobAid.modelInput.deliveredEvidence.push(...receipt.evidence);
  sync(review);
  const before = JSON.stringify(review);
  validateReviewTask(review);
  assert.equal(JSON.stringify(review), before);
  const projected = projectJobAidUpdateInput({ context: review.context }).context.problemAssessment;
  assert.deepEqual(projected.sourceStatements, receipt.sourceStatements);
  assert.deepEqual(projected.deliveredEvidence.filter(item => item.kind === 'TDMS_NATIVE_RECORD'),
    jobAid.modelInput.deliveredEvidence.filter(item => item.kind === 'TDMS_NATIVE_RECORD'));
  assert.deepEqual(projected.deliveredEvidence.find(item => item.sourceStatement),
    receipt.evidence.find(item => item.sourceStatement));
});

const rejectionCases = [
  ['wrong conversation', r => addon(r, c => { c.reviewConversationRef = 'other-conversation'; }), /TURN_BINDING_INVALID/u],
  ['wrong turn', r => addon(r, c => { c.reviewTurnRef = 'other-turn'; }), /TURN_BINDING_INVALID/u],
  ['wrong request', r => addon(r, c => { c.requestId = 'other-request'; }), /TURN_BINDING_INVALID/u],
  ['wrong input revision', r => addon(r, c => { c.inputRevision++; }), /TURN_BINDING_INVALID/u],
  ['invalid input revision', r => addon(r, c => { c.inputRevision = '7'; }), /TURN_BINDING_INVALID/u],
  ['wrong work ref', r => addon(r, c => { c.workRevisionRef = 'other-work'; }), /WORK_BINDING_INVALID/u],
  ['wrong work revision', r => addon(r, c => { c.workRevision++; }), /WORK_BINDING_INVALID/u],
  ['zero work revision', r => addon(r, c => { c.workRevision = 0; }), /WORK_BINDING_INVALID/u],
  ['changed saved baseline', r => { r.jobAidContext.previousWork.workRevision++; }, /WORK_BINDING_INVALID/u],
  ['changed model baseline', r => { r.jobAidContext.modelInput.previousWork.workRevisionRef = 'other'; }, /WORK_BINDING_INVALID/u],
  ['changed expected revision', r => { r.jobAidContext.modelInput.expectedWorkRevision++; }, /WORK_BINDING_INVALID/u],
  ['empty refs', r => addon(r, c => { c.evidenceRefs = []; }), /EVIDENCE_REFS_INVALID/u],
  ['duplicate refs', r => addon(r, c => { c.evidenceRefs.push(c.evidenceRefs[0]); }), /EVIDENCE_REFS_INVALID/u],
  ['missing ref', r => addon(r, c => { c.evidenceRefs.pop(); }), /EVIDENCE_REFS_INVALID/u],
  ['unregistered ref', r => addon(r, c => { c.evidenceRefs[0] = 'native:other'; }), /EVIDENCE_REFS_INVALID/u],
  ['blank ref', r => addon(r, c => { c.evidenceRefs[0] = ' '; }), /EVIDENCE_REFS_INVALID/u],
  ['not initially delivered', r => { r.jobAidContext.initiallyDeliveredRefs.pop(); }, /EVIDENCE_REFS_INVALID/u],
  ['missing directory entry', r => { r.jobAidContext.modelInput.availableSources.pop(); }, /EVIDENCE_REFS_INVALID/u],
  ['missing delivered carrier', r => { r.jobAidContext.modelInput.deliveredEvidence.pop(); }, /EVIDENCE_REFS_INVALID/u],
  ['unregistered saved carrier', r => { r.jobAidContext.previousWork.content.evidence.push(nativeCarrier(3)); }, /EVIDENCE_REFS_INVALID/u],
  ['changed saved body', r => { r.jobAidContext.sourceCatalog[1].excerpt = 'changed body'; }, /SAVED_CARRIER_DRIFT/u],
  ['changed receipt task', r => { r.jobAidContext.sourceCatalog[1].nativeReadReceipt.taskContextRef = r.reviewTurnRef; }, /SAVED_CARRIER_DRIFT/u],
  ['changed receipt permission', r => { r.jobAidContext.sourceCatalog[1].nativeReadReceipt.permissionRevision = 'current'; }, /SAVED_CARRIER_DRIFT/u],
  ['dropped model receipt', r => { delete r.jobAidContext.modelInput.deliveredEvidence[1].nativeReadReceipt; }, /DELIVERED_EVIDENCE_DRIFT/u],
  ['wrapper/model addon drift', r => { r.jobAidContext.modelInput.tdmsReviewContext.requestId = 'other'; }, /CONTEXT_INVALID/u],
  ['missing wrapper addon', r => { delete r.jobAidContext.tdmsReviewContext; }, /PURPOSE_INVALID/u],
  ['missing model addon', r => { delete r.jobAidContext.modelInput.tdmsReviewContext; }, /PURPOSE_INVALID/u],
  ['native without addon', r => { delete r.jobAidContext.tdmsReviewContext; delete r.jobAidContext.modelInput.tdmsReviewContext; }, /CONTEXT_REQUIRED/u],
  ['ordinary wrapper context mixed', r => { r.jobAidContext.tdmsContext = {}; }, /CONTEXT_MIXED/u],
  ['ordinary model context mixed', r => { r.jobAidContext.modelInput.tdmsContext = {}; }, /CONTEXT_MIXED/u],
  ['null addon', r => { r.jobAidContext.tdmsReviewContext = null; r.jobAidContext.modelInput.tdmsReviewContext = null; }, /CONTEXT_INVALID/u],
  ['wrong schema', r => addon(r, c => { c.schemaVersion = 'wiselink.tdms-runtime-context.v1'; }), /CONTEXT_INVALID/u],
  ['new READ mode', r => addon(r, c => { c.mode = 'READ'; }), /CONTEXT_INVALID/u],
  ['CHAT purpose', r => { r.context.purpose = 'CHAT'; }, /PURPOSE_INVALID/u],
  ['ordinary initial purpose', r => { r.jobAidContext.modelInput.purpose = 'INITIAL_PROBLEM_ASSESSMENT'; }, /REVIEW_JOBAID_CONTEXT_INVALID/u],
  ['JSON authority pollution', r => addon(r, c => { c.reviewCaller = { authorized: true }; }), /CONTEXT_INVALID/u],
  ['JSON proto pollution', r => addon(r, c => { Object.defineProperty(c, '__proto__', { value: {}, enumerable: true }); }), /CONTEXT_INVALID/u],
];
for (const [label, mutate, expected] of rejectionCases) {
  test(`actual Review validator rejects ${label}`, () => {
    const review = fixture();
    mutate(review);
    sync(review);
    assert.throws(() => validateReviewTask(review), expected);
  });
}

for (const [label, mutate, expected = 'JOBAID_TDMS_READ_RECEIPT_INVALID'] of [
  ['missing receipt time', item => { delete item.nativeReadReceipt.readAt; }, 'JOBAID_TDMS_METADATA_INVALID'],
  ['nonexistent receipt date', item => { item.nativeReadReceipt.readAt = '2026-02-31T00:00:00Z'; }],
  ['wrong receipt source', item => { item.nativeReadReceipt.sourceRevisionRef = 'other'; }],
  ['wrong receipt fields', item => { item.nativeReadReceipt.fieldPaths = ['other']; }],
  ['receipt authority pollution', item => { item.nativeReadReceipt.authorized = true; }, 'JOBAID_TDMS_METADATA_INVALID'],
  ['wrong own state', item => { item.nativeSource.state.rawCode = 'Estimating'; }],
  ['parent approval observation', item => { item.nativeScope.approval.before.sourceRecordId = 'parent'; }, 'JOBAID_TDMS_READ_APPROVAL_INVALID'],
]) test(`actual Review validator still rejects saved carriers with ${label}`, () => {
  const review = fixture();
  const carrier = review.jobAidContext.sourceCatalog[1];
  mutate(carrier);
  review.jobAidContext.previousWork.content.evidence[0] = structuredClone(carrier);
  sync(review);
  assert.throws(() => validateReviewTask(review), { message: expected });
});

test('saved native carrier cannot be added to artifact READ_SOURCE_REFS resources', () => {
  const review = fixture();
  review.resourceRefs.push({ sourceRefId: 'native:saved-1', resourceArtifactRef: 'artifact://forged-native',
    resourceArtifactSha256: 'a'.repeat(64), value: { sourceRefId: 'native:saved-1' } });
  assert.throws(() => validateReviewTask(review), /REVIEW_JOBAID_RESOURCE_BINDING_INVALID/u);
});

test('legacy CHAT and Matter contexts cannot carry the new JobAid addon', () => {
  const value = fixture().jobAidContext.modelInput;
  const chat = JSON.parse(legacy);
  chat.context.problemAssessment = value;
  assert.throws(() => validateReviewTask(chat), /PURPOSE_INVALID/u);
  const matter = JSON.parse(legacy);
  matter.schemaVersion = 'wiselink.3_1.review_turn_task.v1.c4';
  matter.selectedEvaluationItemId = null;
  matter.allowedEvaluationItemIds = [];
  matter.matterContext = { title: 'Synthetic matter', workingState: null, readingEvidence: [], evidenceSources: [],
    scope: { schemaVersion: 'wiselink.3_1.matter_review_scope.v1', kind: 'ENGINEERING_MATTER',
      matterId: 'matter', basedOnMatterRevisionId: 'revision', expectedWorkingRevision: 1, targetClaimId: null,
      inputs: [{ inputId: 'input', workItemId: 'WI-matter', workItemRevision: 1,
        documentVersionId: 'DV-matter', resultRef: null, resultRevision: null }] } };
  matter.context.problemAssessment = value;
  assert.throws(() => validateReviewTask(matter), /PURPOSE_INVALID/u);
});

// Actual driver -> orchestrator -> sanitizer -> unchanged control-value guard ->
// model marshalling -> original candidate validator, using only local doubles.
async function modelPipeline(t, { isolated = false, mutateTask, mutateContext, mutateOutput, ordinary = false } = {}) {
  const review = fixture();
  if (ordinary) {
    const jobAid = review.jobAidContext;
    delete jobAid.tdmsReviewContext;
    delete jobAid.modelInput.tdmsReviewContext;
    jobAid.sourceCatalog = jobAid.sourceCatalog.slice(0, 1);
    jobAid.initiallyDeliveredRefs = ['document:page-1'];
    jobAid.previousWork.content.evidence = [];
    jobAid.modelInput.availableSources = jobAid.modelInput.availableSources.slice(0, 1);
    jobAid.modelInput.deliveredEvidence = jobAid.modelInput.deliveredEvidence.slice(0, 1);
  }
  mutateTask?.(review);
  sync(review);
  const unsealed = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-saved-native-review', operationRef: 'AQ-saved-native-review',
    taskType: 'OPENCLAW_INTERACTIVE_REVIEW', priority: 100, tenantId: 'tenant-control-plane',
    workItemId: review.context.workItem.workItemId, inputRevision: review.inputRevision,
    baseRevision: review.inputRevision, documentVersionId: review.context.workItem.documentVersionId,
    sourceRefs: review.resourceRefs.map(item => ({ ref: item.resourceArtifactRef, sha256: item.resourceArtifactSha256 })),
    allowedConnectors: [], hostResolvedMissingInputs: [], modelInput: review,
    deadline: '2099-01-01T00:00:00Z', idempotencyKey: 'synthetic:saved-native-model-view',
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic model', providerKind: 'BUILT_IN',
      settingsRevision: 1, selectedAt: '2026-10-01T00:00:00Z' } };
  const task = { ...unsealed, inputHash: canonicalSha256(unsealed) };
  const context = structuredClone(review.context);
  mutateContext?.(context);
  const initialTask = structuredClone(task), initialContext = structuredClone(context);
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-saved-native-pipeline-'));
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const calls = [], requests = [], modelInputs = [];
  let validated = 0;
  const stop = new Error('TEST_MODEL_PIPELINE_CAPTURED_BEFORE_COMMIT');
  const output = { answer: '按原保存依据更正条件，执行状态仍未知。', sourceRefs: ['document:page-1'],
    jobAidWorkingDelta: { schemaVersion: 'wiselink.jobaid-problem-work.v3',
      completionReason: '仅对原保存依据作条件性更正。', changeSummary: '保留原依据与限制。',
      issues: [{ issueKey: 'saved-native-review', question: '原措施适用条件是什么？',
        body: `只适用于构型A，尚未确认实施。[[${ordinary ? 'document:page-1' : 'native:saved-1'}]]`,
        riskScenarios: [], measures: [], otherClassifications: [], openQuestions: [], requirementHandling: [] }] } };
  mutateOutput?.(output);
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'begin_review_turn') return { status: 'RUNNING', attemptRef: task.operationRef, task,
      leaseToken: 'synthetic-current-lease', leaseGeneration: 1,
      leaseExpiresAt: '2099-01-01T00:00:00Z' };
    if (name === 'get_review_turn_context') return {
      schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2', attemptRef: task.operationRef,
      reviewConversationRef: review.reviewConversationRef, reviewTurnRef: review.reviewTurnRef,
      mode: 'INTERACTIVE_REVIEW', selectedEvaluationItemId: review.selectedEvaluationItemId,
      inputRevision: review.inputRevision, allowedOperations: review.allowedOperations,
      resourceRefs: review.resourceRefs.map(({ sourceRefId, resourceArtifactRef, resourceArtifactSha256 }) =>
        ({ sourceRefId, resourceArtifactRef, resourceArtifactSha256 })), context, executionPolicy: review.executionPolicy };
    if (name === 'read_source_refs') {
      assert.deepEqual(args.sourceRefIds, ['document:page-1'], 'no native READ handle is created');
      return { schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2', attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map(ref => ({
          ...plain(review.jobAidContext.sourceCatalog.find(item => item.evidenceRef === ref)), sourceRefId: ref })) };
    }
    if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: '2099-01-01T00:00:00Z' };
    assert.fail(`Unexpected business action: ${name}`);
  };
  const requestGateway = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const readFirst = body.tools.every(tool => tool.function.name === 'read_wiselink_review_sources');
    return Response.json({ model: 'synthetic-selected-model', choices: [{ finish_reason: 'tool_calls', message: {
      content: null, tool_calls: [{ id: `synthetic-${requests.length}`, type: 'function', function: {
        name: readFirst ? 'read_wiselink_review_sources' : 'return_wiselink_review_candidate',
        arguments: JSON.stringify(readFirst ? { sourceRefIds: ['document:page-1'] } : output) } }] } }] });
  };
  const runtime = { gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://synthetic.invalid',
    gatewayToken: 'synthetic-only', configuredModelVersion: 'synthetic-selected-model',
    registeredModelRefs: ['miaoda/glm-5.3'] };
  const invokeModel = async (input, driverOptions) => {
    modelInputs.push(structuredClone(input));
    await invokeHostedReviewModel(input, { ...runtime, ...driverOptions,
      validateCandidate: candidate => { driverOptions.validateCandidate(candidate); validated++; } }, { requestGateway });
    throw stop;
  };
  return { task, context, initialTask, initialContext, calls, requests, modelInputs, stop,
    validated: () => validated,
    run: () => runHostedReviewTurn({ workItemId: task.workItemId,
      reviewConversationRef: review.reviewConversationRef, requestId: review.requestId,
      checkpointDir, isolatedCandidate: isolated,
      ...(isolated ? { timeoutMs: 480_000, maxModelRequests: 1, maxCompletionTokens: 8192 } : {}) },
    { callTool, invokeModel, modelRuntime: runtime, requestGateway }) };
}

test('real saved-native normal model pipeline preserves carrier evidence without control-plane fields', async t => {
  const f = await modelPipeline(t);
  await assert.rejects(f.run(), error => error === f.stop);
  assert.equal(f.validated(), 1, 'the original orchestrator candidate validator accepts the inline native citation');
  assert.equal(f.requests.length, 2, 'one actual artifact read round precedes the candidate');
  const assessment = f.modelInputs[0].input.context.problemAssessment;
  assert.equal(Object.hasOwn(assessment, 'tdmsReviewContext'), false);
  const native = assessment.deliveredEvidence.filter(item => item.kind === 'TDMS_NATIVE_RECORD');
  assert.equal(native.length, 2);
  for (const item of native) {
    const expected = structuredClone(f.initialTask.modelInput.jobAidContext.modelInput.deliveredEvidence.find(
      row => row.evidenceRef === item.evidenceRef));
    delete expected.nativeScope.processingSetBinding.scope.tenantId;
    assert.deepEqual(item, expected);
  }
  for (const control of [f.task.modelInput.reviewConversationRef, f.task.modelInput.reviewTurnRef,
    f.task.modelInput.requestId, f.task.actionAttemptId, f.task.operationRef, f.task.workItemId, 'synthetic-current-lease'])
    assert.equal(JSON.stringify(f.requests).includes(control), false, control);
  assert.deepEqual(f.task, f.initialTask);
  assert.deepEqual(f.context, f.initialContext);
  assert.equal(f.calls.filter(call => call.name === 'read_source_refs').length, 1);
  assert.equal(f.calls.some(call => call.name === 'commit_review_turn_candidate'), false);
});

test('real saved-native isolated model pipeline reaches the original final candidate validation', async t => {
  const f = await modelPipeline(t, { isolated: true });
  const result = await f.run();
  assert.equal(result.outcome, 'CANDIDATE_NOT_SAVED');
  assert.match(result.candidate.jobAidWorkingDelta.issues[0].body, /\[\[native:saved-1\]\]/u);
  assert.deepEqual(result.candidate.sourceRefs, ['document:page-1']);
  assert.deepEqual(result.candidate.candidateEvidenceRefs, []);
  assert.equal(f.requests.length, 1);
  const user = f.requests[0].messages.find(message => message.role === 'user');
  const sent = JSON.parse(user.content.slice(user.content.indexOf('\n') + 1));
  const assessment = sent.input.context.problemAssessment;
  assert.equal(Object.hasOwn(assessment, 'tdmsReviewContext'), false);
  for (const carrier of assessment.deliveredEvidence.filter(item => item.kind === 'TDMS_NATIVE_RECORD')) {
    assert.equal(Object.hasOwn(carrier.nativeScope.processingSetBinding.scope, 'tenantId'), false);
    assert.deepEqual(carrier.nativeReadReceipt,
      f.task.modelInput.jobAidContext.sourceCatalog.find(item => item.evidenceRef === carrier.evidenceRef).nativeReadReceipt);
  }
  assert.deepEqual(f.task, f.initialTask);
  assert.deepEqual(f.context, f.initialContext);
  assert.equal(f.calls.filter(call => call.name === 'read_source_refs').length, 1);
  assert.equal(f.calls.some(call => call.name === 'commit_review_turn_candidate'), false);
});

test('real ordinary model pipeline keeps the existing no-addon document path', async t => {
  const f = await modelPipeline(t, { ordinary: true });
  await assert.rejects(f.run(), error => error === f.stop);
  assert.equal(f.validated(), 1);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.task, f.initialTask);
  assert.deepEqual(f.context, f.initialContext);
  assert.equal(f.modelInputs[0].input.context.problemAssessment.deliveredEvidence.length, 0,
    'the existing ordinary document-preview projection remains');
});

function alterCarrier(review, mutate) {
  const jobAid = review.jobAidContext;
  const carrier = jobAid.sourceCatalog[1];
  mutate(carrier);
  jobAid.previousWork.content.evidence[0] = structuredClone(carrier);
  jobAid.modelInput.deliveredEvidence[1] = { ...plain(carrier), nativeSource: structuredClone(carrier.nativeSource),
    nativeScope: structuredClone(carrier.nativeScope), nativeReadReceipt: structuredClone(carrier.nativeReadReceipt) };
}
for (const [label, options, message] of [
  ['context differs from sealed model input', { mutateContext: context => {
    context.problemAssessment.deliveredEvidence[1].excerpt = 'different returned body';
  } }, /^REVIEW_JOBAID_TDMS_MODEL_CONTEXT_DRIFT$/u],
  ['forged context addon on an ordinary task', { ordinary: true, mutateContext: context => {
    context.problemAssessment.tdmsReviewContext = fixture().jobAidContext.tdmsReviewContext;
  } }, /^REVIEW_JOBAID_TDMS_MODEL_CONTEXT_DRIFT$/u],
  ['tenant field outside the exact model carrier scope', { mutateContext: context => {
    context.evaluation.unexpected = { tenantId: 'unexpected-private-tenant' };
  } }, /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN:.*evaluation\.unexpected\.tenantId/u],
  ['tenant field in nativeSource', { mutateTask: review => alterCarrier(review, carrier => {
    carrier.nativeSource.tenantId = 'unexpected-private-tenant';
  }) }, /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN:.*nativeSource\.tenantId/u],
  ['unexpected carrier in model previousWork', { mutateTask: review => {
    review.jobAidContext.modelInput.previousWork.content.evidence = [structuredClone(review.jobAidContext.sourceCatalog[1])];
  } }, /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN:.*previousWork.*tenantId/u],
  ['current request value in an ordinary field', { mutateTask: review => {
    review.jobAidContext.modelInput.availableSources[1].locator = review.requestId;
  } }, /^REVIEW_MODEL_CONTROL_PLANE_VALUE_FORBIDDEN$/u],
  ['current turn masquerading as original receipt task', { mutateTask: review => alterCarrier(review, carrier => {
    carrier.nativeReadReceipt.taskContextRef = review.reviewTurnRef;
  }) }, /^REVIEW_MODEL_CONTROL_PLANE_VALUE_FORBIDDEN$/u],
]) test(`real saved-native model pipeline rejects ${label}`, async t => {
  const f = await modelPipeline(t, options);
  await assert.rejects(f.run(), { message });
  assert.equal(f.modelInputs.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.calls.some(call => ['read_source_refs', 'commit_review_turn_candidate'].includes(call.name)), false);
  assert.deepEqual(f.task, f.initialTask);
  assert.deepEqual(f.context, f.initialContext);
});

test('real saved-native isolated pipeline still rejects native refs in top-level artifact sourceRefs', async t => {
  const f = await modelPipeline(t, { isolated: true, mutateOutput: output => { output.sourceRefs = ['native:saved-1']; } });
  await assert.rejects(f.run(), /REVIEW_MODEL_SOURCE_REF_NOT_READ/u);
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.some(call => call.name === 'commit_review_turn_candidate'), false);
});
