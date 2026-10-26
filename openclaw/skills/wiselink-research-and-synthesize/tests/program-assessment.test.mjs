import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { prepareProgramAssessmentMaterials } from '../scripts/program-assessment-materials.mjs';
import { invokeHostedProgramAssessment } from '../scripts/run-program-assessment.mjs';
import { invokeHostedInitialModel } from '../scripts/invoke-hosted-initial-model.mjs';
import { runDynamicEvaluation } from '../scripts/orchestrate-host-mcp.mjs';
import { runHostedInitialStage } from '../scripts/consume-hosted-work-item.mjs';
import { canonicalSha256 } from '../scripts/validate-payload.mjs';
import { JOBAID_WORK_UPDATE_SHAPE } from '../scripts/jobaid-work-shape.mjs';

const binding = { documentVersionId: 'DV-primary', parseRunId: 'PR-current', parseRevision: 3,
  sourceArtifactId: 'artifact-source', sourceSha256: 'a'.repeat(64), sourceByteLength: 300 };
function inputFixture(count = 3, relatedCount = 1) {
  const evidence = Array.from({ length: count }, (_, index) => ({
    evidenceRef: `DOCUMENT_ORIGINAL:DV-primary:PR-current:SR-${index}`, kind: 'DOCUMENT_PASSAGE',
    documentVersionId: 'DV-primary', sourceRefId: `SR-${index}`, title: '原文', versionLabel: 'PR-current',
    locator: JSON.stringify({ parseRunId: 'PR-current', sourceRefId: `SR-${index}`, pageStart: index < 1 ? 2 : 3 }),
    excerpt: index === 0 ? 'Do not install P/N 123-ABC unless' : index === 1
      ? 'the condition in footnote 1 holds; complete within 30 days.' : `Exact body ${index}.`,
  }));
  const fact = Array.from({ length: relatedCount }, (_, index) => ({ evidenceRef: `fact:${index}`, kind: 'HOST_FACT',
    title: '已取得对象事实', versionLabel: 'R3', excerpt: `Exact controlled fact ${index}.` }));
  const method = { evidenceRef: 'method:risk', kind: 'METHOD_CLAUSE', title: '风险定义', versionLabel: 'R1',
    excerpt: 'Unknown lifetime frequency remains unknown; do not invent a score.', classificationDefinitions: [] };
  const directory = [...evidence, ...fact, method,
    { evidenceRef: 'method:unrelated-full-library', kind: 'METHOD_CLAUSE', title: '本轮不需要的完整方法库' }];
  // Production evidence omits top-level identities; the sealed directory owns them.
  const projectedEvidence = evidence.map(({ documentVersionId: _documentVersionId, sourceRefId: _sourceRefId, ...item }) => item);
  return { input: { schemaVersion: 'wiselink.jobaid-problem-task.v2', executionMode: 'PROGRAM_CONTROLLED_V1',
    purpose: 'INITIAL_PROBLEM_ASSESSMENT', methodBinding: { packRef: 'method-pack' },
    availableSources: directory.map(({ evidenceRef, excerpt: _excerpt, ...item }) => ({ ref: evidenceRef, ...item,
      ...(item.kind === 'DOCUMENT_PASSAGE' ? { parseRunId: binding.parseRunId, carrierRangeRef: evidenceRef } : {}) })),
    deliveredEvidence: [...projectedEvidence, method], expectedWorkRevision: 0, previousWork: null,
    documentOverview: { title: 'Conditional equipment installation', original: { binding } },
    programOriginal: { binding, units: evidence.map((item, index) => ({ unitId: `u-${index}`, kind: 'PARAGRAPH',
      moduleId: 'body', order: index, continuityKey: 'installation', sourceRefIds: [item.sourceRefId],
      sourceSegmentIds: [`seg-${index}`], mapping: { originalPage: index < 1 ? 2 : 3 },
      payload: { text: item.excerpt } })),
    sourceLocators: evidence.map((item, index) => ({ sourceRefId: item.sourceRefId,
      pageStart: index < 1 ? 2 : 3, pageEnd: 3, normalizedPath: `body/${index}`, xpath: `/p[${index + 1}]` })),
    coverage: { knownPageCount: 4, readPageIndexes: [2, 3], unresolvedRanges: [] }, findings: [] },
    contextPackage: { primaryDocument: { documentVersionId: 'DV-primary' }, supplementaryMaterials: { status: 'AVAILABLE', items: [] },
      sourceOrigins: directory.map(item => ({ evidenceRef: item.evidenceRef, origin: item.kind })),
      knowledgeRetrieval: { status: 'NOT_CONNECTED', fragments: [] } }, discussion: { currentCorrection: 'Preserve the explicit exception.' } },
    evidence: [...projectedEvidence, ...fact, method], fact };
}
function candidate(input) {
  const ref = input.deliveredEvidence[0].evidenceRef;
  return { schemaVersion: 'wiselink.jobaid-problem-work.v3', headline: '条件安装限制仍须核对',
    listBrief: '条件未确认时不得安装该件，期限与脚注一并保留。',
    overview: `P/N 123-ABC仅在脚注条件成立时可安装；30天期限仍适用，当前条件待核。[[${ref}]]`,
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS', completionReason: '文件分析已完成；实际构型仍待核。',
    changeSummary: '依据本轮完整原文形成条件判断。',
    issues: [{ issueKey: 'install-condition', question: '何时可以安装？', body: `不得忽略条件。[[${ref}]]`,
      riskScenarios: [], measures: [], otherClassifications: [], requirementHandling: [],
      openQuestions: [{ question: '当前条件成立吗？', affects: '安装决定', nextEvidence: '当前构型', reason: '未取得' }] }] };
}
function responseWithWork(work) {
  return new Response(JSON.stringify({ model: 'provider/glm-5.3', choices: [{ finish_reason: 'tool_calls',
    message: { content: null, tool_calls: [{ id: 'result-1', type: 'function', function: {
      name: 'return_wiselink_program_assessment', arguments: JSON.stringify({ workJson: JSON.stringify(work) }),
    } }] } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200 });
}
function withPreviousIssues(f) {
  const issue = candidate(f.input).issues[0];
  const previous = { workRevisionRef: 'JAWR-exact-old', workRevision: 4, content: {
    understanding: '完整旧综合', issues: [{ ...issue, issueKey: 'oldA', body: '准确旧问题 A 正文。' },
      { ...issue, issueKey: 'oldB', body: '准确旧问题 B 正文，不得因只更新 A 而丢失。' }],
  } };
  f.input.expectedWorkRevision = previous.workRevision;
  f.input.previousWork = { ...previous, projectionKind: 'HOST_SAVED_ISSUE_INDEX', omittedIssueBodiesRetainedByHost: true,
    content: { issues: previous.content.issues.map(item => ({ issueKey: item.issueKey, body: '简短预览' })) } };
  const read = f.options.readAssessmentWork;
  f.options.readAssessmentWork = async request => {
    if (!request.workRevisionRef) return read(request);
    f.reads.push(request);
    assert.equal(request.workRevisionRef, previous.workRevisionRef);
    assert.equal(request.requestId, undefined);
    return { revision: previous };
  };
  return previous;
}
function returnWork(f, work) {
  f.dependencies.requestGateway = async (_url, request) => {
    f.calls.push(request);
    return responseWithWork(work);
  };
}
async function fixture(t, count, relatedCount) {
  const root = await mkdtemp(join(tmpdir(), 'wiselink-program-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkpoint = await createCheckpointStore(root);
  const source = inputFixture(count, relatedCount);
  const calls = [], saves = [], reads = [], sourceReads = [], progress = [], store = new Map();
  const options = { gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'private-fixture-token',
    configuredModelVersion: 'synthetic-provider/model', sessionDiscriminator: 'request-new-program',
    taskDeadline: new Date(Date.now() + 120_000).toISOString(), assessmentCheckpoint: checkpoint,
    assessmentBinding: { documentVersionId: binding.documentVersionId, inputRevision: 3 },
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'Host selected GLM', providerKind: 'BUILT_IN',
      settingsRevision: 7, selectedAt: '2026-10-25T00:00:00.000Z' }, registeredModelRefs: ['miaoda/glm-5.3'],
    heartbeat: async () => {}, recordAssessmentProgramProgress: async item => { progress.push(item); return { ...item, recorded: true }; },
    readAssessmentSources: async request => {
      sourceReads.push(request);
      const evidence = source.evidence.filter(item => request.sourceRefs.includes(item.evidenceRef));
      return { status: 'AVAILABLE', scope: 'EXACT', completeRequestedScope: true, sourceRefs: evidence.map(item => item.evidenceRef), evidence };
    },
    saveAssessmentWork: async request => {
      saves.push(request);
      const content = JSON.parse(request.workJson);
      const revision = { requestId: request.requestId, workRevisionRef: 'JAWR-program',
        workRevision: source.input.expectedWorkRevision + 1,
        content: { ...content, understanding: content.overview, overviewStatus: 'CURRENT' } };
      store.set(request.requestId, revision);
      return { requestId: request.requestId, workRevisionRef: revision.workRevisionRef,
        workRevision: revision.workRevision, roundCompletion: content.roundCompletion };
    },
    readAssessmentWork: async request => { reads.push(request); return { revision: store.get(request.requestId) ?? null }; },
  };
  const dependencies = { requestGateway: async (_url, request) => {
    calls.push(request);
    return responseWithWork(candidate(source.input));
  } };
  return { ...source, checkpoint, options, dependencies, calls, saves, reads, sourceReads, progress, store,
    run: () => invokeHostedInitialModel({ operation: 'EVALUATE_JOBAID', modelInput: source.input }, options, dependencies) };
}

test('the actual initial entry uses one serialization-only model call, full input, SAVE and exact independent READ', async t => {
  const f = await fixture(t);
  const result = await f.run();
  assert.equal(result.output.workRevisionRef, 'JAWR-program');
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 1);
  assert.deepEqual(f.reads.map(read => read.requestId), [f.saves[0].requestId, f.saves[0].requestId]);
  assert.equal(f.calls[0].headers['x-openclaw-model'], 'miaoda/glm-5.3');
  const payload = JSON.parse(f.calls[0].body);
  const guide = payload.messages[0].content;
  const deliveredShape = JSON.parse(guide.split('完整字段类型契约：\n')[1].split('\n')[0]);
  assert.deepEqual(deliveredShape, JOBAID_WORK_UPDATE_SHAPE, 'the outgoing field contract is the existing authoritative shape');
  for (const key of ['headline', 'listBrief', 'overview', 'completionReason', 'changeSummary'])
    assert.deepEqual(deliveredShape.properties[key], { type: 'string', minLength: 1 });
  assert.match(guide, /listBrief是一段供列表阅读的摘要文本，不是条目数组/u);
  assert.match(guide, /continuousOriginal\.spans是输入原文.*不是work字段，不得回填到work/u);
  assert.deepEqual(payload.tools.map(tool => tool.function.name), ['return_wiselink_program_assessment']);
  assert.equal(payload.tools[0].function.parameters.properties.action, undefined);
  const material = await f.checkpoint.readOptional('program-materials');
  assert.deepEqual(material.originalInput, f.input);
  assert.deepEqual(JSON.parse(payload.messages[1].content), JSON.parse(JSON.stringify(material.modelInput)));
  assert.deepEqual((await f.checkpoint.readOptional('program-model-input')).body, f.calls[0].body);
  assert.equal(JSON.stringify(await f.checkpoint.readOptional('program-model-input')).includes('private-fixture-token'), false);
  assert.match((await f.checkpoint.readOptional('assessment-round-1.result')).value.raw, /return_wiselink_program_assessment/u);
  assert.deepEqual(f.progress.map(item => item.phase), ['MATERIALS_READY', 'MODEL_RESPONSE_SAVED']);
  assert.equal(f.sourceReads.length, 1);
  assert.deepEqual(f.sourceReads[0].sourceRefs, ['fact:0'], 'full primary is already actually delivered, unrelated methods stay out');
  assert.equal(result.provenance.modelVersion, 'provider/glm-5.3');
});

test('a listBrief array still fails unchanged before SAVE instead of becoming compatible text', async t => {
  const f = await fixture(t), work = candidate(f.input);
  work.listBrief = ['第一段私有摘要。', '第二段私有摘要。'];
  const original = structuredClone(work);
  returnWork(f, work);
  await assert.rejects(f.run(), error => error.terminalAssessmentFailure?.errorCode === 'JOBAID_WORK_JSON_INVALID');
  assert.deepEqual(await f.checkpoint.readOptional('program-work-rejection'), {
    code: 'PROGRAM_WORK_SHAPE', category: 'WORK_SHAPE', violations: [
      { path: 'work.listBrief', reason: 'FIELD_TYPE_OR_VALUE', expected: 'non-empty string', received: 'array' },
    ],
  });
  const response = JSON.parse((await f.checkpoint.readOptional('assessment-round-1.result')).value.raw);
  assert.deepEqual(JSON.parse(JSON.parse(response.choices[0].message.tool_calls[0].function.arguments).workJson), original);
  assert.equal(await f.checkpoint.readOptional('program-work-candidate'), null);
  assert.equal(f.saves.length, 0);
  assert.equal(f.reads.length, 0);
  assert.equal(f.calls.length, 1);
});

test('program response diagnostics describe the actual HTTP result and declared function channel', async t => {
  const f = await fixture(t), observed = [];
  f.options.observeModelOutput = async value => observed.push(value);
  await f.run();
  assert.equal(observed.length, 1);
  const shape = observed[0].responseShape;
  assert.deepEqual(shape.http, { status: 200, ok: true });
  assert.equal(shape.routing.requestedModel, JSON.parse(f.calls[0].body).model);
  assert.equal(shape.routing.reportedModel, 'provider/glm-5.3');
  assert.equal(shape.choiceCount, 1);
  assert.equal(shape.outputChannel, 'FUNCTION_ARGUMENTS');
  assert.equal(shape.toolCall.nameMatched, true);
  assert.equal(shape.toolCall.strictJsonObjectAccepted, true);
  assert.equal(f.saves.length, 1);
});

test('work shape rejection identifies nested fields without echoing or changing authored content', async t => {
  const f = await fixture(t), work = candidate(f.input);
  const privateText = 'private authored measure that must remain only in the complete response';
  work.issues[0].measures = [{ text: privateText, addresses: [privateText], limitations: [],
    status: 'PROPOSED', basisRefs: [] }];
  returnWork(f, work);
  const original = structuredClone(work);
  await assert.rejects(f.run(), error => error.terminalAssessmentFailure?.errorCode === 'JOBAID_WORK_JSON_INVALID');
  const rejection = await f.checkpoint.readOptional('program-work-rejection');
  assert.deepEqual(rejection, { code: 'PROGRAM_WORK_SHAPE', category: 'WORK_SHAPE', violations: [
    { path: 'work.issues[0].measures[0].addresses', reason: 'FIELD_TYPE_OR_VALUE',
      expected: 'non-empty string', received: 'array' },
  ] });
  assert.equal(JSON.stringify(rejection).includes(privateText), false);
  const response = JSON.parse((await f.checkpoint.readOptional('assessment-round-1.result')).value.raw);
  assert.deepEqual(JSON.parse(JSON.parse(response.choices[0].message.tool_calls[0].function.arguments).workJson), original);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 0);
  assert.equal(f.reads.length, 0);
});

test('program-specific shape requirements retain rejection and identify the unmet path', async t => {
  const cases = [
    ['schema', work => { delete work.schemaVersion; }, 'work.schemaVersion', 'SCHEMA_VERSION'],
    ['incomplete round', work => { work.roundCompletion = 'IN_PROGRESS'; }, 'work.roundCompletion', 'ROUND_COMPLETION'],
    ['missing overview', work => { delete work.overview; }, 'work.overview', 'REQUIRED_TEXT'],
    ['missing issues', work => { delete work.issues; }, 'work.issues', 'ISSUES_ARRAY'],
    ['empty update', work => { work.issues = []; }, 'work', 'EMPTY_ISSUE_UPDATE'],
    ['undeclared field', work => { work.issues[0].references = ['private source text']; },
      'work.[undeclared field]', 'UNDECLARED_FIELD'],
  ];
  for (const [name, mutate, path, reason] of cases) await t.test(name, async subtest => {
    const f = await fixture(subtest), work = candidate(f.input);
    mutate(work);
    returnWork(f, work);
    await assert.rejects(f.run(), error => error.terminalAssessmentFailure?.errorCode === 'JOBAID_WORK_JSON_INVALID');
    const rejection = await f.checkpoint.readOptional('program-work-rejection');
    assert.equal(rejection.code, 'PROGRAM_WORK_SHAPE');
    assert.equal(rejection.category, 'WORK_SHAPE');
    assert.ok(rejection.violations.some(item => item.path === path && item.reason === reason));
    assert.equal(JSON.stringify(rejection).includes('private source text'), false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.saves.length, 0);
    assert.equal(f.reads.length, 0);
  });
});

test('undeclared field diagnostics never retain private text or dots from the authored key', async t => {
  const f = await fixture(t), work = candidate(f.input);
  const privateKey = 'private clinical-looking body.with.dotted.key';
  const privateValue = 'private field value';
  work.issues[0][privateKey] = privateValue;
  returnWork(f, work);
  await assert.rejects(f.run(), error => error.terminalAssessmentFailure?.errorCode === 'JOBAID_WORK_JSON_INVALID');
  const rejection = await f.checkpoint.readOptional('program-work-rejection');
  assert.deepEqual(rejection, { code: 'PROGRAM_WORK_SHAPE', category: 'WORK_SHAPE', violations: [
    { path: 'work.[undeclared field]', reason: 'UNDECLARED_FIELD',
      expected: 'declared work-update field', received: 'undeclared field' },
  ] });
  const diagnostic = JSON.stringify(rejection);
  assert.equal(diagnostic.includes(privateKey), false);
  assert.equal(diagnostic.includes('private clinical-looking body'), false);
  assert.equal(diagnostic.includes(privateValue), false);
  assert.equal(f.saves.length, 0);
  assert.equal(f.reads.length, 0);
});

test('argument shape and JSON parse failures remain distinct without exposing rejected values', async t => {
  const cases = [
    ['extra argument', work => JSON.stringify({ workJson: JSON.stringify(work), extra: 'private argument text' }),
      'PROGRAM_WORK_SHAPE', 'ARGUMENT_SHAPE', 'arguments'],
    ['object workJson', work => JSON.stringify({ workJson: work }),
      'PROGRAM_WORK_SHAPE', 'ARGUMENT_SHAPE', 'arguments.workJson'],
    ['outer parse', () => '{"workJson":', 'JOBAID_WORK_JSON_INVALID', 'JSON_PARSE', 'arguments'],
    ['inner parse', () => JSON.stringify({ workJson: '{"overview":' }),
      'JOBAID_WORK_JSON_INVALID', 'JSON_PARSE', 'arguments.workJson'],
  ];
  for (const [name, argumentsFor, code, category, path] of cases) await t.test(name, async subtest => {
    const f = await fixture(subtest);
    const payload = await responseWithWork(candidate(f.input)).json();
    payload.choices[0].message.tool_calls[0].function.arguments = argumentsFor(candidate(f.input));
    f.dependencies.requestGateway = async (_url, request) => { f.calls.push(request); return Response.json(payload); };
    await assert.rejects(f.run(), error => error.terminalAssessmentFailure?.errorCode === 'JOBAID_WORK_JSON_INVALID');
    const rejection = await f.checkpoint.readOptional('program-work-rejection');
    assert.equal(rejection.code, code);
    assert.equal(rejection.category, category);
    assert.ok(rejection.path === path || rejection.violations?.some(item => item.path === path));
    assert.equal(JSON.stringify(rejection).includes('private argument text'), false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.saves.length, 0);
    assert.equal(f.reads.length, 0);
  });
});

test('MATERIALS_READY registers both exact durable checkpoints before dispatch without gateway credentials', async t => {
  const f = await fixture(t);
  const record = f.options.recordAssessmentProgramProgress;
  let registered = false;
  f.options.recordAssessmentProgramProgress = async item => {
    if (item.phase === 'MATERIALS_READY') {
      const materials = await f.checkpoint.readOptional('program-materials');
      const modelRequest = await f.checkpoint.readOptional('program-model-input');
      assert.ok(materials);
      assert.ok(modelRequest);
      assert.deepEqual(JSON.parse(item.materialSnapshotJson), { materials, modelRequest });
      assert.equal(item.materialSnapshotJson.includes('private-fixture-token'), false);
      assert.equal(modelRequest.headers, undefined);
      assert.equal(f.calls.length, 0);
      assert.equal(await f.checkpoint.readOptional('assessment-round-1.started'), null);
      registered = true;
    } else assert.equal(item.materialSnapshotJson, undefined);
    return record(item);
  };
  const gateway = f.dependencies.requestGateway;
  f.dependencies.requestGateway = async (...args) => {
    assert.equal(registered, true);
    assert.equal((await f.checkpoint.readOptional('program-model-input')).body, args[1].body);
    return gateway(...args);
  };
  await f.run();
  const snapshot = JSON.parse(f.progress[0].materialSnapshotJson);
  assert.equal(snapshot.modelRequest.body, f.calls[0].body);
  assert.deepEqual(JSON.parse(JSON.parse(snapshot.modelRequest.body).messages[1].content), snapshot.materials.modelInput);
});

test('material registration failure leaves the exact request durable and blocks dispatch until registered', async t => {
  const f = await fixture(t);
  const record = f.options.recordAssessmentProgramProgress;
  let rejectedSnapshot;
  f.options.recordAssessmentProgramProgress = async item => {
    rejectedSnapshot = item.materialSnapshotJson;
    throw new Error('MATERIAL_REGISTRATION_FAILED');
  };
  await assert.rejects(f.run(), /MATERIAL_REGISTRATION_FAILED/u);
  const modelRequest = await f.checkpoint.readOptional('program-model-input');
  assert.deepEqual(JSON.parse(rejectedSnapshot), {
    materials: await f.checkpoint.readOptional('program-materials'), modelRequest,
  });
  assert.equal(f.calls.length, 0);
  assert.equal(f.saves.length, 0);
  assert.equal(await f.checkpoint.readOptional('program-progress-MATERIALS_READY'), null);
  assert.equal(await f.checkpoint.readOptional('assessment-round-1.started'), null);
  f.options.recordAssessmentProgramProgress = record;
  await f.run();
  assert.equal(f.progress[0].materialSnapshotJson, rejectedSnapshot);
  assert.equal(f.calls[0].body, modelRequest.body);
  assert.equal(f.calls.length, 1);
});

test('130 original units retain a page 3→4 sentence, structured table/units and negated footnote with exact mapping', async t => {
  const f = await fixture(t, 130, 0);
  f.input.programOriginal.units[2].kind = 'TABLE';
  f.input.programOriginal.units[2].payload = { caption: 'Installation limits', rows: [
    [{ text: 'Part number' }, { text: 'Pressure (kPa)' }], [{ text: '123-ABC' }, { text: '12' }],
  ], footnotes: ['1: Do not install unless condition X holds; complete within 30 days.'] };
  const original = structuredClone(f.input.programOriginal);
  const material = await prepareProgramAssessmentMaterials(f.input, f.options);
  const view = material.modelInput.continuousOriginal;
  assert.equal(view.spans.length, 130);
  assert.match(view.content, /Do not install P\/N 123-ABC unless\nthe condition in footnote 1 holds/u);
  assert.match(view.content, /Pressure \(kPa\)/u);
  assert.match(view.content, /Do not install unless condition X holds; complete within 30 days/u);
  assert.match(view.content, /Exact body 129/u);
  for (const span of view.spans) {
    const unit = original.units.find(item => item.unitId === span.unitId);
    const body = view.content.slice(span.start, span.end);
    assert.deepEqual(span.sourceRefIds, unit.sourceRefIds);
    assert.deepEqual(span.evidenceRefs, unit.sourceRefIds.map(ref => `DOCUMENT_ORIGINAL:DV-primary:PR-current:${ref}`));
    assert.deepEqual(span.encoding === 'TEXT' ? { text: body } : JSON.parse(body), unit.payload);
  }
  assert.deepEqual(view.binding, binding);
  assert.deepEqual(view.sourceLocators, original.sourceLocators);
  assert.equal(view.sourceLocators[0].pageStart, 2);
  assert.equal(view.sourceLocators[0].pageEnd, 3);
  assert.deepEqual(f.input.programOriginal, original);
});

test('originals read in multiple Host batches bind projected bodies through the sealed identity directory', async t => {
  const f = await fixture(t, 130, 0);
  f.input.deliveredEvidence = f.input.deliveredEvidence.filter(item => item.kind === 'METHOD_CLAUSE');
  const material = await prepareProgramAssessmentMaterials(f.input, f.options);
  assert.deepEqual(f.sourceReads.map(read => read.sourceRefs.length), [96, 34]);
  assert.equal(material.modelInput.continuousOriginal.evidence.length, 130);
  assert.equal(material.modelInput.continuousOriginal.spans.every(span => span.evidenceRefs.length === 1), true);
  assert.equal(material.sourceReads.every(packet => packet.evidence.every(item => !Object.hasOwn(item, 'documentVersionId'))), true);
  assert.equal(f.calls.length, 0);
});

test('conflicting directory, carrier or delivered identities cannot dispatch a program model', async t => {
  for (const mutate of [
    f => { f.input.availableSources[0].documentVersionId = 'DV-other'; },
    f => { f.input.availableSources[0].parseRunId = 'PR-other'; },
    f => { f.input.availableSources[0].sourceRefId = 'SR-other'; },
    f => { f.input.availableSources[0].carrierRangeRef = 'DOCUMENT_ORIGINAL:DV-other:PR-current:SR-0'; },
    f => { f.input.deliveredEvidence[0].versionLabel = 'PR-other'; },
    f => { f.input.deliveredEvidence[0].sourceRefId = 'SR-other'; },
    f => { f.input.deliveredEvidence[0].locator = JSON.stringify({ parseRunId: 'PR-other', sourceRefId: 'SR-0' }); },
  ]) {
    const f = await fixture(t);
    mutate(f);
    await assert.rejects(f.run(), /PROGRAM_ASSESSMENT_MATERIALS_ORIGINAL_EVIDENCE_MISMATCH/u);
    assert.equal(f.calls.length, 0);
    assert.equal(f.saves.length, 0);
    assert.equal(await f.checkpoint.readOptional('assessment-round-1.started'), null);
  }
});

test('bounded source API batches 97 acquired facts without truncation and journals complete packets', async t => {
  const f = await fixture(t, 3, 97);
  const material = await prepareProgramAssessmentMaterials(f.input, f.options);
  assert.deepEqual(f.sourceReads.map(read => read.sourceRefs.length), [96, 1]);
  assert.equal(material.modelInput.objectAndCompanyFacts.evidence.length, 97);
  assert.equal(material.sourceReads.length, 2);
  assert.deepEqual(await f.checkpoint.readOptional('program-source-read-2'), material.sourceReads[1]);
  await prepareProgramAssessmentMaterials(f.input, f.options);
  assert.equal(f.sourceReads.length, 2, 'complete bounded reads are reused only under the same bound material preparation');
});

test('foreign parse binding, missing locators and incomplete read cannot become a whole-document input', async t => {
  for (const mutate of [
    f => { f.input.programOriginal.binding = { ...binding, parseRunId: 'PR-foreign' }; },
    f => { f.input.programOriginal.sourceLocators = []; },
    f => { f.options.readAssessmentSources = async () => ({ status: 'AVAILABLE', scope: 'EXACT', completeRequestedScope: true, sourceRefs: ['fact:0'], evidence: [] }); },
  ]) {
    const f = await fixture(t);
    mutate(f);
    await assert.rejects(f.run(), /PROGRAM_ASSESSMENT_MATERIALS_/u);
    assert.equal(f.calls.length, 0);
    assert.equal(f.saves.length, 0);
  }
});

test('a complete response followed by SAVE failure resumes that exact work without generating again', async t => {
  const f = await fixture(t);
  const save = f.options.saveAssessmentWork;
  let failed = false;
  f.options.saveAssessmentWork = async request => { if (!failed) { failed = true; throw new Error('SAVE_UNAVAILABLE'); } return save(request); };
  await assert.rejects(f.run(), /SAVE_UNAVAILABLE/u);
  const request = await f.checkpoint.readOptional('program-save-request');
  const raw = (await f.checkpoint.readOptional('assessment-round-1.result')).value.raw;
  assert.equal((await f.run()).output.workRevisionRef, 'JAWR-program');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.saves[0], request);
  assert.equal((await f.checkpoint.readOptional('assessment-round-1.result')).value.raw, raw);
});

test('lost SAVE ACK is recovered by the original request READ without a duplicate SAVE', async t => {
  const f = await fixture(t);
  const save = f.options.saveAssessmentWork;
  f.options.saveAssessmentWork = async request => { await save(request); throw new Error('ACK_LOST'); };
  assert.equal((await f.run()).output.workRevisionRef, 'JAWR-program');
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 1);
  assert.deepEqual(f.reads.map(read => read.requestId), [f.saves[0].requestId, f.saves[0].requestId]);
  await f.run();
  assert.equal(f.saves.length, 1);
});

