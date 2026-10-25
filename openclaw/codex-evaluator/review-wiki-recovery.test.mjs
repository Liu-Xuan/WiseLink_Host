import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { runWikiFixture, runReviewFixture, runSummaryConsumerFixture, runReviewConsumerFixture } from './review-wiki-recovery-fixture.mjs';
import { assertCodexParentRunLink, assertDistinctCodexParentRunLinks } from './codex-parent-run-link-test-helper.mjs';

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'wiki-codex-recovery-'));
  const runRoot = resolve(root, 'runner');
  await mkdir(runRoot);
  const fake = resolve(root, 'fake-runner.py');
  await writeFile(fake, `import hashlib,json,os,pathlib,sys
r=json.load(sys.stdin); p=pathlib.Path(r['run_directory']); p.mkdir(exist_ok=True)
with open(p.parent/'dispatch-count','a') as f: f.write('1\\n'); f.flush(); os.fsync(f.fileno())
def save(name,value):
 q=p/(name+'.tmp'); q.write_text(json.dumps(value)); os.replace(q,p/name)
step={'action':'SAVE_SUMMARY','content':{'headline':'Selected ATA4 candidate','listBrief':'One selected matter.','body':'Selected engineering finding [[member-1]]. Source currentness remains unverified.','limitations':['Source currentness not established.']}}
candidate={'tool_name':'return_wiselink_summary_step','arguments':{'step':step}}
if (p.parent/'summary-two-round').exists() and len(json.loads(r['prompt'].split('\\n\\n')[-1])['messages'])==2:
 candidate={'tool_name':'return_wiselink_summary_step','arguments':{'step':{'action':'READ_MEMBER_WORK','evidenceRefs':['member-1'],'purpose':'Confirm exact member work.'}}}
if 'return_wiselink_review_candidate' in r['allowed_tool_names']:
 two=(p.parent/'review-two-round').exists()
 first=two and 'read_wiselink_review_sources' in r['allowed_tool_names'] and len(json.loads(r['prompt'].split('\\n\\n')[-1])['messages'])==2
 if first:
  candidate={'tool_name':'read_wiselink_review_sources','arguments':{'sourceRefIds':['SR-1']}}
 else:
  candidate={'tool_name':'return_wiselink_review_candidate','arguments':{'responseType':'ANSWER','answer':'No current status is established.','sourceRefs':['SR-1'] if two else [],'missingInputs':[],'candidateEvidenceRefs':[],'reviewActionDraft':None,'affectedItemIds':[],'warnings':[]}}
summary={'codex_exit_code':0,'terminal_events':['turn.completed'],'transport_passed':True,'upstream_models':['glm-5.3'],'input_tokens':10,'output_tokens':5,'model_requests':1,'closure':'completed','process_group_closed':True,'upstream_response_present':True,'upstream_request_present':True,'structured_final_to_contract':True,'source_config_unchanged':True}
save('upstream-request.json',{'model':'glm-5.3','messages':[{'role':'user','content':'offline review fixture'}]})
summary['upstream_request_sha256']=hashlib.sha256((p/'upstream-request.json').read_bytes()).hexdigest()
save('upstream-response.json',{'format':'chat-completions-sse-events-v1','events':[{'model':'glm-5.3','choices':[{'index':0,'finish_reason':'stop'}]}]})
save('contract-candidate.json',candidate); save('transport-summary.json',summary)
save('generation-receipt.json',{'version':1,'binding_sha256':r['binding_sha256'],'run_directory':str(p),'transport':summary,'candidate':candidate,'upstream_request_sha256':summary['upstream_request_sha256'],'upstream_response_sha256':hashlib.sha256((p/'upstream-response.json').read_bytes()).hexdigest()})
print(json.dumps(summary))
`);
  const wrapper = resolve(root, 'python-wrapper');
  await writeFile(wrapper, `#!/bin/sh\nexec python3 '${fake}'\n`);
  await chmod(wrapper, 0o700);
  return root;
}

