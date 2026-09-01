import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION,
  WISELINK_MODEL_POLICY_REF,
  WISELINK_APPLICABILITY_PROMPT_VERSION,
  WISELINK_SKILL_VERSION,
  buildApplicabilityCandidate,
  canonicalSha256,
  sealResultEnvelope,
  validatePayload,
  validateReviewCandidate,
} from '../scripts/validate-payload.mjs';
import {
  HOST_MCP_TOOLS,
  INITIAL_ANALYSIS_OPERATIONS,
  INTERACTIVE_REVIEW_TOOLS,
  commitTranslationPayloadFile,
  runDynamicEvaluation,
  runApplicabilityEvaluation,
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
const REVIEW_ATTACHMENT_TASK_FIXTURE_URL = new URL(
  './fixtures/review-turn-task-attachment.c2.json',
  import.meta.url,
);
const REVIEW_CANDIDATE_FIXTURE_URL = new URL(
  './fixtures/review-turn-candidate.c2.json',
  import.meta.url,
);
const APPLICABILITY_TASK_FIXTURE_URL = new URL(
  './fixtures/applicability-task.c4.json',
  import.meta.url,
);
const APPLICABILITY_AST_FIXTURE_URL = new URL(
  './fixtures/applicability-ast-candidate.c4.json',
  import.meta.url,
);

const ARTIFACT_REF = 'artifact://fixture/frozen-package';
const ARTIFACT_SHA = 'b'.repeat(64);
const LEASE_TOKEN = '9bc7de9d-1e86-4c12-8e78-e27cce3aa0d4';
const WORK_ITEM_ID = 'WI-CONTROL-001';

test('pins exact20 MCP 1.2, five review tools, and hosted provenance', () => {
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
  assert.equal(HOST_MCP_TOOLS.length, 20);
  assert.equal(new Set(HOST_MCP_TOOLS).size, 20);
  assert.ok(HOST_MCP_TOOLS.includes('begin_applicability_evaluation'));
  assert.ok(HOST_MCP_TOOLS.includes('commit_applicability_candidate'));
  assert.equal(
    WISELINK_SKILL_VERSION,
    'wiselink-research-and-synthesize@r09.c4',
  );
  assert.equal(WISELINK_MODEL_POLICY_REF, 'official-hosted-profile-config');
  assert.equal(WISELINK_HOST_MCP_VERSION, '1.2.0');
});

test('runs real applicability AST extraction through dedicated begin/commit', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  const task = makeTask('OPENCLAW_APPLICABILITY_EVALUATION', input);
  const begin = runningBegin(task, { modelInput: input });
  const calls = [];
  let modelInput;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'begin_applicability_evaluation') return begin;
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_applicability_candidate') {
      validatePayload('result-envelope', { task, result: args.result });
      const candidate = JSON.parse(args.result.modelOutput);
      assert.equal(
        candidate.schemaVersion,
        'wiselink.3_1.applicability_candidate.v1',
      );
      assert.equal(candidate.expressions.length, 1);
      assert.equal(
        Object.hasOwn(candidate.expressions[0], 'applicabilityLevel'),
        false,
      );
      assert.equal(
        Object.hasOwn(candidate.expressions[0], 'contentRef'),
        false,
      );
      assert.equal(args.attemptRef, task.operationRef);
      assert.equal(args.leaseToken, LEASE_TOKEN);
      assert.equal(args.leaseGeneration, 3);
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 8,
        status: 'CANDIDATE_ONLY',
        applicability: {
          status: 'CANDIDATE_ONLY',
          actionAttemptId: task.actionAttemptId,
        },
      };
    }
    if (name === 'get_deep_link') {
      return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runInitialAnalysis({
    mode: 'INITIAL_ANALYSIS',
    operation: 'EXTRACT_APPLICABILITY',
    applicabilityContextRef: input.applicabilityContextRef,
    requestId: 'REQ-applicability-001',
    callTool,
    extractApplicability: async (value) => {
      modelInput = value;
      return {
        output: astCandidate,
        provenance: applicabilityProvenance(),
      };
    },
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.equal(Object.hasOwn(modelInput, 'tenantId'), false);
  assert.equal(Object.hasOwn(modelInput, 'workItemId'), false);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'begin_applicability_evaluation',
      'get_parse_status',
      'heartbeat_action_attempt',
      'heartbeat_action_attempt',
      'commit_applicability_candidate',
      'get_parse_status',
      'get_deep_link',
    ],
  );
});

test('rejects an operator outside the Host-frozen applicability vocabulary before commit', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  astCandidate.expressions[0].expressionAst = {
    type: 'assert',
    property: 'lineNumber',
    operator: 'between',
    value: [100, 200],
  };
  assert.throws(
    () => validatePayload('applicability-pair', { input, output: astCandidate }),
    /APPLICABILITY_AST_ASSERT_UNSUPPORTED/u,
  );
});

test('propagates only Host-frozen applicability missing input without a model call', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const missingInputs = [
    {
      code: 'FLEET_MISSING_CONTROLLED_FACT_fixture',
      message: 'Controlled aircraft fact is missing.',
    },
  ];
  const task = makeTask(
    'OPENCLAW_APPLICABILITY_EVALUATION',
    input,
    missingInputs,
  );
  const begin = runningBegin(task, { modelInput: input });
  let modelCallCount = 0;
  const calls = [];
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === 'begin_applicability_evaluation') return begin;
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'commit_applicability_candidate') {
      assert.equal(args.result.status, 'WAITING_INPUT');
      assert.deepEqual(args.result.missingInputs, missingInputs);
      assert.deepEqual(args.result.conflicts, []);
      assert.equal(args.result.modelOutput, null);
      return {
        attemptRef: task.operationRef,
        status: 'WAITING_INPUT',
        projectionApplied: false,
        terminalReason: 'HOST_RESOLVED_MISSING_INPUT',
      };
    }
    if (name === 'get_deep_link') return { deepLink: '/work-item/fixture' };
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runApplicabilityEvaluation({
    applicabilityContextRef: input.applicabilityContextRef,
    requestId: 'REQ-applicability-waiting',
    callTool,
    extractApplicability: async () => {
      modelCallCount += 1;
      throw new Error('MODEL_MUST_NOT_RUN');
    },
    runtimeProvenance: applicabilityProvenance({
      runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
    }),
  });
  assert.equal(result.outcome, 'WAITING_INPUT');
  assert.equal(modelCallCount, 0);
  assert.equal(
    calls.filter((name) => name === 'commit_applicability_candidate').length,
    1,
  );
});

