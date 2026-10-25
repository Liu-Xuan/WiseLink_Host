import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, readdir, unlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createCodexGateway, codexRecoveryRunDirectory } from './codex-generation.mjs';

// These cases exercise Linux /proc runner identity, not a portable fake liveness check.
const linuxTest = (name, callback) => test(name, { skip: process.platform !== 'linux'
  ? 'requires Linux /proc runner identity; not validated on this platform' : false }, callback);

const body = JSON.stringify({ model: 'openclaw/wiselink-engineering',
  messages: [{ role: 'user', content: 'Return a result' }],
  tools: [{ type: 'function', function: { name: 'return_result', parameters: {
    type: 'object', required: ['workJson'], additionalProperties: false,
    properties: { workJson: { type: 'string' } },
  } } }], tool_choice: 'auto', parallel_tool_calls: false, n: 1, stream: false });
const input = (requestId, recoverOnly = false) => ({ method: 'POST', body,
  headers: { authorization: 'Bearer secret-never-persist' },
  codexRecovery: { requestId, recoverOnly } });
const gatewayOptions = (root, wrapper) => ({ codexBinary: '/fake/codex', configPath: resolve(dirname(wrapper), 'config.json'),
  runRoot: root, pythonBinary: wrapper, timeoutSeconds: 25 });

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'generation-recovery-'));
  const configPath = resolve(root, 'config.json');
  await writeFile(configPath, JSON.stringify({ models: { providers: {
    miaoda: { models: [{ id: 'glm-5.3', maxTokens: 64000 }] },
  } } }));
  const fake = resolve(root, 'fake-runner.py');
  await writeFile(fake, `import hashlib,json,os,pathlib,sys,time
r=json.load(sys.stdin); p=pathlib.Path(r['run_directory']); p.mkdir(exist_ok=True)
with open(p.parent/'dispatch-count','a') as f: f.write('1\\n'); f.flush(); os.fsync(f.fileno())
stat=pathlib.Path('/proc/self/stat').read_text()
identity={'pid':int(stat.split(' ',1)[0]),'bootId':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'startTime':stat[stat.rfind(')')+2:].split()[19]}
identity['pidNs']=os.readlink('/proc/self/ns/pid')
def save(name,value):
 q=p/(name+'.tmp'); q.write_text(json.dumps(value)); os.replace(q,p/name)
save('runner-identity.json',identity)
request_id=json.loads((p/'generation-binding.json').read_text())['requestId']
if 'active' in request_id:
 os.kill(os.getppid(),9)
if 'active' in request_id or 'live' in request_id:
 deadline=time.monotonic()+20
 while not (p/'release-runner').exists() and time.monotonic()<deadline: time.sleep(.02)
candidate={'tool_name':'return_result','arguments':{'workJson':'{}'}}
summary={'transport_passed':True,'upstream_models':['glm-5.3'],'input_tokens':10,'output_tokens':5,'model_requests':1,'closure':'completed','process_group_closed':True,'upstream_response_present':True,'upstream_request_present':True}
save('upstream-request.json',{'model':'glm-5.3','messages':[{'role':'user','content':'offline'}]})
summary['upstream_request_sha256']=hashlib.sha256((p/'upstream-request.json').read_bytes()).hexdigest()
save('upstream-response.json',{'format':'chat-completions-sse-events-v1','events':[{'model':'glm-5.3','choices':[{'index':0,'finish_reason':'stop'}]}]})
save('contract-candidate.json',candidate); save('transport-summary.json',summary)
save('generation-receipt.json',{'version':1,'binding_sha256':r['binding_sha256'],'run_directory':str(p),'transport':summary,'candidate':candidate,'upstream_request_sha256':summary['upstream_request_sha256'],'upstream_response_sha256':hashlib.sha256((p/'upstream-response.json').read_bytes()).hexdigest()})
print(json.dumps(summary))
`);
  const wrapper = resolve(root, 'python-wrapper');
  await writeFile(wrapper, `#!/bin/sh\nexec python3 '${fake}'\n`);
  await chmod(wrapper, 0o700);
  const parent = resolve(root, 'parent.mjs');
  await writeFile(parent, `import { createCodexGateway } from ${JSON.stringify(new URL('./codex-generation.mjs', import.meta.url).href)};
const body=${JSON.stringify(body)};
const gateway=createCodexGateway({codexBinary:'/fake/codex',configPath:${JSON.stringify(configPath)},runRoot:${JSON.stringify(root)},pythonBinary:${JSON.stringify(wrapper)},timeoutSeconds:25,onRunCompleted:()=>{if(process.argv[3]==='exit')process.exit(91)}});
await gateway(null,{method:'POST',body,codexRecovery:{requestId:process.argv[2]}});
`);
  return { root, wrapper, parent };
}

