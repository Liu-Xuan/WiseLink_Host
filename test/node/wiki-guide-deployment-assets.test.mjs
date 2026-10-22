import assert from 'node:assert/strict';
import {
  copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, rmSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';

// An existing complete build can be selected without building or altering it.
const build = resolve(process.env.WISELINK_DEPLOYMENT_DIST || 'dist');
const modulePath = 'server/modules/canonical-host/hierarchical-wiki-navigation.js';
const assetPath = 'server/runtime-assets/wiki-guide/library-ata-titles.generated.json';

function within(root, path) {
  const name = relative(root, path);
  return !isAbsolute(name) && name !== '..' && !name.startsWith('..' + sep);
}

/** One physical copy of the actual pruned dependencies, never the source tree.
 * Internal links are materialized; external, dangling or cyclic links fail. */
function copyDependencies(sourceRoot, destinationRoot) {
  function copyEntry(source, destination, ancestors) {
    let actual = source;
    let info = lstatSync(source);
    if (info.isSymbolicLink()) {
      actual = realpathSync(source);
      assert(within(sourceRoot, actual),
        `Deployment dependency link escapes packaged node_modules: ${relative(sourceRoot, source)}`);
      info = statSync(actual);
    }
    if (info.isDirectory()) {
      assert(!ancestors.has(actual),
        `Cyclic deployment dependency link: ${relative(sourceRoot, source)}`);
      const next = new Set(ancestors); next.add(actual);
      mkdirSync(destination, { recursive: true });
      for (const name of readdirSync(actual)) copyEntry(join(actual, name), join(destination, name), next);
      return;
    }
    assert(info.isFile(), `Unsupported deployment dependency entry: ${relative(sourceRoot, source)}`);
    try { linkSync(actual, destination); }
    catch (error) {
      if (!['EXDEV', 'EPERM', 'ENOTSUP'].includes(error.code)) throw error;
      copyFileSync(actual, destination);
    }
  }
  copyEntry(sourceRoot, destinationRoot, new Set());
}

describe('physical server-only deployment layout', { concurrency: false }, () => {
  let root;
  before(() => {
    const packagedRoot = realpathSync(build);
    for (const name of [modulePath, assetPath, 'package.json']) {
      const file = join(packagedRoot, name);
      assert(lstatSync(file).isFile() && within(packagedRoot, realpathSync(file)),
        `A complete build must contain a regular packaged file: ${name}`);
    }
    const dependencies = join(packagedRoot, 'node_modules');
    assert(lstatSync(dependencies).isDirectory(), 'Packaged node_modules must be a real directory');
    root = realpathSync(mkdtempSync(join(tmpdir(), 'wiselink-guide-deployment-')));
    copyDependencies(dependencies, join(root, 'node_modules'));
    for (const name of [modulePath, assetPath, 'package.json']) {
      const destination = join(root, name);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(packagedRoot, name), destination);
    }
    assert.equal(existsSync(join(root, 'client')), false);
  });
  after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  function run(body) {
    const script = `
      const assert = require('node:assert/strict');
      const { realpathSync } = require('node:fs');
      const { dirname, isAbsolute, join, relative, sep } = require('node:path');
      const { createRequire } = require('node:module');
      const root = process.argv[1];
      assert.equal(process.env.NODE_PATH, undefined);
      assert.equal(process.env.NODE_OPTIONS, undefined);
      assert.equal(process.permission.has('fs.read', root), true);
      assert.equal(process.permission.has('fs.read', dirname(root)), false);
      const load = createRequire(join(root, ${JSON.stringify(modulePath)}));
      let result;
      ${body}
      const loaded = Object.keys(require.cache).map(file => realpathSync(file));
      for (const file of loaded) {
        const name = relative(root, file);
        assert(!isAbsolute(name) && name !== '..' && !name.startsWith('..' + sep),
          'Loaded a module outside the independent deployment: ' + file);
      }
      process.stdout.write(JSON.stringify({ ...result, loadedModuleCount: loaded.length }));
    `;
    // Standard Node permissions also prevent ancestor/global dependencies from
    // filling a missing peer. No preload, loader hook, NODE_PATH or source mount.
    const result = spawnSync(process.execPath, [
      '--permission', '--allow-fs-read=' + root, '--no-global-search-paths', '-e', script, root,
    ], { cwd: root, env: { NODE_ENV: 'production' }, encoding: 'utf8', timeout: 30_000 });
    if (result.error) throw result.error;
    return result;
  }

  it('loads the actual Nest runtime peer and default Express adapter entirely inside the package', () => {
    const result = run(`
      const common = createRequire(load.resolve('@nestjs/common/serializer/class-serializer.interceptor.js'));
      const operators = common('rxjs/operators');
      assert.equal(typeof operators.map, 'function');
      const factory = createRequire(load.resolve('@nestjs/core/nest-factory.js'));
      assert.equal(typeof factory('@nestjs/platform-express').ExpressAdapter, 'function');
      result = { rxjs: relative(root, common.resolve('rxjs/operators')),
        adapter: relative(root, factory.resolve('@nestjs/platform-express')) };
    `);
    assert.equal(result.status, 0, result.stderr);
    const loaded = JSON.parse(result.stdout);
    assert(loaded.rxjs.startsWith('node_modules' + sep));
    assert(loaded.adapter.startsWith('node_modules' + sep));
    assert(loaded.loadedModuleCount > 0);
  });

  it('without a client directory loads its actual packaged bilingual ATA catalogue', () => {
    const result = run(`
      const navigation = load(join(root, ${JSON.stringify(modulePath)}));
      result = { titles: [navigation.wikiGuideChapterTitleCodes('记录'),
        navigation.wikiGuideChapterTitleCodes('Control Panels')] };
    `);
    assert.equal(result.status, 0, result.stderr);
    const { titles: [chinese, english], loadedModuleCount } = JSON.parse(result.stdout);
    assert(chinese.ata2.includes('31'));
    assert(english.ata4.includes('31-10'));
    assert(loadedModuleCount > 0);
    assert.deepEqual(readFileSync(join(root, assetPath)),
      readFileSync('client/src/pages/WorkspaceHomePage/library-ata-titles.generated.json'));
  });

  it('missing deployment catalogue fails explicitly instead of returning an empty chapter search', () => {
    rmSync(join(root, assetPath));
    try {
      const result = run(`load(join(root, ${JSON.stringify(modulePath)}));`);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /WIKI_GUIDE_RUNTIME_ASSET_NOT_PACKAGED:library-ata-titles\.generated\.json/u);
    } finally { copyFileSync(join(build, assetPath), join(root, assetPath)); }
  });
});
