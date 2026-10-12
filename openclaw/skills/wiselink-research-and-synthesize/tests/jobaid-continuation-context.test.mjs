import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { invokeHostedJobAidProblemModel, JOBAID_GENERATION_POLICY } from '../scripts/run-jobaid-problem-assessment.mjs';
import { createJobAidEvidenceCache, cacheJobAidSourceRead, projectJobAidContinuationContext }
  from '../scripts/jobaid-continuation-context.mjs';
import { assertTdmsNativeReadPacket, sameTdmsNativeEvidenceBody } from '../scripts/tdms-native-context.mjs';

const source = ref => ({ evidenceRef: ref, kind: 'DOCUMENT_PASSAGE', title: ref,
  versionLabel: 'R1', locator: 'p1', excerpt: `Full ${ref}: preserve the exception and the prerequisite.` });
const priorIssue = () => ({ issueKey: 'existing', issueRef: 'WI-fixture:issue:existing',
  question: '当前措施的条件是什么？', body: '完整旧正文及否定、适用条件。'.repeat(600) + ' [[source:1]]',
  riskScenarios: [{ scenario: '条件成立时的风险', conditions: ['仅构型 A'], method: 'JA_AC_R01',
    severity: null, likelihood: null, importantEvent: null, score: null, riskGrade: null,
    gradeMeaning: null, limitations: ['缺少真实暴露频率'], controlComparison: '措施仍待核验' }],
  measures: [{ text: '先核对构型', addresses: '避免不适用的处置', limitations: ['不代表已实施'],
    status: 'PROPOSED', basisRefs: ['source:1'] }],
  otherClassifications: [{ method: 'EO_ATTRIBUTE', value: '条件性建议', reason: '原文有前提', basisRefs: ['source:1'] }],
  openQuestions: [{ question: '构型是否匹配？', affects: '适用性', nextEvidence: '受控构型', reason: '尚未交付' }],
  requirementHandling: [{ methodRef: 'method:risk', requirement: '核对条件', conditions: ['构型匹配'],
    treatment: 'CONDITIONS_UNCONFIRMED', basisRefs: ['source:1'], explanation: '保留条件限制' }],
  sourceDependencies: ['source:1'], premiseRefs: [], legacyCriterionRefs: [] });

