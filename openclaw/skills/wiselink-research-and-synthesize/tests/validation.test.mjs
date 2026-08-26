import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION,
  WISELINK_MODEL_VERSION,
  WISELINK_SKILL_VERSION,
  canonicalSha256,
  sealResultEnvelope,
  validatePayload,
  validateReviewCandidate,
} from '../scripts/validate-payload.mjs';
import {
  EXTRACT_APPLICABILITY_BLOCKER,
  INITIAL_ANALYSIS_OPERATIONS,
  INTERACTIVE_REVIEW_TOOLS,
  runDynamicEvaluation,
  runInitialAnalysis,
  runInteractiveReviewTurn,
  runOverallSynthesis,
  runTranslation,
  summarizeQueryParsedPackage,
} from '../scripts/orchestrate-host-mcp.mjs';

const DYNAMIC_FIXTURE_URL = new URL(
  './fixtures/dynamic-rules-evaluation-737.input.json',
  import.meta.url,
);
const REVIEW_TASK_FIXTURE_URL = new URL(
  './fixtures/review-turn-task.c2.json',
  import.meta.url,
);
const REVIEW_CANDIDATE_FIXTURE_URL = new URL(
  './fixtures/review-turn-candidate.c2.json',
  import.meta.url,
);

const ARTIFACT_REF = 'artifact://fixture/frozen-package';
const ARTIFACT_SHA = 'b'.repeat(64);
const LEASE_TOKEN = '9bc7de9d-1e86-4c12-8e78-e27cce3aa0d4';
const WORK_ITEM_ID = 'WI-CONTROL-001';

test('pins exact C2 modes, five review tools, and hosted provenance', () => {
  assert.deepEqual(INITIAL_ANALYSIS_OPERATIONS, [
    'TRANSLATE',
    'EXTRACT_APPLICABILITY',
    'EVALUATE_JOBAID',
    'SYNTHESIZE_OVERALL',
  ]);
  assert.deepEqual(INTERACTIVE_REVIEW_TOOLS, [
    'begin_review_turn',
    'get_review_turn_context',
    'read_source_refs',
    'get_action_attempt_status',
    'commit_review_turn_candidate',
  ]);
  assert.equal(
    WISELINK_SKILL_VERSION,
    'wiselink-research-and-synthesize@r09.interactive-review.c2',
  );
  assert.equal(WISELINK_MODEL_VERSION, 'GLM-5.1');
  assert.equal(WISELINK_HOST_MCP_VERSION, '1.1.0');
});

test('keeps EXTRACT_APPLICABILITY as an explicit fail-closed blocker', async () => {
  await assert.rejects(
    runInitialAnalysis({
      mode: 'INITIAL_ANALYSIS',
      operation: 'EXTRACT_APPLICABILITY',
    }),
    new RegExp(EXTRACT_APPLICABILITY_BLOCKER, 'u'),
  );
});

test('validates the real dynamic N input and preserves FALSE/UNKNOWN/TRUE', async () => {
  const input = await readJson(DYNAMIC_FIXTURE_URL);
  const output = buildDynamicRulesOutput(input);
  validatePayload('dynamic-rules-pair', { input, output });
  assert.equal(
    output.ruleResults.rows.length,
    input.jobAidContext.criterionTable.rowCount,
  );

  const table = input.jobAidContext.criterionTable;
  const predicateIndex = table.columns.indexOf('predicateResult');
  const sourceIndex = table.columns.indexOf('sourceEvidenceCandidateIds');
  const falseIndex = table.rows.findIndex(
    (_, index) => dynamicValue(table, predicateIndex, index) === 'FALSE',
  );
  const unknownIndex = table.rows.findIndex(
    (_, index) => dynamicValue(table, predicateIndex, index) === 'UNKNOWN',
  );
  const trueIndex = table.rows.findIndex(
    (_, index) =>
      dynamicValue(table, predicateIndex, index) === 'TRUE' &&
      dynamicValue(table, sourceIndex, index).length > 0,
  );
  assert.deepEqual(output.ruleResults.rows[falseIndex].slice(1, 9), [
    'NOT_APPLICABLE',
    [],
    '谓词 FALSE。',
    '不适用。',
    'not_applicable',
    [],
    [],
    false,
  ]);
  assert.equal(
    output.ruleResults.rows[unknownIndex][1],
    'UNKNOWN/WAITING_INPUT',
  );
  assert.equal(output.ruleResults.rows[unknownIndex][8], true);
  assert.notEqual(
    output.ruleResults.rows[trueIndex][1],
    'UNKNOWN/WAITING_INPUT',
  );
  assert.ok(output.ruleResults.rows[trueIndex][6].length > 0);
});

