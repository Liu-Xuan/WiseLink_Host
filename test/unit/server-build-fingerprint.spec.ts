import { execFileSync, spawnSync } from 'node:child_process';
import { Logger } from '@nestjs/common';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

jest.mock('../../server/runtime/u0-python/hosted-u0-python-runtime', () => ({
  resolveHostedU0PythonRuntime: jest
    .fn()
    .mockRejectedValue(new Error('NOT_RUN_IN_FINGERPRINT_TEST')),
}));

import {
  readServerBuildFingerprint,
  RuntimeProbeService,
} from '../../server/modules/runtime-probe/runtime-probe.service';

const temporary: string[] = [];
const moduleUrl = pathToFileURL(
  resolve(__dirname, '../../scripts/sync-document-management-assets.mjs'),
).href;
const valid = {
  schemaVersion: 'wiselink.server-build-fingerprint.v1',
  sourceCommit: 'a'.repeat(40),
  buildTime: '2026-10-11T15:43:14.985Z',
};
const unavailable = {
  deployedCommit: 'UNAVAILABLE',
  serverBuildTime: 'UNAVAILABLE',
  fingerprintSource: 'UNAVAILABLE',
};
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'wiselink-build-fingerprint-'));
  temporary.push(path);
  return path;
}
function stamp(root: string) {
  return join(
    root,
    'dist/server/runtime-assets/host-build/build-fingerprint.json',
  );
}
function runWriter(
  root: string,
  environment: NodeJS.ProcessEnv = {},
  requireProvenance = false,
) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'const {writeServerBuildFingerprint}=await import(process.argv[1]); console.log(JSON.stringify(await writeServerBuildFingerprint(process.argv[2], { requireProvenance: process.argv[3] === "true" })));',
        moduleUrl,
        root,
        String(requireProvenance),
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...environment },
      },
    ),
  );
}
function strictWriterProcess(
  root: string,
  environment: NodeJS.ProcessEnv = {},
) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'const {writeServerBuildFingerprint}=await import(process.argv[1]); try { await writeServerBuildFingerprint(process.argv[2], {requireProvenance:true}); } catch(error) { if(error.code!=="SERVER_BUILD_PROVENANCE_REQUIRED") throw error; process.exitCode=1; }',
      moduleUrl,
      root,
    ],
    { encoding: 'utf8', env: { ...process.env, ...environment } },
  );
}
function git(root: string, args: string[]) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function repository() {
  const root = directory();
  git(root, ['init', '--quiet']);
  writeFileSync(join(root, '.gitignore'), 'dist/\n');
  writeFileSync(join(root, 'source.txt'), 'synthetic source\n');
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=Synthetic',
    '-c',
    'user.email=synthetic@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'Synthetic source',
  ]);
  return root;
}
beforeEach(() =>
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
);
afterEach(() => jest.restoreAllMocks());
afterAll(() =>
  temporary.forEach((path) => rmSync(path, { recursive: true, force: true })),
);