function fixture(steps, extra = {}, withPreviousWork = true) {
  const fullIssue = priorIssue();
  const prior = withPreviousWork ? { requestId: 'prior-request', workRevisionRef: 'JAWR-1', workRevision: 1,
    content: { schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: '条件性的工程判断',
      listBrief: '构型待核对，措施尚未实施。', understanding: '适用构型未确认，不主张已经实施。',
      overviewStatus: 'CURRENT', roundCompletion: 'IN_PROGRESS', completionReason: '尚有未完成核对',
      issues: [fullIssue], readSourceRefs: ['source:1'], evidence: [source('source:1')] } } : null;
  const input = { schemaVersion: 'wiselink.jobaid-problem-task.v2', purpose: 'INITIAL_PROBLEM_ASSESSMENT',
    methodBinding: { packRef: 'fixture-method' }, documentOverview: { title: 'Fixture original', sections: [] },
    availableSources: ['source:1', 'source:2'].map(ref => ({ ref, kind: 'DOCUMENT_PASSAGE', title: ref,
      versionLabel: 'R1', locator: 'p1' })),
    deliveredEvidence: [source('source:1')], expectedWorkRevision: prior?.workRevision ?? 0,
    previousWork: structuredClone(prior), capabilities: [] };
  const calls = [], reads = [], saves = [], workReads = [], queriedEvidenceRefs = [];
  const store = new Map(prior ? [[prior.requestId, prior]] : []);
  let latest = prior ?? { workRevision: 0, content: { issues: [], readSourceRefs: [] } };
  const options = { gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1',
    gatewayToken: 'synthetic-only', configuredModelVersion: 'fixture-glm', sessionDiscriminator: 'fixture-owned-attempt',
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3', providerKind: 'BUILT_IN', settingsRevision: 1,
      selectedAt: '2026-10-11T03:37:21.003Z' }, registeredModelRefs: ['miaoda/glm-5.3'],
    heartbeat: async () => {},
    readAssessmentSources: async args => { reads.push(structuredClone(args)); return {
      schemaVersion: 'wiselink.jobaid-source-read.v2', status: 'AVAILABLE', sourceRefs: args.sourceRefs,
      evidence: args.sourceRefs.map(source), scope: args.context, completeRequestedScope: true,
    }; },
    readAssessmentWork: async args => { workReads.push(structuredClone(args)); return {
      schemaVersion: 'wiselink.jobaid-work-read.v2', revision: structuredClone(
        args.requestId ? store.get(args.requestId) ?? null : latest),
    }; },
    saveAssessmentWork: async args => {
      assert.equal(args.expectedWorkRevision, latest.workRevision, 'the exact Host CAS remains authoritative');
      saves.push(structuredClone(args));
      const candidate = JSON.parse(args.workJson);
      const byKey = new Map(latest.content.issues.map(issue => [issue.issueKey, structuredClone(issue)]));
      for (const issue of candidate.issues ?? []) byKey.set(issue.issueKey, structuredClone(issue));
      latest = { requestId: args.requestId, workRevisionRef: `JAWR-${args.expectedWorkRevision + 1}`,
        workRevision: args.expectedWorkRevision + 1, content: { ...structuredClone(latest.content), ...candidate,
          understanding: candidate.overview ?? latest.content.understanding,
          issues: [...byKey.values()], readSourceRefs: [...new Set(['source:1', ...reads.flatMap(r => r.sourceRefs), ...queriedEvidenceRefs])] } };
      store.set(args.requestId, latest);
      return { workRevisionRef: latest.workRevisionRef, workRevision: latest.workRevision,
        roundCompletion: latest.content.roundCompletion };
    }, ...extra };
  const dependencies = { requestGateway: async (_url, request) => {
    calls.push(JSON.parse(request.body));
    const step = steps.shift();
    assert.ok(step, 'the driver must not add an unplanned model round');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null, tool_calls: [{ id: `call-${calls.length}`, type: 'function',
        function: { name: 'return_wiselink_assessment_step', arguments: JSON.stringify({ step }) } }],
    } }], usage: { prompt_tokens: 30, completion_tokens: 40 } }), { status: 200 });
  } };
  return { input, prior, fullIssue, calls, reads, saves, workReads, queriedEvidenceRefs, options, dependencies,
    run: () => invokeHostedJobAidProblemModel({ operation: 'EVALUATE_JOBAID', modelInput: input }, options, dependencies) };
}

const readSources = { action: 'READ_SOURCES', sourceRefs: ['source:1', 'source:2'], purpose: '核对相邻条件', context: 'PAGE' };
const workUpdate = (issues, complete = false, rest = {}) => ({ action: 'SAVE_WORK', workJson: JSON.stringify({
  schemaVersion: 'wiselink.jobaid-problem-work.v3', issues,
  roundCompletion: complete ? 'COMPLETE_WITH_OPEN_QUESTIONS' : 'IN_PROGRESS',
  completionReason: '保留真实构型未知', changeSummary: '按原文进行有限更正', ...rest,
}) });
const newIssue = { issueKey: 'new', question: '新增条件是否成立？', body: '需先核对前提 [[source:2]]', openQuestions: [] };