test('rejects any dynamic attempt to degrade a Host TRUE predicate', async () => {
  const input = await readJson(DYNAMIC_FIXTURE_URL);
  const output = buildDynamicRulesOutput(input);
  const table = input.jobAidContext.criterionTable;
  const predicateIndex = table.columns.indexOf('predicateResult');
  const sourceIndex = table.columns.indexOf('sourceEvidenceCandidateIds');
  const trueIndex = table.rows.findIndex(
    (_, index) =>
      dynamicValue(table, predicateIndex, index) === 'TRUE' &&
      dynamicValue(table, sourceIndex, index).length > 0,
  );
  output.ruleResults.rows[trueIndex][1] = 'UNKNOWN/WAITING_INPUT';
  assert.throws(
    () => validatePayload('dynamic-rules-pair', { input, output }),
    /DYNAMIC_RULES_TRUE_PREDICATE_DOWNGRADED/u,
  );
});

test('reads resultCount/results without inventing applicability', () => {
  const summary = summarizeQueryParsedPackage({
    workItemId: WORK_ITEM_ID,
    resultCount: 2,
    results: [
      {
        unitId: 'U-1',
        kind: 'paragraph',
        text: '737-8 / 737-9',
        sourceRefIds: ['SR-1'],
      },
      {
        unitId: 'U-2',
        kind: 'paragraph',
        text: '737-8200',
        sourceRefIds: [],
      },
    ],
  });
  assert.equal(summary.resultCount, 2);
  assert.equal(summary.sourceBoundResultCount, 1);
  assert.equal(summary.applicabilityAuthorityAvailable, false);
  assert.deepEqual(summary.authorityCollections, {
    sourceExpressions: null,
    normalizedCandidates: null,
    assignments: null,
  });
});

test('seals exact full ResultEnvelope and rejects self-reported version drift', () => {
  const task = makeTask('OPENCLAW_TRANSLATE', translationInput());
  const result = sealResultEnvelope({
    task,
    modelOutput: translationOutput(),
    provenance: provenance(),
  });
  validatePayload('result-envelope', { task, result });
  const { contentHash: _contentHash, ...unsealed } = result;
  assert.equal(result.contentHash, canonicalSha256(unsealed));
  assert.equal(result.skillVersion, WISELINK_SKILL_VERSION);
  assert.equal(
    result.toolVersions[WISELINK_HOST_MCP_NAME],
    WISELINK_HOST_MCP_VERSION,
  );

  assert.throws(
    () =>
      sealResultEnvelope({
        task,
        modelOutput: translationOutput(),
        provenance: provenance({ skillVersion: 'self-reported-latest' }),
      }),
    /RUNTIME_SKILL_VERSION_POLICY_MISMATCH/u,
  );
  assert.throws(
    () =>
      sealResultEnvelope({
        task,
        modelOutput: translationOutput(),
        provenance: provenance({ modelVersion: 'fallback-model' }),
      }),
    /RUNTIME_MODEL_VERSION_POLICY_MISMATCH/u,
  );
});

