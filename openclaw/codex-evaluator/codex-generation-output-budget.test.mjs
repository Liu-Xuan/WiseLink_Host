import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCodexGateway, codexRecoveryRunDirectory } from './codex-generation.mjs';
import { generationInput, modelConfig, offlineGenerationFixture } from './codex-generation-offline-test-fixture.mjs';

test('configured 64000 reaches the real Python runner and bridge request with one upstream attempt', async () => {
  const f = await offlineGenerationFixture();
  const response = await f.gateway()(null, generationInput('budget:configured'));
  const directory = response.codexReceipt.runDirectory;
  assert.equal((await f.readJson(directory, 'generation-binding.json')).maxOutputTokens, 64000);
  const upstream = await f.readJson(directory, 'upstream-request.json');
  assert.equal(upstream.max_tokens, 64000);
  assert.equal(upstream.reasoning_effort, 'max');
  const summary = await f.readJson(directory, 'transport-summary.json');
  assert.equal(summary.model_requests, 1);
  assert.equal(summary.input_tokens, 169583);
  assert.equal(summary.transport_passed, true);
  assert.equal((await readFile(resolve(f.root, 'dispatch-count'), 'utf8')).trim(), '1');
});

test('configured metadata is dynamic and lower caller and request budgets are retained end to end', async () => {
  const f = await offlineGenerationFixture({ maximum: 72000 });
  for (const [name, option, body, expected] of [
    ['dynamic', {}, {}, 72000],
    ['option', { maxOutputTokens: 12000 }, {}, 12000],
    ['tokens', {}, { max_tokens: 9000 }, 9000],
    ['completion', { maxOutputTokens: 12000 }, { max_tokens: 9000, max_completion_tokens: 7000 }, 7000],
    ['above-model', { maxOutputTokens: 90000 }, {}, 72000],
  ]) {
    const response = await f.gateway(option)(null, generationInput(`budget:${name}`, { body }));
    assert.equal((await f.readJson(response.codexReceipt.runDirectory, 'upstream-request.json')).max_tokens, expected);
  }
});

test('the same above-profile caller option recovers its capped result without spawning', async () => {
  const f = await offlineGenerationFixture({ maximum: 72000 });
  const requestId = 'budget:above-profile-recovery';
  const option = { maxOutputTokens: 90000 };
  const first = await f.gateway(option)(null, generationInput(requestId));
  const directory = first.codexReceipt.runDirectory;
  const binding = await readFile(resolve(directory, 'generation-binding.json'));
  assert.equal(JSON.parse(binding).maxOutputTokens, 72000);
  assert.equal((await f.readJson(directory, 'upstream-request.json')).max_tokens, 72000);
  for (const recoverOnly of [true, false]) {
    const recovered = await f.gateway({ ...option, pythonBinary: '/missing/must-not-spawn' })(null,
      generationInput(requestId, { recoverOnly }));
    assert.equal(await recovered.text(), await first.text());
    assert.equal(recovered.codexReceipt.recovered, true);
    assert.deepEqual(await readFile(resolve(directory, 'generation-binding.json')), binding);
  }
  await assert.rejects(f.gateway({ maxOutputTokens: 70000 })(null,
    generationInput(requestId, { recoverOnly: true })), /CODEX_GENERATION_RECOVERY_MISMATCH/u);
  assert.equal((await readFile(resolve(f.root, 'dispatch-count'), 'utf8')).trim(), '1');
});

