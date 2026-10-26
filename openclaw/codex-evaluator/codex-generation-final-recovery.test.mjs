import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generationInput, offlineGenerationFixture } from './codex-generation-offline-test-fixture.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const workJson = JSON.stringify({ schemaVersion: 'synthetic-work.v1',
  body: '完整原文、引号"、反斜杠\\、括号{}[]与否定条件均保留。', issues: [{ key: 'A', value: 3 }] });
const complete = JSON.stringify({ tool_name: 'return_result', arguments: { workJson } });
const raw = complete.slice(0, -1);
const derivedNames = ['generation-normalized-final.json', 'generation-final-recovery.json', 'adapted-response.json'];
const originals = ['generation-binding.json', 'codex-prompt.txt', 'generation-receipt.json',
  'transport-summary.json', 'bridge.audit.jsonl', 'upstream-request.json', 'upstream-response.json', 'final.txt'];

async function eofFixture(requestId) {
  const f = await offlineGenerationFixture({ maximum: 131072, finalText: raw });
  const first = await f.gateway()(null, generationInput(requestId));
  const directory = first.codexReceipt.runDirectory;
  const snapshot = new Map(await Promise.all(originals.map(async name =>
    [name, await readFile(resolve(directory, name))])));
  const recover = (input = generationInput(requestId, { recoverOnly: true })) =>
    f.gateway({ pythonBinary: '/missing/never-spawn' })(null, input);
  return { ...f, first, directory, snapshot, recover, requestId };
}

async function removeDerived(f) {
  for (const name of derivedNames) await unlink(resolve(f.directory, name));
}

async function unchanged(f) {
  for (const [name, bytes] of f.snapshot) assert.deepEqual(await readFile(resolve(f.directory, name)), bytes);
  assert.equal((await readFile(resolve(f.root, 'dispatch-count'), 'utf8')).trim(), '1');
  assert.equal(JSON.parse(await readFile(resolve(f.directory, 'transport-summary.json'), 'utf8')).transport_passed, false);
  await assert.rejects(readFile(resolve(f.directory, 'contract-candidate.json')), { code: 'ENOENT' });
}

test('single EOF root closure uses the real JS/Python/bridge path and preserves payload and original verdict', async () => {
  const f = await eofFixture('eof:first-and-recovery');
  const firstRaw = await f.first.text();
  const response = JSON.parse(firstRaw);
  assert.equal(JSON.parse(response.choices[0].message.tool_calls[0].function.arguments).workJson, workJson);
  const provenance = response.finalRecovery;
  assert.equal(provenance.kind, 'single-eof-root-close');
  assert.equal(provenance.modelRequests, 1);
  assert.equal(provenance.originalFinalSha256, digest(raw));
  assert.equal(provenance.normalizedFinalSha256, digest(complete));
  assert.equal(provenance.workJsonSha256, digest(workJson));
  assert.equal(provenance.originalReceiptSha256, digest(f.snapshot.get('generation-receipt.json')));
  assert.deepEqual(f.first.codexReceipt.finalRecovery, provenance);
  assert.equal(await readFile(provenance.normalizedFinalRef, 'utf8'), raw + '}');
  const derived = JSON.parse(await readFile(provenance.receiptRef, 'utf8'));
  assert.equal(derived.candidate.arguments.workJson, workJson);
  for (let index = 0; index < 2; index++) assert.equal(await (await f.recover()).text(), firstRaw);
  await unchanged(f);
});

test('an old failed receipt without derived artifacts recovers with zero runner launch', async () => {
  const f = await eofFixture('eof:legacy-receipt');
  const expected = await f.first.text();
  await removeDerived(f);
  assert.equal(await (await f.recover()).text(), expected);
  await unchanged(f);
});

test('already valid structured finals keep the original success path without derived recovery', async () => {
  const f = await offlineGenerationFixture({ finalText: complete });
  const response = await f.gateway()(null, generationInput('eof:already-valid'));
  assert.equal(response.codexReceipt.finalRecovery, undefined);
  assert.equal(JSON.parse(await response.text()).finalRecovery, undefined);
  for (const name of derivedNames.slice(0, 2))
    await assert.rejects(readFile(resolve(response.codexReceipt.runDirectory, name)), { code: 'ENOENT' });
});