test('runs translation with fresh status and full fenced ResultEnvelope', async () => {
  const input = translationInput();
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const begin = runningBegin(task, { modelInput: input });
  const calls = [];
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'begin_translation') return begin;
    if (name === 'commit_translation_candidate') {
      assert.deepEqual(Object.keys(args).sort(), [
        'attemptRef',
        'leaseGeneration',
        'leaseToken',
        'result',
      ]);
      assert.equal(args.attemptRef, task.operationRef);
      assert.equal(args.leaseToken, LEASE_TOKEN);
      assert.equal(args.leaseGeneration, 3);
      validatePayload('result-envelope', { task, result: args.result });
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 8,
        status: 'CANDIDATE_ONLY',
        translation: { status: 'CANDIDATE_ONLY' },
      };
    }
    if (name === 'get_deep_link') {
      return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runTranslation({
    workItemId: WORK_ITEM_ID,
    callTool,
    translate: async () => ({
      output: translationOutput(),
      provenance: provenance(),
    }),
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.equal(result.provenance.skillVersion, WISELINK_SKILL_VERSION);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'get_parse_status',
      'begin_translation',
      'commit_translation_candidate',
      'get_parse_status',
      'get_deep_link',
    ],
  );
});

test('runs dynamic N/N and never uses old {attemptRef, output}', async () => {
  const input = await readJson(DYNAMIC_FIXTURE_URL);
  const output = buildDynamicRulesOutput(input);
  const task = makeTask('OPENCLAW_DYNAMIC_EVALUATION', input);
  const begin = runningBegin(task, { modelInput: input });
  const calls = [];
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'begin_dynamic_evaluation') return begin;
    if (name === 'commit_dynamic_evaluation_candidate') {
      assert.equal(Object.hasOwn(args, 'output'), false);
      assert.equal(Object.hasOwn(args, 'result'), true);
      validatePayload('result-envelope', { task, result: args.result });
      assert.equal(
        JSON.parse(args.result.modelOutput).ruleResults.rows.length,
        input.jobAidContext.criterionTable.rowCount,
      );
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 8,
        status: 'BASE_RULE_CANDIDATE_READY',
      };
    }
    if (name === 'get_deep_link') {
      return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runDynamicEvaluation({
    workItemId: WORK_ITEM_ID,
    callTool,
    evaluateDynamicRules: async () => ({
      output,
      provenance: provenance(),
    }),
  });
  assert.equal(result.commitRecoveredByReadback, false);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'get_parse_status',
      'begin_dynamic_evaluation',
      'commit_dynamic_evaluation_candidate',
      'get_parse_status',
      'get_deep_link',
    ],
  );
});