test('missing, ambiguous, invalid or unreadable model metadata fails before the claim and child', async () => {
  const f = await offlineGenerationFixture();
  const cases = [
    [{}, /MODEL_METADATA_INVALID/u],
    [modelConfig(64000), null],
    [modelConfig(null), /MODEL_METADATA_INVALID/u],
    [modelConfig('64000'), /MODEL_METADATA_INVALID/u],
    [modelConfig(true), /MODEL_METADATA_INVALID/u],
    [modelConfig(0), /MODEL_METADATA_INVALID/u],
    [modelConfig(1.5), /MODEL_METADATA_INVALID/u],
    [modelConfig(Number.MAX_SAFE_INTEGER + 1), /MODEL_METADATA_INVALID/u],
  ];
  cases[1][0].models.providers.miaoda.models = [];
  cases[1][1] = /MODEL_METADATA_MISSING/u;
  const ambiguous = modelConfig(64000);
  ambiguous.models.providers.miaoda.models.push({ id: 'glm-5.3', maxTokens: 64000 });
  cases.push([ambiguous, /MODEL_METADATA_AMBIGUOUS/u]);
  for (const [config, expected] of cases) {
    await writeFile(f.configPath, JSON.stringify(config));
    await assert.rejects(f.gateway({ maxOutputTokens: 128 })(null, generationInput('budget:invalid')), expected);
  }
  await writeFile(f.configPath, '{invalid');
  await assert.rejects(f.gateway()(null, generationInput('budget:invalid')), /MODEL_CONFIG_INVALID/u);
  await unlink(f.configPath);
  await assert.rejects(f.gateway()(null, generationInput('budget:invalid')), /MODEL_CONFIG_UNAVAILABLE/u);
  assert.equal((await readdir(f.root)).some(name => name.startsWith('generation-')), false);
  await assert.rejects(readFile(resolve(f.root, 'dispatch-count')), { code: 'ENOENT' });
});

test('legacy 16k completed binding recovers exact bytes under a new default with zero child', async () => {
  const f = await offlineGenerationFixture();
  const requestId = 'budget:legacy-complete';
  const first = await f.gateway({ maxOutputTokens: 16384 })(null, generationInput(requestId));
  const directory = first.codexReceipt.runDirectory;
  const originals = new Map(await Promise.all((await readdir(directory)).map(async name =>
    [name, await readFile(resolve(directory, name)).catch(() => null)])));
  const recover = extra => createCodexGateway({ ...f.options, pythonBinary: '/missing/must-not-spawn', ...extra })
    (null, generationInput(requestId, { recoverOnly: true }));
  assert.equal(await (await recover()).text(), await first.text());
  // A completed recovery depends on the original config identity, not current
  // model metadata availability or a newly calculated configured default.
  await writeFile(f.configPath, JSON.stringify({ models: { providers: {} } }));
  assert.equal(await (await recover()).text(), await first.text());
  for (const [name, bytes] of originals)
    if (bytes !== null) assert.deepEqual(await readFile(resolve(directory, name)), bytes);
  for (const change of [{ configPath: '/different/config' }, { codexBinary: '/different/codex' },
    { timeoutSeconds: 29 }, { reasoningEffort: 'low' }, { maxOutputTokens: 8192 }, { maxOutputTokens: 64000 }])
    await assert.rejects(recover(change), /CODEX_GENERATION_RECOVERY_MISMATCH/u);
  const changed = generationInput(requestId, { recoverOnly: true, body: {
    messages: [{ role: 'user', content: 'changed request' }],
  } });
  await assert.rejects(f.gateway()(null, changed), /CODEX_GENERATION_RECOVERY_MISMATCH/u);
  assert.equal((await readFile(resolve(f.root, 'dispatch-count'), 'utf8')).trim(), '1');
});

test('legacy 16k UNKNOWN claim stays byte-identical and never spawns under the new default', async () => {
  const f = await offlineGenerationFixture();
  const requestId = 'budget:legacy-unknown';
  await assert.rejects(f.gateway({ maxOutputTokens: 16384,
    onRunPrepared: () => { throw Error('OFFLINE_PRELAUNCH'); } })(null, generationInput(requestId)), /OFFLINE_PRELAUNCH/u);
  const directory = await codexRecoveryRunDirectory(f.root, requestId);
  const names = await readdir(directory);
  const originals = await Promise.all(names.map(name => readFile(resolve(directory, name))));
  for (const recoverOnly of [true, false, true])
    await assert.rejects(f.gateway({ pythonBinary: '/missing/must-not-spawn' })(null,
      generationInput(requestId, { recoverOnly })), /CODEX_GENERATION_OUTCOME_UNKNOWN/u);
  assert.deepEqual(await readdir(directory), names);
  for (let index = 0; index < names.length; index++)
    assert.deepEqual(await readFile(resolve(directory, names[index])), originals[index]);
  await assert.rejects(readFile(resolve(f.root, 'dispatch-count')), { code: 'ENOENT' });
});