describe('server build artifact fingerprint', () => {
  it('reads a valid packaged stamp without deriving anything from the current checkout', async () => {
    const root = repository();
    const metadata = runWriter(root);
    const buildCommit = git(root, ['rev-parse', 'HEAD']);
    expect(metadata.sourceCommit).toBe(buildCommit);
    expect(new Date(metadata.buildTime).toISOString()).toBe(metadata.buildTime);
    writeFileSync(join(root, 'source.txt'), 'later runtime checkout\n');
    git(root, ['add', '.']);
    git(root, [
      '-c',
      'user.name=Synthetic',
      '-c',
      'user.email=synthetic@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Later checkout',
    ]);
    expect(git(root, ['rev-parse', 'HEAD'])).not.toBe(buildCommit);
    await expect(readServerBuildFingerprint(stamp(root))).resolves.toEqual({
      deployedCommit: buildCommit,
      serverBuildTime: metadata.buildTime,
      fingerprintSource: 'SERVER_BUILD_ARTIFACT',
    });
    expect(
      readdirSync(join(root, 'dist/server/runtime-assets/host-build')),
    ).toEqual(['build-fingerprint.json']);
  });

  it('accepts a clean checkout in required-provenance mode', () => {
    const root = repository();
    const metadata = runWriter(root, {}, true);
    expect(metadata.sourceCommit).toBe(git(root, ['rev-parse', 'HEAD']));
    expect(Object.keys(metadata).sort()).toEqual([
      'buildTime',
      'schemaVersion',
      'sourceCommit',
    ]);
    expect(JSON.parse(readFileSync(stamp(root), 'utf8'))).toEqual(metadata);
  });

  it.each(['tracked', 'untracked'])(
    'fails the strict build subprocess after explicitly replacing the stamp for %s changes',
    (kind) => {
      const root = repository();
      expect(runWriter(root).sourceCommit).not.toBe('UNAVAILABLE');
      writeFileSync(
        join(
          root,
          kind === 'tracked' ? 'source.txt' : 'private-secret-file.txt',
        ),
        'PRIVATE_SOURCE_MUST_NOT_LEAK',
      );
      const result = strictWriterProcess(root);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        'SERVER_BUILD_FINGERPRINT:GIT_WORKTREE_DIRTY\n',
      );
      expect(JSON.parse(readFileSync(stamp(root), 'utf8'))).toEqual({
        schemaVersion: valid.schemaVersion,
        sourceCommit: 'UNAVAILABLE',
        buildTime: 'UNAVAILABLE',
      });
    },
  );

  it('reports redirect presence without printing the environment value or checkout path', () => {
    const root = repository();
    const result = strictWriterProcess(root, {
      GIT_CONFIG_GLOBAL: '/private/SENSITIVE_CONFIGURATION_PATH',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      'SERVER_BUILD_FINGERPRINT:GIT_ENVIRONMENT_REDIRECT_PRESENT\n',
    );
    expect(result.stderr).not.toContain(root);
  });

  it('distinguishes unavailable repository facts from a missing Git executable', () => {
    const root = directory();
    const noRepository = strictWriterProcess(root);
    expect(noRepository.status).toBe(1);
    expect(noRepository.stderr).toBe(
      'SERVER_BUILD_FINGERPRINT:GIT_ROOT_UNAVAILABLE\n',
    );
    const missingGit = strictWriterProcess(root, { PATH: directory() });
    expect(missingGit.status).toBe(1);
    expect(missingGit.stderr).toBe(
      'SERVER_BUILD_FINGERPRINT:GIT_EXECUTABLE_MISSING\n',
    );
  });

  it.each([
    ['OVERSIZED', ' '.repeat(1025)],
    ['INVALID_JSON', 'PRIVATE_INVALID_JSON'],
    [
      'INVALID_SCHEMA',
      JSON.stringify({ ...valid, privateData: 'PRIVATE_VALUE' }),
    ],
    [
      'PROVENANCE_UNAVAILABLE',
      JSON.stringify({
        schemaVersion: valid.schemaVersion,
        sourceCommit: 'UNAVAILABLE',
        buildTime: 'UNAVAILABLE',
      }),
    ],
  ])('logs only the fixed reader category %s', async (reason, content) => {
    const path = join(directory(), 'private-artifact-path.json');
    writeFileSync(path, content);
    await expect(readServerBuildFingerprint(path)).resolves.toEqual(
      unavailable,
    );
    expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      `SERVER_BUILD_FINGERPRINT:${reason}`,
    );
  });

  it.each([
    ['ENOENT', 'MISSING'],
    ['EACCES', 'READ_FAILED'],
  ])(
    'classifies read error %s without logging its private message or path',
    async (code, reason) => {
      jest
        .spyOn(files, 'readFile')
        .mockRejectedValueOnce(
          Object.assign(new Error('PRIVATE_URL_TOKEN_AND_PATH'), { code }),
        );
      await expect(
        readServerBuildFingerprint('/private/SENSITIVE_PATH'),
      ).resolves.toEqual(unavailable);
      expect(Logger.prototype.warn).toHaveBeenCalledTimes(1);
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        `SERVER_BUILD_FINGERPRINT:${reason}`,
      );
    },
  );

  it.each(['tracked', 'untracked'])(
    'writes explicit unavailable for a %s dirty build and replaces an old stamp',
    async (kind) => {
      const root = repository();
      expect(runWriter(root).sourceCommit).not.toBe('UNAVAILABLE');
      writeFileSync(
        join(root, kind === 'tracked' ? 'source.txt' : 'new-source.txt'),
        'changed source\n',
      );
      expect(runWriter(root)).toEqual({
        schemaVersion: valid.schemaVersion,
        sourceCommit: 'UNAVAILABLE',
        buildTime: 'UNAVAILABLE',
      });
      await expect(readServerBuildFingerprint(stamp(root))).resolves.toEqual(
        unavailable,
      );
    },
  );

  it('rejects a dirty build redirected to a different clean repository by Git environment', async () => {
    const root = repository();
    const foreign = repository();
    writeFileSync(join(root, 'source.txt'), 'dirty actual build source\n');
    writeFileSync(join(foreign, 'source.txt'), 'foreign clean source\n');
    git(foreign, ['add', '.']);
    git(foreign, [
      '-c',
      'user.name=Synthetic',
      '-c',
      'user.email=synthetic@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Foreign source',
    ]);
    expect(git(root, ['status', '--porcelain=v1'])).not.toBe('');
    expect(git(foreign, ['status', '--porcelain=v1'])).toBe('');
    expect(git(root, ['rev-parse', 'HEAD'])).not.toBe(
      git(foreign, ['rev-parse', 'HEAD']),
    );
    expect(
      runWriter(root, {
        GIT_DIR: join(foreign, '.git'),
        GIT_WORK_TREE: foreign,
      }),
    ).toEqual({
      schemaVersion: valid.schemaVersion,
      sourceCommit: 'UNAVAILABLE',
      buildTime: 'UNAVAILABLE',
    });
    await expect(readServerBuildFingerprint(stamp(root))).resolves.toEqual(
      unavailable,
    );
  });

  it.each([
    ['alternate index', { GIT_INDEX_FILE: '.git/index' }],
    [
      'counted config',
      {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.ignorestat',
        GIT_CONFIG_VALUE_0: 'true',
      },
    ],
    ['config parameters', { GIT_CONFIG_PARAMETERS: "'core.ignorestat=true'" }],
    ['global config file', { GIT_CONFIG_GLOBAL: '.git/config' }],
  ])(
    'rejects %s environment rather than accepting influenced Git facts',
    async (_name, environment) => {
      const root = repository();
      expect(runWriter(root, environment)).toEqual({
        schemaVersion: valid.schemaVersion,
        sourceCommit: 'UNAVAILABLE',
        buildTime: 'UNAVAILABLE',
      });
      await expect(readServerBuildFingerprint(stamp(root))).resolves.toEqual(
        unavailable,
      );
    },
  );

  it('does not use a clean parent repository as the build root', async () => {
    const parent = repository();
    const root = join(parent, 'nested-build');
    mkdirSync(root);
    expect(git(parent, ['status', '--porcelain=v1'])).toBe('');
    expect(runWriter(root).sourceCommit).toBe('UNAVAILABLE');
    await expect(readServerBuildFingerprint(stamp(root))).resolves.toEqual(
      unavailable,
    );
  });

  it('rejects a repository-local core.worktree redirect whose physical top level differs', async () => {
    const root = repository();
    const foreign = repository();
    git(root, ['config', 'core.worktree', foreign]);
    expect(runWriter(root).sourceCommit).toBe('UNAVAILABLE');
    await expect(readServerBuildFingerprint(stamp(root))).resolves.toEqual(
      unavailable,
    );
  });

  it('accepts an ordinary clean Git worktree with a .git file bound to the build root', async () => {
    const original = repository();
    const root = directory();
    git(original, ['worktree', 'add', '--detach', '--quiet', root, 'HEAD']);
    expect(readFileSync(join(root, '.git'), 'utf8')).toMatch(/^gitdir: /u);
    const metadata = runWriter(root);
    expect(metadata.sourceCommit).toBe(git(original, ['rev-parse', 'HEAD']));
    await expect(readServerBuildFingerprint(stamp(root))).resolves.toEqual({
      deployedCommit: metadata.sourceCommit,
      serverBuildTime: metadata.buildTime,
      fingerprintSource: 'SERVER_BUILD_ARTIFACT',
    });
  });

  it('writes explicit unavailable when the build checkout has no git provenance', async () => {
    const root = directory();
    expect(runWriter(root)).toEqual({
      schemaVersion: valid.schemaVersion,
      sourceCommit: 'UNAVAILABLE',
      buildTime: 'UNAVAILABLE',
    });
    await expect(readServerBuildFingerprint(stamp(root))).resolves.toEqual(
      unavailable,
    );
  });

  it('propagates an asset write failure as a nonzero build step', () => {
    const root = repository();
    mkdirSync(stamp(root), { recursive: true });
    writeFileSync(join(stamp(root), 'cannot-replace.txt'), 'synthetic blocker');
    expect(() => runWriter(root)).toThrow();
    expect(
      readdirSync(join(root, 'dist/server/runtime-assets/host-build')),
    ).toEqual(['build-fingerprint.json']);
  });

  it('does not substitute runtime deployment env for either valid or absent metadata in the actual probe response', async () => {
    const old = new Map(
      ['MIAODA_DEPLOYED_COMMIT', 'GIT_COMMIT', 'COMMIT_SHA'].map((key) => [
        key,
        process.env[key],
      ]),
    );
    const actualRead = files.readFile;
    let metadata: unknown = valid;
    jest.spyOn(files, 'readFile').mockImplementation(((
      path: unknown,
      ...args: unknown[]
    ) => {
      if (String(path).endsWith('/host-build/build-fingerprint.json')) {
        if (metadata === null)
          return Promise.reject(new Error('SYNTHETIC_PRIVATE_ERROR_URL_TOKEN'));
        return Promise.resolve(Buffer.from(JSON.stringify(metadata)));
      }
      return (actualRead as (...args: unknown[]) => unknown)(path, ...args);
    }) as typeof files.readFile);
    try {
      for (const key of old.keys())
        process.env[key] = 'runtime-env-must-not-become-source';
      const response = await new RuntimeProbeService().probe();
      expect(response).toMatchObject({
        deployedCommit: valid.sourceCommit,
        serverBuildTime: valid.buildTime,
        fingerprintSource: 'SERVER_BUILD_ARTIFACT',
      });
      expect(response.authority).toEqual({
        businessWriteAuthorized: false,
        artifactPersistAuthorized: false,
        baseRecordWriteAuthorized: false,
        publicationDecisionCreated: false,
      });
      expect(response.selectedContract.contractRevision).toBe('frozen.2');
      expect(Object.keys(response.checks)).toHaveLength(7);
      expect(response).not.toHaveProperty('releaseId');
      metadata = null;
      const missing = await new RuntimeProbeService().probe();
      expect(missing).toMatchObject(unavailable);
      expect(JSON.stringify(missing)).not.toContain(
        'SYNTHETIC_PRIVATE_ERROR_URL_TOKEN',
      );
      expect(JSON.stringify(missing)).not.toContain(
        'runtime-env-must-not-become-source',
      );
    } finally {
      for (const [key, value] of old) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('keeps missing metadata explicitly unavailable', async () => {
    await expect(
      readServerBuildFingerprint(join(directory(), 'missing.json')),
    ).resolves.toEqual(unavailable);
  });

  it.each([
    ['broken JSON', '{'],
    ['array', '[]'],
    ['extra field', JSON.stringify({ ...valid, releaseId: 'unproven' })],
    ['wrong schema', JSON.stringify({ ...valid, schemaVersion: 'other' })],
    [
      'invalid commit',
      JSON.stringify({ ...valid, sourceCommit: 'A'.repeat(40) }),
    ],
    [
      'invalid calendar date',
      JSON.stringify({ ...valid, buildTime: '2026-02-30T00:00:00.000Z' }),
    ],
    [
      'noncanonical time zone',
      JSON.stringify({ ...valid, buildTime: '2026-10-11T15:43:14.985+00:00' }),
    ],
    ['oversized metadata', ' '.repeat(1025)],
  ])('keeps %s metadata unavailable', async (_name, content) => {
    const path = join(directory(), 'metadata.json');
    writeFileSync(path, content);
    await expect(readServerBuildFingerprint(path)).resolves.toEqual(
      unavailable,
    );
  });
});