test('a lost generated-progress observation resumes the recorded raw response and never repeats the model', async t => {
  const f = await fixture(t);
  const progress = f.options.recordAssessmentProgramProgress;
  let failed = false;
  f.options.recordAssessmentProgramProgress = async item => {
    if (item.phase === 'MODEL_RESPONSE_SAVED' && !failed) { failed = true; throw new Error('PROGRESS_ACK_LOST'); }
    return progress(item);
  };
  await assert.rejects(f.run(), /PROGRESS_ACK_LOST/u);
  assert.ok(await f.checkpoint.readOptional('assessment-round-1.result'));
  assert.equal(f.saves.length, 0);
  assert.equal((await f.run()).output.workRevisionRef, 'JAWR-program');
  assert.equal(f.calls.length, 1);
});

test('UNKNOWN transport keeps the exact started request fenced and cannot replay a model', async t => {
  const f = await fixture(t);
  f.dependencies.requestGateway = async () => { f.calls.push('one-dispatch'); throw new Error('TRANSPORT_UNKNOWN'); };
  await assert.rejects(f.run(), /TRANSPORT_UNKNOWN/u);
  await assert.rejects(f.run(), /PROGRAM_ASSESSMENT_MODEL_OUTCOME_UNKNOWN/u);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 0);
  assert.equal((await f.checkpoint.readOptional('program-transport-observation')).outcome, 'UNKNOWN');
});

