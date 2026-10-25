import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generationInput, offlineGenerationFixture } from './codex-generation-offline-test-fixture.mjs';

async function lengthFixture(requestId) {
  const f = await offlineGenerationFixture({ finish: 'length' });
  let initialError;
  await assert.rejects(f.gateway({ maxOutputTokens: 16384 })(null, generationInput(requestId)), error => {
    initialError = error;
    return error.message === 'CODEX_GENERATION_INCOMPLETE';
  });
  const directory = resolve(f.root, (await readdir(f.root)).find(name => name.startsWith('generation-recovery-')));
  const recover = () => f.gateway({ pythonBinary: '/missing/must-not-spawn' })(null,
    generationInput(requestId, { recoverOnly: true }));
  return { ...f, directory, initialError, recover };
}

test('exact closed length receipt produces typed terminal evidence on first run and legacy recovery', async () => {
  const requestId = 'terminal:known-length';
  const f = await lengthFixture(requestId);
  const summary = await f.readJson(f.directory, 'transport-summary.json');
  const expected = { code: 'JOBAID_MODEL_OUTPUT_LENGTH', requestId, runDirectory: f.directory,
    transportSummaryRef: resolve(f.directory, 'transport-summary.json'), modelVersion: 'glm-5.3',
    inputTokens: 169583, outputTokens: 16384, durationMs: summary.duration_ms };
  assert.deepEqual(f.initialError.codexTerminalFailure, expected);
  const names = await readdir(f.directory);
  const original = await Promise.all(names.map(name => readFile(resolve(f.directory, name)).catch(() => null)));
  for (let attempt = 0; attempt < 2; attempt++)
    await assert.rejects(f.recover(), error => {
      assert.deepEqual(error.codexTerminalFailure, expected);
      return error.message === 'CODEX_GENERATION_INCOMPLETE';
    });
  for (let index = 0; index < names.length; index++)
    if (original[index] !== null) assert.deepEqual(await readFile(resolve(f.directory, names[index])), original[index]);
  assert.equal((await readFile(resolve(f.root, 'dispatch-count'), 'utf8')).trim(), '1');
  assert.equal(summary.transport_passed, false);
  for (const name of ['contract-candidate.json', 'upstream-response.json', 'adapted-response.json'])
    await assert.rejects(readFile(resolve(f.directory, name)), { code: 'ENOENT' });
});

test('uncertain, mixed or inconsistent length evidence keeps generic incomplete and zero redispatch', async () => {
  const f = await lengthFixture('terminal:uncertain-length');
  const auditPath = resolve(f.directory, 'bridge.audit.jsonl');
  const auditRaw = await readFile(auditPath, 'utf8');
  const row = JSON.parse(auditRaw);
  for (const changed of [
    { error_code: 'upstream_timeout' }, { error_type: 'TimeoutError' }, { finish_reason: 'stop' },
    { upstream_attempted: false }, { upstream_models: ['other-model'] }, { model: 'other-model' },
    { error_phase: 'response_write' }, { tool_calls: 1 }, { status: 200 },
    { usage: { input_tokens: 169583, output_tokens: 16383, total_tokens: 185966 } },
  ]) {
    await writeFile(auditPath, JSON.stringify({ ...row, ...changed }) + '\n');
    await assert.rejects(f.recover(), error => {
      assert.equal(error.codexTerminalFailure, undefined);
      return error.message === 'CODEX_GENERATION_INCOMPLETE';
    });
  }
  for (const raw of [auditRaw + auditRaw, '{invalid', '']) {
    await writeFile(auditPath, raw);
    await assert.rejects(f.recover(), error => !error.codexTerminalFailure &&
      error.message === 'CODEX_GENERATION_INCOMPLETE');
  }
  await writeFile(auditPath, auditRaw);
  const receiptPath = resolve(f.directory, 'generation-receipt.json');
  const receiptRaw = await readFile(receiptPath, 'utf8');
  const receipt = JSON.parse(receiptRaw);
  const transportPath = resolve(f.directory, 'transport-summary.json');
  const transportRaw = await readFile(transportPath, 'utf8');
  for (const changed of [{ process_group_closed: false }, { process_group_had_members: true },
    { timed_out: true }, { failure: 'generation_deadline_exceeded' }, { model_requests: 2 },
    { upstream_models: ['glm-5.3', 'other-model'] }, { duration_ms: -1 },
    { source_config_unchanged: false }, { input_tokens: 169582 },
    { bridge_errors: ['upstream_output_length', 'other-error'] }]) {
    const transport = { ...receipt.transport, ...changed };
    await writeFile(transportPath, JSON.stringify(transport));
    await writeFile(receiptPath, JSON.stringify({ ...receipt, transport }));
    await assert.rejects(f.recover(), error => !error.codexTerminalFailure &&
      error.message === 'CODEX_GENERATION_INCOMPLETE');
  }
  await writeFile(receiptPath, receiptRaw);
  await writeFile(transportPath, transportRaw);
  for (const name of ['upstream-response.json', 'adapted-response.json']) {
    await writeFile(resolve(f.directory, name), '{}');
    await assert.rejects(f.recover(), error => !error.codexTerminalFailure &&
      error.message === 'CODEX_GENERATION_INCOMPLETE');
    await unlink(resolve(f.directory, name));
  }
  const requestPath = resolve(f.directory, 'upstream-request.json');
  await writeFile(requestPath, '{"model":"glm-5.3","max_tokens":16384}');
  await assert.rejects(f.recover(), error => !error.codexTerminalFailure &&
    error.message === 'CODEX_GENERATION_INCOMPLETE');
  assert.equal((await readFile(resolve(f.root, 'dispatch-count'), 'utf8')).trim(), '1');
});

test('length classification cannot bypass original binding, prompt, receipt or durable transport checks', async () => {
  const f = await lengthFixture('terminal:strict-binding');
  for (const [name, changed, expected] of [
    ['generation-binding.json', value => ({ ...value, maxOutputTokens: 64000 }), /RECEIPT_INVALID/u],
    ['generation-binding.json', value => ({ ...value, requestId: 'foreign' }), /RECOVERY_MISMATCH/u],
    ['generation-binding.json', value => ({ ...value, configPath: '/foreign/config' }), /RECOVERY_MISMATCH/u],
    ['generation-receipt.json', value => ({ ...value, binding_sha256: 'wrong' }), /RECEIPT_INVALID/u],
    ['transport-summary.json', value => ({ ...value, output_tokens: 0 }), /RECEIPT_INVALID/u],
  ]) {
    const path = resolve(f.directory, name);
    const raw = await readFile(path, 'utf8');
    await writeFile(path, JSON.stringify(changed(JSON.parse(raw))));
    await assert.rejects(f.recover(), error => !error.codexTerminalFailure && expected.test(error.message));
    await writeFile(path, raw);
  }
  const promptPath = resolve(f.directory, 'codex-prompt.txt');
  await writeFile(promptPath, 'different prompt');
  await assert.rejects(f.recover(), error => !error.codexTerminalFailure && /RECOVERY_MISMATCH/u.test(error.message));
  assert.equal((await readFile(resolve(f.root, 'dispatch-count'), 'utf8')).trim(), '1');
});