// Full Native carrier fields from the existing transport/shared schema; no real READ or authority.
function nativePacket(receiptRef, readAt) {
  const sourceVersion = { rawRevision: 'R00', rawIteration: '2', confirmation: 'SOURCE_DECLARED' };
  const state = { rawName: 'Estimated', rawCode: 'Estimated' };
  const observation = { sourceRecordId: 'assessment-1', sourceVersion, state, recordKind: 'ENGINEER_ASSESSMENT',
    objectBinding: 'EXACT_CURRENT_DETAIL', sourceModifiedAt: null, observedAt: '2026-10-01T10:00:00Z',
    identitySelector: '#infoPageIdentityObjectIdentifier',
    stateSelector: '.attributePanel[oid] .attributePanel-label[State] => .attributePanel-value',
    versionSelector: '.attributePanel[oid] .attributePanel-label[Version] => .attributePanel-value' };
  const carrier = { kind: 'TDMS_NATIVE_RECORD', evidenceRef: 'native-exact', title: 'Native exact opinion', versionLabel: 'R00',
    excerpt: 'UNIQUE_NATIVE_BODY: only for configuration A; do not treat the proposal as verified implementation.',
    nativeSource: { recordRef: 'record-1', sourceRevisionRef: 'observation-1', recordKind: 'ENGINEER_ASSESSMENT',
      sourceRecordId: 'assessment-1', sourceKey: 'TDMS', sourceInstanceId: 'fixture-instance', title: 'Native exact opinion',
      fileType: null, sourceVersion, state, authors: [], observedAt: observation.observedAt,
      capturedAt: '2026-10-02T10:00:00Z', coverage: { status: 'PARTIAL', gaps: ['Currentness not connected'], readback: 'CONSISTENT' },
      relatedDocumentVersionIds: [], fieldSelectors: [{ fieldPath: 'content.opinions[0]', selector: 'selector-1' }],
      sourceVerification: 'DECLARED_ONLY', currentness: 'SELECTED_HOST_OBSERVATION' },
    nativeScope: { sourceRevisionRef: 'observation-1', fieldSelectors: [{ fieldPath: 'content.opinions[0]', selector: 'selector-1' }],
      grouping: 'TRANSPARENT_FIELDS', limitations: ['实施仍未知'], processingSetBinding: {
        scope: { tenantId: 'fixture', sourceKey: 'TDMS', sourceInstanceId: 'fixture-instance', scopeId: 'scope-1' },
        setRevisionRef: 'set-1', generation: 2, processingFamilyRef: 'family-1', cohortRef: 'cohort-1',
        processingObservationRef: 'processing-1', memberRef: 'member-1', assessmentObservationRef: 'observation-1' },
      approval: { captureRef: 'capture-1', mode: 'EXACT_VERSION', evidencePath: 'rawFields.opinionCollection',
        approvalSubject: { sourceRecordId: 'assessment-1', sourceVersion }, before: observation, after: observation } },
    nativeReadReceipt: { receiptRef, sourceRevisionRef: 'observation-1', readAt, purpose: 'JOB_AID_NATIVE_RECORD',
      fieldPaths: ['content.opinions[0]'], taskContextRef: 'fixture-owned-attempt', readPerformed: true,
      permissionRevision: 'fixture-permission', engineeringAdoption: 'NOT_CREATED', executionVerified: false } };
  return { schemaVersion: 'wiselink.jobaid-source-read.v2', status: 'AVAILABLE', scope: 'EXACT',
    completeRequestedScope: true, sourceRefs: [carrier.evidenceRef], evidence: [carrier], nativeReadReceipts: [carrier.nativeReadReceipt] };
}

function addNativeDirectory(input, carrier) {
  input.availableSources.push({ ref: carrier.evidenceRef, kind: carrier.kind, title: carrier.title,
    versionLabel: carrier.versionLabel, locator: 'content.opinions[0]' });
  input.tdmsContext = { schemaVersion: 'wiselink.tdms-runtime-context.v1', projection: {
    opinions: [{ evidenceRef: carrier.evidenceRef, scope: carrier.nativeScope.processingSetBinding.scope,
      assessment: { recordRef: carrier.nativeSource.recordRef, sourceRevisionRef: carrier.nativeSource.sourceRevisionRef,
        sourceRecordId: carrier.nativeSource.sourceRecordId, sourceVersion: carrier.nativeSource.sourceVersion, businessVersion: null },
      fieldPath: 'content.opinions[0]', sourceSelector: 'selector-1', author: null, lane: null,
      approval: { captureRef: 'capture-1', evidencePath: 'rawFields.opinionCollection', mode: 'EXACT_VERSION' },
      sourceVerification: 'DECLARED_ONLY', readPerformed: false, engineeringAdoption: 'NOT_CREATED', executionVerified: false }],
    contradictions: [], selectedSetApprovedRefs: [carrier.evidenceRef], historicalCohortApprovedRefs: [], cohorts: [],
    readPerformed: false, interpretation: 'APPROVED_PROFESSIONAL_JUDGMENT_NOT_INFALLIBLE' } };
}