function launch(parent, requestId, mode) {
  const child = spawn(process.execPath, [parent, requestId, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', value => { stderr += value; });
  return { child, done: new Promise(accept => child.once('exit', (code, signal) => accept({ code, signal, stderr }))) };
}

async function awaitRunner(root) {
  for (let index = 0; index < 250; index++) {
    const directory = (await readdir(root)).find(name => name.startsWith('generation-recovery-'));
    if (directory && (await readdir(resolve(root, directory))).includes('runner-identity.json'))
      return resolve(root, directory);
    await new Promise(accept => setTimeout(accept, 20));
  }
  throw Error('runner identity marker missing');
}

linuxTest('restart after runner receipt and before caller checkpoint returns exact stable response once', async () => {
  const { root, wrapper, parent } = await fixture();
  const first = launch(parent, 'program:after-receipt', 'exit');
  assert.equal((await first.done).code, 91);
  const gateway = createCodexGateway(gatewayOptions(root, wrapper));
  const recovered = await gateway(null, input('program:after-receipt', true));
  const repeated = await gateway(null, input('program:after-receipt', true));
  assert.equal(await recovered.text(), await repeated.text());
  assert.equal(recovered.codexReceipt.recovered, true);
  assert.equal((await readFile(resolve(root, 'dispatch-count'), 'utf8')).trim(), '1');
  for (const artifact of ['generation-binding.json', 'generation-receipt.json', 'adapted-response.json'])
    assert.equal((await readFile(resolve(recovered.codexReceipt.runDirectory, artifact), 'utf8')).includes('secret-never-persist'), false);
  assert.equal(JSON.parse(await recovered.text()).choices[0].message.tool_calls[0].function.name, 'return_result');
});

test('prelaunch parent checkpoint can name the private prompt directory without dispatch', async () => {
  const { root, wrapper } = await fixture();
  const requestId = 'program:prelaunch';
  const expected = await codexRecoveryRunDirectory(root, requestId);
  let prepared, checkpointLink;
  const gateway = createCodexGateway({ ...gatewayOptions(root, wrapper),
    onRunPrepared: value => { prepared = value; throw new Error('offline_parent_interrupted'); } });
  await assert.rejects(gateway(null, { ...input(requestId), codexRecovery: {
    requestId, onRunPrepared: value => { checkpointLink = value; },
  } }), /offline_parent_interrupted/u);
  assert.equal(prepared.runDirectory, expected);
  assert.equal(prepared.requestId, requestId);
  assert.equal(prepared.recovered, false);
  assert.equal(checkpointLink.runDirectory, expected);
  assert.match(checkpointLink.bindingSha256, /^[0-9a-f]{64}$/u);
  const prompt = await readFile(resolve(expected, 'codex-prompt.txt'), 'utf8');
  assert.match(prompt, /Return a result/u);
  assert.equal(prompt.includes('secret-never-persist'), false);
  assert.equal((await stat(expected)).mode & 0o077, 0);
  assert.equal((await stat(resolve(expected, 'codex-prompt.txt'))).mode & 0o077, 0);
  let recoveredLink;
  await assert.rejects(createCodexGateway(gatewayOptions(root, wrapper))(null,
    { ...input(requestId, true), codexRecovery: { requestId, recoverOnly: true,
      onRunPrepared: value => { recoveredLink = value; } } }), /CODEX_GENERATION_OUTCOME_UNKNOWN/u);
  assert.deepEqual(recoveredLink, checkpointLink);
  await assert.rejects(readFile(resolve(root, 'dispatch-count')), { code: 'ENOENT' });
});

test('failed parent checkpoint publication blocks runner launch', async () => {
  const { root, wrapper } = await fixture();
  const requestId = 'program:checkpoint-failure';
  const gateway = createCodexGateway(gatewayOptions(root, wrapper));
  await assert.rejects(gateway(null, { ...input(requestId), codexRecovery: {
    requestId, onRunPrepared: () => { throw new Error('offline_checkpoint_failed'); },
  } }), /offline_checkpoint_failed/u);
  const directory = await codexRecoveryRunDirectory(root, requestId);
  assert.match(await readFile(resolve(directory, 'codex-prompt.txt'), 'utf8'), /Return a result/u);
  await assert.rejects(readFile(resolve(root, 'dispatch-count')), { code: 'ENOENT' });
  await assert.rejects(gateway(null, input(requestId, true)), /CODEX_GENERATION_OUTCOME_UNKNOWN/u);
});

linuxTest('creates nested runRoot parent chain before making its exclusive recovery claim', async () => {
  const { root, wrapper } = await fixture();
  const nested = resolve(root, 'new', 'nested', 'run-root');
  const gateway = createCodexGateway(gatewayOptions(nested, wrapper));
  const first = await gateway(null, input('program:nested'));
  const recovered = await gateway(null, input('program:nested', true));
  assert.equal(await first.text(), await recovered.text());
  assert.equal((await readFile(resolve(nested, 'dispatch-count'), 'utf8')).trim(), '1');
});

linuxTest('an existing live runner is joined without a second dispatch', async () => {
  const { root, wrapper } = await fixture();
  const gateway = createCodexGateway(gatewayOptions(root, wrapper));
  const first = gateway(null, input('program:live'));
  const directory = await awaitRunner(root);
  const identity = JSON.parse(await readFile(resolve(directory, 'runner-identity.json'), 'utf8'));
  const actual = await readFile(`/proc/${identity.pid}/stat`, 'utf8');
  assert.equal(actual.slice(actual.lastIndexOf(')') + 2).split(' ')[19], identity.startTime);
  const joining = gateway(null, input('program:live', true));
  await writeFile(resolve(directory, 'release-runner'), 'go');
  const recovered = await joining;
  await first;
  assert.equal(recovered.codexReceipt.recovered, true);
  assert.equal((await readFile(resolve(root, 'dispatch-count'), 'utf8')).trim(), '1');
});

linuxTest('killed parent with a live runner resumes its completed receipt without redispatch', async () => {
  const { root, wrapper, parent } = await fixture();
  const first = launch(parent, 'program:active', 'normal');
  assert.equal((await first.done).signal, 'SIGKILL');
  const gateway = createCodexGateway(gatewayOptions(root, wrapper));
  const joining = gateway(null, input('program:active', true));
  await writeFile(resolve(await awaitRunner(root), 'release-runner'), 'go');
  const recovered = await joining;
  assert.equal(recovered.codexReceipt.recovered, true);
  assert.equal((await readFile(resolve(root, 'dispatch-count'), 'utf8')).trim(), '1');
});

linuxTest('aborting a recovery wait leaves the active runner available for a later retry', async () => {
  const { root, wrapper } = await fixture();
  const gateway = createCodexGateway(gatewayOptions(root, wrapper));
  const first = gateway(null, input('program:live'));
  const directory = await awaitRunner(root);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('caller deadline')), 100);
  await assert.rejects(gateway(null, { ...input('program:live', true), signal: controller.signal }), /caller deadline/u);
  await writeFile(resolve(directory, 'release-runner'), 'go');
  await first;
  const recovered = await gateway(null, input('program:live', true));
  assert.equal(recovered.codexReceipt.recovered, true);
  assert.equal((await readFile(resolve(root, 'dispatch-count'), 'utf8')).trim(), '1');
});