function codexLengthFixture(f, mutate = () => {}) {
  const runRoot = join(tmpdir(), 'synthetic-program-codex-runs');
  Object.assign(f.options, { modelExecutor: 'CODEX',
    codexOptions: { codexBinary: '/offline/codex', configPath: '/offline/config', runRoot },
    assessmentBinding: { attemptRef: 'AQ-program', actionAttemptId: 'ATT-program', workItemId: 'WI-program',
      documentVersionId: binding.documentVersionId, inputRevision: 3, baseRevision: 3 } });
  let dispatches = 0;
  f.dependencies.requestGateway = async (_endpoint, request) => {
    f.calls.push(request);
    if (!request.codexRecovery.recoverOnly) dispatches++;
    const runDirectory = join(runRoot, 'generation-original-request');
    await request.codexRecovery.onRunPrepared({ runRoot, runDirectory,
      requestId: request.codexRecovery.requestId, bindingSha256: 'c'.repeat(64), promptSha256: 'd'.repeat(64) });
    // The gateway's own tests validate the durable receipt/audit. This fixture
    // supplies that narrow typed boundary to the actual program consumer.
    const failure = { code: 'JOBAID_MODEL_OUTPUT_LENGTH', requestId: request.codexRecovery.requestId,
      runDirectory, transportSummaryRef: join(runDirectory, 'transport-summary.json'),
      modelVersion: 'glm-5.3', inputTokens: 120, outputTokens: 16384, durationMs: 95000 };
    const error = Object.assign(new Error('CODEX_GENERATION_INCOMPLETE'), { codexTerminalFailure: failure });
    await mutate(error, request);
    throw error;
  };
  return { dispatches: () => dispatches };
}