function assertNamedContract(calls) {
  for (const call of calls) {
    assert.deepEqual(call.tool_choice, { type: 'function', function: { name: 'return_wiselink_assessment_step' } });
    assert.equal(call.parallel_tool_calls, false); assert.equal(call.n, 1); assert.equal(call.stream, false);
    assert.equal(call.max_completion_tokens, undefined, 'the frozen GLM output budget is not changed');
  }
}

test('actual read bodies occur once per fresh segment and survive a Host-confirmed save', async () => {
  const f = fixture([readSources, workUpdate([newIssue], true), { action: 'FINISH' }]);
  const original = structuredClone(f.input);
  const result = await f.run();
  assert.equal(result.output.workRevisionRef, 'JAWR-2');
  assert.equal(f.reads.length, 1); assert.equal(f.saves.length, 1);
  for (const request of f.calls.slice(1)) {
    const context = JSON.parse(request.messages[1].content);
    assert.deepEqual(context.deliveredEvidence.map(e => e.evidenceRef), ['source:1', 'source:2']);
    assert.deepEqual(context.deliveredEvidence, [source('source:1'), source('source:2')]);
    for (const ref of ['source:1', 'source:2']) assert.equal(
      JSON.stringify(request.messages).split(source(ref).excerpt).length - 1, 1);
  }
  const savedContext = JSON.parse(f.calls[2].messages[1].content);
  const saveReceipt = JSON.parse(f.calls[2].messages[2].content);
  assert.deepEqual(savedContext.previousWork.content.readSourceRefs, ['source:1', 'source:2']);
  assert.equal(Object.hasOwn(saveReceipt, 'readSourceRefs'), false);
  assert.deepEqual(f.input, original, 'the Host-frozen input and bindings must not be mutated');
  assertNamedContract(f.calls);
});

test('a first assessment with no previous or target work performs READ SAVE and FINISH', async () => {
  const f = fixture([readSources, workUpdate([newIssue], true, {
    headline: '首次条件评估', listBrief: '原文的前提与尚缺构型资料均保留。', overview: '原文条件成立时才适用，构型仍待核对。',
  }), { action: 'FINISH' }], {}, false);
  assert.equal(f.input.previousWork, null);
  const result = await f.run();
  assert.equal(result.output.workRevisionRef, 'JAWR-1');
  assert.equal(f.reads.length, 1); assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].expectedWorkRevision, 0);
  assert.equal(Object.hasOwn(JSON.parse(f.calls[0].messages[1].content), 'targetWork'), false);
  assertNamedContract(f.calls);
});

