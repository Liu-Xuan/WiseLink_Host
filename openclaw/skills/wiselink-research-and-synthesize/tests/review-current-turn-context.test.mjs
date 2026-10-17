import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeHostedReviewModel } from '../scripts/run-hosted-review-turn.mjs';
import { canonicalJson } from '../scripts/validate-payload.mjs';
import { packet, record } from './fixtures/source-statement-v2-wire.fixture.mjs';
import { SOURCE_CONTENT_SYNTHESIS_GUIDANCE } from '../scripts/jobaid-problem-guidance.mjs';

// Synthetic transport and Host-read callbacks only. No provider, SDK, secrets,
// business mutation or platform access participates in these tests.
const readName = 'read_wiselink_review_sources';
const candidateName = 'return_wiselink_review_candidate';
const options = { gatewayUrl: 'https://fixture.invalid', gatewayToken: 'fixture-only',
  configuredModelVersion: 'fixture/provider', maxModelRequests: 8 };
const nativeSessionKey = 'agent:wiselink-engineering:review:ACTX-RS-current-turn-fixture';
const response = (name, args, id = 'fixture-call') => Response.json({ choices: [{
  message: { content: null, tool_calls: [{ id, type: 'function',
    function: { name, arguments: JSON.stringify(args) } }] },
}] });
const read = (ids) => response(readName, { sourceRefIds: ids });
const candidate = () => response(candidateName, { answer: '保留本轮范围和未知。',
  jobAidWorkingDelta: { issues: [] } });
const sourceReader = async (ids) => ids.map((sourceRefId) => ({ sourceRefId,
  evidenceRef: `evidence:${sourceRefId}`, excerpt: `Actually read ${sourceRefId}.` }));
const feedback = (body) => JSON.parse(body.messages.find((message) => message.role === 'tool').content);
const fullInputs = (body) => body.messages.filter((message) => message.role === 'user' &&
  message.content.includes('\nINPUT:\n')).map((message) =>
  JSON.parse(message.content.slice(message.content.lastIndexOf('\nINPUT:\n') + 8)));
const currentRequest = { engineerRequest: '核对当前条件，只修正 issue-now。',
  purpose: 'UPDATE_ASSESSMENT', selectedEvaluationItemId: 'criterion-now',
  targetClaimId: null, targetIssueKeys: ['issue-now'] };
function legacyInput() {
  return { input: { userMessage: 'Fallback request must not replace engineer text.',
    selectedEvaluationItemId: 'criterion-now', availableSourceRefIds: ['page1', 'page2'],
    attachmentRefs: [], context: { purpose: 'UPDATE_ASSESSMENT',
      engineerInput: { text: currentRequest.engineerRequest },
      issueEditScope: { targetIssueKeys: ['issue-now'] },
      discussion: [{ engineerStatement: 'Selected discussion premise.', candidateOnly: true }],
      problemAssessment: { availableSources: [
        { kind: 'DOCUMENT_PASSAGE', ref: 'page1', title: 'Relevant source', locator: 'page:0' },
        { kind: 'DOCUMENT_PASSAGE', ref: 'page2', title: 'Additional source', locator: 'page:1' },
      ], previousWork: { content: { issues: [
        { issueKey: 'issue-now', question: 'Current question', body: 'Full saved engineering judgment.' },
        { issueKey: 'issue-other', question: 'Other question', body: 'Unaffected saved judgment.' },
      ] } } },
    } } };
}
function v2Input() {
  const input = legacyInput();
  const receipt = packet([record()]);
  Object.assign(input.input.context.problemAssessment, {
    evidenceProjectionVersion: 'SOURCE_CONTEXT_V2', sourceStatements: receipt.sourceStatements,
    activityContexts: receipt.activityContexts, deliveredEvidence: receipt.evidence,
  });
  return input;
}