function child(root, mode, kind = 'wiki') {
  const script = resolve('openclaw/codex-evaluator/review-wiki-recovery-fixture.mjs');
  const run = spawn(process.execPath, [script, root, mode, kind], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  run.stdout.on('data', value => { stdout += value; });
  run.stderr.on('data', value => { stderr += value; });
  return new Promise(resolveDone => run.once('exit', (code, signal) => resolveDone({ code, signal, stdout, stderr })));
}

test('Wiki round joins one real durable process after response but before caller checkpoint', async () => {
  const root = await fixture();
  const first = await child(root, 'after-model-receipt');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  const store = await createCheckpointStore(resolve(root, 'checkpoint'));
  assert.equal(await store.readOptional('summary-round-0.result'), null);
  const recovered = await runWikiFixture(root);
  assert.equal(recovered.content.headline, 'Selected ATA4 candidate');
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
  assert.equal((await store.readOptional('summary-codex.receipt')).runs.length, 1);
  assert.equal((await store.readOptional('summary-codex.receipt')).closed, true);
  const repeated = await runWikiFixture(root);
  assert.deepEqual(repeated.content, recovered.content);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('Wiki recovery refuses changed subject, round payload and missing child receipt', async () => {
  const root = await fixture();
  assert.equal((await child(root, 'after-model-receipt')).signal, 'SIGKILL');
  const store = await createCheckpointStore(resolve(root, 'checkpoint'));
  const started = await store.readOptional('summary-codex.round-0.started');
  await store.write('summary-codex.round-0.started', { ...started, bodySha256: '0'.repeat(64) });
  await assert.rejects(runWikiFixture(root), /DERIVED_SUMMARY_CODEX_ROUND_BINDING_MISMATCH/u);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});

// A Review model marker makes the attempt recoverable. An uncertain model
// outcome must not be converted into a Host cancellation by the cron wrapper.
test('ordinary Review preserves the exact Codex attempt on model UNKNOWN', async () => {
  const { consumePendingReviewTurn } = await import('../skills/wiselink-research-and-synthesize/scripts/consume-hosted-review-turn.mjs');
  const root = await mkdtemp(resolve(tmpdir(), 'review-codex-unknown-'));
  const reviewTurnRef = 'RT-review-recovery';
  const store = await createCheckpointStore(resolve(root, encodeURIComponent(reviewTurnRef)));
  await store.writeOnce('model.started', { argsHash: 'a'.repeat(64) });
  let cancelled = 0;
  const callTool = async name => {
    if (name === 'get_pending_review_turn') return { busy: false,
      next: { reviewTurnRef, reviewConversationRef: 'RC-1', requestId: 'REQ-1' } };
    if (name === 'begin_review_turn') return { status: 'RUNNING', attemptRef: 'AQ-review-1' };
    if (name === 'cancel_action_attempt') { cancelled++; throw new Error('CANCEL_FORBIDDEN'); }
    throw new Error(`UNEXPECTED_${name}`);
  };
  await assert.rejects(consumePendingReviewTurn({ workItemId: 'WI-1', checkpointRoot: root }, {
    callTool, modelRuntime: { modelExecutor: 'CODEX' },
    runTurn: async (_options, dependencies) => {
      await dependencies.callTool('begin_review_turn', {});
      throw new Error('CODEX_GENERATION_OUTCOME_UNKNOWN');
    },
  }), /CODEX_GENERATION_OUTCOME_UNKNOWN/u);
  assert.equal(cancelled, 0);
});

test('ordinary Review reacquires and validates a fresh Host lease before model recovery', async () => {
  const { runHostedReviewTurn } = await import('../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs');
  const root = await mkdtemp(resolve(tmpdir(), 'review-codex-lease-'));
  const store = await createCheckpointStore(root);
  const old = { status: 'RUNNING', attemptRef: 'AQ-review-1', leaseToken: 'old-token',
    leaseGeneration: 1, leaseExpiresAt: '2020-01-01T00:00:00.000Z',
    task: { operationRef: 'AQ-review-1', modelInput: {} } };
  await store.writeOnce('model-executor', { schemaVersion: 'wiselink.review.executor.v1', modelExecutor: 'CODEX' });
  await store.writeOnce('begin.result', { value: old });
  await store.writeOnce('model.started', { argsHash: 'a'.repeat(64) });
  const options = { reviewConversationRef: 'RC-1', requestId: 'REQ-1', checkpointDir: root };
  const runtime = { modelExecutor: 'CODEX', codexOptions: { codexBinary: '/fake/codex',
    configPath: '/fake/config', runRoot: resolve(root, 'runner') } };
  let heartbeatArgs;
  const fresh = { ...old, leaseToken: 'new-token', leaseGeneration: 2,
    leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
  await assert.rejects(runHostedReviewTurn(options, { modelRuntime: runtime,
    invokeModel: async () => { throw new Error('MODEL_FORBIDDEN'); },
    callTool: async (name, args) => {
      if (name === 'begin_review_turn') return fresh;
      if (name === 'heartbeat_action_attempt') { heartbeatArgs = args;
        return { leaseExpiresAt: '2099-01-01T00:00:00.000Z' }; }
      throw new Error(`UNEXPECTED_${name}`);
    },
  }), /TASK_ENVELOPE_MISSING_FIELD:schemaVersion/u);
  assert.equal(heartbeatArgs.leaseToken, 'new-token');
  assert.equal(heartbeatArgs.leaseGeneration, 2);
  await assert.rejects(runHostedReviewTurn(options, { modelRuntime: runtime,
    invokeModel: async () => { throw new Error('MODEL_FORBIDDEN'); },
    callTool: async name => name === 'begin_review_turn'
      ? { ...fresh, leaseExpiresAt: '2020-01-01T00:00:00.000Z' }
      : { leaseExpiresAt: '2099-01-01T00:00:00.000Z' },
  }), /REVIEW_CODEX_RECOVERY_FRESH_BEGIN_INVALID/u);
});

test('ordinary Review reuses one real Codex process after durable response and lost caller checkpoint', async () => {
  const root = await fixture();
  const first = await child(root, 'after-model-receipt', 'review');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  const store = await createCheckpointStore(resolve(root, 'review-checkpoint'));
  assert.equal(await store.readOptional('review-codex-round-1.result') !== null, true);
  const recovered = await runReviewFixture(root);
  assert.equal(recovered.output.answer, 'No current status is established.');
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
  const repeated = await runReviewFixture(root);
  assert.deepEqual(repeated.output, recovered.output);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});


test('ordinary Review recovers a completed runner before its HTTP response checkpoint', async () => {
  const root = await fixture();
  const first = await child(root, 'after-runner-receipt', 'review');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  const store = await createCheckpointStore(resolve(root, 'review-checkpoint'));
  assert.equal(await store.readOptional('review-codex-round-1.result'), null);
  assert.equal(await store.readOptional('review-codex-round-1.started') !== null, true);
  const recovered = await runReviewFixture(root);
  assert.equal(recovered.output.responseType, 'ANSWER');
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('Wiki queue keeps the original pointer after a completed Codex model and lost SAVE acknowledgement', async () => {
  const { consumeHierarchicalWikiIdle } = await import('../skills/wiselink-research-and-synthesize/scripts/consume-hierarchical-wiki-queue.mjs');
  const root = await mkdtemp(resolve(tmpdir(), 'wiki-queue-ack-'));
  const queue = await createCheckpointStore(resolve(root, 'queue'));
  const subject = await createCheckpointStore(resolve(root, 'subject'));
  let nextCalls = 0, cleanupCalls = 0, consumeCalls = 0;
  const options = { enabled: true, modelExecutor: 'CODEX',
    codexOptions: {}, runBudget: { timeoutMs: 30_000, maxCompletionTokens: 1000,
      maxModelRequests: 2, reasoningEffort: 'low' },
    checkpointRoot: root, endpointKey: 'synthetic-host' };
  const dependencies = {
    checkpoint: queue, createCheckpoint: async () => subject,
    callTool: async name => {
      if (name === 'next_hierarchical_wiki') { nextCalls++;
        return { status: 'SUMMARY_PENDING', summaryId: 'DS-1', attemptRef: 'AQ-1' }; }
      if (name === 'hierarchical_wiki_cleanup') { cleanupCalls++;
        throw new Error('CANCEL_FORBIDDEN'); }
      throw new Error(`UNEXPECTED_${name}`);
    },
    consumeSummary: async () => {
      consumeCalls++;
      if (!await subject.readOptional('summary-codex.started'))
        await subject.writeOnce('summary-codex.started', { executor: 'CODEX', attemptRef: 'AQ-1',
          subject: { kind: 'DERIVED_SUMMARY', summaryId: 'DS-1' } });
      throw new Error('SYNTHETIC_SAVE_ACK_LOST');
    },
  };
  const first = await consumeHierarchicalWikiIdle(options, dependencies);
  assert.equal(first.status, 'WIKI_ATTENTION');
  assert.equal((await queue.readOptional('active-wiki')).attemptRef, 'AQ-1');
  const second = await consumeHierarchicalWikiIdle(options, dependencies);
  assert.equal(second.status, 'WIKI_ATTENTION');
  assert.equal((await queue.readOptional('active-wiki')).attemptRef, 'AQ-1');
  assert.equal(nextCalls, 1);
  assert.equal(consumeCalls, 2);
  assert.equal(cleanupCalls, 0);
});


test('Wiki summary consumer reuses original model and saved revision after lost SAVE acknowledgement', async () => {
  const root = await fixture();
  const completed = await runSummaryConsumerFixture(root, 'lost-save-ack');
  assert.equal(completed.result.status, 'DERIVED_SUMMARY_SAVED');
  assert.equal(completed.state.committedWrites, 1);
  assert.equal(completed.state.saveCalls, 1);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
  const repeated = await runSummaryConsumerFixture(root);
  assert.equal(repeated.result.summaryRef, completed.result.summaryRef);
  assert.equal(repeated.state.committedWrites, 1);
  assert.equal(repeated.state.saveCalls, 1);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('Wiki summary consumer resumes frozen candidate after process stops before SAVE', async () => {
  const root = await fixture();
  const first = await child(root, 'before-save', 'consumer');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  const completed = await runSummaryConsumerFixture(root);
  assert.equal(completed.result.status, 'DERIVED_SUMMARY_SAVED');
  assert.equal(completed.state.committedWrites, 1);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});


test('ordinary Review refuses changed attempt and payload without dispatching a second model', async () => {
  const root = await fixture();
  await runReviewFixture(root);
  await assert.rejects(runReviewFixture(root, 'normal', 'A different question'),
    /REVIEW_CODEX_ROUND_BINDING_MISMATCH/u);
  await assert.rejects(runReviewFixture(root, 'normal', 'What is the status?', 'AQ-other-attempt'),
    /REVIEW_CODEX_ROUND_BINDING_MISMATCH/u);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});


test('full ordinary Review consumer resumes one Codex process with a new Host lease and one commit', async () => {
  const root = await fixture();
  const first = await child(root, 'after-runner-receipt', 'review-consumer');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  const busy = await runReviewConsumerFixture(root);
  assert.equal(busy.result.status, 'BUSY');
  await new Promise(resolveDelay => setTimeout(resolveDelay, 180));
  const completed = await runReviewConsumerFixture(root);
  assert.equal(completed.result.status, 'CANDIDATE_SAVED');
  assert.equal(completed.state.beginCalls, 2);
  assert.equal(completed.state.commitCalls, 1);
  assert.equal(completed.state.committedWrites, 1);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('full ordinary Review reads back a lost commit ACK without another model or business write', async () => {
  const root = await fixture();
  const recovered = await runReviewConsumerFixture(root, 'lost-commit-ack');
  assert.equal(recovered.result.status, 'CANDIDATE_SAVED');
  assert.equal(recovered.state.commitCalls, 1);
  assert.equal(recovered.state.committedWrites, 1);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});


test('full ordinary Review renews lease after model.result and before its first commit', async () => {
  const root = await fixture();
  const first = await child(root, 'before-commit', 'review-consumer');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  const store = await createCheckpointStore(resolve(root, 'review-consumer', 'RT-review-recovery'));
  assert.equal(await store.readOptional('model.result') !== null, true);
  await new Promise(resolveDelay => setTimeout(resolveDelay, 180));
  const completed = await runReviewConsumerFixture(root);
  assert.equal(completed.result.status, 'CANDIDATE_SAVED');
  assert.equal(completed.state.beginCalls, 2);
  assert.equal(completed.state.commitCalls, 1);
  assert.equal(completed.state.committedWrites, 1);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('ordinary Review still cancels a proven unprepared Host rejection after Codex completion', async () => {
  const { consumePendingReviewTurn } = await import('../skills/wiselink-research-and-synthesize/scripts/consume-hosted-review-turn.mjs');
  const root = await mkdtemp(resolve(tmpdir(), 'review-codex-rejected-'));
  const turn = 'RT-codex-rejected';
  const store = await createCheckpointStore(resolve(root, turn));
  await store.writeOnce('model.started', { argsHash: 'a'.repeat(64) });
  let cancelled = 0;
  const result = await consumePendingReviewTurn({ workItemId: 'WI-1', checkpointRoot: root }, {
    modelRuntime: { modelExecutor: 'CODEX' },
    callTool: async name => {
      if (name === 'get_pending_review_turn') return { busy: false,
        next: { reviewTurnRef: turn, reviewConversationRef: 'RC-1', requestId: 'REQ-1' } };
      if (name === 'begin_review_turn') return { status: 'RUNNING', attemptRef: 'AQ-1' };
      if (name === 'cancel_action_attempt') { cancelled++;
        return { status: 'CANCELLED', attemptRef: 'AQ-1' }; }
      throw new Error(`UNEXPECTED_${name}`);
    },
    runTurn: async (_options, dependencies) => {
      await dependencies.callTool('begin_review_turn', {});
      throw Object.assign(new Error('REVIEW_COMMIT_REJECTED_BEFORE_PREPARE'), {
        code: 'REVIEW_COMMIT_REJECTED_BEFORE_PREPARE',
        rejectedCommit: { workItemId: 'WI-1', reviewTurnRef: turn,
          attemptRef: 'AQ-1', hostErrorCode: 'REVIEW_CANDIDATE_INVALID' },
        readback: { attemptRef: 'AQ-1', taskType: 'OPENCLAW_INTERACTIVE_REVIEW',
          status: 'RUNNING', commitStartedAt: null, resultContentHash: null,
          projectionApplied: false, recoveryAvailable: false },
      });
    },
  });
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.errorCode, 'REVIEW_CANDIDATE_INVALID');
  assert.equal(cancelled, 1);
});

test('full ordinary Review preserves source read and second model round across lease recovery', async () => {
  const root = await fixture();
  await writeFile(resolve(root, 'runner', 'review-two-round'), 'yes');
  const first = await child(root, 'after-second-runner-receipt', 'review-consumer');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  await new Promise(resolveDelay => setTimeout(resolveDelay, 180));
  const completed = await runReviewConsumerFixture(root);
  assert.equal(completed.result.status, 'CANDIDATE_SAVED');
  assert.equal(completed.state.committedWrites, 1);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim().split('\n').length, 2);
  const links = await Promise.all([1, 2].map(round => assertCodexParentRunLink({
    checkpointRoot: resolve(root, 'review-consumer', 'RT-review-recovery'),
    step: `review-codex-round-${round}`, requestId: `review:AQ-review-recovery:round-${round}`,
    runRoot: resolve(root, 'runner'),
  })));
  assertDistinctCodexParentRunLinks(links);
});

test('Wiki summary resumes source read and second fixed Codex round without recounting process', async () => {
  const root = await fixture();
  await writeFile(resolve(root, 'runner', 'summary-two-round'), 'yes');
  const first = await child(root, 'after-second-model-receipt');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  const result = await runWikiFixture(root);
  assert.equal(result.content.headline, 'Selected ATA4 candidate');
  const store = await createCheckpointStore(resolve(root, 'checkpoint'));
  const receipt = await store.readOptional('summary-codex.receipt');
  assert.equal(receipt.runs.length, 2);
  assert.equal(receipt.closed, true);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim().split('\n').length, 2);
  const links = await Promise.all([0, 1].map(round => assertCodexParentRunLink({
    checkpointRoot: resolve(root, 'checkpoint'), step: `summary-codex.round-${round}`,
    requestId: `summary:DS-wiki-recovery:AQ-wiki-recovery:round-${round + 1}`,
    runRoot: resolve(root, 'runner'),
  })));
  assertDistinctCodexParentRunLinks(links);
});

test('ordinary Review refuses changed source body on fresh lease without a new model or commit', async () => {
  const root = await fixture();
  await writeFile(resolve(root, 'runner', 'review-two-round'), 'yes');
  assert.equal((await child(root, 'after-second-runner-receipt', 'review-consumer')).signal, 'SIGKILL');
  await new Promise(resolveDelay => setTimeout(resolveDelay, 180));
  await assert.rejects(runReviewConsumerFixture(root, 'changed-source'),
    /REVIEW_CODEX_READ_BINDING_MISMATCH/u);
  const host = await createCheckpointStore(resolve(root, 'review-host'));
  assert.equal((await host.readOptional('state')).committedWrites, 0);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim().split('\n').length, 2);
});

test('ordinary Review refuses a changed Host task and input hash on recovery', async () => {
  const root = await fixture();
  assert.equal((await child(root, 'after-runner-receipt', 'review-consumer')).signal, 'SIGKILL');
  await new Promise(resolveDelay => setTimeout(resolveDelay, 180));
  await assert.rejects(runReviewConsumerFixture(root, 'changed-task'),
    /REVIEW_CODEX_RECOVERY_FRESH_BEGIN_INVALID/u);
  const host = await createCheckpointStore(resolve(root, 'review-host'));
  assert.equal((await host.readOptional('state')).committedWrites, 0);
  assert.equal((await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('Review consumer durably links round one before launch and does not regenerate when UNKNOWN', async () => {
  const root = await fixture();
  const first = await child(root, 'before-codex-launch', 'review-consumer');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  const checkpointRoot = resolve(root, 'review-consumer', 'RT-review-recovery');
  await assertCodexParentRunLink({ checkpointRoot, step: 'review-codex-round-1',
    requestId: 'review:AQ-review-recovery:round-1', runRoot: resolve(root, 'runner') });
  await assert.rejects(readFile(resolve(root, 'runner', 'dispatch-count')), { code: 'ENOENT' });

  await new Promise(resolveDelay => setTimeout(resolveDelay, 180));
  await assert.rejects(runReviewConsumerFixture(root), /CODEX_GENERATION_OUTCOME_UNKNOWN/u);
  const state = await createCheckpointStore(resolve(root, 'review-host')).then(store => store.readOptional('state'));
  assert.equal(state.committedWrites, 0);
  await assert.rejects(readFile(resolve(root, 'runner', 'dispatch-count')), { code: 'ENOENT' });
});

test('Wiki SUMMARY consumer durably links its exact run before launch and does not regenerate on restart', async () => {
  const root = await fixture();
  const first = await child(root, 'before-codex-launch', 'consumer');
  assert.equal(first.signal, 'SIGKILL', first.stderr);
  const checkpointRoot = resolve(root, 'derived-summary', 'synthetic-host', 'DS-wiki-recovery', 'AQ-wiki-recovery');
  await assertCodexParentRunLink({ checkpointRoot, step: 'summary-codex.round-0',
    requestId: 'summary:DS-wiki-recovery:AQ-wiki-recovery:round-1', runRoot: resolve(root, 'runner') });
  await assert.rejects(readFile(resolve(root, 'runner', 'dispatch-count')), { code: 'ENOENT' });

  await assert.rejects(runSummaryConsumerFixture(root), /CODEX_GENERATION_OUTCOME_UNKNOWN/u);
  const state = await createCheckpointStore(resolve(root, 'host')).then(store => store.readOptional('state'));
  assert.equal(state?.committedWrites ?? 0, 0);
  assert.equal(state?.saveCalls ?? 0, 0);
  await assert.rejects(readFile(resolve(root, 'runner', 'dispatch-count')), { code: 'ENOENT' });
});
