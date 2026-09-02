import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleRoot = join(root, 'dist/server/modules/canonical-host');
const { CanonicalHostMcpService } = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host-mcp.service.js'))
);
const { CanonicalHostOpenClawMcpService } = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host-openclaw-mcp.service.js'))
);

const calls = [];
const dynamicCalls = [];
const orchestratorCalls = [];
const translationCalls = [];
const translationResultParts = new Map();
let assembledTranslationResult = null;
let translationTransportProof = null;
const applicabilityCalls = [];
const reviewCalls = [];
const statusCalls = [];
const attemptCalls = [];
const methods = [];
const leaseToken = '00000000-0000-4000-8000-000000000001';
const leaseExpiresAt = '2026-08-24T12:01:00.000Z';
const dynamicModelInput = {
  purpose: 'EVALUATE_DYNAMIC_RULES',
  callerCorrelationRef: 'DYN-OPAQUE-CALLER-REF',
  criterionCount: 150,
};
const overallModelInput = {
  operation: 'SYNTHESIZE_OVERALL_CANDIDATE',
  outputCorrelationRef: 'OVR-OPAQUE',
};
const dynamicBeginResult = {
  attemptRef: 'DYN-OPAQUE-CALLER-REF',
  status: 'RUNNING',
  leaseToken,
  leaseGeneration: 1,
  leaseExpiresAt,
  task: mockTaskEnvelope({
    actionAttemptId: 'ATT-DYNAMIC',
    operationRef: 'DYN-OPAQUE-CALLER-REF',
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    modelInput: dynamicModelInput,
  }),
  modelInput: dynamicModelInput,
};
const overallBeginResult = {
  attemptRef: 'OVR-OPAQUE',
  status: 'RUNNING',
  leaseToken,
  leaseGeneration: 1,
  leaseExpiresAt,
  task: mockTaskEnvelope({
    actionAttemptId: 'ATT-OVERALL',
    operationRef: 'OVR-OPAQUE',
    taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
    modelInput: {
      modelInput: overallModelInput,
      selectedDiscoveryRefs: ['search:boeing:server-owned'],
      providerCodes: ['BOEING'],
    },
  }),
  selectedDiscoveryRefs: ['search:boeing:server-owned'],
  modelInput: overallModelInput,
};
const candidateResult = {
  schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
  contentHash: 'b'.repeat(64),
};
const serviceScope = {
  authorizeWorkItemRead: async ({ workItemId }) => serviceScopeFor(workItemId),
  authorizeDevelopmentCreate: async () => {
    throw new Error('DEVELOPMENT_CREATE_NOT_EXPECTED_IN_MCP_SMOKE');
  },
  assertTransport: async () => undefined,
  authorizeOpenClawWorkItem: async ({ workItemId }) =>
    serviceScopeFor(workItemId),
  authorizeOpenClawApplicabilityContext: async ({
    applicabilityContextRef,
    requestId,
  }) => ({
    ...serviceScopeFor('WI-DYNAMIC'),
    applicabilityContextRef,
    requestId,
  }),
  authorizeOpenClawAttempt: async ({ attemptRef }) => ({
    ...serviceScopeFor('WI-DYNAMIC'),
    attemptRef,
  }),
};
const vertical = {
  openApiStatus: async (workItemId) => {
    calls.push({ tool: 'get_parse_status', workItemId });
    await delay(workItemId.endsWith('SLOW') ? 15 : 1);
    return workItemId === 'WI-STATUS'
      ? {
          workItemId,
          status: `STATUS:${workItemId}`,
          integratedAssessmentSummary: {
            status: 'OVERALL_CANDIDATE_STALE',
            baseRules: {
              status: 'CANDIDATE_ONLY',
              revision: 2,
              criterionCount: 150,
              evaluationItemCount: 150,
              unresolvedCount: 119,
            },
            overallSynthesis: {
              status: 'STALE',
              revision: 1,
              authorityLevel: 'candidate_only',
              staleReason: 'BASE_RULE_RESULT_CHANGED',
            },
          },
        }
      : { workItemId, status: `STATUS:${workItemId}` };
  },
  openApiQuery: async ({ workItemId, query }) => {
    calls.push({ tool: 'query_parsed_package', workItemId, query });
    return {
      workItemId,
      query,
      resultCount: 1,
      results: [{ unitId: `UNIT:${workItemId}` }],
    };
  },
  openApiDeepLink: async (workItemId) => {
    calls.push({ tool: 'get_deep_link', workItemId });
    return {
      workItemId,
      deepLink: `https://host.example.test/work-items/${workItemId}/documents`,
    };
  },
};
const mcp = new CanonicalHostMcpService(vertical, serviceScope);
const dynamicEvaluation = {
  begin: async (workItemId) => {
    dynamicCalls.push({ tool: 'begin_dynamic_evaluation', workItemId });
    return structuredClone(dynamicBeginResult);
  },
  commit: async (attemptRef, selectedLeaseToken, leaseGeneration, result) => {
    dynamicCalls.push({
      tool: 'commit_dynamic_evaluation_candidate',
      attemptRef,
      leaseToken: selectedLeaseToken,
      leaseGeneration,
      result,
    });
    return {
      workItemId: 'WI-DYNAMIC',
      workItemRevision: 6,
      status: 'BASE_RULE_CANDIDATE_READY',
    };
  },
};
const discovery = {
  record: async (workItemId, result) => {
    orchestratorCalls.push({
      tool: 'record_oem_discovery_run',
      workItemId,
      result,
    });
    return {
      searchRunRef: 'search:boeing:server-owned',
      resultStatus: 'ACCESS_DENIED',
    };
  },
};
const overall = {
  begin: async (workItemId, providers) => {
    orchestratorCalls.push({
      tool: 'begin_overall_synthesis',
      workItemId,
      providers,
    });
    return structuredClone(overallBeginResult);
  },
  commit: async (
    selectedAttemptRef,
    selectedLeaseToken,
    leaseGeneration,
    result,
  ) => {
    orchestratorCalls.push({
      tool: 'commit_overall_candidate',
      attemptRef: selectedAttemptRef,
      leaseToken: selectedLeaseToken,
      leaseGeneration,
      result,
    });
    return {
      workItemId: 'WI-DYNAMIC',
      workItemRevision: 7,
      status: 'OVERALL_CANDIDATE_READY',
    };
  },
  resume: async (attemptRef) => {
    const modelInput = {
      operation: 'SYNTHESIZE_OVERALL_CANDIDATE',
      outputCorrelationRef: attemptRef,
    };
    return {
      attemptRef,
      leaseToken,
      leaseGeneration: 2,
      leaseExpiresAt,
      task: mockTaskEnvelope({
        actionAttemptId: 'ATT-OVERALL-EXISTING',
        operationRef: attemptRef,
        taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
        modelInput: {
          modelInput,
          selectedDiscoveryRefs: [],
          providerCodes: [],
        },
      }),
      selectedDiscoveryRefs: [],
      modelInput,
    };
  },
};
const attempts = {
  heartbeat: async (input) => {
    attemptCalls.push({ tool: 'heartbeat_action_attempt', ...input });
    return { leaseExpiresAt };
  },
  requestCancel: async (input) => {
    attemptCalls.push({ tool: 'cancel_action_attempt', ...input });
    return {
      attemptRef: input.attemptRef,
      status: 'CANCELLED',
      projectionApplied: false,
      terminalReason: 'CANCELLED_BY_REQUEST',
    };
  },
};
const translation = {
  begin: async (workItemId) => {
    translationCalls.push({ tool: 'begin_translation', workItemId });
    return { attemptRef: 'TRN-OPAQUE', status: 'RUNNING' };
  },
  commit: async (
    selectedAttemptRef,
    selectedLeaseToken,
    leaseGeneration,
    result,
  ) => {
    translationCalls.push({
      tool: 'commit_translation_candidate',
      attemptRef: selectedAttemptRef,
      leaseToken: selectedLeaseToken,
      leaseGeneration,
      result,
    });
    return { workItemId: 'WI-DYNAMIC', status: 'CANDIDATE_ONLY' };
  },
  uploadResultPart: async (
    selectedAttemptRef,
    selectedLeaseToken,
    leaseGeneration,
    input,
  ) => {
    const bytes = Buffer.from(input.payloadBase64, 'base64');
    const key = `${selectedAttemptRef}:${input.resultContentHash}:${input.partCount}:${input.partIndex}`;
    const existing = translationResultParts.get(key);
    if (existing && !existing.equals(bytes)) {
      throw new Error('RESULT_ENVELOPE_PART_REPLAY_MISMATCH');
    }
    translationResultParts.set(key, existing ?? bytes);
    translationCalls.push({
      tool: 'commit_translation_candidate',
      phase: 'UPLOAD_PART',
      attemptRef: selectedAttemptRef,
      leaseToken: selectedLeaseToken,
      leaseGeneration,
      partIndex: input.partIndex,
      partCount: input.partCount,
      byteLength: bytes.byteLength,
      replayed: existing !== undefined,
    });
    return {
      schemaVersion: 'wiselink.3_1.translation_result_part_receipt.v1',
      attemptRef: selectedAttemptRef,
      resultContentHash: input.resultContentHash,
      partIndex: input.partIndex,
      partCount: input.partCount,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
      replayed: existing !== undefined,
    };
  },
  finalizeResultParts: async (
    selectedAttemptRef,
    selectedLeaseToken,
    leaseGeneration,
    input,
  ) => {
    if (input.parts.length !== input.partCount) {
      throw new Error('TRANSLATION_RESULT_PARTS_INCOMPLETE');
    }
    const ordered = [...input.parts].sort(
      (left, right) => left.partIndex - right.partIndex,
    );
    const bytes = Buffer.concat(
      ordered.map((part, index) => {
        if (part.partIndex !== index) {
          throw new Error('TRANSLATION_RESULT_PARTS_INCOMPLETE');
        }
        const staged = translationResultParts.get(
          `${selectedAttemptRef}:${input.resultContentHash}:${input.partCount}:${index}`,
        );
        if (
          !staged ||
          staged.byteLength !== part.byteLength ||
          createHash('sha256').update(staged).digest('hex') !== part.sha256
        ) {
          throw new Error('RESULT_ENVELOPE_PART_READBACK_MISMATCH');
        }
        return staged;
      }),
    );
    assembledTranslationResult = JSON.parse(bytes.toString('utf8'));
    translationCalls.push({
      tool: 'commit_translation_candidate',
      phase: 'FINALIZE',
      attemptRef: selectedAttemptRef,
      leaseToken: selectedLeaseToken,
      leaseGeneration,
      partCount: input.partCount,
      byteLength: bytes.byteLength,
    });
    return {
      workItemId: 'WI-DYNAMIC',
      workItemRevision: 6,
      status: 'CANDIDATE_ONLY',
      translation: { sourceUnitCount: 196, translatedUnitCount: 196 },
    };
  },
};
const applicability = {
  begin: async (applicabilityContextRef, requestId) => {
    applicabilityCalls.push({
      tool: 'begin_applicability_evaluation',
      applicabilityContextRef,
      requestId,
    });
    return { attemptRef: 'APP-OPAQUE', status: 'RUNNING' };
  },
  commit: async (
    selectedAttemptRef,
    selectedLeaseToken,
    leaseGeneration,
    result,
  ) => {
    applicabilityCalls.push({
      tool: 'commit_applicability_candidate',
      attemptRef: selectedAttemptRef,
      leaseToken: selectedLeaseToken,
      leaseGeneration,
      result,
    });
    return { workItemId: 'WI-DYNAMIC', status: 'CANDIDATE_ONLY' };
  },
};
const review = {
  begin: async (reviewConversationRef, requestId) => {
    reviewCalls.push({
      tool: 'begin_review_turn',
      reviewConversationRef,
      requestId,
    });
    return {
      attemptRef: 'AQ-REVIEW',
      status: 'RUNNING',
      leaseToken,
      leaseGeneration: 1,
    };
  },
  context: async (selectedAttemptRef) => {
    reviewCalls.push({
      tool: 'get_review_turn_context',
      attemptRef: selectedAttemptRef,
    });
    return { attemptRef: selectedAttemptRef, mode: 'INTERACTIVE_REVIEW' };
  },
  readSourceRefs: async (selectedAttemptRef, sourceRefIds) => {
    reviewCalls.push({
      tool: 'read_source_refs',
      attemptRef: selectedAttemptRef,
      sourceRefIds,
    });
    return {
      attemptRef: selectedAttemptRef,
      sourceRefs: [{ sourceRefId: sourceRefIds[0] }],
    };
  },
  commit: async (
    selectedAttemptRef,
    selectedLeaseToken,
    leaseGeneration,
    result,
  ) => {
    reviewCalls.push({
      tool: 'commit_review_turn_candidate',
      attemptRef: selectedAttemptRef,
      leaseToken: selectedLeaseToken,
      leaseGeneration,
      result,
    });
    return { attemptRef: selectedAttemptRef, status: 'SUCCEEDED' };
  },
};
const attemptStatus = {
  status: async (selectedAttemptRef) => {
    statusCalls.push({
      tool: 'get_action_attempt_status',
      attemptRef: selectedAttemptRef,
    });
    return {
      attemptRef: selectedAttemptRef,
      taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
      status: 'RUNNING',
      recoveryAvailable: false,
      commitStartedAt: null,
      projectionApplied: false,
      terminalReason: null,
      resultContentHash: null,
    };
  },
};
const openClawMcp = new CanonicalHostOpenClawMcpService(
  vertical,
  dynamicEvaluation,
  discovery,
  overall,
  translation,
  applicability,
  review,
  attemptStatus,
  attempts,
  serviceScope,
);