test('keeps the real 777 FTD AIMS-2 condition in its own preliminary overall', async () => {
  const applicabilityInput = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const missingInputs = [
    {
      code: 'FLEET_MISSING_CONTROLLED_FACT_EQUIPMENTMODELINSTALLED_AIMS2',
      message:
        'Controlled Fleet fact equipmentModelInstalled[AIMS2] is unavailable for aircraft B-1266 as of 2026-08-27.',
    },
  ];
  const applicabilityTask = makeTask(
    'OPENCLAW_APPLICABILITY_EVALUATION',
    applicabilityInput,
    missingInputs,
  );
  let applicabilityModelCalls = 0;
  const applicability = await runInitialAnalysis({
    mode: 'INITIAL_ANALYSIS',
    operation: 'EXTRACT_APPLICABILITY',
    applicabilityContextRef: applicabilityInput.applicabilityContextRef,
    requestId: 'REQ-applicability-aims2-waiting',
    callTool: async (name, args) => {
      if (name === 'begin_applicability_evaluation') {
        return runningBegin(applicabilityTask, {
          modelInput: applicabilityInput,
        });
      }
      if (name === 'get_parse_status') return status(WORK_ITEM_ID);
      if (name === 'commit_applicability_candidate') {
        validatePayload('result-envelope', {
          task: applicabilityTask,
          result: args.result,
        });
        return {
          attemptRef: applicabilityTask.operationRef,
          status: 'WAITING_INPUT',
          projectionApplied: false,
          terminalReason: 'HOST_RESOLVED_MISSING_INPUT',
        };
      }
      if (name === 'get_deep_link') {
        return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
    extractApplicability: async () => {
      applicabilityModelCalls += 1;
      throw new Error('MODEL_MUST_NOT_RUN');
    },
    runtimeProvenance: applicabilityProvenance({
      runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
    }),
  });
  assert.equal(applicability.ok, true);
  assert.equal(applicability.outcome, 'WAITING_INPUT');
  assert.equal(applicabilityModelCalls, 0);

  const dynamicInput = await readJson(DYNAMIC_FIXTURE_URL);
  const dynamicOutput = buildDynamicRulesOutput(dynamicInput);
  const dynamicTask = makeTask('OPENCLAW_DYNAMIC_EVALUATION', dynamicInput);
  let dynamicModelCalls = 0;
  const dynamic = await runInitialAnalysis({
    mode: 'INITIAL_ANALYSIS',
    operation: 'EVALUATE_JOBAID',
    workItemId: WORK_ITEM_ID,
    callTool: async (name, args) => {
      if (name === 'get_parse_status') return status(WORK_ITEM_ID);
      if (name === 'begin_dynamic_evaluation') {
        return runningBegin(dynamicTask, { modelInput: dynamicInput });
      }
      if (name === 'heartbeat_action_attempt') {
        return heartbeatResult(dynamicTask, args);
      }
      if (name === 'commit_dynamic_evaluation_candidate') {
        validatePayload('result-envelope', {
          task: dynamicTask,
          result: args.result,
        });
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
    },
    evaluateDynamicRules: async () => {
      dynamicModelCalls += 1;
      return { output: dynamicOutput, provenance: provenance() };
    },
  });
  assert.equal(dynamic.outcome, 'CANDIDATE_ONLY');
  assert.equal(dynamicModelCalls, 1);

  const overallInput = synthesisInput();
  overallInput.baseRuleResult.items[0].missingInputs = [
    missingInputs[0].message,
  ];
  const overallOutput = synthesisOutput(overallInput);
  overallOutput.gap = 'AIMS-2 configuration data is not connected.';
  overallOutput.overallCandidate =
    '飞机身份和机型已知；AIMS-2 构型数据未接入，适用性保持条件性未知，需工程师或后续受控数据确认；当前可形成初步工程综合候选，但不得最终批准或发布。';
  overallOutput.engineeringSummary.conclusion.text =
    overallOutput.overallCandidate;
  overallOutput.engineeringSummary.applicability.sourceScope.text =
    '当前 777 FTD 的来源适用范围要求飞机装有 AIMS-2 平台。';
  overallOutput.engineeringSummary.applicability.fleetMatch.text =
    '所选飞机的 AIMS-2 受控构型事实缺失，因此当前匹配保持条件性未知。';
  overallOutput.engineeringSummary.applicability.requiredFacts[0].text =
    missingInputs[0].message;
  overallOutput.engineeringSummary.nextActions[0].text =
    '核对所选 777 飞机是否装有 AIMS-2 平台的受控构型事实。';
  overallOutput.findings[0] = {
    finding: '飞机身份和机型已知，AIMS-2 构型状态未知。',
    basis: 'Dynamic N/N and frozen.2 SourceRef',
    sourceRefIds: [overallInput.unifiedSourceContext.sourceRefs[0].sourceRefId],
    assumptions: [],
    uncertainty: 'AIMS-2 构型数据未接入，适用性需人工或后续数据确认。',
  };
  overallOutput.missingInputs = [missingInputs[0].message];
  const overallTask = makeTask('OPENCLAW_OVERALL_SYNTHESIS', {
    modelInput: overallInput,
    selectedDiscoveryRefs: [],
    providerCodes: [],
  });
  let overallStatusReads = 0;
  let overallModelCalls = 0;
  const overall = await runInitialAnalysis({
    mode: 'INITIAL_ANALYSIS',
    operation: 'SYNTHESIZE_OVERALL',
    workItemId: WORK_ITEM_ID,
    providers: [],
    callTool: async (name, args) => {
      if (name === 'get_parse_status') {
        overallStatusReads += 1;
        return overallStatusReads === 1
          ? statusWithDynamic(WORK_ITEM_ID, 'REQ-DYNAMIC')
          : statusWithOverall(WORK_ITEM_ID, overallInput.outputCorrelationRef);
      }
      if (name === 'begin_overall_synthesis') {
        return runningBegin(overallTask, {
          modelInput: overallInput,
          selectedDiscoveryRefs: [],
        });
      }
      if (name === 'heartbeat_action_attempt') {
        return heartbeatResult(overallTask, args);
      }
      if (name === 'commit_overall_candidate') {
        validatePayload('result-envelope', {
          task: overallTask,
          result: args.result,
        });
        return {
          workItemId: WORK_ITEM_ID,
          workItemRevision: 9,
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
    },
    synthesizeOverall: async () => {
      overallModelCalls += 1;
      return { output: overallOutput, provenance: provenance() };
    },
  });
  assert.equal(overall.outcome, 'CANDIDATE_ONLY');
  assert.equal(overallModelCalls, 1);
  assert.equal(overallOutput.applicabilityStatus, 'UNKNOWN/WAITING_INPUT');
  assert.match(overallOutput.overallCandidate, /初步工程综合候选/u);
  assert.match(overallOutput.overallCandidate, /不得最终批准或发布/u);
});

test('recovers COMMITTING applicability once by generic attempt status hash', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  const task = makeTask('OPENCLAW_APPLICABILITY_EVALUATION', input);
  const recoveryResult = sealResultEnvelope({
    task,
    modelOutput: buildApplicabilityCandidate(input, astCandidate),
    provenance: applicabilityProvenance(),
    factsConsidered: input.controlledFacts.map(({ factId }) => factId),
  });
  const calls = [];
  const callTool = async (name) => {
    calls.push(name);
    if (name === 'begin_applicability_evaluation') {
      return {
        ...runningBegin(task, { modelInput: input }),
        status: 'COMMITTING',
        recoveryResult,
      };
    }
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'get_action_attempt_status') {
      return attemptStatus(task, 'COMMITTING', recoveryResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  let modelCallCount = 0;
  const result = await runApplicabilityEvaluation({
    applicabilityContextRef: input.applicabilityContextRef,
    requestId: 'REQ-applicability-committing',
    callTool,
    extractApplicability: async () => {
      modelCallCount += 1;
      throw new Error('MODEL_MUST_NOT_RUN');
    },
  });
  assert.equal(result.outcome, 'COMMITTING_RECOVERY_READ_ONLY');
  assert.equal(modelCallCount, 0);
  assert.deepEqual(calls, [
    'begin_applicability_evaluation',
    'get_parse_status',
    'get_action_attempt_status',
  ]);
});

test('recovers applicability commit response loss once and never retries commit', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  const task = makeTask('OPENCLAW_APPLICABILITY_EVALUATION', input);
  const calls = [];
  let submittedResult;
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === 'begin_applicability_evaluation') {
      return runningBegin(task, { modelInput: input });
    }
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_applicability_candidate') {
      submittedResult = args.result;
      throw new Error('TRANSPORT_RESPONSE_LOST');
    }
    if (name === 'get_action_attempt_status') {
      return attemptStatus(task, 'SUCCEEDED', submittedResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runApplicabilityEvaluation({
    applicabilityContextRef: input.applicabilityContextRef,
    requestId: 'REQ-applicability-response-loss',
    callTool,
    extractApplicability: async () => ({
      output: astCandidate,
      provenance: applicabilityProvenance(),
    }),
  });
  assert.equal(result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(
    calls.filter((name) => name === 'commit_applicability_candidate').length,
    1,
  );
  assert.equal(
    calls.filter((name) => name === 'get_action_attempt_status').length,
    1,
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

test('seals actual model provenance without binding the Skill to one model version', () => {
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
  assert.equal(
    sealResultEnvelope({
      task,
      modelOutput: translationOutput(),
      provenance: provenance({
        modelVersion: 'official-provider/model-release-2',
      }),
    }).modelVersion,
    'official-provider/model-release-2',
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
  for (const modelVersion of ['', 'fallback', 'unknown']) {
    assert.throws(
      () =>
        sealResultEnvelope({
          task,
          modelOutput: translationOutput(),
          provenance: provenance({ modelVersion }),
        }),
      /RUNTIME_MODEL_PROVENANCE_(?:REQUIRED|UNREADABLE)/u,
    );
  }
});

test('rejects Host-incompatible numeric tokenization with unit diagnostics', () => {
  const cases = [
    {
      label: 'letter-glued digits split into an extra standalone token',
      unitKey: 'SYNTH-GLUED-DIGITS',
      sourceText: 'Retain OCRX123.',
      translatedText: '保留 OCRX 123。',
    },
    {
      label: 'leading-zero token split',
      unitKey: 'SYNTH-LEADING-ZERO',
      sourceText: 'Retain 007.',
      translatedText: '保留 00 7。',
    },
    {
      label: 'concatenated decimal table string reordered',
      unitKey: 'SYNTH-DECIMAL-TABLE',
      sourceText: 'Retain 40.512.7.',
      translatedText: '保留 40.5 12.7。',
    },
  ];
  for (const { label, unitKey, sourceText, translatedText } of cases) {
    const input = translationInput();
    const output = translationOutput();
    input.sourceUnits[0].unitKey = unitKey;
    output.candidateUnits[0].unitKey = unitKey;
    input.sourceUnits[0].text = sourceText;
    output.candidateUnits[0].text = translatedText;
    assert.throws(
      () => validatePayload('translation-pair', { input, output }),
      (error) => {
        assert.match(error.message, /TRANSLATION_RULE_PREFLIGHT_REJECTED/u);
        assert.match(error.message, /NUMBER_NOT_PRESERVED/u);
        assert.match(error.message, new RegExp(unitKey, 'u'));
        return true;
      },
      label,
    );
  }
});

test('rejects a missing ATA token after the numeric multiset still matches', () => {
  const input = translationInput();
  const output = translationOutput();
  input.sourceUnits[0].unitKey = 'SYNTH-ATA';
  output.candidateUnits[0].unitKey = 'SYNTH-ATA';
  input.sourceUnits[0].text = 'Retain ATA 31-21 with marker 8.';
  output.candidateUnits[0].text = '保留 ATA 31 和 21，并保留标记 8。';
  assert.throws(
    () => validatePayload('translation-pair', { input, output }),
    (error) => {
      assert.match(error.message, /TRANSLATION_RULE_PREFLIGHT_REJECTED/u);
      assert.match(error.message, /ATA_CHAPTER_NOT_PRESERVED/u);
      assert.match(error.message, /SYNTH-ATA/u);
      return true;
    },
  );
});

test('accepts a normal Chinese translation with Host tokens preserved', () => {
  const input = translationInput();
  const output = translationOutput();
  input.sourceUnits[0].text = 'Retain OCRX123, 007, 40.512.7, and ATA 31-21.';
  output.candidateUnits[0].text = '保留 OCRX123、007、40.512.7 和 ATA 31-21。';
  validatePayload('translation-pair', { input, output });
});

test('does not treat mm inside ordinary words as a preserved engineering unit', () => {
  const input = translationInput();
  const output = translationOutput();
  input.rulePack.deterministic.preservedUnits = ['mm'];
  input.sourceUnits[0].text =
    'Commercial Summary recommended common Accomplishment.';
  output.candidateUnits[0].text = '商业摘要、建议、通用和实施。';
  validatePayload('translation-pair', { input, output });
});

test('rejects missing mandatory terms and real engineering units before Host commit', () => {
  const input = translationInput();
  const output = translationOutput();
  input.rulePack.terms = [
    {
      ruleId: 'term.airplane',
      sourceTerm: 'airplane',
      targetRenderings: ['飞机'],
      severity: 'mandatory',
    },
  ];
  input.rulePack.deterministic.preservedUnits = ['mm'];
  input.sourceUnits[0].unitKey = 'ACTUAL-777-PREFLIGHT';
  input.sourceUnits[0].text = 'The airplane requires a 10mm clearance.';
  output.candidateUnits[0].unitKey = 'ACTUAL-777-PREFLIGHT';
  output.candidateUnits[0].text = '该设备要求保持 10 的间隙。';

  assert.throws(
    () => validatePayload('translation-pair', { input, output }),
    (error) => {
      assert.match(error.message, /TERM_MANDATORY_MISSING/u);
      assert.match(error.message, /UNIT_NOT_PRESERVED/u);
      assert.match(error.message, /ACTUAL-777-PREFLIGHT/u);
      return true;
    },
  );
});

test('stops invalid translation before seal, post-model heartbeat, or upload', async () => {
  const input = translationInput();
  input.sourceUnits[0].unitKey = 'SYNTH-PRECOMMIT';
  input.sourceUnits[0].text = 'Retain OCRX123.';
  const output = translationOutput();
  output.candidateUnits[0].unitKey = 'SYNTH-PRECOMMIT';
  output.candidateUnits[0].text = '保留 OCRX 123。';
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const [begin] = translationDeliveryParts(task, input);
  const calls = [];
  await assert.rejects(
    runTranslation({
      workItemId: WORK_ITEM_ID,
      callTool: async (name, args) => {
        calls.push(name);
        if (name === 'get_parse_status') return status(WORK_ITEM_ID);
        if (name === 'begin_translation') return begin;
        if (name === 'heartbeat_action_attempt') {
          return heartbeatResult(task, args);
        }
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      },
      translate: async () => ({ output, provenance: provenance() }),
    }),
    /NUMBER_NOT_PRESERVED.*SYNTH-PRECOMMIT|SYNTH-PRECOMMIT.*NUMBER_NOT_PRESERVED/u,
  );
  assert.deepEqual(calls, [
    'get_parse_status',
    'begin_translation',
    'heartbeat_action_attempt',
  ]);
});

test('runs translation with fresh status and full fenced ResultEnvelope', async () => {
  const input = translationInput();
  input.sourceUnits.push({
    unitKey: 'unit-002',
    kind: 'paragraph',
    text: 'Inspect ATA 32 before release.',
    sourceRefIds: ['source-ref-002'],
  });
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const deliveryParts = translationDeliveryParts(task, input, { batchSize: 1 });
  const output = translationOutput();
  output.candidateUnits.push({
    unitKey: 'unit-002',
    text: '放行前检查 ATA 32。',
    sourceRefIds: ['source-ref-002'],
    engineerRevision: null,
  });
  const calls = [];
  const uploaded = new Map();
  let deliveredModelInput;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'begin_translation') {
      return deliveryParts[args.deliveryPart ?? 0];
    }
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_translation_candidate') {
      assert.equal(args.attemptRef, task.operationRef);
      assert.equal(args.leaseToken, LEASE_TOKEN);
      assert.equal(args.leaseGeneration, 3);
      if (args.phase === 'UPLOAD_PART') {
        return stageTranslationPart(args, uploaded);
      }
      assert.equal(args.phase, 'FINALIZE');
      const assembled = assembleTranslationParts(args, uploaded);
      validatePayload('result-envelope', { task, result: assembled });
      assert.deepEqual(assembled.sourceRefs, []);
      assert.equal(
        JSON.stringify(assembled).includes('tenant-control-plane'),
        false,
      );
      assert.equal(JSON.stringify(assembled).includes(ARTIFACT_REF), false);
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
    translate: async (modelInput) => {
      deliveredModelInput = modelInput;
      return { output, provenance: provenance() };
    },
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.equal(result.provenance.skillVersion, WISELINK_SKILL_VERSION);
  assert.deepEqual(deliveredModelInput, input);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'get_parse_status',
      'begin_translation',
      'begin_translation',
      'heartbeat_action_attempt',
      'heartbeat_action_attempt',
      'commit_translation_candidate',
      'commit_translation_candidate',
      'get_parse_status',
      'get_deep_link',
    ],
  );
  assert.deepEqual(calls[1].args, { workItemId: WORK_ITEM_ID });
  assert.deepEqual(calls[2].args, {
    workItemId: WORK_ITEM_ID,
    deliveryPart: 1,
  });
});

test('recovers COMMITTING translation through generic status without model or commit', async () => {
  const input = translationInput();
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const recoveryResult = sealResultEnvelope({
    task,
    modelOutput: translationOutput(),
    provenance: provenance(),
  });
  const [begin] = translationDeliveryParts(task, input, {
    status: 'COMMITTING',
    recoveryResult,
  });
  const calls = [];
  let translateCalls = 0;
  const result = await runTranslation({
    workItemId: WORK_ITEM_ID,
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_parse_status') return status(WORK_ITEM_ID);
      if (name === 'begin_translation') return begin;
      if (name === 'get_action_attempt_status') {
        return attemptStatus(task, 'COMMITTING', recoveryResult);
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
    translate: async () => {
      translateCalls += 1;
      throw new Error('MODEL_MUST_NOT_RUN');
    },
  });
  assert.equal(result.outcome, 'COMMITTING_RECOVERY_READ_ONLY');
  assert.equal(translateCalls, 0);
  assert.deepEqual(
    calls.map(({ name }) => name),
    ['get_parse_status', 'begin_translation', 'get_action_attempt_status'],
  );
});

test('recovers translation commit response loss against the delivered task binding', async () => {
  const input = translationInput();
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const [begin] = translationDeliveryParts(task, input);
  const calls = [];
  const uploaded = new Map();
  let submittedResult;
  const result = await runTranslation({
    workItemId: WORK_ITEM_ID,
    callTool: async (name, args) => {
      calls.push(name);
      if (name === 'get_parse_status') return status(WORK_ITEM_ID);
      if (name === 'begin_translation') return begin;
      if (name === 'heartbeat_action_attempt') {
        return heartbeatResult(task, args);
      }
      if (name === 'commit_translation_candidate') {
        if (args.phase === 'UPLOAD_PART') {
          return stageTranslationPart(args, uploaded);
        }
        submittedResult = assembleTranslationParts(args, uploaded);
        throw new Error('TRANSPORT_RESPONSE_LOST');
      }
      if (name === 'get_action_attempt_status') {
        return attemptStatus(task, 'COMMITTING', submittedResult);
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
    translate: async () => ({
      output: translationOutput(),
      provenance: provenance(),
    }),
  });
  assert.equal(result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.deepEqual(calls, [
    'get_parse_status',
    'begin_translation',
    'heartbeat_action_attempt',
    'heartbeat_action_attempt',
    'commit_translation_candidate',
    'commit_translation_candidate',
    'get_action_attempt_status',
  ]);
});

test('reads a locally sealed translation payload file and uploads bounded parts before finalize', async () => {
  const input = translationInput();
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const [begin] = translationDeliveryParts(task, input);
  const result = sealResultEnvelope({
    task,
    modelOutput: translationOutput(),
    provenance: provenance(),
  });
  const directory = await mkdtemp(join(tmpdir(), 'wiselink-translation-'));
  const payloadPath = join(directory, 'commit-payload.json');
  await writeFile(
    payloadPath,
    JSON.stringify({
      attemptRef: begin.attemptRef,
      leaseToken: begin.leaseToken,
      leaseGeneration: begin.leaseGeneration,
      result,
    }),
  );
  const uploaded = new Map();
  try {
    const committed = await commitTranslationPayloadFile({
      begin,
      payloadPath,
      callTool: async (name, args) => {
        assert.equal(name, 'commit_translation_candidate');
        assert.ok(Buffer.byteLength(JSON.stringify(args)) < 12_000);
        if (args.phase === 'UPLOAD_PART') {
          return stageTranslationPart(args, uploaded);
        }
        assert.deepEqual(assembleTranslationParts(args, uploaded), result);
        return { status: 'CANDIDATE_ONLY' };
      },
    });
    assert.deepEqual(committed, { status: 'CANDIDATE_ONLY' });
    assert.equal(uploaded.size, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects each forbidden translation input before the model boundary', async (t) => {
  const leakageCases = [
    ['actor', { actor: { id: 'actor-secret' } }],
    ['tenant', { tenant: 'tenant-secret' }],
    ['ACL normalized key', { A_C_L: ['private-row'] }],
    ['sessionKey', { sessionKey: 'analysis:tenant:work-item:attempt' }],
    [
      'openClawSessionKey',
      { openClawSessionKey: 'analysis:tenant:work-item:attempt' },
    ],
    [
      'openClawSessionKey normalized key',
      { 'open_claw-session key': 'analysis:tenant:work-item:attempt' },
    ],
    ['credential', { credential: 'credential-secret' }],
    ['FileService locator', { file_service_locator: 'bucket/private/path' }],
    ['raw PDF', { 'raw-pdf': 'JVBERi0xLjQ=' }],
    ['full Fleet', { 'full fleet': [{ registration: 'B-0001' }] }],
  ];

  for (const [label, leakage] of leakageCases) {
    await t.test(label, async () => {
      const input = { ...translationInput(), ...leakage };
      const task = makeTask('OPENCLAW_TRANSLATE', input);
      const [begin] = translationDeliveryParts(task, input);
      const toolCalls = [];
      let translateCallCount = 0;
      const callTool = async (name) => {
        toolCalls.push(name);
        if (name === 'get_parse_status') return status(WORK_ITEM_ID);
        if (name === 'begin_translation') return begin;
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      };

      await assert.rejects(
        runTranslation({
          workItemId: WORK_ITEM_ID,
          callTool,
          translate: async () => {
            translateCallCount += 1;
            throw new Error('MODEL_MUST_NOT_RUN');
          },
        }),
        /FORBIDDEN_AUTHORITY_INPUT/u,
      );
      assert.equal(translateCallCount, 0);
      assert.deepEqual(toolCalls, ['get_parse_status', 'begin_translation']);
    });
  }
});

test('rejects actor identity key forms before the translation model boundary', async (t) => {
  const leakageCases = [
    ['actorId exact', { actorId: 'actor-secret' }],
    ['actorId case', { ACTORID: 'actor-secret' }],
    ['actorId separator', { 'actor-id': 'actor-secret' }],
    ['actorId NFKC', { ａｃｔｏｒＩｄ: 'actor-secret' }],
    ['actorContextRef exact', { actorContextRef: 'actor-context-secret' }],
    ['actorContextRef case', { ACTORCONTEXTREF: 'actor-context-secret' }],
    [
      'actorContextRef separator',
      { 'Actor_Context-Ref': 'actor-context-secret' },
    ],
    [
      'actorContextRef NFKC',
      { ａｃｔｏｒＣｏｎｔｅｘｔＲｅｆ: 'actor-context-secret' },
    ],
  ];

  for (const [label, leakage] of leakageCases) {
    await t.test(label, async () => {
      const input = { ...translationInput(), ...leakage };
      const task = makeTask('OPENCLAW_TRANSLATE', input);
      const [begin] = translationDeliveryParts(task, input);
      let translateCallCount = 0;
      const callTool = async (name) => {
        if (name === 'get_parse_status') return status(WORK_ITEM_ID);
        if (name === 'begin_translation') return begin;
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      };

      await assert.rejects(
        runTranslation({
          workItemId: WORK_ITEM_ID,
          callTool,
          translate: async () => {
            translateCallCount += 1;
            throw new Error('MODEL_MUST_NOT_RUN');
          },
        }),
        /FORBIDDEN_AUTHORITY_INPUT/u,
      );
      assert.equal(translateCallCount, 0);
    });
  }
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
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
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
      'heartbeat_action_attempt',
      'heartbeat_action_attempt',
      'commit_dynamic_evaluation_candidate',
      'get_parse_status',
      'get_deep_link',
    ],
  );
});

test('does one generic dynamic status recovery after commit response loss', async () => {
  const input = await readJson(DYNAMIC_FIXTURE_URL);
  const output = buildDynamicRulesOutput(input);
  const task = makeTask('OPENCLAW_DYNAMIC_EVALUATION', input);
  const calls = [];
  let submittedResult;
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === 'get_parse_status') {
      return status(WORK_ITEM_ID);
    }
    if (name === 'begin_dynamic_evaluation') {
      return runningBegin(task, { modelInput: input });
    }
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_dynamic_evaluation_candidate') {
      submittedResult = args.result;
      throw new Error('TRANSPORT_RESPONSE_LOST');
    }
    if (name === 'get_action_attempt_status') {
      return attemptStatus(task, 'SUCCEEDED', submittedResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runDynamicEvaluation({
    workItemId: WORK_ITEM_ID,
    callTool,
    evaluateDynamicRules: async () => ({ output, provenance: provenance() }),
  });
  assert.equal(result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(
    calls.filter((name) => name === 'commit_dynamic_evaluation_candidate')
      .length,
    1,
  );
  assert.equal(calls.filter((name) => name === 'get_parse_status').length, 1);
  assert.equal(
    calls.filter((name) => name === 'get_action_attempt_status').length,
    1,
  );
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
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
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
  const attachmentTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  validatePayload('review-task', task);
  validatePayload('review-task', attachmentTask);
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

test('reads a Host-authorized attachment through the C2 SourceRef path', async () => {
  const reviewTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const baseCandidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  const attachmentRef = reviewTask.attachmentRefs[0];
  const attachmentResource = reviewTask.resourceRefs.find(
    ({ sourceRefId }) => sourceRefId === attachmentRef,
  );
  const candidate = {
    ...baseCandidate,
    reviewConversationRef: reviewTask.reviewConversationRef,
    reviewTurnRef: reviewTask.reviewTurnRef,
    responseType: 'CANDIDATE_EVIDENCE',
    answer: '本候选仅分析 Host 本轮授权并解析后的附件内容。',
    sourceRefs: [attachmentRef],
    missingInputs: [],
    candidateEvidenceRefs: [attachmentRef],
  };
  const task = makeTask(
    'OPENCLAW_INTERACTIVE_REVIEW',
    reviewTask,
    [],
    reviewTask.resourceRefs.map(
      ({ resourceArtifactRef, resourceArtifactSha256 }) => ({
        ref: resourceArtifactRef,
        sha256: resourceArtifactSha256,
      }),
    ),
  );
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
        sourceRefs: args.sourceRefIds.map((sourceRefId) =>
          structuredClone(
            reviewTask.resourceRefs.find(
              (resource) => resource.sourceRefId === sourceRefId,
            ).value,
          ),
        ),
      };
    }
    if (name === 'commit_review_turn_candidate') {
      validatePayload('result-envelope', { task, result: args.result });
      assert.deepEqual(args.result.sourceRefs, [
        {
          ref: attachmentResource.resourceArtifactRef,
          sha256: attachmentResource.resourceArtifactSha256,
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
      const refs = await readSourceRefs([attachmentRef]);
      assert.deepEqual(refs, [attachmentResource.value]);
      return { output: candidate, provenance: provenance() };
    },
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.deepEqual(modelInput.attachmentRefs, [attachmentRef]);
  assert.ok(modelInput.availableSourceRefIds.includes(attachmentRef));
  assert.equal(
    JSON.stringify(modelInput).includes(attachmentResource.resourceArtifactRef),
    false,
  );
  assert.equal(
    JSON.stringify(modelInput).includes(
      attachmentResource.resourceArtifactSha256,
    ),
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
      return attemptStatus(task, 'COMMITTING', recoveryResult);
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

test('recovers review commit response loss by matching the sealed result hash', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const calls = [];
  let submittedResult;
  const callTool = async (name, args) => {
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
      submittedResult = args.result;
      throw new Error('TRANSPORT_RESPONSE_LOST');
    }
    if (name === 'get_action_attempt_status') {
      return attemptStatus(task, 'SUCCEEDED', submittedResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runInteractiveReviewTurn({
    mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId,
    callTool,
    respond: async ({ readSourceRefs }) => {
      await readSourceRefs([reviewTask.resourceRefs[0].sourceRefId]);
      return { output: candidate, provenance: provenance() };
    },
  });
  assert.equal(result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(
    calls.filter((name) => name === 'commit_review_turn_candidate').length,
    1,
  );
  assert.equal(
    calls.filter((name) => name === 'get_action_attempt_status').length,
    1,
  );
});

test('fails closed for invalid attachment relations and unavailable expansion', async () => {
  const task = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);

  assert.throws(
    () =>
      validatePayload('review-task', {
        ...task,
        attachmentRefs: ['ATTACHMENT-not-in-resource-refs'],
      }),
    /REVIEW_TASK_ATTACHMENT_REF_NOT_ALLOWED/u,
  );
  assert.throws(
    () =>
      validatePayload('review-task', {
        ...task,
        attachmentRefs: [
          task.resourceRefs[0].sourceRefId,
          task.resourceRefs[0].sourceRefId,
        ],
      }),
    /REVIEW_TASK_ATTACHMENTS_DUPLICATE/u,
  );
  assert.throws(
    () =>
      validatePayload('review-task', {
        ...task,
        attachmentRefs: [''],
      }),
    /REVIEW_TASK_ATTACHMENTS_INVALID/u,
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

test('rejects duplicate or unknown attachment refs before context and model', async (t) => {
  const reviewTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const attachmentRef = reviewTask.attachmentRefs[0];
  const cases = [
    {
      name: 'duplicate',
      attachmentRefs: [attachmentRef, attachmentRef],
      error: /REVIEW_TASK_ATTACHMENTS_DUPLICATE/u,
    },
    {
      name: 'unknown',
      attachmentRefs: ['ATTACHMENT-from-another-resource'],
      error: /REVIEW_TASK_ATTACHMENT_REF_NOT_ALLOWED/u,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const invalidReviewTask = {
        ...structuredClone(reviewTask),
        attachmentRefs: testCase.attachmentRefs,
      };
      const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', invalidReviewTask);
      const calls = [];
      let respondCallCount = 0;
      const callTool = async (name) => {
        calls.push(name);
        if (name === 'begin_review_turn') return runningBegin(task);
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      };
      await assert.rejects(
        runInteractiveReviewTurn({
          mode: 'INTERACTIVE_REVIEW',
          reviewConversationRef: reviewTask.reviewConversationRef,
          requestId: reviewTask.requestId,
          callTool,
          respond: async () => {
            respondCallCount += 1;
            throw new Error('MODEL_MUST_NOT_RUN');
          },
        }),
        testCase.error,
      );
      assert.deepEqual(calls, ['begin_review_turn']);
      assert.equal(respondCallCount, 0);
    });
  }
});

test('rejects cross-resource review context before model execution', async () => {
  const reviewTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const calls = [];
  let respondCallCount = 0;
  const callTool = async (name) => {
    calls.push(name);
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      const context = reviewContext(task, reviewTask);
      context.resourceRefs[1].sourceRefId = 'ATTACHMENT-from-another-resource';
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
        respondCallCount += 1;
        throw new Error('MODEL_MUST_NOT_RUN');
      },
    }),
    /HOST_MCP_REVIEW_CONTEXT_RESOURCE_REFS_MISMATCH/u,
  );
  assert.deepEqual(calls, ['begin_review_turn', 'get_review_turn_context']);
  assert.equal(respondCallCount, 0);
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

test('rejects review session keys before respond, including normalized forms', async (t) => {
  const leakageKeys = [
    'sessionKey',
    'openClawSessionKey',
    'open_claw-session key',
    'ｏｐｅｎＣｌａｗＳｅｓｓｉｏｎＫｅｙ',
  ];

  for (const leakageKey of leakageKeys) {
    await t.test(leakageKey, async () => {
      const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
      const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
      let respondCallCount = 0;
      const callTool = async (name) => {
        if (name === 'begin_review_turn') return runningBegin(task);
        if (name === 'get_review_turn_context') {
          const context = reviewContext(task, reviewTask);
          context.context[leakageKey] =
            'review:tenant:actor:work-item:conversation';
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
            respondCallCount += 1;
            throw new Error('MODEL_MUST_NOT_RUN');
          },
        }),
        /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN/u,
      );
      assert.equal(respondCallCount, 0);
    });
  }
});

test('rejects actor identity key forms before respond', async (t) => {
  const leakageKeys = [
    'actorId',
    'ACTORID',
    'actor-id',
    'ａｃｔｏｒＩｄ',
    'actorContextRef',
    'ACTORCONTEXTREF',
    'Actor_Context-Ref',
    'ａｃｔｏｒＣｏｎｔｅｘｔＲｅｆ',
  ];

  for (const leakageKey of leakageKeys) {
    await t.test(leakageKey, async () => {
      const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
      const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
      let respondCallCount = 0;
      const callTool = async (name) => {
        if (name === 'begin_review_turn') return runningBegin(task);
        if (name === 'get_review_turn_context') {
          const context = reviewContext(task, reviewTask);
          context.context[leakageKey] = 'actor-secret';
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
            respondCallCount += 1;
            throw new Error('MODEL_MUST_NOT_RUN');
          },
        }),
        /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN/u,
      );
      assert.equal(respondCallCount, 0);
    });
  }
});

function provenance(overrides = {}) {
  return {
    modelVersion: 'GLM-5.3',
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

function applicabilityProvenance(overrides = {}) {
  return provenance({
    promptVersion: WISELINK_APPLICABILITY_PROMPT_VERSION,
    ...overrides,
  });
}

function makeTask(
  taskType,
  modelInput,
  hostResolvedMissingInputs = [],
  sourceRefs = [{ ref: ARTIFACT_REF, sha256: ARTIFACT_SHA }],
) {
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
    sourceRefs: structuredClone(sourceRefs),
    allowedConnectors: [],
    hostResolvedMissingInputs: structuredClone(hostResolvedMissingInputs),
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

function heartbeatResult(task, args) {
  assert.deepEqual(args, {
    attemptRef: task.operationRef,
    leaseToken: LEASE_TOKEN,
    leaseGeneration: 3,
  });
  return {
    attemptRef: task.operationRef,
    status: 'RUNNING',
    leaseExpiresAt: '2026-08-27T11:30:00.000Z',
  };
}

function stageTranslationPart(args, uploaded) {
  assert.equal(args.phase, 'UPLOAD_PART');
  assert.ok(Buffer.byteLength(JSON.stringify(args)) < 12_000);
  const bytes = Buffer.from(args.payloadBase64, 'base64');
  assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 6_144);
  const existing = uploaded.get(args.partIndex);
  if (existing && !existing.equals(bytes)) {
    throw new Error('RESULT_ENVELOPE_PART_REPLAY_MISMATCH');
  }
  uploaded.set(args.partIndex, existing ?? bytes);
  return {
    schemaVersion: 'wiselink.3_1.translation_result_part_receipt.v1',
    attemptRef: args.attemptRef,
    resultContentHash: args.resultContentHash,
    partIndex: args.partIndex,
    partCount: args.partCount,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    replayed: existing !== undefined,
  };
}

function assembleTranslationParts(args, uploaded) {
  assert.equal(args.phase, 'FINALIZE');
  assert.equal(args.parts.length, args.partCount);
  const bytes = Buffer.concat(
    [...args.parts]
      .sort((left, right) => left.partIndex - right.partIndex)
      .map((part, index) => {
        assert.equal(part.partIndex, index);
        const staged = uploaded.get(index);
        assert.ok(staged);
        assert.equal(part.byteLength, staged.byteLength);
        assert.equal(
          part.sha256,
          createHash('sha256').update(staged).digest('hex'),
        );
        return staged;
      }),
  );
  const result = JSON.parse(bytes.toString('utf8'));
  assert.equal(result.contentHash, args.resultContentHash);
  return result;
}

function translationDeliveryParts(
  task,
  input,
  {
    batchSize = input.sourceUnits.length,
    status = 'RUNNING',
    recoveryResult,
  } = {},
) {
  const sourceUnits = structuredClone(input.sourceUnits);
  const batches = [];
  for (let index = 0; index < sourceUnits.length; index += batchSize) {
    batches.push(sourceUnits.slice(index, index + batchSize));
  }
  const { sourceUnits: _sourceUnits, ...modelInputBase } = input;
  let startIndex = 0;
  return batches.map((batch, partIndex) => {
    const sourceUnitStartIndex = startIndex;
    startIndex += batch.length;
    return {
      schemaVersion: 'wiselink.3_1.openclaw_translation_delivery.v1',
      attemptRef: task.operationRef,
      status,
      leaseToken: LEASE_TOKEN,
      leaseGeneration: 3,
      leaseExpiresAt: '2026-08-27T11:00:00.000Z',
      ...(status === 'COMMITTING'
        ? { recoveryResultContentHash: recoveryResult?.contentHash }
        : {}),
      taskBinding: {
        actionAttemptId: task.actionAttemptId,
        operationRef: task.operationRef,
        taskType: 'OPENCLAW_TRANSLATE',
        workItemId: task.workItemId,
        inputRevision: task.inputRevision,
        baseRevision: task.baseRevision,
        documentVersionId: task.documentVersionId,
        deadline: task.deadline,
        inputHash: task.inputHash,
        sourceArtifactSha256: task.sourceRefs.map(({ sha256 }) => sha256),
      },
      delivery: {
        partIndex,
        partCount: batches.length,
        sourceUnitStartIndex,
        sourceUnitEndExclusive: startIndex,
        sourceUnitCount: sourceUnits.length,
        ...(partIndex === 0
          ? { modelInputBase: structuredClone(modelInputBase) }
          : {}),
        sourceUnits: structuredClone(batch),
      },
    };
  });
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
      deterministic: {
        numericFidelity: true,
        preserveAtaChapterNumbers: true,
      },
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
          humanReviewRequired: true,
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
      currentDocumentSourceRefIds: [sourceRefId],
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
    selectiveResynthesis: {
      mode: 'INITIAL',
      criterionSetId: 'criterion-set-fixture',
      baseRuleRevision: 1,
      baseRuleArtifactSha256: `sha256:${'e'.repeat(64)}`,
      staleOverallRevision: null,
      targetOverallRevision: 1,
      priorEngineerReviewRevision: null,
      currentEngineerReviewRevision: null,
      affectedCriterionIds: [],
      reusedCriterionIds: [],
      adoptedEvidenceSourceRefIds: [],
    },
  };
}

function synthesisOutput(input) {
  const sourceRefId = input.unifiedSourceContext.sourceRefs[0].sourceRefId;
  const overallCandidate =
    'Candidate only; applicability remains unknown pending the source-required fleet facts.';
  const statement = (text, basis = 'CONDITIONAL_INFERENCE') => ({
    text,
    basis,
    sourceRefIds: [sourceRefId],
  });
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
    overallCandidate,
    engineeringSummary: {
      schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1',
      conclusion: statement(overallCandidate),
      whyItMatters: [
        statement(
          'The current source contains an applicability condition that must be matched.',
          'SOURCE_FACT',
        ),
      ],
      applicability: {
        sourceScope: statement(
          'The source scope is limited to the effectivity stated in the current document.',
          'SOURCE_FACT',
        ),
        fleetMatch: statement(
          'The fleet match remains unknown until the source-required facts are available.',
        ),
        requiredFacts: [
          statement(
            'Obtain the controlled facts required by source effectivity.',
          ),
        ],
      },
      implementationImpact: [
        statement('Plan implementation only after applicability is matched.'),
      ],
      dispositionPriority: [
        statement('Close the applicability fact gap before release planning.'),
      ],
      nextActions: [
        statement('Check the source-required controlled fleet facts.'),
      ],
    },
    findings: [
      {
        finding: 'Controlled applicability facts are missing.',
        basis: 'Dynamic N/N and frozen.2 SourceRef',
        sourceRefIds: [sourceRefId],
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

function attemptStatus(task, statusValue, result) {
  const committing = statusValue === 'COMMITTING';
  const terminal = ['SUCCEEDED', 'WAITING_INPUT', 'FAILED'].includes(
    statusValue,
  );
  return {
    attemptRef: task.operationRef,
    taskType: task.taskType,
    status: statusValue,
    recoveryAvailable: committing,
    commitStartedAt: '2026-08-27T10:00:00.000Z',
    terminalReason: terminal ? 'FIXTURE_TERMINAL' : null,
    projectionApplied:
      statusValue === 'SUCCEEDED' &&
      task.taskType !== 'OPENCLAW_INTERACTIVE_REVIEW',
    resultContentHash: result?.contentHash ?? null,
    ...(committing ? { recoveryResult: result } : {}),
  };
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