linuxTest('missing claim, dead runner and mismatched or malformed receipts never dispatch', async () => {
  const { root, wrapper, parent } = await fixture();
  const gateway = createCodexGateway(gatewayOptions(root, wrapper));
  await assert.rejects(gateway(null, input('program:missing', true)), /CODEX_GENERATION_OUTCOME_UNKNOWN/u);
  const first = launch(parent, 'program:broken', 'exit');
  assert.equal((await first.done).code, 91);
  const directory = (await readdir(root)).find(name => name.startsWith('generation-recovery-'));
  const path = resolve(root, directory);
  await writeFile(resolve(path, 'generation-receipt.json'), '{bad json');
  await assert.rejects(gateway(null, input('program:broken', true)), /SyntaxError/u);
  await writeFile(resolve(path, 'generation-receipt.json'), JSON.stringify({ version: 1, binding_sha256: 'wrong' }));
  await assert.rejects(gateway(null, input('program:broken', true)), /CODEX_GENERATION_RECEIPT_INVALID/u);
  await unlink(resolve(path, 'generation-receipt.json'));
  await assert.rejects(gateway(null, input('program:broken', true)), /CODEX_GENERATION_OUTCOME_UNKNOWN/u);
  const altered = JSON.parse(body); altered.messages[0].content = 'Different request';
  await assert.rejects(gateway(null, { ...input('program:broken', true), body: JSON.stringify(altered) }),
    /CODEX_GENERATION_RECOVERY_MISMATCH/u);
  assert.equal((await readFile(resolve(root, 'dispatch-count'), 'utf8')).trim(), '1');
});

