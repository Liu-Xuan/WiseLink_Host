import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { invokeHostedProgramAssessmentAgent } from '../skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs';
import { programRecoveryData } from './program-recovery-fixture.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const policy = { schemaVersion: 'wiselink.native.program_agent_policy.proposal.v1',
  maxModelRequests: 4, maxOutputTokens: 8192, maxToolCalls: 8, timeoutSeconds: 60 };

test('complete parent candidate receipt resumes same SAVE key after lost ACK and unreadable first readback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'program-agent-tail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { modelInput, work, assessmentBinding } = programRecoveryData();
  const checkpoint = await createCheckpointStore(join(root, 'checkpoint'));
  let saved = null, saveCalls = 0, agentCalls = 0, hideFirstSavedRead = true;
  const observations = [];
  const options = { modelExecutor: 'CODEX', agentPolicy: policy,
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'Fixture',
      providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-10-26T00:00:00Z' },
    sessionDiscriminator: 'synthetic-agent-session', assessmentBinding,
    assessmentCheckpoint: checkpoint, taskDeadline: new Date(Date.now() + 120_000).toISOString(),
    codexOptions: { codexBinary: '/fixture/unused', runRoot: join(root, 'runs') },
    readAssessmentSources: async () => { throw new Error('fixture agent handles tool simulation'); },
    readAssessmentWork: async ({ requestId }) => {
      let revision = saved?.requestId === requestId ? structuredClone(saved) : null;
      if (revision && hideFirstSavedRead) { hideFirstSavedRead = false; revision = null; }
      return { schemaVersion: 'wiselink.jobaid-work-read.v2',
        attemptId: assessmentBinding.actionAttemptId, inputWorkRevision: 0,
        executionStatus: 'RUNNING', revision };
    },
    saveAssessmentWork: async request => {
      saveCalls++;
      const authored = JSON.parse(request.workJson);
      saved = { requestId: request.requestId, workRevisionRef: 'JAWR-synthetic-agent', workRevision: 1,
        actionAttemptId: assessmentBinding.actionAttemptId, workItemId: assessmentBinding.workItemId,
        documentVersionId: assessmentBinding.documentVersionId,
        basedOnWorkItemRevision: assessmentBinding.baseRevision,
        content: { ...authored, understanding: authored.overview.trim(), overviewStatus: 'CURRENT',
          issues: authored.issues.map(issue => ({ ...issue, question: issue.question.trim(), body: issue.body.trim() })) } };
      throw new Error('SYNTHETIC_SAVE_ACK_LOST');
    },
    recordAssessmentProgramProgress: async ({ phase }) => ({ phase, status: 'SYNTHETIC_ACK' }),
    observeModelOutput: async row => observations.push(row),
  };
  const dependencies = { runCodexAgent: async input => {
    agentCalls++;
    await input.onRunPrepared({ requestId: input.requestId,
      runDirectory: join(root, 'runs', 'synthetic-completed'), bindingSha256: 'a'.repeat(64) });
    const raw = JSON.stringify({ model: 'fixture/synthetic-glm', choices: [{ finish_reason: 'tool_calls',
      message: { role: 'assistant', content: null, tool_calls: [{ type: 'function', id: 'fixture-call',
        function: { name: 'return_wiselink_program_assessment',
          arguments: JSON.stringify({ workJson: JSON.stringify(work) }) } }] } }] });
    return { version: 1, requestId: input.requestId, runDirectory: join(root, 'runs', 'synthetic-completed'),
      bindingSha256: 'a'.repeat(64), binding: input.binding,
      executionModel: input.executionModel, policy: input.policy,
      generationDeadlineAt: input.generationDeadlineAt,
      raw, responseSha256: sha(raw), status: 200, ok: true, dispatchCount: 2,
      dispatches: [1, 2].map(ordinal => ({ ordinal, maxOutputTokens: policy.maxOutputTokens })),
      deliveredRefs: [modelInput.deliveredEvidence[0].evidenceRef],
      toolAudit: [{ name: 'read_sources', status: 'AVAILABLE',
        refs: [modelInput.deliveredEvidence[0].evidenceRef] },
        { name: 'validate_candidate', status: 'VALID' }] };
  } };
  await assert.rejects(invokeHostedProgramAssessmentAgent({ operation: 'EVALUATE_JOBAID', modelInput },
    options, dependencies), /SYNTHETIC_SAVE_ACK_LOST/u);
  const firstSave = await checkpoint.readOptional('program-save-request');
  assert.ok(firstSave?.requestId);
  assert.equal(await checkpoint.readOptional('program-execution'), null);
  assert.equal(saveCalls, 1);
  assert.equal(agentCalls, 1);
  assert.equal(observations[0].operation, 'EVALUATE_JOBAID');
  assert.equal((await checkpoint.readOptional('program-work-candidate')).issues[0].issueKey, work.issues[0].issueKey);
  const resumed = await invokeHostedProgramAssessmentAgent({ operation: 'EVALUATE_JOBAID', modelInput },
    options, dependencies);
  assert.deepEqual(resumed.output, { workRevisionRef: 'JAWR-synthetic-agent' });
  assert.equal((await checkpoint.readOptional('program-work-readback')).revision.workRevisionRef,
    'JAWR-synthetic-agent');
  assert.equal((await checkpoint.readOptional('program-save-request')).requestId, firstSave.requestId);
  assert.equal(saveCalls, 1);
  assert.equal(agentCalls, 1);
});
