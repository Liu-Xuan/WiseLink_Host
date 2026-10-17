import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { invokeHostedReviewModel, runHostedReviewTurn } from '../scripts/run-hosted-review-turn.mjs';
import { canonicalSha256, validateReviewCandidate, validateResultEnvelope,
  WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION, WISELINK_SKILL_VERSION } from '../scripts/validate-payload.mjs';
import { consumePendingReviewTurn } from '../scripts/consume-hosted-review-turn.mjs';
import { runInteractiveReviewTurn } from '../scripts/orchestrate-host-mcp.mjs';

const options = {
  workItemId: 'WI-1',
  checkpointRoot: '/tmp/review-consumer-test',
};
const next = {
  reviewConversationRef: 'RC-1',
  reviewTurnRef: 'RT-2',
  requestId: 'request-2',
  turnNo: 2,
};

test('idle and busy ticks make no driver/model calls', async () => {
  for (const busy of [false, true]) {
    const result = await consumePendingReviewTurn(options, {
      callTool: async (name, args) => {
        assert.equal(name, 'get_pending_review_turn');
        assert.deepEqual(args, { workItemId: 'WI-1' });
        return { busy, next: null };
      },
      runTurn: () => assert.fail('Driver must not run'),
      invokeModel: () => assert.fail('Model must not run'),
    });
    assert.equal(result.status, busy ? 'BUSY' : 'IDLE');
  }
});

test('one tick dispatches exactly the persisted next turn with its own checkpoint', async () => {
  let runs = 0;
  const result = await consumePendingReviewTurn(options, {
    callTool: async () => ({ busy: false, next }),
    runTurn: async (input) => {
      runs += 1;
      assert.deepEqual(input, {
        workItemId: 'WI-1',
        reviewConversationRef: 'RC-1',
        requestId: 'request-2',
        checkpointDir: '/tmp/review-consumer-test/RT-2',
      });
      return { ok: true };
    },
  });
  assert.equal(runs, 1);
  assert.equal(result.status, 'CANDIDATE_SAVED');
});

test('dynamic Review BEGIN carries the exact WorkItem outside the model', async () => {
  const seen = [];
  await assert.rejects(runInteractiveReviewTurn({
    mode: 'INTERACTIVE_REVIEW', workItemId: 'WI-1',
    reviewConversationRef: 'RC-1', requestId: 'request-2',
    callTool: async (name, args) => {
      seen.push({ name, args });
      throw new Error('TEST_STOP_BEFORE_MODEL');
    },
    respond: async () => assert.fail('model must not be called'),
  }), /TEST_STOP_BEFORE_MODEL/u);
  assert.deepEqual(seen, [{ name: 'begin_review_turn', args: {
    reviewConversationRef: 'RC-1', requestId: 'request-2', workItemId: 'WI-1',
  } }]);
});

test('pre-commit failure stops the exact attempt; an uncertain commit is never cancelled', async () => {
  for (const commitStarted of [false, true]) {
    const calls = [];
    const run = consumePendingReviewTurn(options, {
        callTool: async (name, args) => {
          calls.push({ name, args });
          if (name === 'get_pending_review_turn') return { busy: false, next };
          if (name === 'begin_review_turn')
            return { status: 'RUNNING', attemptRef: 'AQ-2' };
          if (name === 'commit_review_turn_candidate')
            throw new Error('REVIEW_COMMIT_OUTCOME_UNKNOWN');
          return { status: 'CANCELLED', attemptRef: 'AQ-2' };
        },
        runTurn: async (_input, dependencies) => {
          await dependencies.callTool('begin_review_turn', {});
          if (commitStarted)
            await dependencies.callTool('commit_review_turn_candidate', {});
          throw new Error('REVIEW_MODEL_OUTPUT_INVALID');
        },
      });
    if (commitStarted) await assert.rejects(run, /REVIEW_COMMIT_OUTCOME_UNKNOWN/u);
    else assert.deepEqual(await run, {
      status: 'REQUIRES_ATTENTION', reviewTurnRef: 'RT-2', attemptRef: 'AQ-2',
      errorCode: 'REVIEW_MODEL_OUTPUT_INVALID', attemptStatus: 'CANCELLED', candidateOnly: true,
    });
    const cancel = calls.find(({ name }) => name === 'cancel_action_attempt');
    if (commitStarted) assert.equal(cancel, undefined);
    else assert.equal(cancel.args.attemptRef, 'AQ-2');
  }
});

test('unconfirmed or wrong-attempt cancellation remains a consumer error', async () => {
  for (const stopped of [{ status: 'CANCELLED', attemptRef: 'AQ-other' }, { status: 'RUNNING', attemptRef: 'AQ-2' }]) {
    await assert.rejects(consumePendingReviewTurn(options, {
      callTool: async (name) => name === 'get_pending_review_turn' ? { busy: false, next }
        : name === 'begin_review_turn' ? { status: 'RUNNING', attemptRef: 'AQ-2' } : stopped,
      runTurn: async (_options, { callTool }) => {
        await callTool('begin_review_turn', {});
        throw new Error('REVIEW_MODEL_INVALID');
      },
    }), /ATTEMPT_STOP_FAILED:HOSTED_REVIEW_STOP_NOT_CONFIRMED/u);
  }
});

test('a definite Host validation rejection and exact unprepared readback end only the failed attempt', async () => {
  const calls = [];
  const result = await rejectedCommit(calls);
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.errorCode, 'JOBAID_IMPORTANT_EVENT_CATEGORY');
  assert.equal(result.attemptStatus, 'CANCELLED');
  assert.deepEqual(calls.map(({ name }) => name), [
    'get_pending_review_turn', 'begin_review_turn', 'commit_review_turn_candidate', 'cancel_action_attempt',
  ]);
  assert.deepEqual(calls.at(-1).args, {
    attemptRef: 'AQ-2', workItemId: 'WI-1',
    reason: 'HOSTED_REVIEW_EXECUTION_FAILED:JOBAID_IMPORTANT_EVENT_CATEGORY',
  });
});