test('does one exact dynamic readback after unknown commit and never retries', async () => {
  const input = await readJson(DYNAMIC_FIXTURE_URL);
  const output = buildDynamicRulesOutput(input);
  const task = makeTask('OPENCLAW_DYNAMIC_EVALUATION', input);
  const calls = [];
  let statusReads = 0;
  const callTool = async (name) => {
    calls.push(name);
    if (name === 'get_parse_status') {
      statusReads += 1;
      return statusReads === 1
        ? status(WORK_ITEM_ID)
        : statusWithDynamic(WORK_ITEM_ID, input.callerCorrelationRef);
    }
    if (name === 'begin_dynamic_evaluation') {
      return runningBegin(task, { modelInput: input });
    }
    if (name === 'commit_dynamic_evaluation_candidate') {
      throw new Error('TRANSPORT_RESPONSE_LOST');
    }
    if (name === 'get_deep_link') {
      return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runDynamicEvaluation({
    workItemId: WORK_ITEM_ID,
    callTool,
    evaluateDynamicRules: async () => ({ output, provenance: provenance() }),
  });
  assert.equal(result.commitRecoveredByReadback, true);
  assert.equal(
    calls.filter((name) => name === 'commit_dynamic_evaluation_candidate')
      .length,
    1,
  );
  assert.equal(calls.filter((name) => name === 'get_parse_status').length, 2);
});

test('runs no-discovery overall from complete persisted dynamic N', async () => {
  const input = synthesisInput();
  const output = synthesisOutput(input);
  const task = makeTask('OPENCLAW_OVERALL_SYNTHESIS', {
    modelInput: input,
    selectedDiscoveryRefs: [],
    providerCodes: [],
  });
  const begin = runningBegin(task, {
    modelInput: input,
    selectedDiscoveryRefs: [],
  });
  const calls = [];
  let statusReads = 0;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_parse_status') {
      statusReads += 1;
      return statusReads === 1
        ? statusWithDynamic(WORK_ITEM_ID, 'REQ-DYNAMIC')
        : statusWithOverall(WORK_ITEM_ID, input.outputCorrelationRef);
    }
    if (name === 'begin_overall_synthesis') return begin;
    if (name === 'commit_overall_candidate') {
      validatePayload('result-envelope', { task, result: args.result });
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 8,
        status: 'OVERALL_CANDIDATE_READY',
        overallSynthesis: {
          status: 'CANDIDATE_ONLY',
          authorityLevel: 'candidate_only',
          externalDiscoveryIsEvidence: false,
        },
      };
    }
    if (name === 'get_deep_link') {
      return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runOverallSynthesis({
    workItemId: WORK_ITEM_ID,
    providers: [],
    callTool,
    synthesizeOverall: async () => ({ output, provenance: provenance() }),
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.deepEqual(result.selectedDiscoveryRefs, []);
  assert.deepEqual(
    calls.find(({ name }) => name === 'begin_overall_synthesis').args.providers,
    [],
  );
});

test('validates the exact C2 review task and candidate fixtures', async () => {
  const task = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  validatePayload('review-task', task);
  validatePayload('review-candidate', { task, candidate });
});

test('runs INTERACTIVE_REVIEW through only the five-tool C2 contract', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const begin = runningBegin(task);
  const calls = [];
  let modelInput;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'begin_review_turn') return begin;
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) => ({
          sourceRefId,
          kind: 'page',
          statement: 'Fixture-only source-bound statement.',
        })),
      };
    }
    if (name === 'commit_review_turn_candidate') {
      assert.deepEqual(Object.keys(args).sort(), [
        'attemptRef',
        'leaseGeneration',
        'leaseToken',
        'result',
      ]);
      validatePayload('result-envelope', { task, result: args.result });
      assert.equal(args.result.skillVersion, WISELINK_SKILL_VERSION);
      assert.deepEqual(args.result.sourceRefs, [
        {
          ref: ARTIFACT_REF,
          sha256: ARTIFACT_SHA,
        },
      ]);
      return reviewCommit(task.operationRef);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runInteractiveReviewTurn({
    mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId,
    callTool,
    respond: async ({ input, readSourceRefs }) => {
      modelInput = input;
      const refs = await readSourceRefs([
        reviewTask.resourceRefs[0].sourceRefId,
      ]);
      assert.equal(refs[0].sourceRefId, reviewTask.resourceRefs[0].sourceRefId);
      return { output: candidate, provenance: provenance() };
    },
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.equal(
    JSON.stringify(modelInput).includes('WI-control-plane-only'),
    false,
  );
  assert.equal(
    JSON.stringify(modelInput).includes('ACTX-opaque-fixture'),
    false,
  );
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'begin_review_turn',
      'get_review_turn_context',
      'read_source_refs',
      'commit_review_turn_candidate',
    ],
  );
  assert.ok(calls.every(({ name }) => INTERACTIVE_REVIEW_TOOLS.includes(name)));
});

