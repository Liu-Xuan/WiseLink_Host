import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { assertCodexParentRunLink, assertDistinctCodexParentRunLinks } from './codex-parent-run-link-test-helper.mjs';

const worker = fileURLToPath(new URL('./wiki-matter-recovery-fixture.mjs', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'wiki-matter-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, 'runner'));
  const python = resolve(root, 'fake-runner.py');
  await writeFile(python, `import hashlib,json,os,pathlib,sys
r=json.load(sys.stdin); p=pathlib.Path(r['run_directory']); p.mkdir(exist_ok=True)
counter=p.parent/'dispatch-count'
number=len(counter.read_text().splitlines())+1 if counter.exists() else 1
with open(counter,'a') as f: f.write('1\\n'); f.flush(); os.fsync(f.fileno())
def save(name,value):
 q=p/(name+'.tmp'); q.write_text(json.dumps(value)); os.replace(q,p/name)
work={'schemaVersion':'wiselink.jobaid-problem-work.v3','headline':'Synthetic matter finding','listBrief':'Synthetic candidate','overview':'Synthetic candidate only.','roundCompletion':'COMPLETE_WITH_OPEN_QUESTIONS','completionReason':'Offline fixture.','changeSummary':'Synthetic save.','issues':[],'unchangedIssueKeys':[],'retiredIssues':[]}
step={'action':'SAVE_WORK','workJson':json.dumps(work)} if number==1 else {'action':'FINISH'}
candidate={'tool_name':'return_wiselink_assessment_step','arguments':{'step':step}}
summary={'codex_exit_code':0,'terminal_events':['turn.completed'],'transport_passed':True,'upstream_models':['glm-5.3'],'input_tokens':10,'output_tokens':5,'model_requests':1,'closure':'completed','process_group_closed':True,'upstream_response_present':True,'upstream_request_present':True,'structured_final_to_contract':True,'source_config_unchanged':True}
save('upstream-request.json',{'model':'glm-5.3','messages':[{'role':'user','content':'offline wiki fixture'}]})
summary['upstream_request_sha256']=hashlib.sha256((p/'upstream-request.json').read_bytes()).hexdigest()
save('upstream-response.json',{'format':'chat-completions-sse-events-v1','events':[{'model':'glm-5.3','choices':[{'index':0,'finish_reason':'stop'}]}]})
save('contract-candidate.json',candidate); save('transport-summary.json',summary)
save('generation-receipt.json',{'version':1,'binding_sha256':r['binding_sha256'],'run_directory':str(p),'transport':summary,'candidate':candidate,'upstream_request_sha256':summary['upstream_request_sha256'],'upstream_response_sha256':hashlib.sha256((p/'upstream-response.json').read_bytes()).hexdigest()})
print(json.dumps(summary))
`);
  const wrapper = resolve(root, 'python-wrapper');
  await writeFile(wrapper, `#!/bin/sh\nexec python3 '${python}'\n`);
  await chmod(wrapper, 0o700);
  return root;
}

async function run(root, mode = 'normal', kind = 'model') {
  await rm(resolve(root, 'fixture-outcome.json'), { force: true });
  const child = spawn(process.execPath, [worker, root, mode, kind], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  return new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', async (code, signal) => done({ code, signal, stdout, stderr,
      outcome: signal ? null : JSON.parse(await readFile(resolve(root, 'fixture-outcome.json'), 'utf8')) }));
  });
}
const dispatches = async root => (await readFile(resolve(root, 'runner', 'dispatch-count'), 'utf8')).trim().split('\n').length;

for (const mode of ['after-model-receipt', 'after-round-result', 'after-final-model-receipt',
  'after-final-round-result', 'after-save']) {
  test(`Wiki MATTER ${mode} resumes exact model rounds and one Host save`, async t => {
    const root = await fixture(t);
    const first = await run(root, mode);
    assert.equal(first.signal, 'SIGKILL', first.stderr);
    const resumed = await run(root);
    assert.equal(resumed.code, 0, JSON.stringify({ root, resumed }));
    const output = resumed.outcome;
    assert.equal(output.saved.workRevisionRef, output.result.output.workRevisionRef);
    assert.equal(await dispatches(root), 2);
    const checkpoint = await createCheckpointStore(resolve(root, 'checkpoint'));
    assert.equal((await checkpoint.readOptional('assessment-round-1.result')).value.status, 200);
    assert.equal((await checkpoint.readOptional('summary-codex.receipt')).runs.length, 2);
    assert.equal((await run(root)).code, 0);
    assert.equal(await dispatches(root), 2);
  });
}