test('two valid Native READs across SAVE retain one complete body and both exact receipt associations', async () => {
  const packets = [nativePacket('TDMS_READ:fixture-1', '2026-10-03T10:00:00Z'),
    nativePacket('TDMS_READ:fixture-2', '2026-10-03T10:01:00Z')];
  packets.forEach(packet => assertTdmsNativeReadPacket(packet));
  assert.equal(sameTdmsNativeEvidenceBody(packets[0].evidence[0], packets[1].evidence[0]), true);
  const read = { action: 'READ_SOURCES', sourceRefs: ['native-exact'], purpose: '比较真实已批准意见', context: 'EXACT' };
  const issue = key => ({ issueKey: key, question: '该意见的条件是什么？',
    body: '保留原意见的构型条件；提议不代表已经核验实施 [[native-exact]]', openQuestions: [] });
  const f = fixture([read, workUpdate([issue('native-1')]), read,
    workUpdate([issue('native-2')], true), { action: 'FINISH' }]);
  addNativeDirectory(f.input, packets[0].evidence[0]);
  f.options.readAssessmentSources = async args => {
    f.reads.push(structuredClone(args)); return structuredClone(packets[f.reads.length - 1]);
  };
  const result = await f.run();
  assert.equal(result.output.workRevisionRef, 'JAWR-3');
  assert.equal(f.reads.length, 2, 'each explicit source READ still goes to the Host callback');
  assert.equal(f.saves.length, 2);
  const context = JSON.parse(f.calls[3].messages[1].content);
  const bodies = context.deliveredEvidence.filter(item => item.kind === 'TDMS_NATIVE_RECORD');
  assert.equal(bodies.length, 1);
  assert.deepEqual(context.deliveredSourceReads.nativeReadReceipts, packets.map(packet => packet.nativeReadReceipts[0]));
  for (const [index, packet] of packets.entries()) {
    const association = context.deliveredSourceReads.reads[index].nativeEvidenceReceipts;
    assert.deepEqual(association, [{ evidenceRef: 'native-exact', receiptIndex: index }]);
    const originalCarrier = { ...bodies[0], nativeReadReceipt: context.deliveredSourceReads.nativeReadReceipts[association[0].receiptIndex] };
    assert.deepEqual(originalCarrier, packet.evidence[0], 'both complete original carriers are losslessly recoverable');
  }
  assert.equal(JSON.stringify(f.calls[3].messages).split(bodies[0].excerpt).length - 1, 1);
  assertNamedContract(f.calls);
});

test('Native receipt reuse with changed content and changes to source task or permission are rejected', () => {
  const first = nativePacket('TDMS_READ:fixture-1', '2026-10-03T10:00:00Z');
  const cached = cacheJobAidSourceRead(createJobAidEvidenceCache({ deliveredEvidence: [] }), first).cache;
  const mutations = [
    packet => { packet.evidence[0].nativeReadReceipt.receiptRef = 'TDMS_READ:fixture-1'; },
    packet => { packet.evidence[0].nativeReadReceipt.taskContextRef = 'another-attempt'; },
    packet => { packet.evidence[0].nativeReadReceipt.permissionRevision = 'another-permission'; },
    packet => { packet.evidence[0].excerpt += ' A changed condition.'; },
    packet => { packet.evidence[0].nativeSource.sourceInstanceId = 'another-source';
      packet.evidence[0].nativeScope.processingSetBinding.scope.sourceInstanceId = 'another-source'; },
  ];
  for (const change of mutations) {
    const second = nativePacket('TDMS_READ:fixture-2', '2026-10-03T10:01:00Z');
    change(second);
    assertTdmsNativeReadPacket(second);
    assert.throws(() => cacheJobAidSourceRead(cached, second), /INCONSISTENT_CACHED_/);
    assert.deepEqual(cached.nativeReadReceipts, first.nativeReadReceipts);
    assert.deepEqual(cached.evidence, first.evidence, 'a rejected read cannot silently alter cached bytes');
  }
});