test('initial source selection waits for an accepted actual read before full Host context', async () => {
  const input = legacyInput();
  const original = JSON.stringify(input);
  let requests = 0;
  let reads = 0;
  const result = await invokeHostedReviewModel(input, { ...options, nativeSessionKey,
    readSourceRefs: async (ids) => { reads++; return sourceReader(ids); } }, {
    requestGateway: async (_url, init) => {
      requests++;
      const body = JSON.parse(init.body);
      if (requests === 1) {
        assert.deepEqual(body.tools.map((tool) => tool.function.name), [readName]);
        assert.match(body.messages[1].content, /CURRENT_HOST_TURN/u);
        assert.match(body.messages[1].content, /Current question/u);
        assert.doesNotMatch(body.messages[1].content, /Full saved engineering judgment|Unaffected saved judgment|Selected discussion premise/u);
        assert.deepEqual(fullInputs(body), []);
        return read(['foreign-source']);
      }
      if (requests === 2) {
        assert.equal(reads, 0);
        assert.equal(feedback(body).sourceReadAccepted, false);
        assert.deepEqual(feedback(body).currentTurnRequest, currentRequest);
        assert.deepEqual(fullInputs(body), []);
        assert.deepEqual(body.tools.map((tool) => tool.function.name), [readName]);
        return read(['page1']);
      }
      assert.equal(reads, 1);
      assert.deepEqual(feedback(body).currentTurnRequest, currentRequest);
      assert.deepEqual(feedback(body).sourceRefs, await sourceReader(['page1']));
      assert.deepEqual(fullInputs(body), [input]);
      assert.ok(body.messages.some(message => message.content?.includes(SOURCE_CONTENT_SYNTHESIS_GUIDANCE)));
      assert.equal(body.messages.at(-1).role, 'user');
      assert.ok(body.tools.some((tool) => tool.function.name === candidateName));
      return candidate();
    },
  });
  assert.equal(result.output.answer, '保留本轮范围和未知。');
  assert.equal(requests, 3);
  assert.equal(JSON.stringify(input), original);
});

test('failed and incomplete Host reads never deliver a full-context successor request', async () => {
  for (const mode of ['failure', 'incomplete']) {
    let requests = 0;
    await assert.rejects(invokeHostedReviewModel(legacyInput(), { ...options,
      readSourceRefs: async () => {
        if (mode === 'failure') throw new Error('HOST_READ_FAILED');
        return [];
      } }, { requestGateway: async (_url, init) => {
      requests++;
      assert.deepEqual(fullInputs(JSON.parse(init.body)), []);
      return read(['page1']);
    } }), mode === 'failure' ? /HOST_READ_FAILED/u : /REVIEW_SOURCE_READBACK_INCOMPLETE/u);
    assert.equal(requests, 1);
  }
});

test('a citation correction that actually reads a source also delivers the deferred full context', async () => {
  const input = legacyInput();
  let requests = 0;
  let validations = 0;
  let reads = 0;
  await invokeHostedReviewModel(input, { ...options, nativeSessionKey,
    readSourceRefs: async (ids) => { reads++; return sourceReader(ids); },
    validateCandidate: async () => {
      if (++validations === 1) throw new Error('REVIEW_MODEL_SOURCE_REF_NOT_READ');
    } }, { requestGateway: async (_url, init) => {
    requests++;
    const body = JSON.parse(init.body);
    if (requests === 1) return response(candidateName, { answer: '待验证的引用。',
      sourceRefs: ['page1'], jobAidWorkingDelta: { issues: [] } });
    assert.equal(reads, 1);
    assert.equal(feedback(body).candidateAccepted, false);
    assert.deepEqual(feedback(body).currentTurnRequest, currentRequest);
    assert.deepEqual(feedback(body).citedSourceFeedback.sourceRefs, await sourceReader(['page1']));
    assert.deepEqual(fullInputs(body), [input]);
    return candidate();
  } });
  assert.equal(requests, 2);
});

