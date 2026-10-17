import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const sourceScript = resolve(import.meta.dirname, '../../scripts/prune-smart.js');
const nftPackage = dirname(require.resolve('@vercel/nft/package.json'));

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

function writePackage(root, name, metadata = {}, body = 'module.exports = "ok";') {
  const directory = join(root, 'node_modules', name);
  writeJson(join(directory, 'package.json'), { name, version: '1.0.0', main: 'index.js', ...metadata });
  writeFileSync(join(directory, 'index.js'), body);
  return directory;
}

async function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'pr-'));
  const deployment = mkdtempSync(join(tmpdir(), 'pr-out-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'dist/server'), { recursive: true });
  mkdirSync(join(root, 'node_modules/@vercel'), { recursive: true });
  copyFileSync(sourceScript, join(root, 'scripts/prune-smart.js'));
  // Real installed NFT is a development tool, never a runtime trace root.
  symlinkSync(nftPackage, join(root, 'node_modules/@vercel/nft'), 'dir');
  writeJson(join(root, 'package.json'), {
    name: 'prune-fixture', version: '1.0.0', engines: { node: '>=22' },
    dependencies: { runtime: '1.0.0', '@nestjs/platform-express': '10.4.22' },
    devDependencies: { rxjs: '7.8.2', 'unused-dev': '1.0.0' },
  });
  writePackage(root, 'runtime');
  writeFileSync(join(root, 'dist/server/main.js'), 'require("runtime");');
  const env = { ...process.env, MIAODA_RUNTIME_ENTRIES: '' };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const prune = (extraEnv = {}) => spawnSync(process.execPath, [join(root, 'scripts/prune-smart.js')], {
    cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 15_000,
  });
  try {
    await run({ root, deployment, prune, env });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(deployment, { recursive: true, force: true });
  }
}

for (const rootCapability of [false, true]) {
  test(`prune preserves runtime peers, plugin closure and nested capability (other root version=${rootCapability})`, () =>
    withFixture(({ root, deployment, prune, env }) => {
      const runtime = writePackage(root, 'runtime', {
        dependencies: { '@lark-apaas/nestjs-capability': '^0.1.14' },
        optionalDependencies: { 'missing-optional': '1', 'present-optional': '1' },
        peerDependencies: { rxjs: '^7', '@nestjs/platform-express': '^10', 'optional-peer': '*' },
        peerDependenciesMeta: { 'optional-peer': { optional: true } },
      }, 'exports.load = name => require(name);');
      const capability = writePackage(runtime, '@lark-apaas/nestjs-capability', {
        version: '0.1.14', dependencies: { deep: '1' },
      }, 'module.exports = { version: "0.1.14", deep: require("deep") };');
      writePackage(capability, 'deep', {}, 'module.exports = "nested-deep";');
      if (rootCapability) writePackage(root, '@lark-apaas/nestjs-capability', { version: '9.0.0' });
      writePackage(root, 'rxjs', { version: '7.8.2' }, 'module.exports = "rxjs-7";');
      writePackage(root, '@nestjs/platform-express', { version: '10.4.22' }, 'module.exports = "express-10";');
      writePackage(root, 'optional-peer');
      writePackage(root, 'present-optional');
      writePackage(root, 'unused-dev');
      writePackage(root, '@official-plugins/synthetic', {
        dependencies: { 'plugin-dependency': '1' }, peerDependencies: { 'plugin-peer': '1' },
      });
      writePackage(root, 'plugin-dependency');
      writePackage(root, 'plugin-peer');
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      manifest.actionPlugins = { '@official-plugins/synthetic': '1.0.0' };
      writeJson(join(root, 'package.json'), manifest);
      symlinkSync('.', join(root, 'node_modules/node_modules'), 'dir');
      writeFileSync(join(root, 'dist/server/main.js'), [
        'const runtime = require("runtime");',
        'console.log(JSON.stringify([runtime.load("rxjs"),',
        'runtime.load("@lark-apaas/nestjs-capability"),runtime.load("@nestjs/platform-express")]));',
      ].join('\n'));
      const result = prune();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const output = join(root, 'dist/node_modules');
      for (const name of ['rxjs', '@nestjs/platform-express', 'present-optional', '@official-plugins/synthetic',
        'plugin-dependency', 'plugin-peer']) assert.ok(existsSync(join(output, name, 'package.json')), name);
      for (const name of ['node_modules', 'optional-peer', 'unused-dev', '@vercel/nft',
        '@lark-apaas/nestjs-capability']) assert.equal(existsSync(join(output, name)), false, name);
      const nested = join(output, 'runtime/node_modules/@lark-apaas/nestjs-capability');
      assert.equal(JSON.parse(readFileSync(join(nested, 'package.json'), 'utf8')).version, '0.1.14');
      assert.ok(existsSync(join(nested, 'node_modules/deep/package.json')));
      const pruned = JSON.parse(readFileSync(join(root, 'dist/package.json'), 'utf8'));
      assert.deepEqual(pruned.dependencies, {
        runtime: '1.0.0', rxjs: '7.8.2', '@nestjs/platform-express': '10.4.22',
        '@official-plugins/synthetic': '1.0.0',
      });
      assert.deepEqual(pruned.engines, manifest.engines);
      cpSync(join(root, 'dist'), deployment, { recursive: true });
      // Actual Node execution cannot borrow any file from the deleted installation.
      rmSync(root, { recursive: true, force: true });
      const execution = spawnSync(process.execPath, [join(deployment, 'server/main.js')], {
        cwd: deployment, env, encoding: 'utf8', timeout: 5_000,
      });
      assert.equal(execution.status, 0, execution.stderr);
      assert.deepEqual(JSON.parse(execution.stdout), [
        'rxjs-7', { version: '0.1.14', deep: 'nested-deep' }, 'express-10',
      ]);
    }));
}

test('an optional peer actually selected by NFT remains packaged', () => withFixture(({ root, prune }) => {
  writePackage(root, 'runtime', {
    peerDependencies: { 'optional-peer': '*' }, peerDependenciesMeta: { 'optional-peer': { optional: true } },
  }, 'module.exports = require("optional-peer");');
  writePackage(root, 'optional-peer');
  const result = prune();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(existsSync(join(root, 'dist/node_modules/optional-peer/package.json')));
}));

test('NFT-selected nested packages below a package subdirectory keep the exact lookup path', () =>
  withFixture(({ root, prune, deployment, env }) => {
    const runtime = writePackage(root, 'runtime', {}, 'module.exports = require("./lib/use");');
    mkdirSync(join(runtime, 'lib'));
    writeFileSync(join(runtime, 'lib/use.js'), 'module.exports = require("inner");');
    writePackage(join(runtime, 'lib'), 'inner', {}, 'module.exports = "subdirectory-inner";');
    const result = prune();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(existsSync(join(root, 'dist/node_modules/runtime/lib/node_modules/inner/package.json')));
    assert.equal(existsSync(join(root, 'dist/node_modules/inner')), false);
    cpSync(join(root, 'dist'), deployment, { recursive: true });
    rmSync(root, { recursive: true, force: true });
    const execution = spawnSync(process.execPath, ['-e', 'console.log(require("runtime"))'], {
      cwd: deployment, env, encoding: 'utf8', timeout: 5_000,
    });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout.trim(), 'subdirectory-inner');
  }));