test('one Review turn binds attempt-scoped calls to the selected WorkItem', async () => {
  const calls = [];
  const result = await consumePendingReviewTurn(options, {
    callTool: async (name, args) => {
      calls.push({ name, args });
      return name === 'get_pending_review_turn' ? { busy: false, next } : { ok: true };
    },
    runTurn: async (_input, { callTool }) => {
      for (const name of ['begin_review_turn', 'get_review_turn_context', 'read_source_refs',
        'query_review_aily', 'get_action_attempt_status', 'heartbeat_action_attempt',
        'commit_review_turn_candidate']) {
        await callTool(name, { attemptRef: 'AQ-2' });
      }
      return { ok: true };
    },
  });
  assert.equal(result.status, 'CANDIDATE_SAVED');
  assert.deepEqual(calls[1], { name: 'begin_review_turn', args: { attemptRef: 'AQ-2' } });
  for (const { name, args } of calls.slice(2)) {
    assert.equal(args.workItemId, 'WI-1', name);
  }
});

test('uncertain, mismatched, prepared and terminal commit outcomes never authorize cancellation', async () => {
  for (const overrides of [
    { receivedHostToolError: false }, { hostErrorCode: null },
    { code: 'HOST_MCP_COMMIT_READBACK_FAILED' }, { readback: null },
    { readback: { attemptRef: 'AQ-other' } }, { readback: { taskType: 'OTHER' } },
    { readback: { status: 'COMMITTING' } }, { readback: { status: 'SUCCEEDED' } },
    { readback: { commitStartedAt: '2026-09-09T08:33:09Z' } },
    { readback: { resultContentHash: 'sealed' } },
    { readback: { projectionApplied: true } }, { readback: { recoveryAvailable: true } },
  ]) {
    const calls = [];
    await assert.rejects(rejectedCommit(calls, overrides), /HOST_MCP_COMMIT/u);
    assert.equal(calls.some(({ name }) => name === 'cancel_action_attempt'), false);
    assert.equal(calls.filter(({ name }) => name === 'commit_review_turn_candidate').length, 1);
  }
});

test('a race across the Host commit cutoff remains an error without replay', async () => {
  const calls = [];
  await assert.rejects(rejectedCommit(calls, { cancelError: 'ACTION_ATTEMPT_COMMIT_CUTOFF' }),
    /JOBAID_IMPORTANT_EVENT_CATEGORY;ATTEMPT_STOP_FAILED:ACTION_ATTEMPT_COMMIT_CUTOFF/u);
  assert.equal(calls.filter(({ name }) => name === 'cancel_action_attempt').length, 1);
  assert.equal(calls.filter(({ name }) => name === 'commit_review_turn_candidate').length, 1);
});

function rejectedCommit(calls, overrides = {}) {
  return consumePendingReviewTurn(options, {
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_pending_review_turn') return { busy: false, next };
      if (name === 'begin_review_turn') return { status: 'RUNNING', attemptRef: 'AQ-2' };
      if (name === 'commit_review_turn_candidate') throw Object.assign(new Error('HOST_REJECTED'), {
        receivedHostToolError: overrides.receivedHostToolError ?? true,
        hostErrorCode: 'hostErrorCode' in overrides ? overrides.hostErrorCode : 'JOBAID_IMPORTANT_EVENT_CATEGORY',
      });
      if (overrides.cancelError) throw new Error(overrides.cancelError);
      return { status: 'CANCELLED', attemptRef: 'AQ-2' };
    },
    runTurn: async (_input, { callTool }) => {
      await callTool('begin_review_turn', {});
      try {
        await callTool('commit_review_turn_candidate', {});
      } catch {
        // Same exact-identity readback and error contract as the orchestrator.
        throw Object.assign(new Error('HOST_MCP_COMMIT_OUTCOME_UNKNOWN'), {
          code: overrides.code ?? 'HOST_MCP_COMMIT_OUTCOME_UNKNOWN',
          readback: overrides.readback === null ? null : {
            attemptRef: 'AQ-2', taskType: 'OPENCLAW_INTERACTIVE_REVIEW', status: 'RUNNING',
            commitStartedAt: null, resultContentHash: null,
            recoveryAvailable: false, projectionApplied: false, ...overrides.readback,
          },
        });
      }
    },
  });
}