for (const native of [false, true]) {
  test(`V2 delivered roots bypass forced initial READ and ${native ? 'native' : 'stateless'} feedback retains the current request`, async () => {
    const input = v2Input();
    const original = JSON.stringify(input);
    let requests = 0;
    let validations = 0;
    let reads = 0;
    await invokeHostedReviewModel(input, { ...options,
      ...(native ? { nativeSessionKey } : {}),
      readSourceRefs: async (ids) => { reads++; return sourceReader(ids); },
      validateCandidate: async () => {
        if (++validations === 1) throw new Error('REVIEW_JOBAID_ISSUE_FULL_CONTENT_REQUIRED');
      } }, { requestGateway: async (_url, init) => {
      requests++;
      const body = JSON.parse(init.body);
      if (!native || requests === 1) {
        assert.deepEqual(fullInputs(body), [input]);
        const assessment = fullInputs(body)[0].input.context.problemAssessment;
        assert.deepEqual(assessment.sourceStatements, input.input.context.problemAssessment.sourceStatements);
        assert.deepEqual(assessment.activityContexts, input.input.context.problemAssessment.activityContexts);
        assert.deepEqual(assessment.deliveredEvidence, input.input.context.problemAssessment.deliveredEvidence);
        assert.equal(assessment.sourceStatements[0].statement.times[1].role, 'UNKNOWN');
        assert.equal(assessment.sourceStatements[0].statement.status.meaning, 'SOURCE_REPORTED_COMPLETED');
      }
      if (requests === 1) {
        assert.equal(body.tool_choice, 'auto');
        assert.ok(body.tools.some((tool) => tool.function.name === candidateName));
        assert.match(body.messages[1].content, /CURRENT_HOST_TURN/u);
        return candidate();
      }
      assert.deepEqual(feedback(body).currentTurnRequest, currentRequest);
      if (native) assert.deepEqual(fullInputs(body), []);
      if (requests === 2) {
        assert.equal(feedback(body).candidateAccepted, false);
        return read(['foreign-source']);
      }
      if (requests === 3) {
        assert.equal(feedback(body).sourceReadAccepted, false);
        assert.equal(reads, 0);
        return read(['page1']);
      }
      assert.equal(reads, 1);
      if (requests === 4) return read(['page1']);
      assert.equal(feedback(body).sourceReadCached, true);
      return candidate();
    } });
    assert.equal(requests, 5);
    assert.equal(reads, 1);
    assert.equal(validations, 2);
    assert.equal(JSON.stringify(input), original);
  });
}

test('native incomplete and post-rejection protocol corrections retain the exact current request', async () => {
  const input = legacyInput();
  let requests = 0;
  let validations = 0;
  await invokeHostedReviewModel(input, { ...options, nativeSessionKey,
    executionModel: { modelRef: 'm3probe/minimax-m3', displayName: 'Fixture model',
      providerKind: 'BUILT_IN', settingsRevision: 2, selectedAt: '2026-09-06T00:00:00Z' },
    registeredModelRefs: ['m3probe/minimax-m3'],
    readSourceRefs: sourceReader, validateCandidate: async () => {
      if (++validations === 1) throw new Error('REVIEW_JOBAID_ISSUE_FULL_CONTENT_REQUIRED');
    } }, { requestGateway: async (_url, init) => {
    requests++;
    const body = JSON.parse(init.body);
    if (requests === 1) return read(['page1']);
    if (requests === 2) return Response.json({ error: {
      message: 'Agent run ended with an incomplete terminal response.',
    } }, { status: 400 });
    if (requests === 3) {
      assert.ok(body.messages.at(-1).content.startsWith(`CURRENT_HOST_TURN:\n${canonicalJson(currentRequest)}\nCORRECTION:\n`));
      return candidate();
    }
    if (requests === 4) return Response.json({ error: {
      message: 'tool_choice=required was not satisfied by the agent response',
    } }, { status: 502 });
    assert.match(body.messages.at(-1).content, /CURRENT_HOST_TURN/u);
    assert.ok(body.messages.at(-1).content.includes(canonicalJson(currentRequest)));
    assert.match(body.messages.at(-1).content, /issue-now/u);
    return candidate();
  } });
  assert.equal(requests, 5);
});

test('blank engineer text falls back to this turn user message on read feedback', async () => {
  const input = v2Input();
  input.input.context.engineerInput.text = '  ';
  input.input.userMessage = '本轮用户消息。';
  let requests = 0;
  await invokeHostedReviewModel(input, { ...options, readSourceRefs: sourceReader }, {
    requestGateway: async (_url, init) => {
      requests++;
      if (requests === 1) return read(['page1']);
      assert.equal(feedback(JSON.parse(init.body)).currentTurnRequest.engineerRequest, '本轮用户消息。');
      return candidate();
    },
  });
  assert.equal(requests, 2);
});