test('other syntax, duplicate keys, tools or incomplete payloads never enter root closure', async t => {
  const cases = [
    ['two missing closers', complete.slice(0, -2)],
    ['unfinished string', raw.slice(0, raw.lastIndexOf('"'))],
    ['code fence', '```json\n' + raw + '\n```'],
    ['trailing comma', raw + ','],
    ['duplicate root key', '{"tool_name":"return_result",' + raw.slice(1)],
    ['escaped duplicate key', '{"tool_\\u006eame":"return_result",' + raw.slice(1)],
    ['duplicate argument key', '{"tool_name":"return_result","arguments":{"workJson":"{}","workJson":"{}"}'],
    ['duplicate inner key', JSON.stringify({ tool_name: 'return_result', arguments: { workJson: '{"x":1,"x":2}' } }).slice(0, -1)],
    ['nonfinite inner number', JSON.stringify({ tool_name: 'return_result', arguments: { workJson: '{"x":1e999}' } }).slice(0, -1)],
    ['invalid inner payload', JSON.stringify({ tool_name: 'return_result', arguments: { workJson: '{"x":' } }).slice(0, -1)],
    ['foreign tool', JSON.stringify({ tool_name: 'other_tool', arguments: { workJson } }).slice(0, -1)],
    ['extra root field', JSON.stringify({ tool_name: 'return_result', arguments: { workJson }, extra: true }).slice(0, -1)],
    ['extra argument field', JSON.stringify({ tool_name: 'return_result', arguments: { workJson, extra: true } }).slice(0, -1)],
    ['array arguments', JSON.stringify({ tool_name: 'return_result', arguments: [] }).slice(0, -1)],
  ];
  for (const [name, finalText] of cases) await t.test(name, async () => {
    const f = await offlineGenerationFixture({ finalText });
    const requestId = 'eof:reject:' + name;
    await assert.rejects(f.gateway()(null, generationInput(requestId)), /CODEX_GENERATION_INCOMPLETE/u);
    const directory = resolve(f.root, (await readdir(f.root)).find(value => value.startsWith('generation-recovery-')));
    await assert.rejects(f.gateway({ pythonBinary: '/missing/never-spawn' })(null,
      generationInput(requestId, { recoverOnly: true })), /CODEX_GENERATION_INCOMPLETE/u);
    for (const artifact of derivedNames) await assert.rejects(readFile(resolve(directory, artifact)), { code: 'ENOENT' });
    assert.equal((await readFile(resolve(f.root, 'dispatch-count'), 'utf8')).trim(), '1');
  });
});