// Protocol doubles only. These frozen synthetic bytes model the ordinary Host
// read port; no platform identity, HTTP, model, SQL, or real business is used.
async function dialogueReadFixture() {
  const review = JSON.parse(await readFile(
    new URL('./fixtures/review-turn-task.c2.json', import.meta.url), 'utf8',
  ));
  const requestRef = '44444444-4444-4444-8444-444444444444';
  const frozenRequestRef = requestRef;
  const workItemId = review.context.workItem.workItemId;
  const contributionRef = '22222222-2222-4222-8222-222222222222';
  const contribution = {
    contributionRef, revision: 2, messageRef: 'message-selected',
    selectedText: '原 Win7 前提需要重新核实，不能据此推断已执行。',
    sourcePart: 'USER', kind: 'CORRECTION', origin: 'FEISHU_EXCERPT',
    sourceContext: [
      { messageRef: 'message-prior', userText: '适用条件是什么？',
        assistantText: '这是以 Win7 为前提的候选判断吗？' },
      { messageRef: 'message-selected', userText: '请重新核实这个前提。',
        assistantText: null },
    ],
  };
  const dialogue = {
    evidenceRef: 'opaque-frozen-contribution-source-2',
    kind: 'ENGINEER_STATEMENT', origin: 'REVIEW_CONVERSATION',
    title: '对话补充 · 用户提交摘录 · CORRECTION', versionLabel: '贡献修订 2',
    excerpt: JSON.stringify(contribution),
    reviewConversationId: review.reviewConversationRef,
    reviewTurnId: review.reviewTurnRef, engineerSuppliedInputId: 'ESI-synthetic',
    recordedAt: '2026-09-10T00:00:00Z',
    dialogueSource: { requestRef: frozenRequestRef, contributionRef, revision: 2,
      contextWorkItemIds: [workItemId, 'WI-source-context'] },
  };
  const document = { evidenceRef: 'document:synthetic:page-1',
    kind: 'DOCUMENT_PASSAGE', title: '文档原页', versionLabel: 'Original',
    excerpt: '受控文档原文。', locator: 'page 1',
    workItemId };
  const attachment = { evidenceRef: 'attachment:synthetic:1',
    kind: 'ENGINEER_ATTACHMENT', title: '补充附件', versionLabel: '1',
    excerpt: '已解析附件原文。', locator: 'page 1',
    artifactRef: 'artifact://synthetic/attachment', artifactSha256: 'b'.repeat(64) };
  const project = (item) => ({ evidenceRef: item.evidenceRef, kind: item.kind,
    title: item.title, versionLabel: item.versionLabel, excerpt: item.excerpt,
    locator: item.locator ?? null, sourceRefId: item.evidenceRef });
  review.schemaVersion = 'wiselink.3_1.review_turn_task.v1.c5';
  review.requestId = `dialogue-${requestRef}`;
  review.selectedEvaluationItemId = null;
  review.allowedEvaluationItemIds = [];
  review.allowedAdoptedInputRefs = [];
  review.attachmentRefs = [attachment.evidenceRef];
  review.resourceRefs = [document, attachment].map((item) => ({
    sourceRefId: item.evidenceRef,
    resourceArtifactRef: item.artifactRef ?? 'artifact://synthetic/document',
    resourceArtifactSha256: item.artifactSha256 ?? 'a'.repeat(64),
    value: project(item),
  }));
  const sourceCatalog = [document, attachment, dialogue];
  const modelInput = { schemaVersion: 'wiselink.jobaid-problem-task.v2',
    purpose: 'PROBLEM_REVIEW', availableSources: sourceCatalog.map((item) => ({
      ref: item.evidenceRef, kind: item.kind, title: item.title,
      versionLabel: item.versionLabel, locator: item.locator ?? null,
    })), deliveredEvidence: [], previousWork: { content: { issues: [] } } };
  review.jobAidContext = { schemaVersion: modelInput.schemaVersion, sourceCatalog,
    sourceBindings: [{ workItemId: document.workItemId,
      artifactRef: 'artifact://synthetic/document', artifactSha256: 'a'.repeat(64) }],
    initiallyDeliveredRefs: [], modelInput, previousWork: modelInput.previousWork };
  delete review.context.workItem;
  review.context.purpose = 'UPDATE_ASSESSMENT';
  review.context.engineerInput = { text: '汇集已选择的贡献并重新判断。',
    attachmentRefs: [...review.attachmentRefs] };
  review.context.problemAssessment = structuredClone(modelInput);
  review.executionPolicy.toolPolicyRef =
    'wiselink-openclaw-engineering-assessment@1.2.0#interactive-jobaid-review-c5';
  const unsealed = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-synthetic-read', operationRef: 'AQ-synthetic-read',
    taskType: 'OPENCLAW_INTERACTIVE_REVIEW', priority: 100, tenantId: 'tenant-synthetic',
    workItemId, inputRevision: review.inputRevision,
    baseRevision: review.inputRevision, documentVersionId: 'DV-fixture-001',
    sourceRefs: review.resourceRefs.map((item) => ({ ref: item.resourceArtifactRef,
      sha256: item.resourceArtifactSha256 })), allowedConnectors: [],
    hostResolvedMissingInputs: [], modelInput: review, deadline: '2099-01-01T00:00:00Z',
    idempotencyKey: 'synthetic:dialogue-read' };
  const task = { ...unsealed, inputHash: canonicalSha256(unsealed) };
  const candidate = { schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c5',
    mode: 'INTERACTIVE_REVIEW', reviewConversationRef: review.reviewConversationRef,
    reviewTurnRef: review.reviewTurnRef, responseType: 'RESYNTHESIS_RESULT',
    answer: '已保留更正来源，原前提仍需根据受控原文核实。',
    sourceRefs: [], candidateEvidenceRefs: [], missingInputs: [],
    reviewActionDraft: null, affectedItemIds: [], warnings: [],
    runtime: { runtimeAppId: review.executionPolicy.runtimeAppId,
      profileRef: review.executionPolicy.profileRef },
    jobAidWorkingDelta: { schemaVersion: 'wiselink.jobaid-problem-work.v3',
      completionReason: '已记录需重新核实的前提，未确认实际执行。',
      changeSummary: '补充来源前提更正。',
      issues: [{ issueKey: 'basis-correction', question: '原前提是否成立？',
        body: `原前提待核，用户摘录不自动成为事实。[[${dialogue.evidenceRef}]]`,
        riskScenarios: [], measures: [], otherClassifications: [],
        openQuestions: [], requirementHandling: [] }] } };
  const calls = [];
  const readPort = async (args) => ({
    schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
    attemptRef: task.operationRef,
    sourceRefs: args.sourceRefIds.map((ref) => {
      const item = sourceCatalog.find((entry) => entry.evidenceRef === ref);
      assert.ok(item, 'Host protocol double accepts only its exact frozen catalog');
      return project(item);
    }),
  });
  const toolPort = (overrides = {}) => async (name, args) => {
      calls.push({ name, args });
      if (name === 'begin_review_turn') return {
        status: 'RUNNING', attemptRef: task.operationRef, task,
        leaseToken: 'synthetic-lease', leaseGeneration: 1,
      };
      if (name === 'get_review_turn_context') return {
        schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2',
        attemptRef: task.operationRef, reviewConversationRef: review.reviewConversationRef,
        reviewTurnRef: review.reviewTurnRef, mode: 'INTERACTIVE_REVIEW',
        selectedEvaluationItemId: null, inputRevision: review.inputRevision,
        allowedOperations: review.allowedOperations,
        resourceRefs: review.resourceRefs.map(({ sourceRefId, resourceArtifactRef,
          resourceArtifactSha256 }) => ({ sourceRefId, resourceArtifactRef,
          resourceArtifactSha256 })), context: review.context,
        executionPolicy: review.executionPolicy,
      };
      if (name === 'read_source_refs') {
        assert.equal(args.attemptRef, task.operationRef);
        return (overrides.readPort ?? readPort)(args);
      }
      if (name === 'commit_review_turn_candidate' && overrides.commitPort)
        return overrides.commitPort(args);
      assert.fail(`Unexpected mutation ${name}`);
    };
  const run = (respond, overrides = {}) => runInteractiveReviewTurn({
    mode: 'INTERACTIVE_REVIEW', workItemId: task.workItemId,
    reviewConversationRef: review.reviewConversationRef, requestId: review.requestId,
    ...overrides.selectors, callTool: toolPort(overrides), respond,
  });
  return { review, task, candidate, contribution, dialogue, document, attachment,
    calls, run, readPort, project, toolPort };
}

