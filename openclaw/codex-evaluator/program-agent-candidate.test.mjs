import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgramAgentSession } from './program-agent-session.mjs';
import { runProgramAgentGateway } from './program-agent-gateway.mjs';
import { prepareProgramAgentMaterials } from '../skills/wiselink-research-and-synthesize/scripts/program-assessment-materials.mjs';
import { programRecoveryData } from './program-recovery-fixture.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const binary = process.env.WISELINK_CODEX_TEST_BINARY;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'program-agent-candidate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { modelInput, work, assessmentBinding } = programRecoveryData();
  const checkpoint = { readOptional: async () => null, writeOnce: async () => {} };
  const materials = await prepareProgramAgentMaterials(modelInput, {
    assessmentBinding, assessmentCheckpoint: checkpoint });
  const evidence = modelInput.deliveredEvidence[0];
  const readAssessmentSources = async ({ sourceRefs, context }) => ({ status: 'AVAILABLE', scope: context,
    completeRequestedScope: true, sourceRefs, evidence: [structuredClone(evidence)] });
  return { root, materials, work, modelInput, assessmentBinding, readAssessmentSources };
}

test('private units preserve unknown fields while source receipts alone grant citation authority', async t => {
  const f = await fixture(t);
  f.materials.originalInput.programOriginal.units[0].payload.unknownField = { exact: 'keep' };
  f.materials.originalInput.programOriginal.units[0].sourceRefIds.push('UNCITABLE-ORIGINAL');
  f.materials.originalInput.programOriginal.sourceLocators.push({ sourceRefId: 'UNCITABLE-ORIGINAL', page: 2 });
  const session = createProgramAgentSession({ materials: f.materials,
    readAssessmentSources: f.readAssessmentSources, readAssessmentWork: async () => null,
    maxToolCalls: 8 });
  assert.deepEqual(session.deliveredRefs(), []);
  const unit = await session.callTool('read_private_units', { unitIds: ['fixture-unit-1'] });
  assert.deepEqual(unit.units[0].payload.unknownField, { exact: 'keep' });
  assert.deepEqual(unit.units[0].uncitableSourceRefIds, ['UNCITABLE-ORIGINAL']);
  assert.equal(session.validateFinal(JSON.stringify(f.work)).violations.includes('UNDELIVERED_EVIDENCE_REF'), true);
  assert.equal((await session.callTool('read_sources', { sourceRefs: [f.modelInput.availableSources[0].ref],
    purpose: 'Check the exact synthetic source' })).status, 'AVAILABLE');
  assert.equal(session.validateFinal(JSON.stringify(f.work)).status, 'VALID');
  assert.equal(session.validateFinal(JSON.stringify({ ...f.work,
    overview: 'Unknown [[UNCITABLE-ORIGINAL]]' })).violations.includes('UNDELIVERED_EVIDENCE_REF'), true);
  const unreadMethod = structuredClone(f.work);
  unreadMethod.issues[0].requirementHandling = [{ methodRef: 'JA_AC_R01' }];
  assert.equal(session.validateFinal(JSON.stringify(unreadMethod)).violations.includes('UNDELIVERED_EVIDENCE_REF'), true);
  assert.equal((await session.callTool('read_sources', { sourceRefs: [f.modelInput.availableSources[0].ref],
    purpose: 'x', extra: true })).code, 'SOURCE_SELECTION_INVALID');
  const changed = { ...f.modelInput.deliveredEvidence[0], versionLabel: 'other' };
  const mismatched = createProgramAgentSession({ materials: f.materials,
    readAssessmentSources: async ({ sourceRefs }) => ({ status: 'AVAILABLE', scope: 'EXACT',
      completeRequestedScope: true, sourceRefs, evidence: [changed] }),
    readAssessmentWork: async () => null, maxToolCalls: 3 });
  await assert.rejects(mismatched.callTool('read_sources', { sourceRefs: [f.modelInput.availableSources[0].ref],
    purpose: 'x' }), /SOURCE_READ_INCOMPLETE/u);
  assert.deepEqual(mismatched.deliveredRefs(), []);
  assert.equal(session.validateFinal(JSON.stringify({ ...f.work, listBrief: ['Paragraph one', 'Paragraph two'] })).status, 'VALID');
});