const httpServer = createServer(async (request, response) => {
  methods.push(request.method);
  const selectedMcp =
    request.url === '/openapi/wiselink/mcp'
      ? mcp
      : request.url === '/openapi/wiselink/openclaw-mcp'
        ? openClawMcp
        : null;
  if (request.method !== 'POST' || selectedMcp === null) {
    response.writeHead(405, { Allow: 'POST' });
    response.end();
    return;
  }
  try {
    await selectedMcp.handle(request, response, await readJsonBody(request));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      }),
    );
  }
});

await new Promise((resolveListen) =>
  httpServer.listen(0, '127.0.0.1', resolveListen),
);
const address = httpServer.address();
assert.ok(address && typeof address !== 'string');
const endpoint = new URL(
  `/openapi/wiselink/mcp`,
  `http://127.0.0.1:${address.port}`,
);

try {
  const client = await connectedClient(endpoint, 'mcp-readonly-client');
  try {
    assert.equal(client.getNegotiatedProtocolVersion(), '2025-11-25');
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map(({ name }) => name),
      ['get_parse_status', 'query_parsed_package', 'get_deep_link'],
    );
    assert.ok(
      listed.tools.every(
        ({ annotations }) =>
          annotations?.readOnlyHint === true &&
          annotations.destructiveHint === false &&
          annotations.idempotentHint === true &&
          annotations.openWorldHint === false,
      ),
    );
    assert.deepEqual(client.getServerCapabilities(), {
      tools: { listChanged: true },
    });

    assert.deepEqual(
      resultJson(
        await client.callTool({
          name: 'get_parse_status',
          arguments: { workItemId: 'WI-STATUS' },
        }),
      ),
      {
        workItemId: 'WI-STATUS',
        status: 'STATUS:WI-STATUS',
        integratedAssessmentSummary: {
          status: 'OVERALL_CANDIDATE_STALE',
          baseRules: {
            status: 'CANDIDATE_ONLY',
            revision: 2,
            criterionCount: 150,
            evaluationItemCount: 150,
            unresolvedCount: 119,
          },
          overallSynthesis: {
            status: 'STALE',
            revision: 1,
            authorityLevel: 'candidate_only',
            staleReason: 'BASE_RULE_RESULT_CHANGED',
          },
        },
      },
    );
    assert.deepEqual(
      resultJson(
        await client.callTool({
          name: 'query_parsed_package',
          arguments: { workItemId: 'WI-QUERY', query: 'software' },
        }),
      ),
      {
        workItemId: 'WI-QUERY',
        query: 'software',
        resultCount: 1,
        results: [{ unitId: 'UNIT:WI-QUERY' }],
      },
    );
    assert.deepEqual(
      resultJson(
        await client.callTool({
          name: 'get_deep_link',
          arguments: { workItemId: 'WI-LINK' },
        }),
      ),
      {
        workItemId: 'WI-LINK',
        deepLink: 'https://host.example.test/work-items/WI-LINK/documents',
      },
    );
    assert.deepEqual(calls, [
      { tool: 'get_parse_status', workItemId: 'WI-STATUS' },
      {
        tool: 'query_parsed_package',
        workItemId: 'WI-QUERY',
        query: 'software',
      },
      { tool: 'get_deep_link', workItemId: 'WI-LINK' },
    ]);
  } finally {
    await client.close();
  }

  calls.length = 0;
  const negativeClient = await connectedClient(endpoint, 'mcp-negative-client');
  try {
    await negativeClient.listTools();
    await assert.rejects(
      negativeClient.callTool({ name: 'start_parse', arguments: {} }),
    );
    const extraInputResult = await negativeClient.callTool({
      name: 'get_parse_status',
      arguments: {
        workItemId: 'WI-NEGATIVE',
        url: 'https://untrusted.example.test',
        headers: { Authorization: 'untrusted' },
        actor: 'untrusted',
        authority: true,
      },
    });
    assert.equal(extraInputResult.isError, true);
    assert.deepEqual(calls, []);
  } finally {
    await negativeClient.close();
  }

  calls.length = 0;
  dynamicCalls.length = 0;
  const openClawEndpoint = new URL('/openapi/wiselink/openclaw-mcp', endpoint);
  const openClawClient = await connectedClient(
    openClawEndpoint,
    'openclaw-mcp-client',
  );
  try {
    const listed = await openClawClient.listTools();
    assert.deepEqual(
      listed.tools.map(({ name }) => name),
      [
        'get_parse_status',
        'query_parsed_package',
        'get_deep_link',
        'begin_translation',
        'commit_translation_candidate',
        'begin_applicability_evaluation',
        'commit_applicability_candidate',
        'begin_dynamic_evaluation',
        'commit_dynamic_evaluation_candidate',
        'record_oem_discovery_run',
        'begin_overall_synthesis',
        'resume_overall_synthesis',
        'commit_overall_candidate',
        'begin_review_turn',
        'get_review_turn_context',
        'read_source_refs',
        'get_action_attempt_status',
        'commit_review_turn_candidate',
        'heartbeat_action_attempt',
        'cancel_action_attempt',
      ],
    );
    assert.equal(listed.tools.length, 20);
    assert.equal(openClawClient.getServerVersion()?.version, '1.2.0');
    const largeTranslation = largeTranslationResultEnvelope();
    assert.ok(
      largeTranslation.bytes.byteLength >= 65_000 &&
        largeTranslation.bytes.byteLength <= 75_000,
    );
    const rawParts = chunkBytes(largeTranslation.bytes, 6_144);
    assert.equal(rawParts.length, 12);
    const receipts = new Array(rawParts.length);
    const uploadOrder = [
      1,
      0,
      ...rawParts.slice(2).map((_, index) => index + 2),
    ];
    let maxUploadArgumentBytes = 0;
    for (const partIndex of uploadOrder) {
      const argumentsValue = {
        attemptRef: 'TRN-TRANSLATION-LARGE',
        leaseToken,
        leaseGeneration: 1,
        phase: 'UPLOAD_PART',
        resultContentHash: largeTranslation.result.contentHash,
        partIndex,
        partCount: rawParts.length,
        payloadBase64: rawParts[partIndex].toString('base64'),
      };
      const argumentBytes = Buffer.byteLength(JSON.stringify(argumentsValue));
      maxUploadArgumentBytes = Math.max(maxUploadArgumentBytes, argumentBytes);
      assert.ok(argumentBytes < 12_000);
      receipts[partIndex] = resultJson(
        await openClawClient.callTool({
          name: 'commit_translation_candidate',
          arguments: argumentsValue,
        }),
      );
    }
    const duplicate = resultJson(
      await openClawClient.callTool({
        name: 'commit_translation_candidate',
        arguments: {
          attemptRef: 'TRN-TRANSLATION-LARGE',
          leaseToken,
          leaseGeneration: 1,
          phase: 'UPLOAD_PART',
          resultContentHash: largeTranslation.result.contentHash,
          partIndex: 0,
          partCount: rawParts.length,
          payloadBase64: rawParts[0].toString('base64'),
        },
      }),
    );
    assert.equal(duplicate.replayed, true);
    const missingFinalize = await openClawClient.callTool({
      name: 'commit_translation_candidate',
      arguments: {
        attemptRef: 'TRN-TRANSLATION-LARGE',
        leaseToken,
        leaseGeneration: 1,
        phase: 'FINALIZE',
        resultContentHash: largeTranslation.result.contentHash,
        partCount: rawParts.length,
        parts: receipts.slice(0, -1).map(resultPartBinding),
      },
    });
    assert.equal(missingFinalize.isError, true);
    assert.equal(
      translationCalls.filter(({ phase }) => phase === 'FINALIZE').length,
      0,
    );
    const finalized = resultJson(
      await openClawClient.callTool({
        name: 'commit_translation_candidate',
        arguments: {
          attemptRef: 'TRN-TRANSLATION-LARGE',
          leaseToken,
          leaseGeneration: 1,
          phase: 'FINALIZE',
          resultContentHash: largeTranslation.result.contentHash,
          partCount: rawParts.length,
          parts: receipts.map(resultPartBinding).reverse(),
        },
      }),
    );
    assert.deepEqual(finalized, {
      workItemId: 'WI-DYNAMIC',
      workItemRevision: 6,
      status: 'CANDIDATE_ONLY',
      translation: { sourceUnitCount: 196, translatedUnitCount: 196 },
    });
    assert.equal(
      Buffer.byteLength(JSON.stringify(assembledTranslationResult)),
      largeTranslation.bytes.byteLength,
    );
    assert.equal(
      JSON.parse(assembledTranslationResult.modelOutput).candidateUnits.length,
      196,
    );
    assert.deepEqual(assembledTranslationResult, largeTranslation.result);
    translationTransportProof = {
      payloadBytes: largeTranslation.bytes.byteLength,
      sourceUnitCount: 196,
      partCount: rawParts.length,
      maxUploadArgumentBytes,
      duplicatePartReplayed: duplicate.replayed,
      outOfOrderUploadAndFinalize: true,
      missingPartRejected: missingFinalize.isError === true,
      readbackComplete: true,
    };
    assert.deepEqual(
      resultJson(
        await openClawClient.callTool({
          name: 'begin_applicability_evaluation',
          arguments: {
            applicabilityContextRef: 'APCTX-OPAQUE',
            requestId: 'app-request-1',
          },
        }),
      ),
      { attemptRef: 'APP-OPAQUE', status: 'RUNNING' },
    );
    const forgedApplicabilityBegin = await openClawClient.callTool({
      name: 'begin_applicability_evaluation',
      arguments: {
        applicabilityContextRef: 'APCTX-OPAQUE',
        requestId: 'app-request-1',
        actorId: 'forged',
        tenantId: 'forged',
        workItemId: 'WI-FORGED',
        sessionKey: 'forged',
      },
    });
    assert.equal(forgedApplicabilityBegin.isError, true);
    assert.deepEqual(
      resultJson(
        await openClawClient.callTool({
          name: 'commit_applicability_candidate',
          arguments: {
            attemptRef: 'APP-OPAQUE',
            leaseToken,
            leaseGeneration: 1,
            result: candidateResult,
          },
        }),
      ),
      { workItemId: 'WI-DYNAMIC', status: 'CANDIDATE_ONLY' },
    );
    assert.deepEqual(
      applicabilityCalls.map(({ tool }) => tool),
      ['begin_applicability_evaluation', 'commit_applicability_candidate'],
    );
    assert.deepEqual(
      resultJson(
        await openClawClient.callTool({
          name: 'begin_dynamic_evaluation',
          arguments: { workItemId: 'WI-DYNAMIC' },
        }),
      ),
      dynamicBeginResult,
    );
    assert.deepEqual(
      resultJson(
        await openClawClient.callTool({
          name: 'commit_dynamic_evaluation_candidate',
          arguments: {
            attemptRef: 'DYN-OPAQUE-CALLER-REF',
            leaseToken,
            leaseGeneration: 1,
            result: candidateResult,
          },
        }),
      ),
      {
        workItemId: 'WI-DYNAMIC',
        workItemRevision: 6,
        status: 'BASE_RULE_CANDIDATE_READY',
      },
    );
    const rejected = await openClawClient.callTool({
      name: 'begin_dynamic_evaluation',
      arguments: {
        workItemId: 'WI-DYNAMIC',
        actor: 'untrusted',
        authority: true,
        url: 'https://untrusted.example.test',
        header: { Authorization: 'untrusted' },
        model: 'untrusted',
        agentId: 'untrusted',
      },
    });
    assert.equal(rejected.isError, true);
    assert.deepEqual(dynamicCalls, [
      { tool: 'begin_dynamic_evaluation', workItemId: 'WI-DYNAMIC' },
      {
        tool: 'commit_dynamic_evaluation_candidate',
        attemptRef: 'DYN-OPAQUE-CALLER-REF',
        leaseToken,
        leaseGeneration: 1,
        result: candidateResult,
      },
    ]);
    const denied = {
      provider: 'BOEING',
      query: '737 SB',
      resultStatus: 'ACCESS_DENIED',
      candidates: [],
      accessRestricted: true,
      truncated: false,
      partialOnly: false,
      excludedNonOemCandidateCount: 0,
      error: { code: 'UPSTREAM_CONNECT_TIMEOUT', message: 'timeout' },
    };
    await openClawClient.callTool({
      name: 'record_oem_discovery_run',
      arguments: { workItemId: 'WI-DYNAMIC', result: denied },
    });
    await openClawClient.callTool({
      name: 'begin_overall_synthesis',
      arguments: { workItemId: 'WI-DYNAMIC', providers: ['BOEING'] },
    });
    const resumed = await openClawClient.callTool({
      name: 'resume_overall_synthesis',
      arguments: { attemptRef: 'OVR-EXISTING' },
    });
    const resumedModelInput = {
      operation: 'SYNTHESIZE_OVERALL_CANDIDATE',
      outputCorrelationRef: 'OVR-EXISTING',
    };
    assert.deepEqual(resultJson(resumed), {
      attemptRef: 'OVR-EXISTING',
      leaseToken,
      leaseGeneration: 2,
      leaseExpiresAt,
      task: mockTaskEnvelope({
        actionAttemptId: 'ATT-OVERALL-EXISTING',
        operationRef: 'OVR-EXISTING',
        taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
        modelInput: {
          modelInput: resumedModelInput,
          selectedDiscoveryRefs: [],
          providerCodes: [],
        },
      }),
      selectedDiscoveryRefs: [],
      modelInput: resumedModelInput,
    });
    await openClawClient.callTool({
      name: 'commit_overall_candidate',
      arguments: {
        attemptRef: 'OVR-OPAQUE',
        leaseToken,
        leaseGeneration: 1,
        result: candidateResult,
      },
    });
    assert.equal(orchestratorCalls.length, 3);
    assert.deepEqual(
      resultJson(
        await openClawClient.callTool({
          name: 'begin_review_turn',
          arguments: {
            reviewConversationRef: 'RC-1',
            requestId: 'request-1',
          },
        }),
      ),
      {
        attemptRef: 'AQ-REVIEW',
        status: 'RUNNING',
        leaseToken,
        leaseGeneration: 1,
      },
    );
    const forgedReviewBegin = await openClawClient.callTool({
      name: 'begin_review_turn',
      arguments: {
        reviewConversationRef: 'RC-1',
        requestId: 'request-1',
        actorId: 'forged',
        tenantId: 'forged',
        workItemId: 'WI-FORGED',
        sessionKey: 'forged',
      },
    });
    assert.equal(forgedReviewBegin.isError, true);
    await openClawClient.callTool({
      name: 'get_review_turn_context',
      arguments: { attemptRef: 'AQ-REVIEW' },
    });
    await openClawClient.callTool({
      name: 'read_source_refs',
      arguments: { attemptRef: 'AQ-REVIEW', sourceRefIds: ['SRC-1'] },
    });
    assert.deepEqual(
      resultJson(
        await openClawClient.callTool({
          name: 'get_action_attempt_status',
          arguments: { attemptRef: 'AQ-REVIEW' },
        }),
      ),
      {
        attemptRef: 'AQ-REVIEW',
        taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
        status: 'RUNNING',
        recoveryAvailable: false,
        commitStartedAt: null,
        projectionApplied: false,
        terminalReason: null,
        resultContentHash: null,
      },
    );
    await openClawClient.callTool({
      name: 'commit_review_turn_candidate',
      arguments: {
        attemptRef: 'AQ-REVIEW',
        leaseToken,
        leaseGeneration: 1,
        result: candidateResult,
      },
    });
    assert.deepEqual(
      reviewCalls.map(({ tool }) => tool),
      [
        'begin_review_turn',
        'get_review_turn_context',
        'read_source_refs',
        'commit_review_turn_candidate',
      ],
    );
    assert.deepEqual(statusCalls, [
      { tool: 'get_action_attempt_status', attemptRef: 'AQ-REVIEW' },
    ]);
    assert.deepEqual(
      resultJson(
        await openClawClient.callTool({
          name: 'heartbeat_action_attempt',
          arguments: {
            attemptRef: 'DYN-OPAQUE-CALLER-REF',
            leaseToken,
            leaseGeneration: 1,
          },
        }),
      ),
      { leaseExpiresAt },
    );
    assert.deepEqual(
      resultJson(
        await openClawClient.callTool({
          name: 'cancel_action_attempt',
          arguments: {
            attemptRef: 'DYN-OPAQUE-CALLER-REF',
            reason: 'cancel isolated MCP smoke attempt',
          },
        }),
      ),
      {
        attemptRef: 'DYN-OPAQUE-CALLER-REF',
        status: 'CANCELLED',
        projectionApplied: false,
        terminalReason: 'CANCELLED_BY_REQUEST',
      },
    );
    assert.deepEqual(attemptCalls, [
      {
        tool: 'heartbeat_action_attempt',
        attemptRef: 'DYN-OPAQUE-CALLER-REF',
        tenantId: 'tenant-mcp-smoke',
        workItemId: 'WI-DYNAMIC',
        principalId: 'service:openclaw-mcp-smoke',
        leaseToken,
        leaseGeneration: 1,
      },
      {
        tool: 'cancel_action_attempt',
        attemptRef: 'DYN-OPAQUE-CALLER-REF',
        tenantId: 'tenant-mcp-smoke',
        workItemId: 'WI-DYNAMIC',
        reason: 'cancel isolated MCP smoke attempt',
      },
    ]);
  } finally {
    await openClawClient.close();
  }

  calls.length = 0;
  const modernClient = await connectedClient(
    endpoint,
    'mcp-modern-client',
    'modern',
  );
  try {
    assert.equal(modernClient.getNegotiatedProtocolVersion(), '2026-07-28');
    assert.deepEqual(
      resultJson(
        await modernClient.callTool({
          name: 'get_deep_link',
          arguments: { workItemId: 'WI-MODERN' },
        }),
      ),
      {
        workItemId: 'WI-MODERN',
        deepLink: 'https://host.example.test/work-items/WI-MODERN/documents',
      },
    );
    assert.deepEqual(calls, [
      { tool: 'get_deep_link', workItemId: 'WI-MODERN' },
    ]);
  } finally {
    await modernClient.close();
  }

  calls.length = 0;
  const [slowClient, fastClient] = await Promise.all([
    connectedClient(endpoint, 'mcp-concurrent-slow'),
    connectedClient(endpoint, 'mcp-concurrent-fast'),
  ]);
  try {
    const [slowResult, fastResult] = await Promise.all([
      slowClient.callTool({
        name: 'get_parse_status',
        arguments: { workItemId: 'WI-SLOW' },
      }),
      fastClient.callTool({
        name: 'get_parse_status',
        arguments: { workItemId: 'WI-FAST' },
      }),
    ]);
    assert.deepEqual(resultJson(slowResult), {
      workItemId: 'WI-SLOW',
      status: 'STATUS:WI-SLOW',
    });
    assert.deepEqual(resultJson(fastResult), {
      workItemId: 'WI-FAST',
      status: 'STATUS:WI-FAST',
    });
    assert.deepEqual(
      calls.toSorted((left, right) =>
        left.workItemId.localeCompare(right.workItemId),
      ),
      [
        { tool: 'get_parse_status', workItemId: 'WI-FAST' },
        { tool: 'get_parse_status', workItemId: 'WI-SLOW' },
      ],
    );
  } finally {
    await Promise.all([slowClient.close(), fastClient.close()]);
  }

  assert.ok(methods.length > 0);
  assert.ok(methods.includes('POST'));
  assert.ok(
    methods
      .filter((method) => method !== 'POST')
      .every((method) => method === 'GET' || method === 'DELETE'),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'PASSED',
        transport: 'STATELESS_STREAMABLE_HTTP_JSON_POST_ONLY',
        protocolVersions: ['2026-07-28', '2025-11-25'],
        ailyTools: [
          'get_parse_status',
          'query_parsed_package',
          'get_deep_link',
        ],
        openClawTools: [
          'get_parse_status',
          'query_parsed_package',
          'get_deep_link',
          'begin_translation',
          'commit_translation_candidate',
          'begin_applicability_evaluation',
          'commit_applicability_candidate',
          'begin_dynamic_evaluation',
          'commit_dynamic_evaluation_candidate',
          'record_oem_discovery_run',
          'begin_overall_synthesis',
          'resume_overall_synthesis',
          'commit_overall_candidate',
          'begin_review_turn',
          'get_review_turn_context',
          'read_source_refs',
          'get_action_attempt_status',
          'commit_review_turn_candidate',
          'heartbeat_action_attempt',
          'cancel_action_attempt',
        ],
        resources: 0,
        prompts: 0,
        ailyMutationTools: 0,
        openClawCandidateMutationTools: 13,
        servedMethods: ['POST'],
        rejectedClientTransportMethods: [
          ...new Set(methods.filter((method) => method !== 'POST')),
        ],
        concurrentClientsIsolated: true,
        translationTransportProof,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await new Promise((resolveClose, rejectClose) =>
    httpServer.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
}

function serviceScopeFor(workItemId) {
  return {
    principalId: 'service:openclaw-mcp-smoke',
    appId: 'app-mcp-smoke',
    tenantId: 'tenant-mcp-smoke',
    workItemId,
    authorizationFingerprint: 'mcp-smoke-fingerprint',
  };
}

function mockTaskEnvelope(input) {
  return {
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: input.actionAttemptId,
    operationRef: input.operationRef,
    taskType: input.taskType,
    priority: 100,
    tenantId: 'tenant-mcp-smoke',
    workItemId: 'WI-DYNAMIC',
    inputRevision: 5,
    baseRevision: 5,
    documentVersionId: 'DV-MCP-SMOKE',
    sourceRefs: [{ ref: 'artifact://mcp-smoke', sha256: 'a'.repeat(64) }],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: structuredClone(input.modelInput),
    deadline: '2026-08-24T12:10:00.000Z',
    idempotencyKey: `mcp-smoke:${input.operationRef}`,
    inputHash: 'c'.repeat(64),
  };
}

async function connectedClient(endpoint, name, era = 'legacy') {
  const client = new Client(
    { name, version: '1.0.0' },
    era === 'modern'
      ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      : undefined,
  );
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  return client;
}

function resultJson(result) {
  const content = result.content.find((item) => item.type === 'text');
  assert.ok(content && content.type === 'text');
  return JSON.parse(content.text);
}

function largeTranslationResultEnvelope() {
  const filler =
    '完成驾驶舱显示系统构型核对并保留所有警告注意步骤与件号单位。'.repeat(2) +
    '严格复核完成并确认';
  const candidateUnits = Array.from({ length: 196 }, (_, index) => {
    const suffix = String(index + 1).padStart(3, '0');
    return {
      unitKey: `UNIT-${suffix}`,
      text: `WARNING airplane AIMS-2 P/N 123-ABC 5 kg. ${filler}`,
      sourceRefIds: [`SRC-${suffix}`],
      engineerRevision: null,
    };
  });
  const result = {
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: 'ATT-TRANSLATION-LARGE',
    operationRef: 'TRN-TRANSLATION-LARGE',
    taskType: 'OPENCLAW_TRANSLATE',
    workItemId: 'WI-DYNAMIC',
    baseRevision: 5,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: JSON.stringify({
      schemaVersion: 'wiselink.3_1.translation_result.v0.candidate',
      candidateUnits,
    }),
    outputArtifactRefs: [],
    sourceRefs: [],
    factsConsidered: [],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'GLM-5.3',
    promptVersion: 'wiselink.3_1.openclaw_translation_prompt.v1',
    skillVersion: 'wiselink-research-and-synthesize@r09.c5',
    toolVersions: {
      'wiselink-openclaw-engineering-assessment': '1.2.0',
    },
    runMetrics: { durationMs: 1, inputUnits: 1, outputUnits: 1 },
    errorCode: null,
    errorDetail: null,
    contentHash: 'e'.repeat(64),
  };
  return { result, bytes: Buffer.from(JSON.stringify(result), 'utf8') };
}

function chunkBytes(bytes, partBytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.byteLength; offset += partBytes) {
    parts.push(bytes.subarray(offset, offset + partBytes));
  }
  return parts;
}

function resultPartBinding(value) {
  return {
    partIndex: value.partIndex,
    sha256: value.sha256,
    byteLength: value.byteLength,
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function delay(milliseconds) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