test('uses read-only status recovery for COMMITTING review attempts', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const recoveryResult = sealResultEnvelope({
    task,
    modelOutput: candidate,
    provenance: provenance(),
    sourceRefs: [{ ref: ARTIFACT_REF, sha256: ARTIFACT_SHA }],
  });
  const calls = [];
  const callTool = async (name) => {
    calls.push(name);
    if (name === 'begin_review_turn') {
      return {
        ...runningBegin(task),
        status: 'COMMITTING',
        recoveryResult,
      };
    }
    if (name === 'get_action_attempt_status') {
      return reviewStatus(task.operationRef, recoveryResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  let modelCalled = false;
  const result = await runInteractiveReviewTurn({
    mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId,
    callTool,
    respond: async () => {
      modelCalled = true;
      return { output: candidate, provenance: provenance() };
    },
  });
  assert.equal(result.outcome, 'COMMITTING_RECOVERY_READ_ONLY');
  assert.equal(modelCalled, false);
  assert.deepEqual(calls, ['begin_review_turn', 'get_action_attempt_status']);
});

test('does one status read and no blind retry after unknown review commit', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const calls = [];
  const callTool = async (name) => {
    calls.push(name);
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: [
          {
            sourceRefId: reviewTask.resourceRefs[0].sourceRefId,
            kind: 'page',
            statement: 'Fixture-only source-bound statement.',
          },
        ],
      };
    }
    if (name === 'commit_review_turn_candidate') {
      throw new Error('TRANSPORT_RESPONSE_LOST');
    }
    if (name === 'get_action_attempt_status') {
      return {
        ...reviewStatus(task.operationRef, null),
        status: 'SUCCEEDED',
        recoveryAvailable: false,
      };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  await assert.rejects(
    runInteractiveReviewTurn({
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: reviewTask.reviewConversationRef,
      requestId: reviewTask.requestId,
      callTool,
      respond: async ({ readSourceRefs }) => {
        await readSourceRefs([reviewTask.resourceRefs[0].sourceRefId]);
        return { output: candidate, provenance: provenance() };
      },
    }),
    /HOST_MCP_REVIEW_COMMIT_OUTCOME_UNKNOWN/u,
  );
  assert.equal(
    calls.filter((name) => name === 'commit_review_turn_candidate').length,
    1,
  );
  assert.equal(
    calls.filter((name) => name === 'get_action_attempt_status').length,
    1,
  );
});

test('fails closed for attachment, search, compare, and resynthesis expansion', async () => {
  const task = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);

  assert.throws(
    () =>
      validatePayload('review-task', {
        ...task,
        attachmentRefs: ['attachment://unavailable'],
      }),
    /REVIEW_TASK_ATTACHMENTS_OUT_OF_SCOPE/u,
  );
  assert.throws(
    () =>
      validatePayload('review-task', {
        ...task,
        allowedOperations: [
          ...task.allowedOperations,
          'SEARCH_ALLOWED_KNOWLEDGE',
        ],
      }),
    /REVIEW_TASK_ALLOWED_OPERATIONS_INVALID/u,
  );
  assert.throws(
    () =>
      validateReviewCandidate(task, {
        ...candidate,
        responseType: 'RESYNTHESIS_RESULT',
      }),
    /REVIEW_CANDIDATE_RESPONSE_TYPE_UNSUPPORTED_BY_C2/u,
  );
  assert.equal(task.allowedOperations.includes('COMPARE_REVISIONS'), false);
  assert.equal(task.allowedOperations.includes('REEVALUATE_AFFECTED'), false);
});

test('rejects tenant, credential, FileService, raw PDF, or Fleet leakage', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const callTool = async (name) => {
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      const context = reviewContext(task, reviewTask);
      context.context.tenantId = 'tenant-secret';
      return context;
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  await assert.rejects(
    runInteractiveReviewTurn({
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: reviewTask.reviewConversationRef,
      requestId: reviewTask.requestId,
      callTool,
      respond: async () => {
        throw new Error('MODEL_MUST_NOT_RUN');
      },
    }),
    /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN/u,
  );
});

