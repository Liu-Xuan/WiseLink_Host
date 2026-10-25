import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCodexParentRunLink, assertDistinctCodexParentRunLinks } from './codex-parent-run-link-test-helper.mjs';

const worker = fileURLToPath(new URL('./translation-reading-recovery-fixture.mjs', import.meta.url));
const documentWorker = fileURLToPath(new URL('./translation-reading-document-fixture.mjs', import.meta.url));
const workItemWorker = fileURLToPath(new URL('./translation-reading-workitem-fixture.mjs', import.meta.url));
async function fixture(t, kind = 'reading') {
  const root = await mkdtemp(resolve(tmpdir(), 'translation-reading-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fake = resolve(root, 'fake-runner.py');
  await writeFile(fake, `import hashlib,json,os,pathlib,sys
r=json.load(sys.stdin); p=pathlib.Path(r['run_directory']); p.mkdir(exist_ok=True)
with open(p.parent/'dispatch-count','a') as f: f.write('1\\n'); f.flush(); os.fsync(f.fileno())
def save(name,value):
 q=p/(name+'.tmp'); q.write_text(json.dumps(value)); os.replace(q,p/name)
a={'anchorId':'fixture-anchor'}
s={'text':'一般无需批准，但安装属于例外。','quotes':[a]}
candidate={'tool_name':'return_wiselink_document_reading','arguments':{'schemaVersion':'wiselink.document.reading.v1','headline':'安装批准条件','brief':s,'explanation':[s],'criticalConditions':[s],'limitations':[]}}
if ${JSON.stringify(kind)} == 'translation':
 candidate={'tool_name':'return_wiselink_translation_block','arguments':{'candidate':{'markdown':'<!-- WL-SECTION:1 -->\\n打开防护罩前断开电源。'}}}
summary={'transport_passed':True,'upstream_models':['glm-5.3'],'input_tokens':10,'output_tokens':5,'model_requests':1,'closure':'completed','process_group_closed':True,'upstream_response_present':True,'upstream_request_present':True}
save('upstream-request.json',{'model':'glm-5.3','messages':[{'role':'user','content':'offline reading fixture'}]})
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
async function run(root, mode = 'normal', workerFile = worker) {
  await rm(resolve(root, 'host', 'fixture-outcome.json'), { force: true });
  const child = spawn(process.execPath, [workerFile, root, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stdout.resume(); child.stderr.on('data', chunk => { stderr += chunk; });
  return await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', async (code, signal) => {
      let outcome = null;
      try { outcome = JSON.parse(await readFile(resolve(root, 'host', 'fixture-outcome.json'), 'utf8')); }
      catch (error) { if (!signal) return reject(error); }
      accept({ code, signal, outcome, stderr });
    });
  });
}
const json = async (root, ...parts) => JSON.parse(await readFile(resolve(root, ...parts), 'utf8'));

for (const mode of ['after-gateway-receipt', 'after-model-result', 'after-host-save']) {
  test(`reading recovers ${mode} without another model or business save`, async t => {
    const root = await fixture(t);
    assert.equal((await run(root, mode)).signal, 'SIGKILL');
    const recovered = await run(root);
    assert.equal(recovered.code, 0, JSON.stringify(recovered));
    assert.equal(recovered.outcome.status, 'READING_SAVED');
    const state = await json(root, 'host', 'state.json');
    assert.equal(state.saves, 1);
    assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
    const repeated = await run(root);
    assert.equal(repeated.outcome.status, 'READING_SAVED');
    assert.equal((await json(root, 'host', 'state.json')).saves, 1);
  });
}

test('reading with an uncertain unsent SAVE queries Host and remains pending without a duplicate', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'before-save')).signal, 'SIGKILL');
  const resumed = await run(root);
  assert.equal(resumed.outcome.status, 'PENDING_SAVE_CONFIRMATION');
  const state = await json(root, 'host', 'state.json');
  assert.ok(state.reads >= 2);
  assert.equal(state.saves, 0);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('reading refuses a changed version binding before any new model or save', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'after-gateway-receipt')).signal, 'SIGKILL');
  const state = await json(root, 'checkpoint', 'model.started.json');
  state.identity.semanticRevision = 2;
  await writeFile(resolve(root, 'checkpoint', 'model.started.json'), JSON.stringify(state));
  const result = await run(root);
  assert.equal(result.outcome.errorCode, 'READING_CHECKPOINT_BINDING_MISMATCH');
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
  assert.equal((await json(root, 'host', 'state.json')).saves, 0);
});

test('reading started without a completion receipt stays UNKNOWN after restart', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'after-model-started')).signal, 'SIGKILL');
  const resumed = await run(root);
  assert.equal(resumed.outcome.status, 'PENDING_MODEL_CONFIRMATION');
  assert.equal((await json(root, 'host', 'state.json')).saves, 0);
  await assert.rejects(readFile(resolve(root, 'codex-runs', 'dispatch-count')));
});

for (const mode of ['after-gateway-receipt', 'after-model-result', 'after-host-save']) {
  test(`document translation synthetic-authorized-same-fence recovers ${mode} locally`, async t => {
    const root = await fixture(t, 'translation');
    assert.equal((await run(root, mode, documentWorker)).signal, 'SIGKILL');
    const resumed = await run(root, 'synthetic-authorized-same-fence', documentWorker);
    assert.equal(resumed.code, 0, JSON.stringify(resumed));
    assert.equal(resumed.outcome.status, 'SUCCEEDED', JSON.stringify({ resumed, state: await json(root, 'host', 'state.json'),
      modelError: await json(root, 'host', 'model-error.json').catch(() => null) }));
    const state = await json(root, 'host', 'state.json');
    assert.equal(state.saves, 1);
    assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
  });
}

test('document translation with uncertain unsent write reads Host and keeps exact generation pending', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'before-host-save', documentWorker)).signal, 'SIGKILL');
  const resumed = await run(root, 'synthetic-authorized-same-fence', documentWorker);
  assert.equal(resumed.outcome.errorCode, 'DOCUMENT_TRANSLATION_SAVE_CONFIRMATION_PENDING');
  const state = await json(root, 'host', 'state.json');
  assert.ok(state.reads >= 2);
  assert.equal(state.saves, 0);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('document translation synthetic-authorized-same-fence without receipt stays UNKNOWN', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'after-model-started', documentWorker)).signal, 'SIGKILL');
  const resumed = await run(root, 'synthetic-authorized-same-fence', documentWorker);
  assert.equal(resumed.outcome.errorCode, 'CODEX_GENERATION_OUTCOME_UNKNOWN', JSON.stringify(resumed));
  const state = await json(root, 'host', 'state.json');
  assert.equal(state.saves, 0);
  assert.equal(state.failure, undefined);
  await assert.rejects(readFile(resolve(root, 'codex-runs', 'dispatch-count')));
});

test('document translation synthetic-authorized-same-fence rejects a different generation binding', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'after-gateway-receipt', documentWorker)).signal, 'SIGKILL');
  const files = await readdir(resolve(root, 'checkpoint'));
  const name = files.find(file => /^codex-translation-.*\.started\.json$/u.test(file));
  assert.ok(name);
  const path = resolve(root, 'checkpoint', name);
  const started = JSON.parse(await readFile(path, 'utf8'));
  started.generationRequestRef = 'another-generation';
  await writeFile(path, JSON.stringify(started));
  const resumed = await run(root, 'synthetic-authorized-same-fence', documentWorker);
  assert.equal(resumed.outcome.errorCode, 'DOCUMENT_TRANSLATION_CODEX_BINDING_CHANGED');
  assert.equal((await json(root, 'host', 'state.json')).saves, 0);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('document translation renewed lease cannot rebind the registered generation', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'after-gateway-receipt', documentWorker)).signal, 'SIGKILL');
  const resumed = await run(root, 'synthetic-force-new-lease', documentWorker);
  assert.equal(resumed.outcome.errorCode, 'DOCUMENT_TRANSLATION_ORIGINAL_GENERATION_LEASE_CHANGED', JSON.stringify(resumed));
  const state = await json(root, 'host', 'state.json');
  assert.equal(state.nextRequestId, 'document:fixture-attempt:batch-0');
  assert.equal(state.saves, 0);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('document translation default Host CLAIM blocks registered generation after a new process', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'after-gateway-receipt', documentWorker)).signal, 'SIGKILL');
  const resumed = await run(root, 'normal', documentWorker);
  assert.equal(resumed.outcome.status, 'REQUIRES_ATTENTION');
  assert.equal(resumed.outcome.errorCode, 'DOCUMENT_TRANSLATION_GENERATION_OUTCOME_UNKNOWN');
  const state = await json(root, 'host', 'state.json');
  assert.equal(state.saves, 0);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('document translation Codex receipt survives reordered equivalent Host JSON', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'after-gateway-receipt', documentWorker)).signal, 'SIGKILL');
  const resumed = await run(root, 'synthetic-reordered-same-fence', documentWorker);
  assert.equal(resumed.outcome.status, 'SUCCEEDED', JSON.stringify(resumed));
  assert.equal((await json(root, 'host', 'state.json')).saves, 1);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('WorkItem translation reclaims the same Host lease and recovers one model receipt', async t => {
  const root = await fixture(t, 'translation');
  const first = await run(root, 'after-gateway-receipt', workItemWorker);
  assert.equal(first.signal, 'SIGKILL', JSON.stringify(first));
  const resumed = await run(root, 'lose-save-ack', workItemWorker);
  const state = await json(root, 'host', 'state.json');
  assert.equal(resumed.outcome.status, 'INITIAL_STAGE_SAVED', JSON.stringify({ resumed, state }));
  assert.equal(state.beginCalls, 2);
  assert.equal(state.saves, 1);
  assert.equal(state.commits, 1);
  assert.ok(state.reads >= 1);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('WorkItem translation renewed Host lease refuses old generation before inference or save', async t => {
  const root = await fixture(t, 'translation');
  const first = await run(root, 'after-gateway-receipt', workItemWorker);
  assert.equal(first.signal, 'SIGKILL', JSON.stringify(first));
  const resumed = await run(root, 'new-lease', workItemWorker);
  const state = await json(root, 'host', 'state.json');
  assert.equal(resumed.outcome.errorCode, 'TRANSLATION_RECOVERY_LEASE_CHANGED', JSON.stringify(resumed));
  assert.equal(state.beginCalls, 2);
  assert.equal(state.saves, 0);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('WorkItem translation lost SAVE ACK after process exit queries the original generation', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'after-host-save', workItemWorker)).signal, 'SIGKILL');
  const resumed = await run(root, 'normal', workItemWorker);
  const state = await json(root, 'host', 'state.json');
  assert.equal(state.beginCalls, 2);
  assert.equal(state.saves, 1);
  assert.deepEqual(state.phases.slice(-3), ['NEXT', 'NEXT', 'ASSEMBLE']);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
  assert.equal(resumed.outcome.status, 'INITIAL_STAGE_SAVED', JSON.stringify(resumed));
  assert.equal(state.commits, 1);
  assert.notEqual(state.committedProvenance.modelVersion, 'host-assembly/no-model-call');
  assert.ok(state.committedProvenance.runMetrics.inputUnits > 0);
});

test('WorkItem translation uncertain unsent SAVE remains pending on original registered generation', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'before-host-save', workItemWorker)).signal, 'SIGKILL');
  const resumed = await run(root, 'normal', workItemWorker);
  const state = await json(root, 'host', 'state.json');
  assert.equal(resumed.outcome.errorCode, 'TRANSLATION_SAVE_CONFIRMATION_PENDING');
  assert.equal(state.saves, 0);
  assert.equal(state.commits, undefined);
  assert.ok(state.phases.filter(phase => phase === 'NEXT').length >= 3);
  assert.ok(state.reads >= 1);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('WorkItem translation resumes its second batch without replaying the first', async t => {
  const root = await fixture(t, 'translation');
  const first = await run(root, 'second-receipt', workItemWorker);
  assert.equal(first.signal, 'SIGKILL', JSON.stringify(first));
  const before = await json(root, 'host', 'state.json');
  assert.equal(before.saves, 1);
  const resumed = await run(root, 'normal', workItemWorker);
  const after = await json(root, 'host', 'state.json');
  assert.equal(after.saves, 2, JSON.stringify({ resumed, after }));
  assert.equal(after.savedSecond, true);
  assert.equal(after.commits, 1);
  assert.equal(resumed.outcome.status, 'INITIAL_STAGE_SAVED', JSON.stringify(resumed));
  assert.notEqual(after.committedProvenance.modelVersion, 'host-assembly/no-model-call');
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim().split('\n').length, 2);
  const checkpointRoot = resolve(root, 'checkpoint', 'WI-fixture-translation', 'initial', 'TRANSLATE',
    'requests', 'fixture_translation_request');
  const links = await Promise.all((await readdir(checkpointRoot)).filter(name => name.endsWith('.codex-run.json'))
    .map(async name => {
      const step = name.slice(0, -'.codex-run.json'.length);
      return assertCodexParentRunLink({ checkpointRoot, step, requestId: step,
        runRoot: resolve(root, 'codex-runs') });
    }));
  assertDistinctCodexParentRunLinks(links);
});

test('WorkItem commit-started crash reuses the exact sealed Result after Host RUNNING readback', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'before-host-commit', workItemWorker)).signal, 'SIGKILL');
  const sealed = await json(root, 'checkpoint', 'WI-fixture-translation', 'initial', 'TRANSLATE',
    'requests', 'fixture_translation_request', 'codex-translation-sealed-result.json');
  const resumed = await run(root, 'normal', workItemWorker);
  const state = await json(root, 'host', 'state.json');
  assert.equal(resumed.outcome.status, 'INITIAL_STAGE_SAVED', JSON.stringify(resumed));
  assert.equal(state.commits, 1);
  assert.equal(state.saves, 1);
  assert.ok(state.attemptReads >= 1);
  assert.equal(state.committedHash, sealed.result.contentHash);
  assert.equal(state.committedProvenance.modelVersion, sealed.result.modelVersion);
  assert.deepEqual(state.committedProvenance.runMetrics, sealed.result.runMetrics);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

test('WorkItem lost commit ACK confirms original sealed Result without a second commit', async t => {
  const root = await fixture(t, 'translation');
  const result = await run(root, 'lose-commit-ack', workItemWorker);
  const state = await json(root, 'host', 'state.json');
  const sealed = await json(root, 'checkpoint', 'WI-fixture-translation', 'initial', 'TRANSLATE',
    'requests', 'fixture_translation_request', 'codex-translation-sealed-result.json');
  assert.equal(result.outcome.status, 'INITIAL_STAGE_SAVED', JSON.stringify(result));
  assert.equal(state.commits, 1);
  assert.equal(state.saves, 1);
  assert.ok(state.attemptReads >= 1);
  assert.equal(state.committedHash, sealed.result.contentHash);
  assert.equal(state.committedProvenance.modelVersion, sealed.result.modelVersion);
  assert.deepEqual(state.committedProvenance.runMetrics, sealed.result.runMetrics);
  assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
});

for (const mode of ['unsafe-commit-started', 'unsafe-commit-projected',
  'unsafe-commit-recoverable', 'unsafe-commit-missing']) {
  test(`WorkItem refuses exact commit replay without complete unprepared proof: ${mode}`, async t => {
    const root = await fixture(t, 'translation');
    assert.equal((await run(root, 'before-host-commit', workItemWorker)).signal, 'SIGKILL');
    const resumed = await run(root, mode, workItemWorker);
    const state = await json(root, 'host', 'state.json');
    assert.equal(resumed.code, 1, JSON.stringify(resumed));
    assert.match(resumed.outcome.errorCode, /^HOST_MCP_COMMIT_(?:OUTCOME_UNKNOWN|READBACK_FAILED)/u);
    assert.equal(state.commits, undefined);
    assert.equal(state.saves, 1);
    assert.ok(state.attemptReads >= 1);
    assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
  });
}

for (const mode of ['lose-save-ack-failed', 'lose-save-ack-superseded']) {
  test(`WorkItem SAVE ACK readback refuses ${mode} as success`, async t => {
    const root = await fixture(t, 'translation');
    const result = await run(root, mode, workItemWorker);
    const state = await json(root, 'host', 'state.json');
    assert.equal(result.outcome.errorCode, 'TRANSLATION_SAVE_CONFIRMATION_PENDING', JSON.stringify(result));
    assert.equal(state.saves, 0);
    assert.equal(state.commits, undefined);
    assert.ok(state.reads >= 1);
    assert.equal((await readFile(resolve(root, 'codex-runs', 'dispatch-count'), 'utf8')).trim(), '1');
  });
}

test('reading parent checkpoint links its exact prepared private run before launch and stays UNKNOWN on restart', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'before-codex-launch')).signal, 'SIGKILL');
  const started = await json(root, 'checkpoint', 'model.started.json');
  const link = await assertCodexParentRunLink({ checkpointRoot: resolve(root, 'checkpoint'),
    step: 'model', requestId: started.value.codexRequestId, runRoot: resolve(root, 'codex-runs') });
  assert.equal(link.requestId, started.value.codexRequestId);
  await assert.rejects(readFile(resolve(root, 'codex-runs', 'dispatch-count')), { code: 'ENOENT' });

  const resumed = await run(root);
  assert.equal(resumed.outcome.status, 'PENDING_MODEL_CONFIRMATION');
  assert.equal((await json(root, 'host', 'state.json')).saves, 0);
  await assert.rejects(readFile(resolve(root, 'codex-runs', 'dispatch-count')), { code: 'ENOENT' });
});

test('WorkItem translation parent link stays scoped to its exact generation request before launch', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'before-codex-launch', workItemWorker)).signal, 'SIGKILL');
  const checkpointRoot = resolve(root, 'checkpoint', 'WI-fixture-translation', 'initial', 'TRANSLATE',
    'requests', 'fixture_translation_request');
  const files = (await readdir(checkpointRoot)).filter(name => name.endsWith('.codex-run.json'));
  assert.equal(files.length, 1);
  const step = files[0].slice(0, -'.codex-run.json'.length);
  const link = await assertCodexParentRunLink({ checkpointRoot, step, requestId: step,
    runRoot: resolve(root, 'codex-runs') });
  assert.match(link.requestId, /^codex-translation-[0-9a-f]{64}$/u);
  await assert.rejects(readFile(resolve(root, 'codex-runs', 'dispatch-count')), { code: 'ENOENT' });

  const resumed = await run(root, 'normal', workItemWorker);
  assert.equal(resumed.outcome.status, 'REQUIRES_ATTENTION', JSON.stringify(resumed));
  assert.equal(resumed.outcome.attemptStatus, 'UNKNOWN');
  const state = await json(root, 'host', 'state.json');
  assert.equal(state.modelCalls, 0);
  assert.equal(state.saves, 0);
  await assert.rejects(readFile(resolve(root, 'codex-runs', 'dispatch-count')), { code: 'ENOENT' });
});

test('document translation parent link survives prelaunch interruption under its synthetic same fence', async t => {
  const root = await fixture(t, 'translation');
  assert.equal((await run(root, 'before-codex-launch', documentWorker)).signal, 'SIGKILL');
  const checkpointRoot = resolve(root, 'checkpoint');
  const files = (await readdir(checkpointRoot)).filter(name => name.endsWith('.codex-run.json'));
  assert.equal(files.length, 1);
  const step = files[0].slice(0, -'.codex-run.json'.length);
  assert.match(step, /^codex-translation-[0-9a-f]{64}$/u);
  const link = await assertCodexParentRunLink({ checkpointRoot, step,
    requestId: step.replace(/^codex-/u, ''), runRoot: resolve(root, 'codex-runs') });
  assert.match(link.requestId, /^translation-[0-9a-f]{64}$/u);
  await assert.rejects(readFile(resolve(root, 'codex-runs', 'dispatch-count')), { code: 'ENOENT' });

  const resumed = await run(root, 'synthetic-authorized-same-fence', documentWorker);
  assert.equal(resumed.outcome.errorCode, 'CODEX_GENERATION_OUTCOME_UNKNOWN', JSON.stringify(resumed));
  assert.equal((await json(root, 'host', 'state.json')).saves, 0);
  await assert.rejects(readFile(resolve(root, 'codex-runs', 'dispatch-count')), { code: 'ENOENT' });
});