test('Wiki MATTER refuses a changed task and a changed round binding before inference', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'after-model-receipt')).signal, 'SIGKILL');
  const taskDrift = await run(root, 'drift-task');
  assert.equal(taskDrift.code, 1);
  assert.match(taskDrift.outcome.errorCode, /JOBAID_CHECKPOINT_BINDING_MISMATCH/u);
  const checkpoint = await createCheckpointStore(resolve(root, 'checkpoint'));
  const round = await checkpoint.readOptional('summary-codex.round-0.started');
  await checkpoint.write('summary-codex.round-0.started', { ...round, bodySha256: '0'.repeat(64) });
  const drift = await run(root);
  assert.equal(drift.code, 1);
  assert.match(drift.outcome.errorCode, /DERIVED_SUMMARY_CODEX_ROUND_BINDING_MISMATCH/u);
  assert.equal(await dispatches(root), 1);
});

test('Wiki MATTER keeps legacy markerless started rounds UNKNOWN', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'after-model-receipt')).signal, 'SIGKILL');
  const checkpoint = await createCheckpointStore(resolve(root, 'checkpoint'));
  const started = await checkpoint.readOptional('assessment-round-1.started');
  delete started.codexRecoveryVersion;
  await checkpoint.write('assessment-round-1.started', started);
  const resumed = await run(root);
  assert.equal(resumed.code, 1);
  assert.match(resumed.outcome.errorCode, /REVIEW_ASSESSMENT-ROUND-1_OUTCOME_UNKNOWN/u);
  assert.equal(await dispatches(root), 1);
});

test('Wiki MATTER consumer reacquires a fresh Host lease before receipt-only recovery', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'after-model-receipt', 'consumer')).signal, 'SIGKILL');
  const resumed = await run(root, 'normal', 'consumer');
  assert.equal(resumed.code, 0, JSON.stringify(resumed));
  assert.equal(resumed.outcome.result.status, 'MATTER_WORK_SAVED');
  assert.equal(resumed.outcome.claimCount, 2);
  assert.deepEqual(resumed.outcome.lastLease, { token: 'lease-2', generation: 2 });
  assert.equal(resumed.outcome.saved.matterWorkRevisionId, 'matter-work-1');
  assert.equal(resumed.outcome.finished.status, 'SUCCEEDED');
  assert.equal(await dispatches(root), 2);
  const checkpointRoot = resolve(root, 'consumer-checkpoint', 'matter', 'MAT-fixture-1', 'AQ-matter-fixture-1');
  const links = await Promise.all([0, 1].map(round => assertCodexParentRunLink({
    checkpointRoot, step: `summary-codex.round-${round}`,
    requestId: `matter:MAT-fixture-1:AQ-matter-fixture-1:round-${round + 1}`,
    runRoot: resolve(root, 'runner'),
  })));
  assertDistinctCodexParentRunLinks(links);
});

test('Wiki MATTER consumer queries the original SAVE request after lost Host ACK', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'after-consumer-save', 'consumer')).signal, 'SIGKILL');
  const host = await createCheckpointStore(resolve(root, 'consumer-host'));
  const original = await host.readOptional('saved');
  const resumed = await run(root, 'normal', 'consumer');
  assert.equal(resumed.code, 0, JSON.stringify(resumed));
  assert.equal(resumed.outcome.claimCount, 2);
  assert.equal(resumed.outcome.saved.requestId, original.requestId);
  assert.equal(resumed.outcome.lastLease.token, 'lease-2');
  assert.equal(await dispatches(root), 2);
});

test('Wiki MATTER consumer checkpoints its exact prepared round before Codex launch and remains UNKNOWN on restart', async t => {
  const root = await fixture(t);
  const first = await run(root, 'before-codex-launch', 'consumer');
  assert.equal(first.signal, 'SIGKILL');
  const checkpointRoot = resolve(root, 'consumer-checkpoint', 'matter', 'MAT-fixture-1', 'AQ-matter-fixture-1');
  await assertCodexParentRunLink({ checkpointRoot, step: 'summary-codex.round-0',
    requestId: 'matter:MAT-fixture-1:AQ-matter-fixture-1:round-1', runRoot: resolve(root, 'runner') });
  await assert.rejects(readFile(resolve(root, 'runner', 'dispatch-count')), { code: 'ENOENT' });

  const resumed = await run(root, 'normal', 'consumer');
  assert.equal(resumed.code, 1, JSON.stringify(resumed));
  assert.equal(resumed.outcome.errorCode, 'CODEX_GENERATION_OUTCOME_UNKNOWN');
  assert.equal(await dispatches(root).catch(error => error?.code === 'ENOENT' ? 0 : Promise.reject(error)), 0);
  await assert.rejects(readFile(resolve(root, 'consumer-host', 'saved.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(resolve(root, 'runner', 'dispatch-count')), { code: 'ENOENT' });
});