function provenance(overrides = {}) {
  return {
    modelVersion: WISELINK_MODEL_VERSION,
    promptVersion: 'r09.prompt.fixture.1',
    skillVersion: WISELINK_SKILL_VERSION,
    toolVersions: {
      [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
    },
    runMetrics: {
      durationMs: 12,
      inputUnits: 10,
      outputUnits: 8,
    },
    ...overrides,
  };
}

function makeTask(taskType, modelInput) {
  const unsealed = {
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: `ATT-${taskType}`,
    operationRef: `AQ-${taskType}`,
    taskType,
    priority: 100,
    tenantId: 'tenant-control-plane',
    workItemId: WORK_ITEM_ID,
    inputRevision: 7,
    baseRevision: 7,
    documentVersionId: 'DV-fixture-001',
    sourceRefs: [{ ref: ARTIFACT_REF, sha256: ARTIFACT_SHA }],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: structuredClone(modelInput),
    deadline: '2026-08-27T12:00:00.000Z',
    idempotencyKey: `fixture:${taskType}`,
  };
  return { ...unsealed, inputHash: canonicalSha256(unsealed) };
}

function runningBegin(task, extra = {}) {
  return {
    attemptRef: task.operationRef,
    status: 'RUNNING',
    leaseToken: LEASE_TOKEN,
    leaseGeneration: 3,
    leaseExpiresAt: '2026-08-27T11:00:00.000Z',
    task,
    ...extra,
  };
}

function translationInput() {
  return {
    schemaVersion: 'wiselink.3_1.translation_task.v0.candidate',
    sourceUnits: [
      {
        unitKey: 'unit-001',
        kind: 'paragraph',
        text: 'Maintain 28 VDC and ATA 24.',
        sourceRefIds: ['source-ref-001'],
      },
    ],
    rulePack: {
      meta: {
        schemaVersion: 'wiselink.3_1.translation_rule_pack.v0.candidate',
        rulePackId: 'rule-pack-fixture',
        rulePackVersion: '1.0.0',
        label: 'Fixture rules',
        targetLocale: 'zh-CN',
        sourceLocales: ['en'],
      },
      terms: [],
      noTranslate: [],
      deterministic: {},
    },
    taskStartBinding: {
      documentId: 'DOC-fixture',
      revisionId: 'REV-fixture',
      packageId: 'PKG-fixture',
      contentHash: 'sha256:fixture',
    },
  };
}

function translationOutput() {
  const input = translationInput();
  return {
    schemaVersion: 'wiselink.3_1.translation_result.v0.candidate',
    rulePackId: input.rulePack.meta.rulePackId,
    rulePackVersion: input.rulePack.meta.rulePackVersion,
    taskStartBinding: structuredClone(input.taskStartBinding),
    candidateUnits: [
      {
        unitKey: 'unit-001',
        text: '保持 28 VDC 和 ATA 24。',
        sourceRefIds: ['source-ref-001'],
        engineerRevision: null,
      },
    ],
  };
}

function buildDynamicRulesOutput(input) {
  const table = input.jobAidContext.criterionTable;
  const criterionIndex = table.columns.indexOf('criterionId');
  const predicateIndex = table.columns.indexOf('predicateResult');
  const conclusionIndex = table.columns.indexOf('candidateConclusion');
  const sourceIndex = table.columns.indexOf('sourceEvidenceCandidateIds');
  const missingIndex = table.columns.indexOf('missingPredicateKeys');
  const missingRules = new Map();
  const rows = table.rows.map((row, index) => {
    const ruleId = String(row[criterionIndex]);
    const predicate = dynamicValue(table, predicateIndex, index);
    const conclusion = dynamicValue(table, conclusionIndex, index);
    const sourceRefs = dynamicValue(table, sourceIndex, index);
    const missingInputs = dynamicValue(table, missingIndex, index);
    for (const missingInputId of missingInputs) {
      const rules = missingRules.get(missingInputId) ?? [];
      rules.push(ruleId);
      missingRules.set(missingInputId, rules);
    }
    if (predicate === 'FALSE') {
      return [
        ruleId,
        'NOT_APPLICABLE',
        [],
        '谓词 FALSE。',
        '不适用。',
        'not_applicable',
        [],
        [],
        false,
      ];
    }
    if (predicate === 'UNKNOWN') {
      return [
        ruleId,
        'UNKNOWN/WAITING_INPUT',
        [],
        '缺谓词。',
        '待补输入。',
        'insufficient_data',
        [],
        [...missingInputs],
        true,
      ];
    }
    return [
      ruleId,
      conclusion === 'pass' ? 'CANDIDATE_PASS' : 'CANDIDATE_REVIEW_REQUIRED',
      sourceRefs.length > 0 ? ['SOURCE_BOUND'] : [],
      '候选判断。',
      sourceRefs.length > 0 ? '有来源。' : '待复核。',
      conclusion,
      [...sourceRefs],
      [],
      conclusion === 'conditional',
    ];
  });
  const nextRoundChecklist = [...missingRules.entries()]
    .slice(0, input.responseInstruction.nextRoundChecklist.maxItems)
    .map(([missingInputId, affectedRuleIds]) => ({
      missingInputId,
      description: `补充 ${missingInputId}`,
      affectedRuleIds,
      requestedEvidenceOrFact: missingInputId,
      priority: 'HIGH',
      blocking: true,
    }));
  return {
    callerCorrelationRef: input.callerCorrelationRef,
    authorityLevel: 'candidate_only',
    engineeringConclusion: null,
    applicabilityOverall:
      input.jobAidContext.currentAssessment.applicabilityOverall,
    ruleResults: {
      columns: [...input.responseInstruction.ruleResultRequiredFields],
      rows,
    },
    overallSelfCheck: {
      ruleResultCount: rows.length,
      rulesWithMissingInputs: rows.filter((row) => row[7].length > 0).length,
      humanReviewRequiredCount: rows.filter((row) => row[8]).length,
      overallOpinionProduced: false,
      holisticSynthesisDeferredToOpenClaw: true,
    },
    nextRoundChecklist,
    completionSelfCheck: {
      expectedRuleCount: rows.length,
      sourcePageCount:
        input.responseInstruction.completionSelfCheck.sourcePageCount,
      allInputRulesReturned: true,
      returnedRuleIdsMatchInputOrder: true,
      returnedRuleIdsUnique: true,
    },
  };
}

function dynamicValue(table, columnIndex, rowIndex) {
  const encoded = table.rows[rowIndex][columnIndex];
  const dictionary = table.valueDictionaries?.[table.columns[columnIndex]];
  return Number.isInteger(encoded) && Array.isArray(dictionary)
    ? structuredClone(dictionary[encoded])
    : structuredClone(encoded);
}

function synthesisInput() {
  const sourceRefId = `urn:techpub:source-ref:v1:sha256:${'c'.repeat(64)}`;
  const packageId = `urn:techpub:package:v1:sha256:${'d'.repeat(64)}`;
  return {
    operation: 'SYNTHESIZE_OVERALL_CANDIDATE',
    outputCorrelationRef: 'REQ-OVERALL-001',
    baseRuleResult: {
      sourceResultId: 'openclaw-dynamic://REQ-DYNAMIC',
      revision: 1,
      artifactSha256: `sha256:${'e'.repeat(64)}`,
      documentVersionId: 'DV-fixture-001',
      packageId,
      packageArtifactSha256: `sha256:${'f'.repeat(64)}`,
      criterionSetId: 'criterion-set-fixture',
      criterionCount: 1,
      evaluationItemCount: 1,
      unresolvedCount: 1,
      sourceBoundCandidateCount: 1,
      items: [
        {
          criterionId: 'criterion-001',
          status: 'UNKNOWN/WAITING_INPUT',
          sourceRefIds: [sourceRefId],
          fact: null,
          analysis: 'Controlled dynamic candidate.',
          candidateConclusion: 'UNKNOWN/WAITING_INPUT',
          missingInputs: ['Controlled FleetFacts'],
          authorityLevel: 'candidate_only',
        },
      ],
    },
    unifiedSourceContext: {
      documentVersionId: 'DV-fixture-001',
      packageId,
      packageArtifactSha256: `sha256:${'f'.repeat(64)}`,
      contractRevision: 'frozen.2',
      contentUnitCount: 1,
      sourceRefCount: 1,
      sourceRefs: [
        {
          sourceRefId,
          locator: 'page 1',
          excerpt: null,
        },
      ],
    },
    adoptedDocumentVersions: [
      {
        documentVersionId: 'DV-fixture-001',
        publisher: 'BOEING',
        documentNumber: 'DOC-fixture',
        revisionLabel: 'REV-fixture',
        adoptionStatus: 'ADOPTED',
        currentness: 'CURRENT',
      },
    ],
    engineerReviewContext: {
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    },
    externalDiscoveryResults: [],
  };
}

function synthesisOutput(input) {
  return {
    sourceResultId: input.outputCorrelationRef,
    documentVersionId: input.baseRuleResult.documentVersionId,
    packageId: input.baseRuleResult.packageId,
    baseRuleRevision: input.baseRuleResult.revision,
    baseRuleArtifactSha256: input.baseRuleResult.artifactSha256,
    engineerReviewRevision: null,
    engineerReviewArtifactSha256: null,
    discoveryStatus: 'NO_DISCOVERY',
    gap: 'Controlled FleetFacts are missing.',
    candidateRefCount: 0,
    findingCount: 1,
    unresolvedCount: 1,
    authorityLevel: 'candidate_only',
    externalDiscoveryIsEvidence: false,
    adopted: false,
    usableAsEvidence: false,
    providers: {},
    overallCandidate: 'Candidate only; applicability remains unknown.',
    findings: [
      {
        finding: 'Controlled applicability facts are missing.',
        basis: 'Dynamic N/N and frozen.2 SourceRef',
        sourceRefIds: [input.unifiedSourceContext.sourceRefs[0].sourceRefId],
        assumptions: [],
        uncertainty: 'Fleet applicability is not established.',
      },
    ],
    missingInputs: ['Controlled FleetFacts'],
    applicabilityStatus: 'UNKNOWN/WAITING_INPUT',
    engineeringReviewRequired: true,
  };
}

function status(workItemId) {
  return { entry: { workItemId }, integratedAssessmentSummary: null };
}

function statusWithDynamic(workItemId, correlationRef) {
  return {
    entry: { workItemId },
    integratedAssessmentSummary: {
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        sourceResultId: `openclaw-dynamic://${correlationRef}`,
        criterionCount: 1,
        evaluationItemCount: 1,
      },
      overallSynthesis: null,
    },
  };
}