test('verified Codex length failure reaches the existing terminal failure without response, SAVE or regeneration', async t => {
  const f = await fixture(t), codex = codexLengthFixture(f);
  for (let repeat = 0; repeat < 2; repeat++) await assert.rejects(f.run(), error => {
    assert.equal(error.terminalAssessmentFailure?.errorCode, 'JOBAID_MODEL_OUTPUT_LENGTH');
    assert.equal(error.terminalAssessmentFailure.provenance.modelVersion, 'glm-5.3');
    assert.deepEqual(error.terminalAssessmentFailure.provenance.runMetrics,
      { durationMs: 95000, inputUnits: 120, outputUnits: 16384 });
    return true;
  });
  assert.equal(codex.dispatches(), 1);
  assert.equal(f.calls[1].codexRecovery.recoverOnly, true);
  assert.equal(f.saves.length, 0);
  assert.equal(f.reads.length, 0);
  assert.equal(await f.checkpoint.readOptional('assessment-round-1.result'), null);
  assert.deepEqual(f.progress.map(item => item.phase), ['MATERIALS_READY']);
});

test('unverified or incorrectly bound Codex incomplete errors remain UNKNOWN and cannot settle a pending budget', async t => {
  for (const mutate of [
    error => { delete error.codexTerminalFailure; },
    error => { error.codexTerminalFailure.requestId = 'program:AQ-foreign:round-1'; },
    error => { error.codexTerminalFailure.runDirectory += '-foreign'; },
    error => { error.codexTerminalFailure.transportSummaryRef += '-foreign'; },
    error => { error.codexTerminalFailure.modelVersion = 'configured-route:glm-5.3'; },
    error => { error.codexTerminalFailure.outputTokens = -1; },
  ]) {
    const f = await fixture(t), codex = codexLengthFixture(f, mutate);
    let settled = 0;
    f.options.reconcileProgramModelRequest = async verify => { await verify(); settled++; };
    await assert.rejects(f.run(), error => {
      assert.equal(error.message, 'CODEX_GENERATION_INCOMPLETE');
      assert.equal(error.terminalAssessmentFailure, undefined);
      return true;
    });
    assert.equal(settled, 0);
    assert.equal(codex.dispatches(), 1);
    assert.equal(f.saves.length, 0);
    assert.equal((await f.checkpoint.readOptional('program-transport-observation')).outcome, 'UNKNOWN');
    assert.equal(await f.checkpoint.readOptional('assessment-round-1.result'), null);
  }
});