linuxTest('a changed original upstream response fails the recovery receipt hash', async () => {
  const { root, wrapper, parent } = await fixture();
  assert.equal((await launch(parent, 'program:upstream-tamper', 'exit').done).code, 91);
  const directory = (await readdir(root)).find(name => name.startsWith('generation-recovery-'));
  await writeFile(resolve(root, directory, 'upstream-response.json'), '{"format":"chat-completions-sse-events-v1","events":[{}]}');
  await assert.rejects(createCodexGateway(gatewayOptions(root, wrapper))(null,
    input('program:upstream-tamper', true)), /CODEX_GENERATION_RECEIPT_INVALID/u);
});

linuxTest('a changed final upstream request fails the recovery receipt hash', async () => {
  const { root, wrapper, parent } = await fixture();
  assert.equal((await launch(parent, 'program:request-tamper', 'exit').done).code, 91);
  const directory = (await readdir(root)).find(name => name.startsWith('generation-recovery-'));
  await writeFile(resolve(root, directory, 'upstream-request.json'), '{"model":"changed"}');
  await assert.rejects(createCodexGateway(gatewayOptions(root, wrapper))(null,
    input('program:request-tamper', true)), /CODEX_GENERATION_RECEIPT_INVALID/u);
});

linuxTest('changed or exposed private prompt is rejected before parent linkage and never redispatched', async () => {
  const { root, wrapper, parent } = await fixture();
  const requestId = 'program:prompt-tamper';
  assert.equal((await launch(parent, requestId, 'exit').done).code, 91);
  const directory = await codexRecoveryRunDirectory(root, requestId);
  const promptPath = resolve(directory, 'codex-prompt.txt');
  const original = await readFile(promptPath);
  const gateway = createCodexGateway(gatewayOptions(root, wrapper));
  let links = 0;
  const attempt = () => gateway(null, { ...input(requestId, true), codexRecovery: {
    requestId, recoverOnly: true, onRunPrepared: () => { links++; },
  } });
  await writeFile(promptPath, 'changed prompt');
  await assert.rejects(attempt(), /CODEX_GENERATION_RECOVERY_MISMATCH/u);
  await writeFile(promptPath, original);
  await chmod(promptPath, 0o644);
  await assert.rejects(attempt(), /CODEX_GENERATION_RECOVERY_MISMATCH/u);
  assert.equal(links, 0);
  assert.equal((await readFile(resolve(root, 'dispatch-count'), 'utf8')).trim(), '1');
});