for (const [status, hasEvidence] of [['COMPLETED', true], ['FAILED', false], ['UNKNOWN', false],
  ['UNAVAILABLE', false], ['UNKNOWN', true]]) {
  test(`query ${status} evidence=${hasEvidence} retains its exact state provenance and body after SAVE`, async () => {
    const query = '查找明确适用的补充材料';
    const carrier = { evidenceRef: 'query:aily:query-fixture', kind: 'QUERY_RECEIPT',
      title: '按需知识检索回执（原始文档未核实）', versionLabel: null, locator: null,
      excerpt: 'UNIQUE_QUERY_BODY: supplementary lead only; original source and applicability remain unverified.',
      queryProvenance: { origin: 'AILY_RETRIEVAL', queryText: query, status, originalDocumentsVerified: false } };
    const receipt = { queryRef: 'query-fixture', status, error: status === 'COMPLETED' ? null : 'fixture-uncertainty',
      evidence: hasEvidence ? [carrier] : [], candidateOnly: true, originalDocumentsVerified: false };
    const f = fixture([{ action: 'QUERY_KNOWLEDGE', query }, workUpdate([
      { ...newIssue, body: `原文条件保留；检索只是未核实补充线索 [[source:1]]${hasEvidence ? ' [[query:aily:query-fixture]]' : ''}` }], true),
    { action: 'FINISH' }]);
    f.input.knowledgeAccess = { available: true };
    let queries = 0;
    f.options.queryAssessmentKnowledge = async () => {
      queries++; f.queriedEvidenceRefs.push(...receipt.evidence.map(item => item.evidenceRef)); return structuredClone(receipt);
    };
    await f.run();
    assert.equal(queries, 1); assert.equal(f.reads.length, 0); assert.equal(f.saves.length, 1);
    assert.deepEqual(JSON.parse(f.calls[1].messages.at(-1).content), receipt, 'the original current-segment query receipt is not changed');
    const context = JSON.parse(f.calls[2].messages[1].content);
    const cached = context.deliveredSourceReads.reads[0];
    assert.equal(cached.receiptKind, 'KNOWLEDGE_QUERY');
    const { receiptKind, evidenceRefs, ...originalMetadata } = cached;
    assert.deepEqual({ ...originalMetadata, evidence: context.deliveredEvidence.filter(item => evidenceRefs.includes(item.evidenceRef)) }, receipt);
    assert.equal(cached.status, status); assert.equal(cached.originalDocumentsVerified, false);
    assert.equal(context.deliveredEvidence.filter(item => item.kind === 'QUERY_RECEIPT').length, hasEvidence ? 1 : 0);
    if (hasEvidence) {
      assert.deepEqual(context.deliveredEvidence.find(item => item.evidenceRef === carrier.evidenceRef), carrier);
      assert.equal(JSON.stringify(f.calls[2].messages).split(carrier.excerpt).length - 1, 1);
      assert.ok(context.previousWork.content.readSourceRefs.includes(carrier.evidenceRef));
    }
    assertNamedContract(f.calls);
  });
}

test('an abbreviated old issue cannot be saved until its exact complete target and overview are read', async () => {
  const f = fixture([]);
  const { issueRef, sourceDependencies, premiseRefs, legacyCriterionRefs, ...corrected } = structuredClone(f.fullIssue);
  corrected.riskScenarios = corrected.riskScenarios.map(({ score, riskGrade, gradeMeaning, ...risk }) => risk);
  corrected.body += '\n新增原文条件仍有限制 [[source:2]]';
  f.dependencies.requestGateway = async (_url, request) => {
    const n = f.calls.length;
    const steps = [readSources, workUpdate([{ issueKey: 'existing', question: '更正？', body: '不足的摘要 [[source:2]]' }]),
      { action: 'READ_WORK', workRevisionRef: 'JAWR-1', issueKeys: ['existing'], includeOverview: true },
      workUpdate([corrected], true, { overview: '原有构型限制与新增原文条件均保留。' }), { action: 'FINISH' }];
    const payload = JSON.parse(request.body); f.calls.push(payload);
    if (n === 2) {
      const rejection = JSON.parse(payload.messages.at(-1).content);
      assert.equal(rejection.errorCode, 'JOBAID_WORK_BASELINE_READ_REQUIRED');
      assert.deepEqual(rejection.workReadRequired, { workRevisionRef: 'JAWR-1', issueKeys: ['existing'], includeOverview: false });
      assert.equal(f.saves.length, 0, 'no incomplete issue reaches Host SAVE');
    }
    if (n === 3) {
      const full = JSON.parse(payload.messages.at(-1).content);
      assert.deepEqual(full.issues, [f.fullIssue]);
      assert.equal(full.overview, f.prior.content.understanding);
      assert.ok(full.issues[0].body.length > 4000);
      assert.deepEqual(full.issues[0].requirementHandling, f.fullIssue.requirementHandling);
      assert.deepEqual(full.issues[0].openQuestions, f.fullIssue.openQuestions);
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant',
      content: null, tool_calls: [{ id: `call-${n}`, type: 'function', function: {
        name: 'return_wiselink_assessment_step', arguments: JSON.stringify({ step: steps[n] }),
      } }] } }] }), { status: 200 });
  };
  const result = await f.run();
  assert.equal(result.output.workRevisionRef, 'JAWR-2');
  assert.equal(f.reads.length, 1); assert.equal(f.saves.length, 1);
  const actual = JSON.parse(f.saves[0].workJson).issues[0];
  assert.deepEqual(actual, corrected, 'the driver must not invent or fill professional fields');
  assertNamedContract(f.calls);
});