test('scoped-0744 advertises only exact current frozen contribution metadata without initial body delivery', async () => {
  const f = await dialogueReadFixture();
  const original = JSON.stringify(f.task);
  const stop = new Error('UNIT_DIRECTORY_COMPLETE');
  await assert.rejects(f.run(async ({ input }) => {
    assert.deepEqual(input.availableSourceRefIds, [f.document.evidenceRef,
      f.attachment.evidenceRef, f.dialogue.evidenceRef]);
    assert.deepEqual(input.context.problemAssessment.deliveredEvidence, []);
    assert.equal(JSON.stringify(input).includes(f.contribution.selectedText), false);
    assert.equal(JSON.stringify(input).includes(f.contribution.sourceContext[0].assistantText), false);
    assert.deepEqual(input.attachmentRefs, [f.attachment.evidenceRef]);
    throw stop;
  }), (error) => error === stop);
  assert.equal(JSON.stringify(f.task), original);
  assert.deepEqual(f.review.jobAidContext.initiallyDeliveredRefs, []);
  assert.equal(f.review.resourceRefs.length, 2);
  assert.equal(f.task.sourceRefs.length, 2);
  assert.equal(f.calls.some(({ name }) => name === 'read_source_refs'), false);
});

test('scoped-0744 exact read returns selected text and source context through the ordinary Host port', async () => {
  const f = await dialogueReadFixture();
  const requested = [f.dialogue.evidenceRef, f.document.evidenceRef, f.attachment.evidenceRef];
  const stop = new Error('UNIT_READ_COMPLETE');
  await assert.rejects(f.run(async ({ readSourceRefs }) => {
    const values = await readSourceRefs(requested);
    assert.deepEqual(values, [f.dialogue, f.document, f.attachment].map(f.project));
    assert.deepEqual(JSON.parse(values[0].excerpt), f.contribution);
    assert.equal(values.filter((item) => item.excerpt === f.dialogue.excerpt).length, 1);
    throw stop;
  }), (error) => error === stop);
  assert.deepEqual(f.calls.map(({ name }) => name), [
    'begin_review_turn', 'get_review_turn_context', 'read_source_refs',
  ]);
  assert.deepEqual(f.calls.at(-1).args, { attemptRef: f.task.operationRef, sourceRefIds: requested });
});

test('scoped-0744 reads ordinary documents and attachments without changing their bindings', async () => {
  const f = await dialogueReadFixture();
  const stop = new Error('UNIT_RESOURCE_READ_COMPLETE');
  await assert.rejects(f.run(async ({ readSourceRefs }) => {
    assert.deepEqual(await readSourceRefs([f.document.evidenceRef, f.attachment.evidenceRef]),
      [f.project(f.document), f.project(f.attachment)]);
    throw stop;
  }), (error) => error === stop);
  assert.equal(f.calls.filter(({ name }) => name === 'read_source_refs').length, 1);
});

test('scoped-0744 rejects unknown, late and old-revision handles before a Host read', async () => {
  const f = await dialogueReadFixture();
  for (const ref of ['unknown-source', 'late-contribution-source', 'old-revision-source']) {
    await assert.rejects(f.run(async ({ readSourceRefs }) => readSourceRefs([ref])),
      /HOST_MCP_REVIEW_SOURCE_REF_NOT_ALLOWED/u);
  }
  assert.equal(f.calls.some(({ name }) => name === 'read_source_refs'), false);
});

test('scoped-0744 excludes frozen catalog entries outside the exact request, conversation, turn or WorkItem', async () => {
  for (const alter of [
    (item) => { item.dialogueSource.requestRef = 'another-request'; },
    (item) => { item.reviewConversationId = 'RC-prior'; },
    (item) => { item.reviewTurnId = 'RT-prior'; },
    (item) => { item.dialogueSource.contextWorkItemIds = ['WI-other']; },
    (item) => { item.dialogueSource.revision = 0; },
    (item) => { delete item.dialogueSource.contributionRef; },
  ]) {
    const f = await dialogueReadFixture();
    alter(f.dialogue);
    const { inputHash: _hash, ...unsigned } = f.task;
    f.task.inputHash = canonicalSha256(unsigned);
    await assert.rejects(f.run(async ({ input, readSourceRefs }) => {
      assert.equal(input.availableSourceRefIds.includes(f.dialogue.evidenceRef), false);
      return readSourceRefs([f.dialogue.evidenceRef]);
    }), /HOST_MCP_REVIEW_SOURCE_REF_NOT_ALLOWED/u);
    assert.equal(f.calls.some(({ name }) => name === 'read_source_refs'), false);
  }
  // A previous saved source can legitimately remain in the frozen catalog;
  // catalog membership alone must not make it a read handle for this request.
  const f = await dialogueReadFixture();
  const prior = structuredClone(f.dialogue);
  prior.evidenceRef = 'opaque-prior-contribution-source-1';
  prior.reviewTurnId = 'RT-prior';
  prior.dialogueSource.requestRef = 'prior-request';
  prior.dialogueSource.revision = 1;
  prior.excerpt = JSON.stringify({ ...f.contribution, revision: 1 });
  f.review.jobAidContext.sourceCatalog.push(prior);
  f.review.jobAidContext.modelInput.availableSources.push({ ref: prior.evidenceRef,
    kind: prior.kind, title: prior.title, versionLabel: prior.versionLabel, locator: null });
  f.review.context.problemAssessment = structuredClone(f.review.jobAidContext.modelInput);
  const { inputHash: _hash, ...unsigned } = f.task;
  f.task.inputHash = canonicalSha256(unsigned);
  await assert.rejects(f.run(async ({ input, readSourceRefs }) => {
    assert.equal(input.availableSourceRefIds.includes(prior.evidenceRef), false);
    assert.equal(input.availableSourceRefIds.includes(f.dialogue.evidenceRef), true);
    return readSourceRefs([prior.evidenceRef]);
  }), /HOST_MCP_REVIEW_SOURCE_REF_NOT_ALLOWED/u);
  assert.equal(f.calls.some(({ name }) => name === 'read_source_refs'), false);
});

