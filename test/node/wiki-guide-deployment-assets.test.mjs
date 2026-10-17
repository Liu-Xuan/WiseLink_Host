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
    copyDependencies(join(packagedRoot, 'server'), join(root, 'server'));
    if (existsSync(join(packagedRoot, 'shared')))
      copyDependencies(join(packagedRoot, 'shared'), join(root, 'shared'));
    copyFileSync(join(packagedRoot, 'package.json'), join(root, 'package.json'));
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
      (async () => {
        let result;
        ${body}
        const loaded = Object.keys(require.cache).map(file => realpathSync(file));
        for (const file of loaded) {
          const name = relative(root, file);
          assert(!isAbsolute(name) && name !== '..' && !name.startsWith('..' + sep),
            'Loaded a module outside the independent deployment: ' + file);
        }
        process.stdout.write(JSON.stringify({ ...result, loadedModuleCount: loaded.length }));
      })().catch(error => { console.error(error); process.exitCode = 1; });
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

  it('starts packaged correction routes over HTTP and rejects unavailable native identity without writing', () => {
    const result = run(`
      load('reflect-metadata');
      const { Controller, Get, Module } = load('@nestjs/common');
      const { NestFactory } = load('@nestjs/core');
      const { CanonicalJobAidWorkCorrectionController: ProductController } = load(join(root,
        'server/modules/canonical-host/canonical-jobaid-work-correction.controller.js'));
      const { CanonicalJobAidWorkCorrectionService: ProductService } = load(join(root,
        'server/modules/canonical-host/canonical-jobaid-work-correction.service.js'));
      const { DialogueBrowserScope } = load(join(root,
        'server/modules/canonical-host/dialogue-browser-scope.service.js'));
      const { DocumentReadingRequestConflict } = load(join(root,
        'server/modules/canonical-host/document-reading-request-conflict.js'));
      const { GlobalExceptionFilter } = load(join(root, 'server/common/filters/exception.filter.js'));
      let businessCalls = 0;
      const denyBusiness = () => { businessCalls++; throw new Error('UNEXPECTED_ENGINEERING_CALL'); };
      class ProbeController {
        conflict() { throw new DocumentReadingRequestConflict({ tenantId: 'probe-tenant',
          actorUserId: 'probe-actor', documentVersionId: 'probe-document', requestId: 'probe-request' }); }
      }
      Controller('probe')(ProbeController);
      Get('reading-conflict')(ProbeController.prototype, 'conflict',
        Object.getOwnPropertyDescriptor(ProbeController.prototype, 'conflict'));
      class ProbeModule {}
      Module({ controllers: [ProductController, ProbeController], providers: [
        { provide: ProductService, useValue: { save: denyBusiness, read: denyBusiness } },
        { provide: DialogueBrowserScope, useValue: { run: denyBusiness } },
      ] })(ProbeModule);
      const app = await NestFactory.create(ProbeModule, { logger: false });
      try {
        app.useGlobalFilters(new GlobalExceptionFilter());
        await app.listen(0, '127.0.0.1');
        const base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
        const route = '/api/canonical-host/work-items/WI-probe/assessment-work/corrections';
        for (const [path, init] of [[route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }],
          [route + '/request-probe', { method: 'GET' }]]) {
          const response = await fetch(base + path, init);
          const body = await response.json();
          assert.equal(response.status, 503, JSON.stringify(body));
          assert.equal(body.error.code, 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE');
        }
        const response = await fetch(base + '/probe/reading-conflict');
        assert.equal(response.status, 409);
        assert.equal((await response.json()).error.code, 'DOCUMENT_READING_REQUEST_CONFLICT');
        assert.equal(businessCalls, 0);
        result = { actualCorrectionRoutes: ['POST', 'GET'], nativeIdentityUnavailable: 503,
          compiledConflictAndFilterStatus: 409, businessCalls, provider: 'DENY_ONLY_FIXTURE' };
      } finally { await app.close(); }
    `);
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(result.stdout);
    assert.deepEqual(proof.actualCorrectionRoutes, ['POST', 'GET']);
    assert.equal(proof.businessCalls, 0);
    assert(proof.loadedModuleCount > 0);
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