// Portable receipt validation exercises the actual gateway but publishes an
// explicitly synthetic, closed receipt without launching any runner. Linux
// process-liveness cases above remain separate and are skipped on other OSes.
async function publishedSyntheticReceipt(requestId, { failed = false } = {}) {
  const { root, wrapper } = await fixture();
  let prepared;
  const gateway = createCodexGateway({ ...gatewayOptions(root, wrapper),
    onRunPrepared: () => { throw new Error('SYNTHETIC_NO_SPAWN'); } });
  await assert.rejects(gateway(null, { ...input(requestId), codexRecovery: {
    requestId, onRunPrepared: value => { prepared = value; },
  } }), /SYNTHETIC_NO_SPAWN/u);
  const digest = value => createHash('sha256').update(value).digest('hex');
  const request = Buffer.from(JSON.stringify({ model: 'glm-5.3', messages: [{ role: 'user', content: 'synthetic' }] }));
  const response = Buffer.from(JSON.stringify({ format: 'chat-completions-sse-events-v1',
    events: [{ model: 'glm-5.3', choices: [{ index: 0, finish_reason: 'stop' }] }] }));
  const candidate = failed ? {} : { tool_name: 'return_result', arguments: { workJson: '{}' } };
  const transport = { transport_passed: !failed, upstream_models: ['glm-5.3'], input_tokens: 0,
    output_tokens: 0, model_requests: 1, closure: failed ? 'incomplete' : 'completed',
    process_group_closed: true, bridge_errors: failed ? ['upstream_timeout'] : [],
    upstream_response_present: !failed, upstream_request_present: true, upstream_request_sha256: digest(request) };
  for (const [name, bytes] of [['upstream-request.json', request],
    ...(!failed ? [['upstream-response.json', response], ['contract-candidate.json', JSON.stringify(candidate)]] : []),
    ['transport-summary.json', JSON.stringify(transport)],
    ['generation-receipt.json', JSON.stringify({ version: 1, binding_sha256: prepared.bindingSha256,
      run_directory: prepared.runDirectory, candidate, transport,
      upstream_request_sha256: digest(request), upstream_response_sha256: failed ? null : digest(response) })]])
    await writeFile(resolve(prepared.runDirectory, name), bytes, { mode: 0o600 });
  return { root, directory: prepared.runDirectory,
    recover: () => createCodexGateway(gatewayOptions(root, wrapper))(null, input(requestId, true)) };
}

test('portable exact receipt recovery validates request and response bytes with zero spawn', async () => {
  const f = await publishedSyntheticReceipt('portable:exact-receipt');
  assert.equal((await f.recover()).codexReceipt.recovered, true);
  await assert.rejects(readFile(resolve(f.root, 'dispatch-count')), { code: 'ENOENT' });
  for (const name of ['upstream-request.json', 'upstream-response.json']) {
    const path = resolve(f.directory, name), original = await readFile(path);
    await writeFile(path, 'changed exact bytes');
    await assert.rejects(f.recover(), /CODEX_GENERATION_RECEIPT_INVALID/u);
    await writeFile(path, original);
  }
  await unlink(resolve(f.directory, 'upstream-request.json'));
  await assert.rejects(f.recover(), /CODEX_GENERATION_RECEIPT_INVALID/u);
  await assert.rejects(readFile(resolve(f.root, 'dispatch-count')), { code: 'ENOENT' });
});

test('portable recovery rejects changed prompt or public prompt permissions with zero spawn', async () => {
  const f = await publishedSyntheticReceipt('portable:prompt');
  const path = resolve(f.directory, 'codex-prompt.txt'), original = await readFile(path);
  await writeFile(path, 'changed prompt');
  await assert.rejects(f.recover(), /CODEX_GENERATION_RECOVERY_MISMATCH/u);
  await writeFile(path, original);
  await chmod(path, 0o644);
  await assert.rejects(f.recover(), /CODEX_GENERATION_RECOVERY_MISMATCH/u);
  await assert.rejects(readFile(resolve(f.root, 'dispatch-count')), { code: 'ENOENT' });
});

