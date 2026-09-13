import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const hook = fileURLToPath(new URL('../../.githooks/pre-push', import.meta.url));
const host = 'https://miaoda-git.feishu.cn/apaas4.0/-/t_mx8LiKO6/code_T0OCUEHo3all.git';
const github = 'https://github.com/Liu-Xuan/WiseLink_Host.git';
const refUpdate = `refs/heads/codex/example ${'a'.repeat(40)} refs/heads/codex/example ${'0'.repeat(40)}\n`;
const nonFastForwardUpdate = `refs/heads/codex/example ${'a'.repeat(40)} refs/heads/codex/example ${'b'.repeat(40)}\n`;

for (const [name, remote, destination, allowed] of [
  ['Feishu Host origin', 'origin', host, true],
  ['GitHub remote', 'github', github, true],
  ['direct GitHub URL', github, github, false],
  ['GitHub SSH URL', 'github', 'git@github.com:Liu-Xuan/WiseLink_Host.git', false],
  ['origin redirected to GitHub', 'origin', github, false],
  ['different Feishu project', 'origin', `${host}-other`, false],
  ['unnamed destination', '', '', false],
]) {
  test(name, () => {
    const result = spawnSync(hook, [remote, destination], {
      encoding: 'utf8',
      input: refUpdate,
      env: { ...process.env, SKIP_GIT_HOOKS: '1' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, allowed ? 0 : 1);
    if (!allowed) assert.match(result.stderr, /Push blocked/);
  });
}

for (const [name, input] of [
  ['main ref', `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'0'.repeat(40)}\n`],
  ['tag ref', `refs/tags/v1 ${'a'.repeat(40)} refs/tags/v1 ${'0'.repeat(40)}\n`],
  ['different source and destination refs', `refs/heads/codex/example ${'a'.repeat(40)} refs/heads/codex/other ${'0'.repeat(40)}\n`],
  ['deletion', `refs/heads/codex/example ${'0'.repeat(40)} refs/heads/codex/example ${'a'.repeat(40)}\n`],
  ['non-fast-forward update', nonFastForwardUpdate],
  ['multiple updates', `${refUpdate}${refUpdate}`],
]) {
  test(`rejects ${name}`, () => {
    const result = spawnSync(hook, ['github', github], {
      encoding: 'utf8',
      input,
      env: { ...process.env, SKIP_GIT_HOOKS: '1' },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Push blocked/);
  });
}