test('raw-response persistence is required before any SAVE and a write failure cannot permit redispatch', async t => {
  const f = await fixture(t);
  const write = f.checkpoint.writeOnce;
  f.checkpoint.writeOnce = async (key, value) => { if (key === 'assessment-round-1.result') throw new Error('DISK_UNAVAILABLE'); return write(key, value); };
  await assert.rejects(f.run(), /DISK_UNAVAILABLE/u);
  assert.equal(f.saves.length, 0);
  await assert.rejects(f.run(), /PROGRAM_ASSESSMENT_MODEL_OUTCOME_UNKNOWN/u);
  assert.equal(f.calls.length, 1);
});

test('a completed invalid function response is retained as known failure without READ/SAVE workflow freedom', async t => {
  const f = await fixture(t);
  f.dependencies.requestGateway = async () => new Response(JSON.stringify({ model: 'provider/glm-5.3', choices: [{
    finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ type: 'function', function: {
      name: 'return_wiselink_assessment_step', arguments: JSON.stringify({ step: { action: 'READ_SOURCES' } }),
    } }] },
  }] }), { status: 200 });
  await assert.rejects(f.run(), error => {
    assert.equal(error.terminalAssessmentFailure.errorCode, 'JOBAID_INCOMPLETE_TERMINAL_RESPONSE'); return true;
  });
  assert.equal(f.saves.length, 0);
  assert.match((await f.checkpoint.readOptional('assessment-round-1.result')).value.raw, /READ_SOURCES/u);
});

test('the explicit execution mode never broadens to another operation or an old autonomous checkpoint', async t => {
  const f = await fixture(t);
  await assert.rejects(invokeHostedProgramAssessment({ operation: 'SYNTHESIZE_OVERALL', modelInput: f.input }, f.options), /CAPABILITY_REQUIRED/u);
  await f.checkpoint.writeOnce('assessment-enabled', { version: 1, generationPolicy: { loopPolicyVersion: 'stage-protocol-progress-v1' } });
  await assert.rejects(f.run(), /CHECKPOINT_BINDING_MISMATCH/u);
  assert.equal(f.calls.length, 0);
  const changed = { ...f.input, executionMode: 'UNKNOWN_MODE' };
  await assert.rejects(invokeHostedInitialModel({ operation: 'EVALUATE_JOBAID', modelInput: changed }, f.options), /EXECUTION_MODE_UNSUPPORTED/u);
});