test('a bound failed receipt without a final candidate stays incomplete with zero redispatch', async () => {
  const f = await publishedSyntheticReceipt('portable:upstream-timeout', { failed: true });
  const originals = new Map(await Promise.all(['generation-binding.json', 'generation-receipt.json',
    'transport-summary.json', 'codex-prompt.txt'].map(async name =>
    [name, await readFile(resolve(f.directory, name))])));
  await assert.rejects(f.recover(), /CODEX_GENERATION_INCOMPLETE/u);
  await assert.rejects(f.recover(), /CODEX_GENERATION_INCOMPLETE/u);
  for (const [name, original] of originals)
    assert.deepEqual(await readFile(resolve(f.directory, name)), original);
  assert.equal(JSON.parse(originals.get('transport-summary.json')).model_requests, 1);
  for (const name of ['contract-candidate.json', 'upstream-response.json', 'adapted-response.json'])
    await assert.rejects(readFile(resolve(f.directory, name)), { code: 'ENOENT' });
  await assert.rejects(readFile(resolve(f.root, 'dispatch-count')), { code: 'ENOENT' });
});

test('failed receipt binding and durable transport remain mandatory; success still needs a candidate', async () => {
  const f = await publishedSyntheticReceipt('portable:invalid-failure', { failed: true });
  const receiptPath = resolve(f.directory, 'generation-receipt.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  await writeFile(receiptPath, JSON.stringify({ ...receipt, binding_sha256: 'wrong' }));
  await assert.rejects(f.recover(), /CODEX_GENERATION_RECEIPT_INVALID/u);
  await writeFile(receiptPath, JSON.stringify(receipt));
  await writeFile(resolve(f.directory, 'transport-summary.json'), JSON.stringify({ ...receipt.transport, model_requests: 0 }));
  await assert.rejects(f.recover(), /CODEX_GENERATION_RECEIPT_INVALID/u);
  await assert.rejects(readFile(resolve(f.root, 'dispatch-count')), { code: 'ENOENT' });
  const success = await publishedSyntheticReceipt('portable:missing-success-candidate');
  await unlink(resolve(success.directory, 'contract-candidate.json'));
  await assert.rejects(success.recover(), /CODEX_GENERATION_RECEIPT_INVALID/u);
  await assert.rejects(readFile(resolve(success.root, 'dispatch-count')), { code: 'ENOENT' });
});

test('an earlier caller abort stops one local runner and its failed receipt never redispatches', async () => {
  const { root, wrapper } = await fixture();
  await writeFile(resolve(root, 'fake-runner.py'), `import json,pathlib,signal,sys,time
r=json.load(sys.stdin); p=pathlib.Path(r['run_directory'])
with open(p.parent/'dispatch-count','a') as f: f.write('1\\n')
def save(name,value):
 q=p/(name+'.tmp'); q.write_text(json.dumps(value)); q.replace(p/name)
def interrupted(*args):
 transport={'transport_passed':False,'model_requests':0,'closure':'incomplete','process_group_closed':True,'failure':'generation_interrupted'}
 save('transport-summary.json',transport)
 save('generation-receipt.json',{'version':1,'binding_sha256':r['binding_sha256'],'run_directory':str(p),'transport':transport,'candidate':{}})
 sys.exit(1)
signal.signal(signal.SIGTERM,interrupted)
(p/'started.marker').write_text('offline local runner')
while True: time.sleep(.01)
`);
  const requestId = 'portable:caller-abort';
  const directory = await codexRecoveryRunDirectory(root, requestId);
  const gateway = createCodexGateway(gatewayOptions(root, wrapper));
  const controller = new AbortController();
  const reason = new Error('CALLER_CANCELLED_EARLIER');
  const rejected = assert.rejects(gateway(null, { ...input(requestId), signal: controller.signal }),
    error => error === reason);
  let started = false;
  for (let index = 0; index < 250; index++) {
    try { await readFile(resolve(directory, 'started.marker')); started = true; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await new Promise(accept => setTimeout(accept, 20));
  }
  controller.abort(reason);
  await rejected;
  assert.equal(started, true);
  await assert.rejects(gateway(null, input(requestId, true)), /CODEX_GENERATION_INCOMPLETE/u);
  assert.equal((await readFile(resolve(root, 'dispatch-count'), 'utf8')).trim(), '1');
  await assert.rejects(readFile(resolve(directory, 'adapted-response.json')), { code: 'ENOENT' });
});