test('scoped-0744 rejects a sealed BEGIN for another requested work, conversation or request before context delivery', async () => {
  for (const selectors of [{ workItemId: 'WI-other' },
    { reviewConversationRef: 'RC-old-session' }, { requestId: 'late-request' }]) {
    const f = await dialogueReadFixture();
    let invoked = false;
    await assert.rejects(f.run(async () => { invoked = true; }, { selectors }),
      /HOST_MCP_REVIEW_TASK_BINDING_MISMATCH/u);
    assert.equal(invoked, false);
    assert.deepEqual(f.calls.map(({ name }) => name), ['begin_review_turn']);
  }
});

test('scoped-0744 preserves current Host denial without cached source fallback', async () => {
  // Port denials only: this does not simulate tenant/actor authorization rules.
  for (const code of ['OBJECT_ACCESS_DENIED', 'JOBAID_SOURCE_AUTHORIZATION_CHANGED',
    'REVIEW_SOURCE_REF_NOT_ALLOWED']) {
    const f = await dialogueReadFixture();
    const denial = new Error(code);
    let delivered = false;
    await assert.rejects(f.run(async ({ readSourceRefs }) => {
      await readSourceRefs([f.dialogue.evidenceRef]);
      delivered = true;
    }, { readPort: async () => { throw denial; } }), (error) => error === denial);
    assert.equal(delivered, false);
    assert.equal(f.calls.filter(({ name }) => name === 'read_source_refs').length, 1);
  }
  const f = await dialogueReadFixture();
  const denial = new Error('OBJECT_ACCESS_DENIED');
  const stop = new Error('UNIT_REVOKED_READ_COMPLETE');
  let reads = 0;
  await assert.rejects(f.run(async ({ readSourceRefs }) => {
    assert.deepEqual(await readSourceRefs([f.dialogue.evidenceRef]), [f.project(f.dialogue)]);
    await assert.rejects(readSourceRefs([f.dialogue.evidenceRef]), (error) => error === denial);
    throw stop;
  }, { readPort: async (args) => {
    reads += 1;
    if (reads === 2) throw denial;
    return f.readPort(args);
  } }), (error) => error === stop);
  assert.equal(reads, 2);
  assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
});

test('scoped-0744 preserves exact attempt, source, kind and frozen excerpt readback checks', async () => {
  for (const alter of [
    (value) => { value.attemptRef = 'AQ-other'; },
    (value) => { value.sourceRefs[0].sourceRefId = 'old-revision-source'; },
    (value) => { value.sourceRefs[0].evidenceRef = 'other-source'; },
    (value) => { value.sourceRefs[0].kind = 'HOST_FACT'; },
    (value) => { value.sourceRefs[0].excerpt = 'late replacement text'; },
  ]) {
    const f = await dialogueReadFixture();
    await assert.rejects(f.run(async ({ readSourceRefs }) => readSourceRefs([f.dialogue.evidenceRef]), {
      readPort: async (args) => { const value = await f.readPort(args); alter(value); return value; },
    }), /HOST_MCP_REVIEW_(?:SOURCE_REF_READBACK_INVALID|SOURCE_REF_BINDING_INVALID|JOBAID_SOURCE_BINDING_INVALID)/u);
  }
});

test('scoped-0744 a normal read feeds a nonempty inline-cited delta with unchanged top-level source constraints', async () => {
  const f = await dialogueReadFixture();
  let submitted;
  const result = await f.run(async ({ readSourceRefs, validateCandidate }) => {
    const [resolved] = await readSourceRefs([f.dialogue.evidenceRef]);
    assert.deepEqual(JSON.parse(resolved.excerpt), f.contribution);
    assert.equal(validateCandidate(f.candidate), f.candidate);
    assert.throws(() => validateReviewCandidate(f.review, { ...f.candidate,
      sourceRefs: [f.dialogue.evidenceRef] }), /REVIEW_CANDIDATE_SOURCE_REF_NOT_ALLOWED/u);
    assert.throws(() => validateReviewCandidate(f.review, { ...f.candidate,
      candidateEvidenceRefs: [f.dialogue.evidenceRef] }), /REVIEW_CANDIDATE_EVIDENCE_REF_NOT_ALLOWED/u);
    return { output: f.candidate, provenance: {
      modelVersion: 'unit-protocol-port-only', promptVersion: 'unit-review',
      skillVersion: WISELINK_SKILL_VERSION,
      toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION },
      runMetrics: { durationMs: 1, inputUnits: 0, outputUnits: 0 },
    } };
  }, { commitPort: async (args) => {
    submitted = JSON.parse(args.resultJson);
    validateResultEnvelope(f.task, submitted);
    assert.deepEqual(JSON.parse(submitted.modelOutput), f.candidate);
    assert.deepEqual(submitted.sourceRefs, []);
    assert.deepEqual(submitted.factsConsidered, []);
    assert.equal(args.attemptRef, f.task.operationRef);
    assert.equal(args.leaseToken, 'synthetic-lease');
    assert.equal(args.leaseGeneration, 1);
    return { schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2',
      attemptRef: f.task.operationRef, status: 'SUCCEEDED',
      authority: { candidatePersisted: true, reviewActionExecuted: false,
        workItemRevisionChanged: false, currentChanged: false, staleMarked: false } };
  } });
  assert.equal(result.ok, true);
  assert.ok(submitted);
  assert.deepEqual(f.calls.map(({ name }) => name), ['begin_review_turn',
    'get_review_turn_context', 'read_source_refs', 'commit_review_turn_candidate']);
});

