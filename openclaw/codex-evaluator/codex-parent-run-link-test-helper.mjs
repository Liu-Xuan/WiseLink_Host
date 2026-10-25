import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Assert that the consumer checkpoint names the exact private gateway run. */
export async function assertCodexParentRunLink({ checkpointRoot, step, requestId, runRoot, argsHash }) {
  const linkPath = resolve(checkpointRoot, `${step}.codex-run.json`);
  const link = JSON.parse(await readFile(linkPath, 'utf8'));
  assert.deepEqual(Object.keys(link).sort(), [
    'argsHash', 'gatewayBindingSha256', 'promptSha256', 'requestId', 'runDirectory', 'runRoot', 'version',
  ]);
  assert.equal(link.version, 1);
  assert.equal(link.requestId, requestId);
  assert.match(link.argsHash, /^[0-9a-f]{64}$/u);
  if (argsHash !== undefined) assert.equal(link.argsHash, argsHash);
  assert.match(link.gatewayBindingSha256, /^[0-9a-f]{64}$/u);
  assert.match(link.promptSha256, /^[0-9a-f]{64}$/u);

  const expectedRoot = await realpath(runRoot);
  assert.equal(link.runRoot, expectedRoot);
  assert.equal(dirname(link.runDirectory), expectedRoot);
  assert.equal(link.runDirectory, resolve(expectedRoot, `generation-recovery-${sha256(requestId)}`));

  const binding = JSON.parse(await readFile(resolve(link.runDirectory, 'generation-binding.json'), 'utf8'));
  const prompt = await readFile(resolve(link.runDirectory, 'codex-prompt.txt'));
  assert.equal(binding.requestId, requestId);
  assert.equal(link.gatewayBindingSha256, sha256(JSON.stringify(binding)));
  assert.equal(binding.promptSha256, link.promptSha256);
  assert.equal(link.promptSha256, sha256(prompt));
  return link;
}

export function assertDistinctCodexParentRunLinks(links) {
  assert.ok(links.length > 1);
  assert.equal(new Set(links.map(link => link.requestId)).size, links.length);
  assert.equal(new Set(links.map(link => link.runDirectory)).size, links.length);
  assert.equal(new Set(links.map(link => link.gatewayBindingSha256)).size, links.length);
}
