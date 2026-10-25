import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createCodexGateway } from './codex-generation.mjs';

const body = JSON.stringify({ model: 'openclaw/wiselink-engineering',
  messages: [{ role: 'user', content: 'Return a result' }],
  tools: [{ type: 'function', function: { name: 'return_result', parameters: {
    type: 'object', required: ['workJson'], additionalProperties: false,
    properties: { workJson: { type: 'string' } },
  } } }], tool_choice: 'auto', parallel_tool_calls: false, n: 1, stream: false });
const input = (requestId, recoverOnly = false) => ({ method: 'POST', body,
  headers: { authorization: 'Bearer secret-never-persist' },
  codexRecovery: { requestId, recoverOnly } });
const gatewayOptions = (root, wrapper) => ({ codexBinary: '/fake/codex', configPath: '/fake/config',
  runRoot: root, pythonBinary: wrapper, timeoutSeconds: 25 });

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'generation-recovery-'));
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
summary={'transport_passed':True,'upstream_models':['glm-5.3'],'input_tokens':10,'output_tokens':5,'model_requests':1,'closure':'completed','process_group_closed':True,'upstream_response_present':True}
save('upstream-response.json',{'format':'chat-completions-sse-events-v1','events':[{'model':'glm-5.3','choices':[{'index':0,'finish_reason':'stop'}]}]})
save('contract-candidate.json',candidate); save('transport-summary.json',summary)
save('generation-receipt.json',{'version':1,'binding_sha256':r['binding_sha256'],'run_directory':str(p),'transport':summary,'candidate':candidate,'upstream_response_sha256':hashlib.sha256((p/'upstream-response.json').read_bytes()).hexdigest()})
print(json.dumps(summary))
`);
  const wrapper = resolve(root, 'python-wrapper');
  await writeFile(wrapper, `#!/bin/sh\nexec python3 '${fake}'\n`);
  await chmod(wrapper, 0o700);
  const parent = resolve(root, 'parent.mjs');
  await writeFile(parent, `import { createCodexGateway } from ${JSON.stringify(new URL('./codex-generation.mjs', import.meta.url).href)};
const body=${JSON.stringify(body)};
const gateway=createCodexGateway({codexBinary:'/fake/codex',configPath:'/fake/config',runRoot:${JSON.stringify(root)},pythonBinary:${JSON.stringify(wrapper)},timeoutSeconds:25,onRunCompleted:()=>{if(process.argv[3]==='exit')process.exit(91)}});
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

test('restart after runner receipt and before caller checkpoint returns exact stable response once', async () => {
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

test('creates nested runRoot parent chain before making its exclusive recovery claim', async () => {
  const { root, wrapper } = await fixture();
  const nested = resolve(root, 'new', 'nested', 'run-root');
  const gateway = createCodexGateway(gatewayOptions(nested, wrapper));
  const first = await gateway(null, input('program:nested'));
  const recovered = await gateway(null, input('program:nested', true));
  assert.equal(await first.text(), await recovered.text());
  assert.equal((await readFile(resolve(nested, 'dispatch-count'), 'utf8')).trim(), '1');
});

test('an existing live runner is joined without a second dispatch', async () => {
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

test('killed parent with a live runner resumes its completed receipt without redispatch', async () => {
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

test('aborting a recovery wait leaves the active runner available for a later retry', async () => {
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

test('missing claim, dead runner and mismatched or malformed receipts never dispatch', async () => {
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

test('a changed original upstream response fails the recovery receipt hash', async () => {
  const { root, wrapper, parent } = await fixture();
  assert.equal((await launch(parent, 'program:upstream-tamper', 'exit').done).code, 91);
  const directory = (await readdir(root)).find(name => name.startsWith('generation-recovery-'));
  await writeFile(resolve(root, directory, 'upstream-response.json'), '{"format":"chat-completions-sse-events-v1","events":[{}]}');
  await assert.rejects(createCodexGateway(gatewayOptions(root, wrapper))(null,
    input('program:upstream-tamper', true)), /CODEX_GENERATION_RECEIPT_INVALID/u);
});