test('a target baseline remains complete when the following source read starts a fresh segment', async () => {
  const f = fixture([{ action: 'READ_WORK', workRevisionRef: 'JAWR-1', issueKeys: ['existing'], includeOverview: true },
    readSources, workUpdate([newIssue], true), { action: 'FINISH' }]);
  await f.run();
  const context = JSON.parse(f.calls[2].messages[1].content);
  assert.deepEqual(context.targetWork.issues, [f.fullIssue]);
  assert.equal(context.targetWork.overview, f.prior.content.understanding);
  assert.equal(f.saves.length, 1);
  assert.equal(Object.hasOwn(JSON.parse(f.calls[3].messages[1].content), 'targetWork'), false,
    'a new work revision must not reuse the old revision baseline');
});

test('an exact target revision mismatch stops before saving or adding another model round', async () => {
  const f = fixture([{ action: 'READ_WORK', workRevisionRef: 'JAWR-1', issueKeys: ['existing'], includeOverview: true }]);
  const read = f.options.readAssessmentWork;
  f.options.readAssessmentWork = async args => {
    const value = await read(args); value.revision.workRevisionRef = 'JAWR-concurrent'; return value;
  };
  await assert.rejects(f.run(), /JOBAID_WORK_REVISION_CONFLICT/);
  assert.equal(f.calls.length, 1); assert.equal(f.saves.length, 0);
});

test('target reading preserves Host source authorization instead of serving a stale local baseline', async () => {
  const f = fixture([{ action: 'READ_WORK', workRevisionRef: 'JAWR-1', issueKeys: ['existing'], includeOverview: true }]);
  let authorizedReads = 0;
  f.options.readAssessmentWork = async () => {
    authorizedReads++;
    throw Object.assign(new Error('Source access revoked'), { hostErrorCode: 'JOBAID_SOURCE_AUTHORIZATION_CHANGED' });
  };
  await assert.rejects(f.run(), /Source access revoked/);
  assert.equal(authorizedReads, 1); assert.equal(f.calls.length, 1); assert.equal(f.saves.length, 0);
});

test('the cache and work-target intent do not allow a second source batch before SAVE', async () => {
  const f = fixture([readSources, readSources, workUpdate([newIssue], true), { action: 'FINISH' }]);
  await f.run();
  assert.equal(f.reads.length, 1); assert.equal(f.saves.length, 1);
  const rejection = JSON.parse(f.calls[2].messages.at(-1).content);
  assert.equal(rejection.errorCode, 'JOBAID_SOURCE_BATCH_SAVE_REQUIRED');
  assertNamedContract(f.calls);
});

test('malformed issue collections still receive the Host shape error rather than a local TypeError', async () => {
  const f = fixture([workUpdate({ malformed: true }), workUpdate([
    { ...newIssue, body: '基于已交付原文保留条件 [[source:1]]' }], true), { action: 'FINISH' }]);
  const save = f.options.saveAssessmentWork;
  let attemptedSaves = 0;
  f.options.saveAssessmentWork = async args => {
    attemptedSaves++;
    if (!Array.isArray(JSON.parse(args.workJson).issues))
      throw Object.assign(new Error('Invalid Host issue collection'), { hostErrorCode: 'JOBAID_ISSUES_INVALID' });
    return save(args);
  };
  await f.run();
  assert.equal(attemptedSaves, 2); assert.equal(f.saves.length, 1);
  assert.equal(JSON.parse(f.calls[1].messages.at(-1).content).errorCode, 'JOBAID_ISSUES_INVALID');
});