test('scoped-0744 existing Review driver deduplicates read dispatch and delivers one selected body per exchange', async () => {
  const f = await dialogueReadFixture();
  const messages = [];
  const result = await f.run(async ({ input, readSourceRefs, validateCandidate }) => {
    const execution = await invokeHostedReviewModel({ input }, {
      gatewayUrl: 'https://unit.invalid', gatewayToken: 'unit-only',
      configuredModelVersion: 'unit-protocol-port-only', maxModelRequests: 3,
      readSourceRefs, validateCandidate: (value) => validateCandidate({ ...f.candidate, ...value }),
    }, { requestGateway: async (_url, init) => {
      // Function double only; no socket, provider, or Hosted request is made.
      const body = JSON.parse(init.body);
      messages.push(body.messages);
      const read = messages.length < 3;
      return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
        content: null, tool_calls: [{ id: `unit-${messages.length}`, type: 'function',
          function: { name: read ? 'read_wiselink_review_sources' : 'return_wiselink_review_candidate',
            arguments: JSON.stringify(read ? { sourceRefIds: [f.dialogue.evidenceRef] }
              : { answer: f.candidate.answer, jobAidWorkingDelta: f.candidate.jobAidWorkingDelta }) } }],
      } }] });
    } });
    assert.equal(messages.length, 3);
    assert.equal(JSON.stringify(messages[0]).includes(f.contribution.selectedText), false);
    for (const exchange of messages.slice(1)) {
      for (const text of [f.contribution.selectedText, f.contribution.sourceContext[0].assistantText])
        assert.equal(JSON.stringify(exchange).split(text).length - 1, 1);
    }
    assert.equal(f.calls.filter(({ name }) => name === 'read_source_refs').length, 1);
    return { output: { ...f.candidate, ...execution.output }, provenance: execution.provenance };
  }, { commitPort: async () => ({ schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2',
    attemptRef: f.task.operationRef, status: 'SUCCEEDED',
    authority: { candidatePersisted: true, reviewActionExecuted: false,
      workItemRevisionChanged: false, currentChanged: false, staleMarked: false } }) });
  assert.equal(result.ok, true);
});

// C309 unit fixtures carry actual DTO-shaped prior ref/revision and use only
// local function doubles. No Host identity, SQL, provider or HTTP is exercised.
async function unchangedJobAidFixture() {
  const f = await dialogueReadFixture();
  const previousWork = { workRevisionRef: 'JAWR-unit-prior-7', workRevision: 7,
    workItemId: f.task.workItemId, documentVersionId: f.task.documentVersionId,
    content: { overviewStatus: 'CURRENT', roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      completionReason: '保留原范围和真实未知。', issues: [{ issueKey: 'prior-unknown',
        question: '原前提仍缺什么证据？', body: '实际执行情况仍未知。', openQuestions: ['缺少受控执行证明。'] }] } };
  f.review.jobAidContext.previousWork = previousWork;
  Object.assign(f.review.jobAidContext.modelInput, { expectedWorkRevision: 7,
    previousWork: { workRevisionRef: previousWork.workRevisionRef, workRevision: 7,
      overviewStatus: 'CURRENT', content: structuredClone(previousWork.content) } });
  f.review.context.problemAssessment = structuredClone(f.review.jobAidContext.modelInput);
  Object.assign(f.candidate, { responseType: 'RESYNTHESIS_RESULT', jobAidWorkingDelta: null,
    answer: '已逐项比较当前更正摘录和已保存问题：补充仅重述尚待核实的前提，没有新增支持执行的资料。原问题、判断和缺少受控执行证明的未知均保留，本轮比较完成且工作内容不变。' });
  resealReviewFixture(f);
  return f;
}

function resealReviewFixture(f) {
  const { inputHash: _hash, ...unsigned } = f.task;
  f.task.inputHash = canonicalSha256(unsigned);
}

function reviewModelOutput(candidate) {
  return Object.fromEntries(['responseType', 'answer', 'sourceRefs', 'missingInputs',
    'candidateEvidenceRefs', 'reviewActionDraft', 'affectedItemIds', 'warnings',
    'jobAidWorkingDelta'].map((key) => [key, candidate[key]]));
}

function jobAidReceipt(f, args, { status = 'UNCHANGED', includeReadProof = true } = {}) {
  const result = JSON.parse(args.resultJson);
  return { schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2',
    attemptRef: f.task.operationRef, status: 'SUCCEEDED',
    assistantCandidate: { actionAttemptRef: f.task.operationRef,
      provenance: { resultContentHash: result.contentHash },
      jobAidWorkingUpdate: { status, workRevisionRef: status === 'UNCHANGED'
        ? f.review.jobAidContext.previousWork.workRevisionRef : 'JAWR-unit-applied-8',
        workRevision: status === 'UNCHANGED' ? 7 : 8, affectedIssueKeys: [],
        ...(includeReadProof ? { readSourceRefs: [f.dialogue.evidenceRef] } : {}) } },
    authority: { candidatePersisted: true, reviewActionExecuted: false,
      workItemRevisionChanged: false, currentChanged: false, staleMarked: false } };
}

function unitReviewProvenance() {
  return { modelVersion: 'unit-function-double-only', promptVersion: 'unit-review',
    skillVersion: WISELINK_SKILL_VERSION,
    toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION },
    runMetrics: { durationMs: 1, inputUnits: 0, outputUnits: 0 } };
}

test('scoped-0828 qualified explicit null validates without changing saved work or unknowns', async () => {
  const f = await unchangedJobAidFixture();
  const original = JSON.stringify(f.review.jobAidContext.previousWork);
  assert.equal(validateReviewCandidate(f.review, f.candidate), f.candidate);
  assert.equal(JSON.stringify(f.review.jobAidContext.previousWork), original);
  assert.deepEqual(f.candidate.missingInputs, []);
});

