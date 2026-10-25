import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeHostedInitialModel } from '../skills/wiselink-research-and-synthesize/scripts/invoke-hosted-initial-model.mjs';
import { validatePayload, WISELINK_PROFILE_REF, WISELINK_MODEL_POLICY_REF,
  WISELINK_APPLICABILITY_PROMPT_VERSION, WISELINK_SKILL_COMPATIBILITY_REF,
  WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION } from
  '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3',
  providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-25T00:00:00.000Z' };
const options = { modelExecutor: 'CODEX', runtimeAppId: 'app_syntheticCodexRuntime', executionModel,
  codexOptions: { codexBinary: '/synthetic/codex', configPath: '/synthetic/config',
    runRoot: '/synthetic/runs' },
  configuredModelVersion: 'configured-route:miaoda/glm-5.3', sessionDiscriminator: 'APP-1' };

function applicabilityInput(runtimeAppId) {
  return {
    schemaVersion: 'wiselink.3_1.applicability_task.v2', operation: 'EXTRACT_APPLICABILITY',
    applicabilityContextRef: 'CTX-1', inputRevision: 1, documentVersionRef: 'DV-1',
    sourcePackage: { packageId: 'PKG-1', contentHash: 'synthetic-hash' },
    bilingualBinding: null,
    aircraft: { aircraftNumber: 'B-1234', assessmentAsOf: '2026-10-25' },
    fleetBinding: { bindingRevision: 'BR-1', selectionRevision: 'SR-1',
      sourceSnapshotId: null, sourceRevisionKey: null, authorityRevision: null,
      sourceAsOf: null },
    controlledAircraft: null, controlledFacts: [],
    astVocabulary: { schemaVersion: 'wiselink.3_1.applicability_ast_vocabulary.v1',
      nodeTypes: ['literal', 'assert', 'and', 'or', 'not'],
      properties: [{ property: 'aircraftModel', valueType: 'string', qualifier: 'required',
        operators: [{ operator: 'eq', valueShape: 'scalar' }] }],
      limits: { maxDepth: 4, maxNodes: 16, maxGroupChildren: 8, maxSetValues: 8 } },
    sourceExpressions: [{ expressionId: 'EX-1', text: 'Applies to model A.',
      sourceRefIds: ['REF-1'], assignmentId: 'ASG-1', targetKind: 'module',
      targetId: null, targetSourceRefIds: [], applicabilityLevel: 'document_effectivity',
      contentRef: null }],
    bilingualSourceUnits: [], sourceReadingMode: 'VERIFIED_ENGLISH',
    sourceContext: [{ unitId: 'UNIT-1', kind: 'paragraph',
      sourceText: 'Applies to model A.', sourceRefIds: ['REF-1'] }],
    runtimePolicy: { runtimeAppId, profileRef: WISELINK_PROFILE_REF,
      modelPolicyRef: WISELINK_MODEL_POLICY_REF,
      promptVersion: WISELINK_APPLICABILITY_PROMPT_VERSION,
      skillVersion: WISELINK_SKILL_COMPATIBILITY_REF,
      mcpServerName: WISELINK_HOST_MCP_NAME,
      mcpServerVersion: WISELINK_HOST_MCP_VERSION },
    authority: { candidateOnly: true, documentTextDoesNotProveFleetApplicability: true,
      hostDeterministicEvaluationRequired: true },
  };
}

test('actual initial model leaf accepts Codex-app applicability and rejects old app before dispatch', async () => {
  const input = applicabilityInput('app_syntheticCodexRuntime');
  validatePayload('applicability-input', input, { modelExecutor: 'CODEX', runtimeAppId: options.runtimeAppId });
  let requests = 0;
  const output = { schemaVersion: 'wiselink.3_1.applicability_ast_candidate.v1',
    expressions: [{ expressionId: 'EX-1', sourceRefIds: ['REF-1'],
      extractionStatus: 'extraction_failed', expressionAst: null }] };
  const result = await invokeHostedInitialModel({ operation: 'EXTRACT_APPLICABILITY',
    modelInput: input }, options, { requestGateway: async (_endpoint, init) => {
      requests++;
      assert.equal(init.headers['x-openclaw-model'], 'miaoda/glm-5.3');
      return { status: 200, ok: true, text: async () => JSON.stringify({
        model: 'glm-5.3', choices: [{ finish_reason: 'tool_calls', message: {
          role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: {
            name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: output }),
          } }],
        } }],
      }) };
    } });
  assert.equal(requests, 1);
  assert.deepEqual(result.output, output);
  assert.equal(result.provenance.toolVersions['model-executor'], 'CODEX');
  assert.equal(result.provenance.toolVersions[WISELINK_HOST_MCP_NAME], WISELINK_HOST_MCP_VERSION);
  await assert.rejects(invokeHostedInitialModel({ operation: 'EXTRACT_APPLICABILITY',
    modelInput: applicabilityInput('app_17c3zn24kv2') }, options, {
    requestGateway: async () => { requests++; throw new Error('MODEL_MUST_NOT_RUN'); },
  }), /APPLICABILITY_RUNTIME_APP_MISMATCH/u);
  assert.equal(requests, 1);
});
