import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  runHostedReviewTurn,
  invokeHostedReviewModel,
} from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { validateReviewTask } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {
  sealTaskEnvelope,
} = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const {
  buildJobAidProblemTask,
} = require('../../server/modules/canonical-host/jobaid-problem-task.ts');
const {
  materializeJobAidWork,
} = require('../../server/modules/canonical-host/jobaid-problem-work.ts');
const {
  JOBAID_METHOD_BINDING,
  JOBAID_METHOD_EVIDENCE,
} = require('../../server/modules/canonical-host/jobaid-method-pack.ts');
const {
  overallModelEvidenceRegistry,
} = require('../../server/modules/canonical-host/overall-assessment-reading.ts');
const {
  parseReviewTurnTaskContract,
  parseReviewTurnCandidateContract,
  REVIEW_JOBAID_TOOL_POLICY_REF,
} = require('../../server/modules/canonical-host/canonical-host-openclaw-review.contract.ts');

const doc = {
  evidenceRef: 'source:dv-job:sr1',
  kind: 'DOCUMENT_PASSAGE',
  workItemId: 'WI-private-job',
  documentVersionId: 'dv-job',
  sourceRefId: 'sr1',
  locator: 'page 1',
  title: 'Synthetic test source',
  versionLabel: 'R1',
  excerpt: 'Do not replace unless the indication persists after 5 seconds.',
};
const evidence = [doc, ...JOBAID_METHOD_EVIDENCE];
const binding = {
  workItemId: doc.workItemId,
  documentVersionId: doc.documentVersionId,
  artifactRef: 'artifact://synthetic/source',
  artifactSha256: 'a'.repeat(64),
};
const common = {
  primaryDocument: {
    documentVersionRef: doc.documentVersionId,
    documentCode: 'TEST',
    businessRevision: 'R1',
    title: doc.title,
  },
  documentReading: {
    status: 'AVAILABLE',
    sections: [{ title: 'Conditions', sourceRefIds: ['sr1'] }],
  },
  relatedMaterials: { status: 'AVAILABLE', reason: null, items: [] },
  discussion: {
    status: 'NO_PRIOR_DISCUSSION',
    totalPriorTurns: 0,
    omittedEarlierTurns: 0,
    turns: [],
    usage: 'DISCUSSION_NOT_ADOPTION',
  },
};
const workItem = {
  workItemId: doc.workItemId,
  source: { documentVersionId: doc.documentVersionId },
  applicability: null,
  aeo: null,
};
const validation = {
  methodBinding: JOBAID_METHOD_BINDING,
  workItemId: doc.workItemId,
  previous: null,
  evidence,
  readSourceRefs: evidence.map((item) => item.evidenceRef),
  capabilities: [],
  history: {
    required: false,
    priorAssessmentRefs: [],
    engineeringDocumentRefs: [],
    coverage: 'NOT_REQUIRED',
    limitation: null,
  },
};
function issue(key, text) {
  return {
    issueKey: key,
    question: key === 'a' ? '当前更换条件是否成立？' : '独立限制如何保留？',
    understanding: text,
    statements: [
      {
        claimKey: 'condition',
        text,
        basis: 'SOURCE_FACT',
        premises: [
          {
            evidenceRef: doc.evidenceRef,
            role: 'SUPPORTS',
            explanation: '以完整来源条件为依据。',
            limitation: null,
          },
        ],
      },
    ],
    riskScenarios: [],
    measures: [],
    otherClassifications: [],
    openQuestions: [
      {
        question: '连续监测是否取得？',
        affects: '措施价值',
        nextEvidence: '连续记录',
        reason: '当前信息有限。',
      },
    ],
    requirementHandling: [],
    sourceDependencies: [doc.evidenceRef],
    premiseRefs: [],
  };
}
function proposal(issues, unchangedIssueKeys = []) {
  return {
    schemaVersion: 'wiselink.jobaid-problem-work.v2',
    headline: '完整条件继续适用',
    listBrief: '尚未取得足够连续记录。',
    understanding: '更换条件与单次检查之间的区别仍需保留。',
    decisiveIssueKeys: ['a'],
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
    completionReason: '本轮分析完成，限制明确保留。',
    changeSummary: '按当前证据修订条件理解。',
    unchangedExplanation: '独立问题原样保留。',
    issues,
    unchangedIssueKeys,
    retiredIssues: [],
  };
}
function revision(content, number) {
  return {
    workRevisionRef: `JAWR-${number}`,
    workRevision: number,
    workItemId: doc.workItemId,
    previousWorkRevisionRef: number > 1 ? `JAWR-${number - 1}` : null,
    requestId: `saved-${number}`,
    actionAttemptId: `ATT-saved-${number}`,
    basedOnWorkItemRevision: 7,
    documentVersionId: doc.documentVersionId,
    createdAt: '2026-09-09T00:00:00.000Z',
    content,
  };
}

