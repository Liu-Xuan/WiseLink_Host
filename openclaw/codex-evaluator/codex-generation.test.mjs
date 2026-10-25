import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCodexGateway } from './codex-generation.mjs';

function request(extra = {}) {
  return { method: 'POST', headers: { authorization: 'Bearer secret-never-forward', ...extra },
    body: JSON.stringify({ model: 'openclaw/wiselink-engineering',
      messages: [{ role: 'system', content: 'One work' }, { role: 'user', content: 'Materials' }],
      tools: [{ type: 'function', function: { name: 'return_result', parameters: {
        type: 'object', required: ['workJson'], additionalProperties: false,
        properties: { workJson: { type: 'string', minLength: 2 } },
      } } }], tool_choice: 'auto', parallel_tool_calls: false, n: 1, stream: false }) };
}

test('gateway converts one structured final candidate and never forwards headers', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'codex-generation-test-'));
  const fake = resolve(root, 'fake-runner.py');
  await writeFile(fake, `import json, pathlib, sys\nr=json.load(sys.stdin)\np=pathlib.Path(r['run_directory'])\np.mkdir(mode=0o700)\n(p/'request.json').write_text(json.dumps(r))\n(p/'contract-candidate.json').write_text(json.dumps({'tool_name':'return_result','arguments':{'workJson':'{}'}}))\nprint(json.dumps({'transport_passed':True,'upstream_models':['glm-5.3'],'input_tokens':10,'output_tokens':5,'model_requests':1,'closure':'completed'}))\n`);
  let completed;
  const gateway = createCodexGateway({ codexBinary: '/fake/codex', configPath: '/fake/config', runRoot: root,
    pythonBinary: 'python3', onRunCompleted: value => { completed = value; } });
  // The wrapper substitutes the script argument, so no upstream is invoked.
  const wrapper = resolve(root, 'python-wrapper');
  await writeFile(wrapper, `#!/bin/sh\nexec python3 '${fake}'\n`, { mode: 0o700 });
  const tested = createCodexGateway({ codexBinary: '/fake/codex', configPath: '/fake/config', runRoot: root,
    pythonBinary: wrapper, onRunCompleted: value => { completed = value; } });
  const response = await tested(null, request());
  assert.equal(response.status, 200);
  const payload = JSON.parse(await response.text());
  assert.equal(payload.model, 'glm-5.3');
  assert.equal(payload.conversion, 'codex-structured-final-to-function-contract-v1');
  assert.equal(payload.choices[0].message.tool_calls[0].function.name, 'return_result');
  assert.deepEqual(JSON.parse(payload.choices[0].message.tool_calls[0].function.arguments), { workJson: '{}' });
  assert.equal(completed.transport.model_requests, 1);
  const passed = JSON.parse(await readFile(resolve(completed.runDirectory, 'request.json'), 'utf8'));
  assert.equal(JSON.stringify(passed).includes('secret-never-forward'), false);
  assert.equal(passed.allowed_tool_names[0], 'return_result');
  assert.match(passed.prompt, /"role":"system"/u);
  await writeFile(fake, `import json, pathlib, sys\nr=json.load(sys.stdin)\np=pathlib.Path(r['run_directory'])\np.mkdir(mode=0o700)\n(p/'contract-candidate.json').write_text(json.dumps({'tool_name':'return_result','arguments':{'workJson':''}}))\nprint(json.dumps({'transport_passed':True,'upstream_models':['glm-5.3'],'input_tokens':10,'output_tokens':5}))\n`);
  await assert.rejects(tested(null, request()), /CODEX_GENERATION_CANDIDATE_INVALID/u);
  await writeFile(fake, `import json, pathlib, sys\nr=json.load(sys.stdin)\np=pathlib.Path(r['run_directory'])\np.mkdir(mode=0o700)\n(p/'contract-candidate.json').write_text(json.dumps({'tool_name':'return_result','arguments':{'workJson':'{}'}}))\nprint(json.dumps({'transport_passed':True,'upstream_models':['other-model'],'input_tokens':10,'output_tokens':5}))\n`);
  await assert.rejects(tested(null, request()), /CODEX_GENERATION_INCOMPLETE/u);
  await assert.rejects(gateway(null, request({ 'x-openclaw-model': 'miaoda/other' })),
    /CODEX_GENERATION_SELECTED_MODEL_UNSUPPORTED/u);
});

test('gateway rejects noncontract route and request shape before dispatch', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'codex-generation-invalid-'));
  const gateway = createCodexGateway({ codexBinary: '/fake/codex', configPath: '/fake/config', runRoot: root });
  await assert.rejects(gateway('http://localhost/v1/responses', request()), /CODEX_GENERATION_ROUTE_UNSUPPORTED/u);
  const invalid = request();
  invalid.body = JSON.stringify({ ...JSON.parse(invalid.body), n: 2 });
  await assert.rejects(gateway(null, invalid), /CODEX_GENERATION_REQUEST_UNSUPPORTED/u);
  const wiki = request();
  const body = JSON.parse(wiki.body);
  body.tool_choice = { type: 'function', function: { name: 'return_result' } };
  body.max_completion_tokens = 128;
  body.messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function',
    function: { name: 'return_result', arguments: '{"workJson":"{}"}' } }] });
  body.messages.push({ role: 'tool', tool_call_id: 'call_1', content: '{"read":"observed"}' });
  wiki.body = JSON.stringify(body);
  // Reaching the runner confirms this request shape passed local validation.
  await assert.rejects(gateway(null, wiki), /CODEX_GENERATION_SUMMARY_INVALID|CODEX_GENERATION_INCOMPLETE/u);
});