test('a compact previous-work index is replaced only by an exact full revision READ, never latest', async t => {
  const f = await fixture(t);
  f.input.expectedWorkRevision = 4;
  f.input.previousWork = { workRevisionRef: 'JAWR-exact-old', workRevision: 4,
    projectionKind: 'HOST_SAVED_ISSUE_INDEX', omittedIssueBodiesRetainedByHost: true,
    content: { issues: [{ issueKey: 'old', body: 'Short 4000-byte preview.' }] } };
  const full = { workRevisionRef: 'JAWR-exact-old', workRevision: 4, content: {
    understanding: 'Exact previous overview', issues: [{ issueKey: 'old', body: 'FULL-OLD-BODY '.repeat(700) }],
  } };
  f.options.readAssessmentWork = async request => {
    f.reads.push(request);
    assert.deepEqual(request, { workRevisionRef: 'JAWR-exact-old' });
    return { revision: full };
  };
  const materials = await prepareProgramAssessmentMaterials(f.input, f.options);
  assert.equal(materials.modelInput.previousUnderstandingAndChanges.previousWork.content.issues[0].body, full.content.issues[0].body);
  assert.deepEqual(await f.checkpoint.readOptional('program-previous-work-read'), { revision: full });
  assert.deepEqual(f.reads, [{ workRevisionRef: 'JAWR-exact-old' }]);
  const other = await fixture(t);
  other.input.previousWork = f.input.previousWork;
  other.options.readAssessmentWork = async () => ({ revision: { ...full, workRevisionRef: 'JAWR-latest-unrelated' } });
  await assert.rejects(other.run(), /PREVIOUS_WORK_READ_MISMATCH/u);
  assert.equal(other.calls.length, 0);
});

test('a program result updating only oldA cannot complete while exact previous oldB is unaccounted for', async t => {
  const f = await fixture(t), previous = withPreviousIssues(f);
  const work = candidate(f.input);
  work.issues[0].issueKey = 'oldA';
  returnWork(f, work);
  const rejected = error => {
    assert.equal(error.message, 'JOBAID_PROGRAM_PREVIOUS_ISSUE_COVERAGE_REQUIRED');
    assert.equal(error.terminalAssessmentFailure.errorCode, 'JOBAID_WORK_VALIDATION_FAILED');
    return true;
  };
  await assert.rejects(f.run(), rejected);
  const modelRequest = JSON.parse(f.calls[0].body);
  assert.deepEqual(JSON.parse(modelRequest.messages[1].content).previousUnderstandingAndChanges.previousWork, previous);
  assert.match(modelRequest.messages[0].content, /unchangedIssueKeys/u);
  assert.match(modelRequest.messages[0].content, /retiredIssues/u);
  assert.deepEqual(await f.checkpoint.readOptional('program-work-rejection'), {
    code: 'JOBAID_PROGRAM_PREVIOUS_ISSUE_COVERAGE_REQUIRED', missingIssueKeys: ['oldB'],
  });
  const raw = (await f.checkpoint.readOptional('assessment-round-1.result')).value.raw;
  assert.equal(await f.checkpoint.readOptional('program-work-candidate'), null);
  assert.equal(await f.checkpoint.readOptional('program-save-request'), null);
  assert.deepEqual(f.progress.map(item => item.phase), ['MATERIALS_READY']);
  assert.equal(f.saves.length, 0);
  await assert.rejects(f.run(), rejected);
  assert.equal(f.calls.length, 1, 'resuming a rejected completed response never regenerates');
  assert.equal((await f.checkpoint.readOptional('assessment-round-1.result')).value.raw, raw);
  assert.equal(f.saves.length, 0);
});

test('oldB may remain unchanged or retire with a reason while only oldA sends an updated body', async t => {
  for (const disposition of ['unchanged', 'retired']) {
    const f = await fixture(t), previous = withPreviousIssues(f);
    const work = candidate(f.input);
    work.issues[0].issueKey = 'oldA';
    if (disposition === 'unchanged') work.unchangedIssueKeys = ['oldB'];
    else work.retiredIssues = [{ issueKey: 'oldB', reason: '准确旧问题已由本轮另一问题完整承接。' }];
    returnWork(f, work);
    assert.equal((await f.run()).output.workRevisionRef, 'JAWR-program');
    assert.equal(f.calls.length, 1);
    assert.equal(f.saves.length, 1);
    const saved = JSON.parse(f.saves[0].workJson);
    assert.deepEqual(saved.issues.map(issue => issue.issueKey), ['oldA']);
    assert.equal(f.saves[0].workJson.includes(previous.content.issues[1].body), false);
    assert.deepEqual(f.progress.map(item => item.phase), ['MATERIALS_READY', 'MODEL_RESPONSE_SAVED']);
  }
});

test('all old issues can be explicitly unchanged without resending any issue body', async t => {
  const f = await fixture(t);
  withPreviousIssues(f);
  const work = { ...candidate(f.input), issues: [], unchangedIssueKeys: ['oldA', 'oldB'] };
  returnWork(f, work);
  assert.equal((await f.run()).output.workRevisionRef, 'JAWR-program');
  assert.deepEqual(JSON.parse(f.saves[0].workJson).issues, []);
  assert.equal(f.calls.length, 1);
});

test('HTTP errors, invalid JSON and invalid candidates do not report an available generated engineering work', async t => {
  for (const response of [new Response('{"error":"upstream"}', { status: 400 }),
    new Response('{"choices":', { status: 200 }),
    Response.json({ model: 'provider/glm', choices: [{ finish_reason: 'stop', message: { content: 'unfinished prose' } }] }),
  ]) {
    const f = await fixture(t);
    f.dependencies.requestGateway = async () => response;
    await assert.rejects(f.run());
    assert.deepEqual(f.progress.map(item => item.phase), ['MATERIALS_READY']);
    assert.ok((await f.checkpoint.readOptional('assessment-round-1.result')).value.raw);
    assert.equal(f.saves.length, 0);
  }
});

test('Host JOBAID technical SAVE errors retain the response for the same request recovery', async t => {
  const f = await fixture(t);
  const save = f.options.saveAssessmentWork;
  const technical = Object.assign(new Error('JOBAID_WORK_SAVE_READBACK_MISSING'), {
    receivedHostToolError: true, hostErrorCode: 'JOBAID_WORK_SAVE_READBACK_MISSING',
  });
  f.options.saveAssessmentWork = async () => { throw technical; };
  await assert.rejects(f.run(), error => error === technical && error.terminalAssessmentFailure === undefined);
  f.options.saveAssessmentWork = save;
  assert.equal((await f.run()).output.workRevisionRef, 'JAWR-program');
  assert.equal(f.calls.length, 1);
});

test('a lost heartbeat during generation preserves the full response and prevents SAVE under the lost lease', async t => {
  const f = await fixture(t);
  let tick;
  f.dependencies.setInterval = callback => { tick = callback; return 'timer'; };
  f.dependencies.clearInterval = timer => assert.equal(timer, 'timer');
  const gateway = f.dependencies.requestGateway;
  f.dependencies.requestGateway = async (...args) => {
    f.options.heartbeat = async () => { throw new Error('LEASE_REVOKED'); };
    // The invocation captured its callback, as it captured its sealed model.
    tick();
    return gateway(...args);
  };
  let heartbeatCalls = 0;
  f.options.heartbeat = async () => { if (++heartbeatCalls >= 3) throw new Error('LEASE_REVOKED'); };
  await assert.rejects(f.run(), /LEASE_REVOKED/u);
  assert.ok((await f.checkpoint.readOptional('assessment-round-1.result')).value.raw);
  assert.equal(f.saves.length, 0);
  assert.equal(f.calls.length, 1);
});