for (const declaration of ['dependencies', 'peerDependencies']) {
  test(`missing selected ${declaration} fails rather than borrowing an ancestor or skipping`, () =>
    withFixture(({ root, prune }) => {
      writePackage(root, 'runtime', { [declaration]: { 'missing-required': '1' } });
      const result = prune();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /缺少必需运行依赖: runtime -> missing-required/u);
      assert.equal(existsSync(join(root, 'dist/package.json')), false);
    }));
}

test('bad selected package metadata fails instead of silently omitting its dependency closure', () =>
  withFixture(({ root, prune }) => {
    const runtime = writePackage(root, 'runtime', { dependencies: { broken: '1' } });
    const broken = writePackage(runtime, 'broken');
    writeFileSync(join(broken, 'package.json'), '{ invalid-json');
    const result = prune();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /SyntaxError/u);
    assert.equal(existsSync(join(root, 'dist/package.json')), false);
  }));

test('copy errors are fatal for a real unsupported filesystem entry', () =>
  withFixture(async ({ root, prune }) => {
    const socket = join(root, 'node_modules/runtime/s');
    const server = createServer();
    server.listen(socket);
    await once(server, 'listening');
    try {
      const result = prune();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /复制必需运行依赖失败: runtime/u);
      assert.match(result.stderr, /非普通文件/u);
      assert.equal(existsSync(join(root, 'dist/package.json')), false);
    } finally {
      await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
    }
  }));

for (const kind of ['file', 'directory']) {
  test(`copied ${kind} links may materialize cross-package assets inside the installed root`, () =>
    withFixture(({ root, prune }) => {
      const owner = writePackage(root, 'asset-owner');
      const target = join(owner, 'linked-asset');
      if (kind === 'directory') mkdirSync(target);
      writeFileSync(kind === 'directory' ? join(target, 'value') : target, 'asset-content');
      symlinkSync(
        '../asset-owner/linked-asset', join(root, 'node_modules/runtime/asset'),
        kind === 'directory' ? 'dir' : 'file',
      );
      const result = prune();
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const output = join(root, 'dist/node_modules/runtime/asset');
      assert.equal(lstatSync(output).isSymbolicLink(), false);
      const value = kind === 'directory' ? join(output, 'value') : output;
      assert.equal(readFileSync(value, 'utf8'), 'asset-content');
    }));

  test(`copied ${kind} links outside the actual installed root fail before producing a successful package`, () =>
    withFixture(({ root, prune }) => {
      const target = join(root, 'linked-asset');
      if (kind === 'directory') mkdirSync(target);
      writeFileSync(kind === 'directory' ? join(target, 'value') : target, 'outside-content');
      symlinkSync(
        '../../linked-asset', join(root, 'node_modules/runtime/asset'),
        kind === 'directory' ? 'dir' : 'file',
      );
      const result = prune();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /复制必需运行依赖失败: runtime/u);
      assert.match(result.stderr, /运行依赖复制来源越出安装目录/u);
      assert.equal(existsSync(join(root, 'dist/package.json')), false);
    }));
}

test('declared runtime entries retain source-root and extension mapping', () => withFixture(({ root, prune }) => {
  writePackage(root, 'dynamic-runtime');
  mkdirSync(join(root, 'dist/server/runtime'));
  writeFileSync(join(root, 'dist/server/runtime/entry.js'), 'require("dynamic-runtime");');
  const result = prune({ MIAODA_RUNTIME_ENTRIES: 'server/runtime/entry.ts' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(existsSync(join(root, 'dist/node_modules/dynamic-runtime/package.json')));
}));

test('an external node_modules root fails before NFT can report a false empty closure', () =>
  withFixture(({ root, deployment, prune }) => {
    cpSync(join(root, 'node_modules'), join(deployment, 'node_modules'), { recursive: true });
    rmSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(join(deployment, 'node_modules'), join(root, 'node_modules'), 'dir');
    const result = prune();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /node_modules 实际路径在 NFT base 之外/u);
    assert.equal(existsSync(join(root, 'dist/package.json')), false);
  }));