test('root closure requires every original terminal, byte and usage proof', async t => {
  const f = await eofFixture('eof:terminal-proof');
  await removeDerived(f);
  const baseline = Object.fromEntries([...f.snapshot].map(([key, value]) => [key, value.toString('utf8')]));
  const cases = [
    ['exit failure', d => { d.transport.codex_exit_code = 1; }],
    ['timeout', d => { d.transport.timed_out = true; }],
    ['auth file present', d => { d.transport.auth_json_present = true; }],
    ['provider OpenAI auth', d => { d.transport.provider_requires_openai_auth = true; }],
    ['OpenAI child credentials', d => { d.transport.openai_credentials_in_child_environment = true; }],
    ['open process', d => { d.transport.process_group_closed = false; }],
    ['leftover process', d => { d.transport.process_group_had_members = true; }],
    ['multiple requests', d => { d.transport.model_requests = 2; }],
    ['extra terminal', d => { d.transport.terminal_events.push('turn.failed'); }],
    ['tool item', d => { d.transport.tool_items.push('mcp_tool_call'); }],
    ['bridge error', d => { d.transport.bridge_errors.push('upstream_timeout'); }],
    ['changed config', d => { d.transport.source_config_unchanged = false; }],
    ['wrong usage', d => { d.audit.usage.output_tokens++; }],
    ['audit tool', d => { d.audit.tool_calls = 1; }],
    ['audit not stop', d => { d.audit.finish_reason = 'length'; }],
    ['upstream not stop', d => { d.upstream.events[0].choices[0].finish_reason = 'length'; }],
    ['upstream repeated stop', d => { d.upstream.events.push(d.upstream.events[0]); }],
    ['upstream other model', d => { d.upstream.events[0].model = 'other'; }],
    ['upstream wrong usage', d => { d.upstream.events[0].usage.completion_tokens++; }],
    ['upstream tool', d => { d.upstream.events[0].choices[0].delta.tool_calls = [{ id: 'foreign' }]; }],
    ['upstream content differs', d => { d.upstream.events[0].choices[0].delta.content += ' '; }],
    ['request other model', d => { d.request.model = 'other'; }],
    ['request exceeds binding', d => { d.request.max_tokens = 131073; }],
    ['request tool', d => { d.request.tools = [{ type: 'function' }]; }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    for (const [key, value] of Object.entries(baseline)) await writeFile(resolve(f.directory, key), value);
    const d = { receipt: JSON.parse(baseline['generation-receipt.json']),
      transport: JSON.parse(baseline['transport-summary.json']), audit: JSON.parse(baseline['bridge.audit.jsonl']),
      upstream: JSON.parse(baseline['upstream-response.json']), request: JSON.parse(baseline['upstream-request.json']) };
    change(d);
    const request = JSON.stringify(d.request), upstream = JSON.stringify(d.upstream);
    d.transport.upstream_request_sha256 = digest(request);
    d.transport.upstream_response_sha256 = digest(upstream);
    d.receipt.transport = d.transport;
    d.receipt.upstream_request_sha256 = digest(request);
    d.receipt.upstream_response_sha256 = digest(upstream);
    for (const [key, value] of Object.entries({ 'generation-receipt.json': d.receipt,
      'transport-summary.json': d.transport, 'bridge.audit.jsonl': d.audit,
      'upstream-request.json': d.request, 'upstream-response.json': d.upstream }))
      await writeFile(resolve(f.directory, key), JSON.stringify(value));
    await assert.rejects(f.recover(), /CODEX_GENERATION_INCOMPLETE/u);
    for (const artifact of derivedNames) await assert.rejects(readFile(resolve(f.directory, artifact)), { code: 'ENOENT' });
  });
  assert.equal((await readFile(resolve(f.root, 'dispatch-count'), 'utf8')).trim(), '1');
});

test('original binding, prompt and exact artifact hashes cannot be bypassed by root closure', async t => {
  const f = await eofFixture('eof:strict-binding');
  await removeDerived(f);
  for (const [name, transform, expected] of [
    ['generation-binding.json', value => JSON.stringify({ ...JSON.parse(value), requestId: 'foreign' }), /RECOVERY_MISMATCH/u],
    ['codex-prompt.txt', () => 'different prompt', /RECOVERY_MISMATCH/u],
    ['upstream-request.json', () => '{}', /INCOMPLETE/u],
    ['upstream-response.json', () => '{}', /INCOMPLETE/u],
    ['final.txt', value => value + ' ', /INCOMPLETE/u],
  ]) await t.test(name, async () => {
    const path = resolve(f.directory, name), before = await readFile(path);
    await writeFile(path, transform(before.toString('utf8')));
    await assert.rejects(f.recover(), expected);
    await writeFile(path, before);
    for (const artifact of derivedNames) await assert.rejects(readFile(resolve(f.directory, artifact)), { code: 'ENOENT' });
  });
  const altered = generationInput(f.requestId, { recoverOnly: true,
    body: { max_completion_tokens: 16384 } });
  await assert.rejects(f.recover(altered), /RECOVERY_MISMATCH/u);
  await unchanged(f);
});

test('existing derived artifacts are verified and never overwritten after tampering', async t => {
  const f = await eofFixture('eof:derived-tamper');
  for (const name of derivedNames.slice(0, 2)) await t.test(name, async () => {
    const path = resolve(f.directory, name), before = await readFile(path);
    await writeFile(path, 'changed derived bytes');
    await assert.rejects(f.recover(), /CODEX_GENERATION_FINAL_RECOVERY_INVALID/u);
    assert.equal(await readFile(path, 'utf8'), 'changed derived bytes');
    await writeFile(path, before);
  });
  await unchanged(f);
});