test('missing program capability stops explicitly before any model and never falls back to autonomous steps', async t => {
  const f = await fixture(t);
  f.options.recordAssessmentProgramProgress = async () => { throw new Error('HOST_TOOL_NOT_AVAILABLE:record_assessment_program_progress'); };
  await assert.rejects(f.run(), /HOST_TOOL_NOT_AVAILABLE/u);
  assert.equal(f.calls.length, 0);
  assert.equal(f.saves.length, 0);
  assert.equal(await f.checkpoint.readOptional('assessment-round-1.started'), null);
});

test('the Host model/settings snapshot survives callback mutation and local budget refusal is not provider UNKNOWN', async t => {
  const f = await fixture(t);
  const read = f.options.readAssessmentSources;
  f.options.readAssessmentSources = async request => {
    f.options.executionModel.modelRef = 'untrusted/replacement';
    f.options.executionModel.settingsRevision++;
    return read(request);
  };
  await f.run();
  assert.equal(f.calls[0].headers['x-openclaw-model'], 'miaoda/glm-5.3');
  assert.equal((await f.checkpoint.readOptional('program-model-input')).executionModel.settingsRevision, 7);
  const refused = await fixture(t);
  refused.options.runModelRequest = async () => { throw new Error('JOBAID_RUN_LIMIT_REACHED:modelRequests'); };
  await assert.rejects(refused.run(), /JOBAID_RUN_LIMIT_REACHED/u);
  assert.equal(await refused.checkpoint.readOptional('assessment-round-1.started'), null);
  assert.equal(refused.calls.length, 0);
});

function hostFixture(f) {
  let done = false, failed = false, sealedResult = null, committing = false;
  const tools = [];
  const unsealed = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-program', operationRef: 'AQ-program', taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    priority: 100, tenantId: 'tenant-local-only', workItemId: 'WI-program', inputRevision: 3, baseRevision: 3,
    documentVersionId: binding.documentVersionId, sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [],
    modelInput: { executionMode: 'PROGRAM_CONTROLLED_V1', modelInput: f.input },
    executionModel: f.options.executionModel, deadline: f.options.taskDeadline, idempotencyKey: 'program-explicit-new-request' };
  const task = { ...unsealed, inputHash: canonicalSha256(unsealed) };
  const initial = () => ({ entry: { workItemId: 'WI-program' },
    ...(done && !failed ? { integratedAssessmentSummary: projection() } : {}), initialAnalysis: {
    workItemRevision: done && !failed ? 4 : 3, documentVersionId: binding.documentVersionId, candidateOnly: true,
    status: failed ? 'FAILED' : done ? 'SUCCEEDED' : 'REQUIRED', nextOperation: done ? null : 'EVALUATE_JOBAID',
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: failed ? 'FAILED' : done ? 'SUCCEEDED' : 'PENDING', requestId: 'request-new-program' },
      overall: { status: done && !failed ? 'SUCCEEDED' : 'PENDING' } },
  } });
  const claim = () => ({ status: committing ? 'COMMITTING' : 'RUNNING', task, modelInput: f.input,
    attemptRef: task.operationRef, leaseToken: '12345678-1234-4123-8123-123456789abc', leaseGeneration: 1,
    leaseExpiresAt: f.options.taskDeadline, ...(committing ? { recoveryResult: sealedResult } : {}) });
  const projection = () => ({ workItemId: task.workItemId, workItemRevision: 4, status: 'OVERALL_CANDIDATE_READY',
    baseRules: { workRevisionRef: 'JAWR-program' }, overallSynthesis: { status: 'CANDIDATE_ONLY',
      executionKind: 'DETERMINISTIC_PROJECTION', modelRequests: 0, basedOnJobAidWorkRevisionRef: 'JAWR-program',
      sourceAssessment: { actionAttemptId: task.actionAttemptId, workRevisionRef: 'JAWR-program', workRevision: 1,
        saveRequestId: f.saves[0].requestId, readObservedAt: new Date().toISOString() } } });
  let failProjection = false;
  const callTool = async (name, args) => {
    tools.push({ name, args });
    if (name === 'get_parse_status') return initial();
    if (name === 'get_deep_link') return { workItemId: task.workItemId };
    if (name === 'begin_dynamic_evaluation') return claim();
    if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: f.options.taskDeadline };
    if (name === 'read_assessment_work') {
      if (Object.hasOwn(args, 'workRevisionRef')) {
        assert.equal(args.leaseToken, claim().leaseToken);
        return f.options.readAssessmentWork(args);
      }
      if (Object.hasOwn(args, 'requestId') && !committing) {
        assert.equal(args.leaseToken, claim().leaseToken);
        assert.equal(args.leaseGeneration, 1);
      } else {
        assert.equal(args.leaseToken, undefined);
        assert.equal(args.leaseGeneration, undefined);
      }
      f.reads.push(args);
      const requestId = args.requestId ?? f.saves.at(-1)?.requestId;
      const saved = f.store.get(requestId);
      return { schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: task.actionAttemptId,
        inputWorkRevision: f.input.expectedWorkRevision, executionStatus: committing ? 'COMMITTING' : 'RUNNING',
        revision: saved ? { ...structuredClone(saved), actionAttemptId: task.actionAttemptId,
          workItemId: task.workItemId, documentVersionId: task.documentVersionId,
          basedOnWorkItemRevision: task.baseRevision } : null };
    }
    if (['read_assessment_sources', 'save_assessment_work', 'record_assessment_program_progress'].includes(name)) {
      assert.equal(args.leaseToken, claim().leaseToken);
      assert.equal(args.leaseGeneration, 1);
      if (name === 'read_assessment_sources') return f.options.readAssessmentSources(args);
      if (name === 'save_assessment_work') return f.options.saveAssessmentWork(args);
      return f.options.recordAssessmentProgramProgress(args);
    }
    if (name === 'commit_dynamic_evaluation_candidate') {
      if (sealedResult) assert.deepEqual(args.result, sealedResult, 'projection recovery replays only the exact sealed result');
      sealedResult = args.result;
      if (args.result.status === 'FAILED') {
        failed = true;
        done = true;
        return { status: 'FAILED', attemptRef: task.operationRef,
          terminalReason: args.result.errorCode, projectionApplied: false };
      }
      if (failProjection) { committing = true; throw new Error('PROJECTION_INTERRUPTED'); }
      done = true; return projection();
    }
    if (name === 'get_action_attempt_status') return { attemptRef: task.operationRef, taskType: task.taskType,
      status: 'COMMITTING', recoveryAvailable: true, projectionApplied: false, commitStartedAt: new Date().toISOString(),
      terminalReason: null, resultContentHash: sealedResult.contentHash, recoveryResult: sealedResult };
    assert.fail(`unplanned program tool ${name}`);
  };
  return { task, initial, callTool, tools, fail: value => { failProjection = value; } };
}

test('actual consumer→orchestrator→program runner reaches deterministic Overall and normal stage completion', async t => {
  const f = await fixture(t), host = hostFixture(f);
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-program-entry-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const result = await runHostedInitialStage({ workItemId: host.task.workItemId,
    checkpointRoot, operation: 'EVALUATE_JOBAID',
    initial: host.initial().initialAnalysis }, {
    callTool: host.callTool,
    invokeInitialModel: (input, hooks) => invokeHostedInitialModel(input, { ...f.options, ...hooks }, f.dependencies),
  });
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(result.stageStatus, 'SUCCEEDED');
  assert.equal(result.nextOperation, null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 1);
  const materials = host.tools.find(item => item.name === 'record_assessment_program_progress' && item.args.phase === 'MATERIALS_READY');
  assert.equal(JSON.parse(materials.args.materialSnapshotJson).modelRequest.body, f.calls[0].body);
  assert.equal(host.tools.filter(item => item.name === 'commit_dynamic_evaluation_candidate').length, 1);
  assert.equal(host.tools.some(item => item.name === 'begin_overall_synthesis'), false);
});