test('actual JobAid Host task and native Review driver preserve initial work through two source-bound corrections', async (t) => {
  const legacy = JSON.parse(
    await readFile(
      new URL(
        '../../openclaw/skills/wiselink-research-and-synthesize/tests/fixtures/review-turn-task.c2.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const independent = issue(
    'b',
    `${doc.excerpt} ${'不可按字节预算裁剪的完整独立条件。'.repeat(70)}`,
  );
  let current = revision(
    materializeJobAidWork(
      proposal([issue('a', doc.excerpt), independent]),
      validation,
    ),
    1,
  );
  const original = structuredClone(current.content.issues[1]);
  for (const turn of [1, 2]) {
    const jobAidContext = buildJobAidProblemTask({
      workItem,
      actorUserId: 'actor-private',
      permissionSnapshotVersion: 'synthetic-scope',
      purpose: 'PROBLEM_REVIEW',
      sourceCatalog: [doc],
      sourceBindings: [binding],
      common,
      previousWork: current,
      expectedWorkRevision: current.workRevision,
      priorAssessmentRefs: [current.workRevisionRef],
    });
    assert.equal(
      jobAidContext.modelInput.documentOverview.sections[0].sourceRefs[0],
      doc.evidenceRef,
    );
    const resourceRefs = [
      {
        sourceRefId: doc.evidenceRef,
        resourceArtifactRef: binding.artifactRef,
        resourceArtifactSha256: binding.artifactSha256,
        value: {
          ...overallModelEvidenceRegistry([doc])[0],
          sourceRefId: doc.evidenceRef,
        },
      },
    ];
    const contract = parseReviewTurnTaskContract({
      ...legacy,
      schemaVersion: 'wiselink.3_1.review_turn_task.v1.c5',
      reviewConversationRef: 'RC-private',
      reviewTurnRef: `RT-private-${turn}`,
      requestId: `request-private-${turn}`,
      actorContextRef: 'ACTX-job',
      selectedEvaluationItemId: null,
      allowedEvaluationItemIds: [],
      allowedAdoptedInputRefs: [],
      resourceRefs,
      attachmentRefs: [],
      jobAidContext,
      userMessage: '请按原文继续核对并修订本轮理解。',
      context: {
        problemAssessment: jobAidContext.modelInput,
        engineerInput: {
          text: '本轮单次检查正常，连续记录尚未取得。',
          attachmentRefs: [],
        },
      },
      executionPolicy: {
        ...legacy.executionPolicy,
        toolPolicyRef: REVIEW_JOBAID_TOOL_POLICY_REF,
      },
    });
    validateReviewTask(contract);
    const task = sealTaskEnvelope({
      schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
      actionAttemptId: `ATT-private-${turn}`,
      operationRef: `AQ-private-${turn}`,
      taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
      priority: 100,
      tenantId: 'tenant-private',
      workItemId: doc.workItemId,
      inputRevision: 7,
      baseRevision: 7,
      documentVersionId: doc.documentVersionId,
      sourceRefs: [
        { ref: binding.artifactRef, sha256: binding.artifactSha256 },
      ],
      allowedConnectors: [],
      hostResolvedMissingInputs: [],
      modelInput: contract,
      deadline: '2099-09-09T12:00:00.000Z',
      idempotencyKey: `synthetic:${turn}`,
    });
    const delta = proposal(
      [
        issue(
          'a',
          `${doc.excerpt} 第 ${turn} 轮仍不能以单次正常检查取消持续条件。`,
        ),
      ],
      ['b'],
    );
    const directory = await mkdtemp(join(tmpdir(), 'jobaid-review-protocol-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let modelCalls = 0;
    let commits = 0;
    const result = await runHostedReviewTurn(
      {
        reviewConversationRef: contract.reviewConversationRef,
        requestId: contract.requestId,
        checkpointDir: directory,
      },
      {
        callTool: async (name, args) => {
          if (name === 'begin_review_turn')
            return {
              attemptRef: task.operationRef,
              status: 'RUNNING',
              leaseToken: 'synthetic-lease',
              leaseGeneration: 1,
              leaseExpiresAt: '2099-09-09T12:00:00.000Z',
              task,
            };
          if (name === 'get_review_turn_context')
            return {
              schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2',
              attemptRef: task.operationRef,
              reviewConversationRef: contract.reviewConversationRef,
              reviewTurnRef: contract.reviewTurnRef,
              mode: 'INTERACTIVE_REVIEW',
              selectedEvaluationItemId: null,
              inputRevision: 7,
              allowedOperations: contract.allowedOperations,
              resourceRefs: resourceRefs.map(
                ({ value: _value, ...resource }) => resource,
              ),
              context: contract.context,
              executionPolicy: contract.executionPolicy,
            };
          if (name === 'read_source_refs')
            return {
              schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
              attemptRef: task.operationRef,
              sourceRefs: args.sourceRefIds.map(
                (ref) =>
                  resourceRefs.find((resource) => resource.sourceRefId === ref)
                    .value,
              ),
            };
          if (name === 'heartbeat_action_attempt')
            return { leaseExpiresAt: '2099-09-09T12:00:00.000Z' };
          if (name === 'commit_review_turn_candidate') {
            const envelope = JSON.parse(args.resultJson);
            const candidate = parseReviewTurnCandidateContract({
              task: contract,
              result: envelope,
            });
            assert.equal(
              candidate.schemaVersion,
              'wiselink.3_1.review_turn_candidate.v1.c5',
            );
            assert.equal(candidate.reviewActionDraft, null);
            assert.deepEqual(candidate.affectedItemIds, []);
            current = revision(
              materializeJobAidWork(candidate.jobAidWorkingDelta, {
                ...validation,
                previous: current.content,
              }),
              current.workRevision + 1,
            );
            commits += 1;
            return {
              schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2',
              attemptRef: task.operationRef,
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
          throw new Error(`UNEXPECTED_SYNTHETIC_TOOL:${name}`);
        },
        invokeModel: (input, hooks) =>
          invokeHostedReviewModel(
            input,
            {
              gatewayUrl: 'http://127.0.0.1:1',
              gatewayToken: 'synthetic-only',
              configuredModelVersion: 'synthetic-provider',
              ...hooks,
            },
            {
              requestGateway: async (_url, request) => {
                modelCalls += 1;
                const body = JSON.parse(request.body);
                const serialized = JSON.stringify(body.messages);
                for (const forbidden of [
                  doc.workItemId,
                  'actor-private',
                  task.operationRef,
                  'synthetic-lease',
                  contract.reviewConversationRef,
                  contract.reviewTurnRef,
                ])
                  assert.equal(
                    serialized.includes(forbidden),
                    false,
                    forbidden,
                  );
                if (modelCalls === 1) {
                  assert.ok(serialized.includes('完整独立条件'));
                  assert.ok(serialized.includes('claimKey'));
                  assert.equal(
                    body.tools.find(
                      (tool) =>
                        tool.function.name ===
                        'return_wiselink_review_candidate',
                    ).function.parameters.properties.answer.type,
                    'string',
                  );
                } else
                  assert.deepEqual(
                    body.messages.map((message) => message.role),
                    ['system', 'assistant', 'tool'],
                  );
                const output = {
                  responseType: 'ANSWER',
                  answer: delta.changeSummary,
                  sourceRefs: [doc.evidenceRef],
                  missingInputs: [],
                  candidateEvidenceRefs: [],
                  warnings: [],
                  jobAidWorkingDelta: delta,
                };
                return Response.json({
                  model: 'synthetic-provider',
                  choices: [
                    {
                      message: {
                        content: null,
                        tool_calls: [
                          {
                            id: `synthetic-call-${modelCalls}`,
                            type: 'function',
                            function: {
                              name:
                                modelCalls === 1
                                  ? 'read_wiselink_review_sources'
                                  : 'return_wiselink_review_candidate',
                              arguments: JSON.stringify(
                                modelCalls === 1
                                  ? { sourceRefIds: [doc.evidenceRef] }
                                  : output,
                              ),
                            },
                          },
                        ],
                      },
                    },
                  ],
                });
              },
            },
          ),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(modelCalls, 2);
    assert.equal(commits, 1);
    assert.deepEqual(current.content.issues[1], original);
    assert.equal(
      current.content.issues[0].statements[0].claimId,
      `${doc.workItemId}:issue:a:claim:condition`,
    );
    const tampered = structuredClone(contract);
    tampered.resourceRefs[0].value.kind = 'METHOD_CLAUSE';
    assert.throws(
      () => validateReviewTask(tampered),
      /RESOURCE_BINDING_INVALID/u,
    );
    assert.throws(
      () => parseReviewTurnTaskContract(tampered),
      /RESOURCE_BINDING_INVALID/u,
    );
  }
  assert.equal(current.workRevision, 3);
});