test('the complete same-attempt source cache survives checkpoint reentry without another Host source read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobaid-context-fixture-'));
  try {
    const checkpoint = await createCheckpointStore(dir);
    let heartbeats = 0;
    const f = fixture([readSources, workUpdate([newIssue], true), { action: 'FINISH' }], {
      assessmentCheckpoint: checkpoint,
      heartbeat: async () => { if (++heartbeats === 3) throw new Error('Fixture interruption before next model round'); },
    });
    await assert.rejects(f.run(), /Fixture interruption/);
    const state = await checkpoint.readOptional('assessment-state');
    assert.deepEqual(state.evidenceCache.evidence, [source('source:1'), source('source:2')]);
    assert.equal(state.saved.workRevisionRef, 'JAWR-2');
    f.options.heartbeat = async () => {};
    const result = await f.run();
    assert.equal(result.output.workRevisionRef, 'JAWR-2');
    assert.equal(f.reads.length, 1); assert.equal(f.saves.length, 1); assert.equal(f.calls.length, 3);
    assert.deepEqual(JSON.parse(f.calls[2].messages[1].content).deliveredEvidence, state.evidenceCache.evidence);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('cached roots, source statement scope, activity context and read receipts remain complete and isolated', () => {
  const input = { deliveredEvidence: [source('root:1')] };
  const record = { ref: 'statement:1', rootRefs: ['root:1'], requiredContextRootRefs: ['root:2'],
    statement: { negations: ['不得先实施'], conditions: ['构型 A 且条件 B'], times: ['TBD'], scope: { sections: ['full-section'] } } };
  const activity = { runRef: 'DAR-fixture', candidateRevision: 1,
    sourceContext: { sections: [{ sectionId: 'full-section', deliveredUnitIds: ['u1'], contextForSectionIds: ['s2'] }] } };
  const receipt = { status: 'AVAILABLE', scope: 'PAGE', completeRequestedScope: true,
    sourceRefs: ['root:1', 'root:2'], evidence: [source('root:1'), source('root:2')],
    sourceStatements: [record], activityContexts: [activity], nativeReadReceipts: [{ taskContextRef: 'AQ-fixture', receiptRef: 'read-1' }] };
  const original = structuredClone(receipt);
  const first = cacheJobAidSourceRead(createJobAidEvidenceCache(input), receipt);
  const repeated = cacheJobAidSourceRead(first.cache, receipt);
  assert.equal(repeated.cache.evidence.length, 2); assert.equal(repeated.cache.reads.length, 1);
  const view = projectJobAidContinuationContext(input, repeated.cache, null);
  assert.deepEqual(view.deliveredSourceReads.sourceStatements, [record]);
  assert.deepEqual(view.deliveredSourceReads.activityContexts, [activity]);
  assert.deepEqual(view.deliveredSourceReads.nativeReadReceipts, receipt.nativeReadReceipts);
  view.deliveredEvidence[0].excerpt = 'mutated';
  assert.deepEqual(first.cache.evidence[0], source('root:1'));
  assert.deepEqual(receipt, original);
  const unequal = structuredClone(receipt); unequal.evidence[0].excerpt = 'changed condition';
  assert.throws(() => cacheJobAidSourceRead(first.cache, unequal), /INCONSISTENT_CACHED_EVIDENCE/);
});

test('the existing checkpoint policy check refuses a legacy projection before model or Host dispatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobaid-old-context-fixture-'));
  try {
    const checkpoint = await createCheckpointStore(dir);
    const f = fixture([], { assessmentCheckpoint: checkpoint });
    await checkpoint.writeOnce('assessment-enabled', { binding: { operation: 'EVALUATE_JOBAID', modelInput: f.input,
      sessionDiscriminator: f.options.sessionDiscriminator, executionModel: f.options.executionModel },
    startedAt: Date.now(), generationPolicy: JOBAID_GENERATION_POLICY });
    await assert.rejects(f.run(), /JOBAID_CHECKPOINT_POLICY_CHANGED/);
    assert.equal(f.calls.length, 0); assert.equal(f.saves.length, 0); assert.equal(f.reads.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