test('scoped-0828 null cannot turn ordinary answers, missing inputs or an unbound prior work into completion', async () => {
  for (const alter of [
    f => { f.candidate.responseType = 'ANSWER'; },
    f => { f.candidate.responseType = 'INPUT_REQUEST'; },
    f => { f.candidate.missingInputs = ['缺少本轮比较所需资料']; },
    f => { f.review.jobAidContext.previousWork = null; },
    f => { f.review.jobAidContext.modelInput.previousWork = null; },
    f => { f.review.jobAidContext.modelInput.previousWork.workRevisionRef = 'JAWR-other'; },
    f => { f.review.jobAidContext.modelInput.previousWork.workRevision = 8; },
    f => { f.review.jobAidContext.modelInput.expectedWorkRevision = 8; },
  ]) {
    const f = await unchangedJobAidFixture(); alter(f);
    f.review.context.problemAssessment = structuredClone(f.review.jobAidContext.modelInput);
    assert.throws(() => validateReviewCandidate(f.review, f.candidate), /REVIEW_UPDATE_WORKING_DELTA_REQUIRED/u);
  }
  const f = await unchangedJobAidFixture();
  const omitted = { ...f.candidate }; delete omitted.jobAidWorkingDelta;
  assert.throws(() => validateReviewCandidate(f.review, omitted));
  assert.throws(() => validateReviewCandidate(f.review, { ...f.candidate, answer: '  ' }), /REVIEW_CANDIDATE_ANSWER_REQUIRED/u);
});

test('scoped-0828 all frozen current contributions must actually be read before unchanged completion', async () => {
  const f = await unchangedJobAidFixture();
  for (const deliveredClaim of [false, true]) {
    if (deliveredClaim) {
      f.review.jobAidContext.initiallyDeliveredRefs = [f.dialogue.evidenceRef];
      f.review.jobAidContext.modelInput.deliveredEvidence = [{ evidenceRef: f.dialogue.evidenceRef,
        kind: f.dialogue.kind, title: f.dialogue.title, versionLabel: f.dialogue.versionLabel,
        excerpt: f.dialogue.excerpt, locator: null }];
      f.review.context.problemAssessment = structuredClone(f.review.jobAidContext.modelInput);
      resealReviewFixture(f);
    }
    await assert.rejects(f.run(async () => ({ output: f.candidate,
      provenance: unitReviewProvenance() })), /REVIEW_CANDIDATE_SOURCE_REF_NOT_READ_THIS_TURN/u);
  }
  assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
  assert.equal(f.calls.some(({ name }) => name === 'read_source_refs'), false);
});

test('scoped-0828 exact source read and explicit null accept only the original UNCHANGED receipt', async () => {
  const f = await unchangedJobAidFixture();
  const original = JSON.stringify(f.review.jobAidContext.previousWork);
  let receipt;
  const result = await f.run(async ({ readSourceRefs }) => {
    assert.deepEqual(JSON.parse((await readSourceRefs([f.dialogue.evidenceRef]))[0].excerpt), f.contribution);
    return { output: f.candidate, provenance: unitReviewProvenance() };
  }, { commitPort: async args => { receipt = jobAidReceipt(f, args); return receipt; } });
  assert.equal(result.committed, receipt);
  assert.deepEqual(result.committed.assistantCandidate.jobAidWorkingUpdate.readSourceRefs, [f.dialogue.evidenceRef]);
  assert.equal(JSON.stringify(f.review.jobAidContext.previousWork), original);
  assert.equal(result.committed.authority.staleMarked, false);
});

test('scoped-0828 unchanged rejects wrong read handles and forged or invalidating Host receipts', async () => {
  for (const alter of [
    receipt => { receipt.assistantCandidate.actionAttemptRef = 'AQ-other'; },
    receipt => { receipt.assistantCandidate.provenance.resultContentHash = 'a'.repeat(64); },
    receipt => { receipt.assistantCandidate.jobAidWorkingUpdate.workRevisionRef = 'JAWR-other'; },
    receipt => { receipt.assistantCandidate.jobAidWorkingUpdate.workRevision = 8; },
    receipt => { receipt.assistantCandidate.jobAidWorkingUpdate.status = 'APPLIED'; },
    receipt => { receipt.assistantCandidate.jobAidWorkingUpdate.affectedIssueKeys = ['prior-unknown']; },
    receipt => { receipt.authority.staleMarked = true; },
    receipt => { receipt.authority.currentChanged = true; },
    receipt => { receipt.authority.reviewActionExecuted = true; },
    receipt => { receipt.assistantCandidate.jobAidWorkingUpdate.readSourceRefs = [null]; },
  ]) {
    const f = await unchangedJobAidFixture();
    await assert.rejects(f.run(async ({ readSourceRefs }) => {
      await readSourceRefs([f.dialogue.evidenceRef]);
      return { output: f.candidate, provenance: unitReviewProvenance() };
    }, { commitPort: async args => { const receipt = jobAidReceipt(f, args); alter(receipt); return receipt; } }),
    /HOST_MCP_REVIEW_COMMIT_RESULT_INVALID/u);
  }
  const f = await unchangedJobAidFixture();
  await assert.rejects(f.run(async ({ readSourceRefs }) => readSourceRefs(['wrong-or-new-revision'])),
    /HOST_MCP_REVIEW_SOURCE_REF_NOT_ALLOWED/u);
  assert.equal(f.calls.some(({ name }) => name === 'commit_review_turn_candidate'), false);
});