function sse(ordinal, work) {
  const response = { id: `resp_${ordinal}`, object: 'response', created_at: 1,
    status: 'in_progress', model: 'glm-5.3', output: [], usage: null, error: null };
  const events = [];
  const emit = (type, fields) => events.push({ type, sequence_number: events.length,
    ...structuredClone(fields) });
  emit('response.created', { response }); emit('response.in_progress', { response });
  if (ordinal < 4) {
    const name = ['read_private_units', 'read_sources', 'validate_candidate'][ordinal - 1];
    const args = ordinal === 1 ? { unitIds: ['fixture-unit-1'] } : ordinal === 2
      ? { sourceRefs: [work.issues[0].body.match(/\[\[([^\]]+)\]\]/u)[1]], purpose: 'Verify exact source' }
      : { workJson: JSON.stringify({ ...work, overview: 'Invalid [[foreign:ref]]' }) };
    const item = { id: `fc_${ordinal}`, type: 'function_call', call_id: `call_${ordinal}`,
      namespace: 'mcp__program_agent', name, arguments: JSON.stringify(args), status: 'in_progress' };
    response.output = [item]; emit('response.output_item.added', { output_index: 0, item });
    emit('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments });
    emit('response.function_call_arguments.done', { item_id: item.id, output_index: 0, arguments: item.arguments });
    item.status = 'completed'; emit('response.output_item.done', { output_index: 0, item });
  } else {
    const text = JSON.stringify({ tool_name: 'return_wiselink_program_assessment',
      arguments: { workJson: JSON.stringify(work) } });
    const part = { type: 'output_text', text, annotations: [] };
    const item = { id: 'msg_final', type: 'message', role: 'assistant', status: 'in_progress', content: [part] };
    response.output = [item]; emit('response.output_item.added', { output_index: 0, item });
    emit('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part });
    emit('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text });
    emit('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text });
    emit('response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part });
    item.status = 'completed'; emit('response.output_item.done', { output_index: 0, item });
  }
  response.status = 'completed'; response.usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
  emit('response.completed', { response });
  return Buffer.from(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
}

test('real Codex CLI follows local MCP feedback over four bounded fake-provider dispatches',
  { skip: !binary }, async t => {
    const f = await fixture(t);
    const calls = [];
    const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic',
      providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-26T00:00:00Z' };
    const result = await runProgramAgentGateway({ requestId: 'offline-agent-test',
      binding: { assessmentBinding: f.assessmentBinding, fixture: true }, materials: f.materials,
      policy: { schemaVersion: 'wiselink.native.program_agent_policy.proposal.v1',
        maxModelRequests: 4, maxOutputTokens: 131072, maxToolCalls: 8, timeoutSeconds: 30 },
      executionModel, codexOptions: { codexBinary: binary, runRoot: f.root },
      generationDeadlineAt: new Date(Date.now() + 30_000).toISOString(),
      readAssessmentSources: f.readAssessmentSources, readAssessmentWork: async () => null,
      providerDispatch: async request => {
        calls.push(request);
        const upstreamRequestBytes = Buffer.from(`synthetic-upstream-request-${request.ordinal}`);
        const upstreamResponseBytes = Buffer.from('data: {"choices":[{"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
        return { responseBytes: sse(request.ordinal, f.work), upstreamRequestBytes,
          upstreamResponseBytes, receipt: { complete: true, upstreamHttpStatus: 200,
          upstreamProtocol: 'fixture-chat-completions-sse-v1', reportedModel: 'fixture/synthetic-glm',
          upstreamDoneSeen: true, upstreamFinishReason: 'stop', maxOutputTokens: request.maxOutputTokens,
            executionModel: request.executionModel, clientRequestSha256: request.clientRequestSha256,
            effectiveRequestSha256: request.effectiveRequestSha256,
            upstreamRequestSha256: digest(upstreamRequestBytes),
            upstreamResponseSha256: digest(upstreamResponseBytes) } };
      } });
    assert.equal(result.dispatchCount, 4);
    assert.equal(calls.length, 4);
    assert.equal(calls[0].clientRequestBytes.includes('fixture-source-1'), true);
    assert.equal(calls[0].clientRequestBytes.includes('仅用于离线软件测试'), false);
    assert.equal(calls[1].clientRequestBytes.includes('仅用于离线软件测试'), true);
    assert.equal(calls[3].clientRequestBytes.includes('REPAIR_REQUIRED'), true);
    for (const request of calls) {
      assert.equal(JSON.parse(request.effectiveRequestBytes).max_output_tokens, 131072);
      assert.equal(request.maxOutputTokens, 131072);
    }
    assert.deepEqual(result.toolAudit.map(item => item.name),
      ['read_private_units', 'read_sources', 'validate_candidate']);
    assert.equal(result.toolAudit[2].status, 'REPAIR_REQUIRED');
    const first = JSON.parse(calls[0].clientRequestBytes);
    const toolNames = first.tools.flatMap(tool => tool.type === 'namespace'
      ? (tool.tools ?? []).map(child => `${tool.name}__${child.name}`) : [tool.name ?? tool.type]);
    assert.equal(JSON.stringify(first.tools).includes('exec_command'), false);
    assert.equal(JSON.stringify(first.tools).includes('write_stdin'), false);
    assert.equal(JSON.stringify(first.tools).includes('view_image'), false);
    assert.equal(JSON.stringify(first.tools).includes('goals'), false);
    assert.equal(toolNames.some(name => /(?:^|__)(?:save|finish|overall)$/iu.test(name)), false);
    assert.deepEqual(toolNames.sort(), ['mcp__program_agent__read_sources',
      'mcp__program_agent__read_private_units', 'mcp__program_agent__read_previous_work',
      'mcp__program_agent__validate_candidate', 'list_mcp_resource_templates',
      'list_mcp_resources', 'read_mcp_resource', 'request_user_input'].sort());
    const recovered = await runProgramAgentGateway({ requestId: 'offline-agent-test',
      binding: { assessmentBinding: f.assessmentBinding, fixture: true }, materials: f.materials,
      policy: { schemaVersion: 'wiselink.native.program_agent_policy.proposal.v1',
        maxModelRequests: 4, maxOutputTokens: 131072, maxToolCalls: 8, timeoutSeconds: 30 },
      executionModel, codexOptions: { codexBinary: binary, runRoot: f.root },
      generationDeadlineAt: result ? (JSON.parse(await readFile(join(result.runDirectory,
        'program-agent-binding.json'), 'utf8')).generationDeadlineAt) : null,
      readAssessmentSources: f.readAssessmentSources, readAssessmentWork: async () => null,
      providerDispatch: async () => { throw new Error('MUST_NOT_REDISPATCH'); } });
    assert.deepEqual(recovered, result);
    assert.equal(JSON.parse(await readFile(join(result.runDirectory, 'ledger/dispatch-4.result.json'), 'utf8')).ordinal, 4);
    await assert.rejects(runProgramAgentGateway({ requestId: 'offline-agent-test',
      binding: { fixture: 'wrong-original-binding' }, materials: f.materials,
      policy: { schemaVersion: 'wiselink.native.program_agent_policy.proposal.v1',
        maxModelRequests: 4, maxOutputTokens: 131072, maxToolCalls: 8, timeoutSeconds: 30 },
      executionModel, codexOptions: { codexBinary: binary, runRoot: f.root },
      generationDeadlineAt: JSON.parse(await readFile(join(result.runDirectory,
        'program-agent-binding.json'), 'utf8')).generationDeadlineAt,
      readAssessmentSources: f.readAssessmentSources, readAssessmentWork: async () => null,
      providerDispatch: async () => { throw new Error('MUST_NOT_REDISPATCH'); } }),
    /PROGRAM_AGENT_BINDING_MISMATCH/u);
    t.diagnostic(JSON.stringify({ firstRequestTools: toolNames,
      dispatches: result.dispatches.map(item => ({ ordinal: item.ordinal,
        maxOutputTokens: item.maxOutputTokens, clientRequestSha256: item.clientRequestSha256,
        effectiveRequestSha256: item.effectiveRequestSha256,
        upstreamResponseSha256: item.upstreamResponseSha256 })),
      feedbackInPost: 4, providerCalls: calls.length, recoveredProviderCalls: 0,
      finalReceiptResponseSha256: result.responseSha256 }));
  });

test('reserved unknown dispatch is never resent; reservation conflict sends zero provider calls',
  { skip: !binary }, async t => {
    const f = await fixture(t);
    const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic',
      providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-26T00:00:00Z' };
    const policy = { schemaVersion: 'wiselink.native.program_agent_policy.proposal.v1',
      maxModelRequests: 2, maxOutputTokens: 131072, maxToolCalls: 2, timeoutSeconds: 15 };
    const deadline = new Date(Date.now() + 15_000).toISOString();
    const base = { binding: { fixture: 'unknown' }, materials: f.materials, policy,
      executionModel, codexOptions: { codexBinary: binary, runRoot: f.root },
      generationDeadlineAt: deadline, readAssessmentSources: f.readAssessmentSources,
      readAssessmentWork: async () => null };
    let called = 0;
    await assert.rejects(runProgramAgentGateway({ ...base, requestId: 'pending-original',
      providerDispatch: async () => { called++; throw new Error('SYNTHETIC_PROVIDER_OUTCOME_UNKNOWN'); } }),
    /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
    assert.equal(called, 1);
    const pendingDir = join(f.root, `program-agent-${digest('pending-original')}`);
    assert.equal((await readFile(join(pendingDir, 'ledger/dispatch-1.started.json'), 'utf8')).includes('"ordinal":1'), true);
    await assert.rejects(readFile(join(pendingDir, 'ledger/dispatch-1.result.json')));
    await assert.rejects(runProgramAgentGateway({ ...base, requestId: 'pending-original',
      providerDispatch: async () => { called++; throw new Error('MUST_NOT_REDISPATCH'); } }),
    /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
    assert.equal(called, 1);
    let blockedCalls = 0;
    await assert.rejects(runProgramAgentGateway({ ...base, requestId: 'blocked-reservation',
      onRunPrepared: async ({ runDirectory }) => {
        const ledger = join(runDirectory, 'ledger');
        await mkdir(ledger, { recursive: true, mode: 0o700 });
        await writeFile(join(ledger, 'dispatch-1.started.json'), '{"occupied":true}\n');
      },
      providerDispatch: async () => { blockedCalls++; throw new Error('MUST_NOT_SEND'); } }),
    /PROGRAM_AGENT_OUTCOME_UNKNOWN/u);
    assert.equal(blockedCalls, 0);
    t.diagnostic(JSON.stringify({ pendingOriginalProviderCalls: called,
      recoveryProviderCalls: 0, reservationConflictProviderCalls: blockedCalls,
      pendingStarted: true, pendingResult: false }));
  });