test('actual bounded consumer commits verified Codex length as FAILED with count one and no SAVE or work READ', async t => {
  const f = await fixture(t), codex = codexLengthFixture(f), host = hostFixture(f);
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-program-known-length-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const result = await runHostedInitialStage({ workItemId: host.task.workItemId, modelExecutor: 'CODEX',
    checkpointRoot, operation: 'EVALUATE_JOBAID', initial: host.initial().initialAnalysis,
    initialStageOnly: true, maxInitialStages: 1, expectedInitialOperation: 'EVALUATE_JOBAID',
    jobAidRunLimits: { modelRequests: 1, saves: 1, finishes: 1 } }, {
    callTool: host.callTool,
    invokeInitialModel: (input, hooks) => invokeHostedInitialModel(input, { ...f.options, ...hooks }, f.dependencies),
  });
  assert.equal(result.stageStatus, 'FAILED');
  assert.equal(result.errorCode, 'JOBAID_MODEL_OUTPUT_LENGTH');
  assert.equal(codex.dispatches(), 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 0);
  assert.equal(f.reads.length, 0);
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 1, saves: 0, finishes: 1 });
  assert.equal(result.jobAidRunBudget.pendingOutcome, null);
  const commits = host.tools.filter(item => item.name === 'commit_dynamic_evaluation_candidate');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].args.result.status, 'FAILED');
  assert.equal(commits[0].args.result.businessOutcome, 'NOT_PRODUCED');
  assert.equal(commits[0].args.result.modelOutput, null);
  assert.equal(commits[0].args.result.errorCode, 'JOBAID_MODEL_OUTPUT_LENGTH');
  assert.deepEqual(commits[0].args.result.factsConsidered, []);
  assert.equal(host.tools.some(item => ['save_assessment_work', 'read_assessment_work', 'begin_overall_synthesis'].includes(item.name)), false);
});

test('verified length cannot settle a model budget whose original reservation ordinal changed', async t => {
  const f = await fixture(t);
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-program-length-budget-fence-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const budget = await createCheckpointStore(join(checkpointRoot, 'WI-program/initial/EVALUATE_JOBAID'));
  const codex = codexLengthFixture(f, async () => {
    await budget.write('jobaid-run-budget-modelRequests-1', { kind: 'modelRequests', ordinal: 2 });
  });
  const host = hostFixture(f);
  const result = await runHostedInitialStage({ workItemId: host.task.workItemId, modelExecutor: 'CODEX',
    checkpointRoot, operation: 'EVALUATE_JOBAID', initial: host.initial().initialAnalysis,
    initialStageOnly: true, maxInitialStages: 1, expectedInitialOperation: 'EVALUATE_JOBAID',
    jobAidRunLimits: { modelRequests: 1, saves: 1, finishes: 1 } }, {
    callTool: host.callTool,
    invokeInitialModel: (input, hooks) => invokeHostedInitialModel(input, { ...f.options, ...hooks }, f.dependencies),
  });
  assert.equal(result.attemptStatus, 'UNKNOWN');
  assert.equal(result.errorCode, 'JOBAID_PROGRAM_MODEL_BUDGET_RECOVERY_INVALID');
  assert.equal(result.jobAidRunBudget.pendingOutcome, 'modelRequests');
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 1, saves: 0, finishes: 0 });
  assert.equal(codex.dispatches(), 1);
  assert.equal(host.tools.some(item => item.name === 'commit_dynamic_evaluation_candidate'), false);
  assert.equal(f.saves.length, 0);
});

test('a received FAILED commit must name the exact terminal reason and never causes another commit', async t => {
  const f = await fixture(t);
  codexLengthFixture(f);
  const host = hostFixture(f);
  await assert.rejects(runDynamicEvaluation({ workItemId: host.task.workItemId,
    callTool: async (name, args) => {
      const value = await host.callTool(name, args);
      return name === 'commit_dynamic_evaluation_candidate'
        ? { ...value, terminalReason: 'DIFFERENT_FAILURE', errorCode: args.result.errorCode } : value;
    }, evaluateDynamicRules: (modelInput, hooks) => invokeHostedInitialModel(
      { operation: 'EVALUATE_JOBAID', modelInput }, { ...f.options, ...hooks }, f.dependencies),
  }), /HOST_MCP_FAILED_ASSESSMENT_COMMIT_INVALID/u);
  assert.equal(host.tools.filter(item => item.name === 'commit_dynamic_evaluation_candidate').length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 0);
});

test('actual orchestrator commits missing old-issue coverage as a known work-validation failure', async t => {
  const f = await fixture(t);
  withPreviousIssues(f);
  const work = candidate(f.input);
  work.issues[0].issueKey = 'oldA';
  returnWork(f, work);
  const host = hostFixture(f);
  const result = await runDynamicEvaluation({ workItemId: host.task.workItemId, callTool: host.callTool,
    evaluateDynamicRules: (modelInput, hooks) => invokeHostedInitialModel({ operation: 'EVALUATE_JOBAID', modelInput },
      { ...f.options, ...hooks }, f.dependencies) });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'FAILED');
  assert.equal(result.errorCode, 'JOBAID_WORK_VALIDATION_FAILED');
  assert.equal(result.committed.status, 'FAILED');
  assert.equal(result.after.initialAnalysis.stages.jobAid.status, 'FAILED');
  const commits = host.tools.filter(item => item.name === 'commit_dynamic_evaluation_candidate');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].args.result.status, 'FAILED');
  assert.equal(commits[0].args.result.errorCode, 'JOBAID_WORK_VALIDATION_FAILED');
  assert.equal(commits[0].args.result.modelOutput, null);
  assert.equal(commits[0].args.result.businessOutcome, 'NOT_PRODUCED');
  assert.deepEqual(commits[0].args.result.factsConsidered, []);
  assert.equal(host.tools.some(item => item.name === 'get_action_attempt_status'), false);
  assert.deepEqual(await f.checkpoint.readOptional('program-work-rejection'), {
    code: 'JOBAID_PROGRAM_PREVIOUS_ISSUE_COVERAGE_REQUIRED', missingIssueKeys: ['oldB'],
  });
  assert.ok((await f.checkpoint.readOptional('assessment-round-1.result')).value.raw);
  assert.deepEqual(f.progress.map(item => item.phase), ['MATERIALS_READY']);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 0);
});

test('COMMITTING Overall failure resumes only deterministic projection with the exact result and saved work', async t => {
  const f = await fixture(t), host = hostFixture(f);
  const invoke = () => runDynamicEvaluation({ workItemId: host.task.workItemId, callTool: host.callTool,
    evaluateDynamicRules: (modelInput, hooks) => invokeHostedInitialModel({ operation: 'EVALUATE_JOBAID', modelInput },
      { ...f.options, ...hooks }, f.dependencies) });
  host.fail(true);
  assert.equal((await invoke()).outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  host.fail(false);
  const result = await invoke();
  assert.equal(result.outcome, 'COMMITTING_REPLAYED');
  assert.equal(result.committed.overallSynthesis.sourceAssessment.workRevisionRef, 'JAWR-program');
  assert.equal(f.calls.length, 1);
  assert.equal(f.saves.length, 1);
  assert.equal(f.reads.length, 6, 'two original SAVE reads plus normal and COMMITTING latest/exact inspections');
});