for (const invalid of ['omitted', 'answer', 'default-answer']) {
  test(`scoped-0828 adapter distinguishes ${invalid} from qualified explicit RESYNTHESIS null`, async () => {
    const f = await unchangedJobAidFixture();
    let responses = 0;
    const result = await f.run(async ({ input, readSourceRefs, validateCandidate }) => {
      const execution = await invokeHostedReviewModel({ input }, {
        gatewayUrl: 'https://unit.invalid', gatewayToken: 'unit-only',
        configuredModelVersion: 'unit-function-double-only', maxModelRequests: 3,
        readSourceRefs, validateCandidate: value => validateCandidate({ ...f.candidate, ...value }),
      }, { requestGateway: async (_url, init) => {
        const body = JSON.parse(init.body);
        const shape = body.tools.find(tool => tool.function.name === 'return_wiselink_review_candidate')?.function.parameters;
        if (shape) {
          assert.ok(shape.required.includes('jobAidWorkingDelta'));
          const deltaShape = shape.properties.jobAidWorkingDelta;
          assert.ok(Array.isArray(deltaShape.anyOf));
          assert.ok(deltaShape.anyOf.some(branch => branch.type === 'null'));
          assert.ok(deltaShape.anyOf.some(branch => branch.type === 'object'));
        }
        responses += 1;
        const read = responses === 1;
        const authored = { responseType: 'RESYNTHESIS_RESULT', answer: f.candidate.answer, jobAidWorkingDelta: null };
        if (responses === 2) {
          if (invalid === 'omitted') delete authored.jobAidWorkingDelta;
          if (invalid === 'answer') authored.responseType = 'ANSWER';
          if (invalid === 'default-answer') delete authored.responseType;
        }
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null,
          tool_calls: [{ id: `unit-null-${responses}`, type: 'function', function: {
            name: read ? 'read_wiselink_review_sources' : 'return_wiselink_review_candidate',
            arguments: JSON.stringify(read ? { sourceRefIds: [f.dialogue.evidenceRef] } : authored) } }],
        } }] });
      } });
      return { output: { ...f.candidate, ...execution.output }, provenance: execution.provenance };
    }, { commitPort: args => jobAidReceipt(f, args) });
    assert.equal(responses, 3);
    assert.equal(result.ok, true);
    assert.equal(f.calls.filter(({ name }) => name === 'read_source_refs').length, 1);
    assert.equal(f.calls.filter(({ name }) => name === 'commit_review_turn_candidate').length, 1);
  });
}

for (const status of ['APPLIED', 'UNCHANGED']) for (const includeReadProof of [false, true]) {
  test(`scoped-0828 driver preserves ${status} Host receipt with proof=${includeReadProof} on exact checkpoint replay`, async t => {
    const f = status === 'UNCHANGED' ? await unchangedJobAidFixture() : await dialogueReadFixture();
    const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-c309-receipt-unit-'));
    t.after(() => rm(checkpointDir, { recursive: true, force: true }));
    let receipt; let modelInvocations = 0;
    const toolPort = f.toolPort({ commitPort: args => {
      receipt = jobAidReceipt(f, args, { status, includeReadProof }); return receipt;
    } });
    const opts = { workItemId: f.task.workItemId, reviewConversationRef: f.review.reviewConversationRef,
      requestId: f.review.requestId, checkpointDir };
    const dependencies = { callTool: toolPort, invokeModel: async (_input, hooks) => {
      modelInvocations += 1;
      await hooks.readSourceRefs([f.dialogue.evidenceRef]);
      return { output: reviewModelOutput(f.candidate), provenance: unitReviewProvenance() };
    } };
    const first = await runHostedReviewTurn(opts, dependencies);
    assert.deepEqual(first.jobAidWorkingUpdate, receipt.assistantCandidate.jobAidWorkingUpdate);
    assert.equal(Object.hasOwn(first.jobAidWorkingUpdate, 'readSourceRefs'), includeReadProof);
    const second = await runHostedReviewTurn(opts, dependencies);
    assert.deepEqual(second.jobAidWorkingUpdate, first.jobAidWorkingUpdate);
    assert.equal(modelInvocations, 1);
    assert.equal(f.calls.filter(({ name }) => name === 'commit_review_turn_candidate').length, 1);
    assert.equal(f.calls.filter(({ name }) => name === 'read_source_refs').length, 1);
  });
}


test('scoped-0828 a sealed COMMITTING result without a Host receipt remains attention with no proof reconstruction or replay', async t => {
  const f = await unchangedJobAidFixture();
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-c309-sealed-unit-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  let sealed; let modelInvocations = 0;
  const calls = [];
  const tools = f.toolPort({ commitPort: async args => {
    sealed = JSON.parse(args.resultJson);
    throw Object.assign(new Error('UNIT_SEALED_RECEIPT_UNAVAILABLE'), {
      receivedHostToolError: true, hostErrorCode: 'REVIEW_UNIT_SEALED_RECEIPT_UNAVAILABLE',
    });
  } });
  const dependencies = { callTool: async (name, args) => {
    calls.push(name);
    if (name === 'get_pending_review_turn') return { busy: false, next: {
      reviewConversationRef: f.review.reviewConversationRef,
      reviewTurnRef: f.review.reviewTurnRef, requestId: f.review.requestId } };
    if (name === 'get_action_attempt_status') return { attemptRef: f.task.operationRef,
      taskType: f.task.taskType, status: 'COMMITTING', recoveryAvailable: true,
      projectionApplied: false, commitStartedAt: '2026-10-15T00:00:00Z', terminalReason: null,
      resultContentHash: sealed.contentHash, recoveryResult: sealed };
    return tools(name, args);
  }, invokeModel: async (_input, hooks) => {
    modelInvocations += 1;
    await hooks.readSourceRefs([f.dialogue.evidenceRef]);
    return { output: reviewModelOutput(f.candidate), provenance: unitReviewProvenance() };
  } };
  const opts = { workItemId: f.task.workItemId, checkpointRoot };
  const result = await consumePendingReviewTurn(opts, dependencies);
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(Object.hasOwn(result.result, 'jobAidWorkingUpdate'), false);
  const hash = sealed.contentHash;
  const second = await consumePendingReviewTurn(opts, dependencies);
  assert.equal(second.status, 'REQUIRES_ATTENTION');
  assert.equal(Object.hasOwn(second.result, 'jobAidWorkingUpdate'), false);
  assert.equal(sealed.contentHash, hash);
  assert.equal(modelInvocations, 1);
  assert.equal(calls.filter(name => name === 'commit_review_turn_candidate').length, 1);
  assert.equal(calls.filter(name => name === 'read_source_refs').length, 1);
  assert.equal(calls.includes('cancel_action_attempt'), false);
});