function statusWithOverall(workItemId, correlationRef) {
  return {
    entry: { workItemId },
    integratedAssessmentSummary: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        sourceResultId: 'openclaw-dynamic://REQ-DYNAMIC',
        criterionCount: 1,
        evaluationItemCount: 1,
      },
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        sourceResultId: correlationRef,
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
      },
    },
  };
}

function reviewContext(task, reviewTask) {
  return {
    schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2',
    attemptRef: task.operationRef,
    reviewConversationRef: reviewTask.reviewConversationRef,
    reviewTurnRef: reviewTask.reviewTurnRef,
    mode: 'INTERACTIVE_REVIEW',
    selectedEvaluationItemId: reviewTask.selectedEvaluationItemId,
    inputRevision: reviewTask.inputRevision,
    allowedOperations: [...reviewTask.allowedOperations],
    resourceRefs: reviewTask.resourceRefs.map((resource) => ({
      sourceRefId: resource.sourceRefId,
      resourceArtifactRef: resource.resourceArtifactRef,
      resourceArtifactSha256: resource.resourceArtifactSha256,
    })),
    context: structuredClone(reviewTask.context),
    executionPolicy: structuredClone(reviewTask.executionPolicy),
  };
}

function reviewCommit(attemptRef) {
  return {
    schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2',
    attemptRef,
    status: 'SUCCEEDED',
    replayed: false,
    assistantCandidate: {},
    authority: {
      candidatePersisted: true,
      reviewActionExecuted: false,
      workItemRevisionChanged: false,
      currentChanged: false,
      staleMarked: false,
    },
  };
}

function reviewStatus(attemptRef, recoveryResult) {
  return {
    schemaVersion: 'wiselink.3_1.review_action_attempt_status.v1.c2',
    attemptRef,
    status: 'COMMITTING',
    recoveryAvailable: recoveryResult !== null,
    commitStartedAt: '2026-08-27T10:00:00.000Z',
    leaseGeneration: 3,
    leaseExpiresAt: '2026-08-27T11:00:00.000Z',
    terminalReason: null,
    projectionApplied: false,
    ...(recoveryResult ? { recoveryResult } : {}),
  };
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
