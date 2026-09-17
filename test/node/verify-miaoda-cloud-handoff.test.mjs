import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const script = resolve(
  import.meta.dirname,
  '../../scripts/verify-miaoda-cloud-handoff.mjs',
);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'wl-handoff-test-'));
  const repo = resolve(root, 'repo');
  mkdirSync(repo);
  run('git', ['init', '-q'], repo);
  run('git', ['config', 'user.email', 'test@example.invalid'], repo);
  run('git', ['config', 'user.name', 'WiseLink test'], repo);
  writeFileSync(resolve(repo, 'a.txt'), 'before\n');
  run('git', ['add', 'a.txt'], repo);
  run('git', ['commit', '-qm', 'base'], repo);
  const base = run('git', ['rev-parse', 'HEAD'], repo);
  writeFileSync(resolve(repo, 'a.txt'), 'after\n');
  writeFileSync(resolve(repo, 'b.txt'), 'new\n');
  run('git', ['add', '-N', 'b.txt'], repo);
  const patch = Buffer.from(run('git', ['diff', '--binary', '--no-ext-diff'], repo) + '\n');
  run('git', ['restore', 'a.txt'], repo);
  unlinkSync(resolve(repo, 'b.txt'));
  const payload = gzipSync(patch, { level: 9 });
  const encoded = payload.toString('base64');
  const chunks = encoded.match(/.{1,80}/gu) ?? [];
  const manifest = [
    'WL_CODE_HANDOFF_V1',
    `base_sha=${base}`,
    `patch_sha256=${hash(patch)}`,
    `payload_sha256=${hash(payload)}`,
    `patch_bytes=${patch.length}`,
    `parts=${chunks.length}`,
    'files=a.txt|b.txt',
  ].join('\n');
  const messages = [manifest, ...chunks.map((chunk, index) =>
    `WL_CODE_HANDOFF_CHUNK_V1 part=${index + 1}/${chunks.length}\n${chunk}\nWL_CODE_HANDOFF_CHUNK_END`)].join('\n\n');
  return { root, repo, patch, messages };
}

test('reconstructs and checks an exact compressed cloud handoff', () => {
  const value = fixture();
  try {
    const input = resolve(value.root, 'messages.json');
    const output = resolve(value.root, 'handoff.patch');
    writeFileSync(input, JSON.stringify({ messages: [{ content: value.messages }] }));
    const result = spawnSync(process.execPath, [script, '--repo', value.repo, '--input', input, '--output', output], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(output), value.patch);
    assert.deepEqual(JSON.parse(result.stdout).files, ['a.txt', 'b.txt']);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects missing chunks before writing an output', () => {
  const value = fixture();
  try {
    const input = resolve(value.root, 'messages.txt');
    const output = resolve(value.root, 'handoff.patch');
    writeFileSync(input, value.messages.replace(/WL_CODE_HANDOFF_CHUNK_V1 part=1\/[\s\S]+?WL_CODE_HANDOFF_CHUNK_END/u, ''));
    const result = spawnSync(process.execPath, [script, '--repo', value.repo, '--input', input, '--output', output], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /缺少分块/u);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects a handoff when local HEAD differs from its exact base', () => {
  const value = fixture();
  try {
    const input = resolve(value.root, 'messages.txt');
    const output = resolve(value.root, 'handoff.patch');
    writeFileSync(input, value.messages);
    writeFileSync(resolve(value.repo, 'head.txt'), 'later\n');
    run('git', ['add', 'head.txt'], value.repo);
    run('git', ['commit', '-qm', 'later'], value.repo);
    const result = spawnSync(process.execPath, [script, '--repo', value.repo, '--input', input, '--output', output], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /与 handoff 基线.+不一致/u);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});
