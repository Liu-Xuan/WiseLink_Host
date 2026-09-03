#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '..');
export const SKILL_SLUG = 'wiselink-research-and-synthesize';
export const SKILL_ROOT_RELATIVE = `openclaw/skills/${SKILL_SLUG}`;
export const SKILL_ROOT = join(REPOSITORY_ROOT, SKILL_ROOT_RELATIVE);
export const HOST_POLICY_RELATIVE =
  'server/modules/canonical-host/canonical-host-openclaw-runtime-policy.ts';
export const PUBLISHER_RELATIVE =
  'scripts/package-wiselink-openclaw-skill.mjs';

const FULL_VERSION_PATTERN = /wiselink-research-and-synthesize@r09\.c\d+/gu;
const PROMPT_VERSION_PATTERN = /Skill r09\.c\d+\/MCP 1\.2\.0/gu;
const VALIDATOR_VERSION_PATTERN =
  /WISELINK_SKILL_VERSION\s*=\s*'(wiselink-research-and-synthesize@r09\.c\d+)'/u;
const VALIDATOR_COMPATIBILITY_PATTERN =
  /WISELINK_SKILL_COMPATIBILITY_REF\s*=\s*\n?\s*'(wiselink-research-and-synthesize@r09)'/u;
const HOST_COMPATIBILITY_PATTERN =
  /skillCompatibilityRef:\s*'(wiselink-research-and-synthesize@r09)'/u;
const HOST_MINIMUM_VERSION_PATTERN =
  /minimumCompatibleSkillVersion:\s*\n?\s*'(wiselink-research-and-synthesize@r09\.c\d+)'/u;

export async function inspectPublishLiteSource() {
  const files = await listRegularFiles(SKILL_ROOT);
  const validatorPath = join(SKILL_ROOT, 'scripts/validate-payload.mjs');
  const validator = await readFile(validatorPath, 'utf8');
  const versionMatch = validator.match(VALIDATOR_VERSION_PATTERN);
  if (!versionMatch) {
    throw new Error('SKILL_VERSION_DECLARATION_MISSING');
  }
  const version = versionMatch[1];
  const compatibilityMatch = validator.match(VALIDATOR_COMPATIBILITY_PATTERN);
  if (!compatibilityMatch) {
    throw new Error('SKILL_COMPATIBILITY_DECLARATION_MISSING');
  }
  const compatibilityRef = compatibilityMatch[1];
  const versionSuffix = version.split('@').at(-1);
  const claims = [];

  for (const path of files) {
    const contents = await readFile(path, 'utf8');
    for (const claim of contents.match(FULL_VERSION_PATTERN) ?? []) {
      claims.push({ path: relative(SKILL_ROOT, path), claim });
      if (claim !== version) {
        throw new Error(
          `SKILL_VERSION_DRIFT:${relative(SKILL_ROOT, path)}:${claim}:${version}`,
        );
      }
    }
    for (const claim of contents.match(PROMPT_VERSION_PATTERN) ?? []) {
      claims.push({ path: relative(SKILL_ROOT, path), claim });
      if (claim !== `Skill ${versionSuffix}/MCP 1.2.0`) {
        throw new Error(
          `SKILL_PROMPT_VERSION_DRIFT:${relative(SKILL_ROOT, path)}:${claim}:${versionSuffix}`,
        );
      }
    }
  }

  const hostPolicy = await readFile(
    join(REPOSITORY_ROOT, HOST_POLICY_RELATIVE),
    'utf8',
  );
  const hostCompatibilityRef = hostPolicy.match(
    HOST_COMPATIBILITY_PATTERN,
  )?.[1];
  const minimumCompatibleSkillVersion = hostPolicy.match(
    HOST_MINIMUM_VERSION_PATTERN,
  )?.[1];
  if (hostCompatibilityRef !== compatibilityRef) {
    throw new Error(
      `HOST_SKILL_COMPATIBILITY_DRIFT:${hostCompatibilityRef ?? 'missing'}:${compatibilityRef}`,
    );
  }
  assertCompatibleVersion(
    version,
    compatibilityRef,
    minimumCompatibleSkillVersion,
  );
  if (!claims.some(({ path }) => path === 'agents/openai.yaml')) {
    throw new Error('SKILL_PROMPT_VERSION_DECLARATION_MISSING');
  }

  return {
    slug: SKILL_SLUG,
    version,
    compatibilityRef,
    minimumCompatibleSkillVersion,
    fileCount: files.length,
    claims,
  };
}

export async function buildPublishLitePackage({ outputDirectory }) {
  const source = await inspectPublishLiteSource();
  await assertPublishSourceClean();
  await runSkillTests();

  const commit = await gitText(['rev-parse', 'HEAD']);
  const tree = await gitText(['rev-parse', `HEAD:${SKILL_ROOT_RELATIVE}`]);
  const commitUnixSeconds = await readCommitUnixSeconds(commit);
  const entries = await trackedSkillEntries();
  const workingPaths = (await listRegularFiles(SKILL_ROOT)).map((path) =>
    relative(SKILL_ROOT, path),
  );
  const trackedPaths = entries.map(({ path }) => path);
  if (JSON.stringify(workingPaths) !== JSON.stringify(trackedPaths)) {
    throw new Error('SKILL_TRACKED_FILE_SET_MISMATCH');
  }

  const versionSuffix = source.version.split('@').at(-1);
  const destination = resolve(outputDirectory);
  await mkdir(destination, { recursive: true });
  const archiveName = `${SKILL_SLUG}-${versionSuffix}.zip`;
  const archivePath = join(destination, archiveName);
  await writeDeterministicSkillArchive({
    archivePath,
    commit,
    commitUnixSeconds,
  });

  const archiveBytes = await readFile(archivePath);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const bytes = await readFile(join(SKILL_ROOT, entry.path));
      return {
        path: entry.path,
        mode: entry.mode,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      };
    }),
  );
  const manifest = {
    schemaVersion: 'wiselink.skill-publish-lite.v1',
    slug: SKILL_SLUG,
    version: source.version,
    compatibilityRef: source.compatibilityRef,
    source: {
      gitCommit: commit,
      gitCommitUnixSeconds: commitUnixSeconds,
      gitTree: tree,
      subtree: SKILL_ROOT_RELATIVE,
    },
    validation: {
      command: `node --test ${SKILL_ROOT_RELATIVE}/tests/validation.test.mjs`,
      passed: true,
      versionClaimsAligned: true,
    },
    archive: {
      fileName: archiveName,
      byteLength: archiveBytes.byteLength,
      sha256: sha256(archiveBytes),
      rootDirectory: SKILL_SLUG,
      fileCount: files.length,
    },
    files,
  };
  const manifestPath = join(destination, `${archiveName}.manifest.json`);
  const checksumPath = join(destination, `${archiveName}.sha256`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(checksumPath, `${manifest.archive.sha256}  ${archiveName}\n`);

  return {
    archivePath,
    manifestPath,
    checksumPath,
    manifest,
  };
}

async function assertPublishSourceClean() {
  const status = await gitText([
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    SKILL_ROOT_RELATIVE,
    HOST_POLICY_RELATIVE,
    PUBLISHER_RELATIVE,
  ]);
  if (status) {
    throw new Error(
      `SKILL_PUBLISH_SOURCE_DIRTY:${status.replaceAll('\n', '|')}`,
    );
  }
}

export async function writeDeterministicSkillArchive({
  archivePath,
  commit = 'HEAD',
  commitUnixSeconds,
}) {
  const resolvedCommitUnixSeconds =
    commitUnixSeconds ?? (await readCommitUnixSeconds(commit));
  await git([
    'archive',
    '--format=zip',
    `--mtime=@${resolvedCommitUnixSeconds}`,
    `--prefix=${SKILL_SLUG}/`,
    `--output=${archivePath}`,
    `${commit}:${SKILL_ROOT_RELATIVE}`,
  ]);
}

async function readCommitUnixSeconds(commit) {
  const value = await gitText(['show', '-s', '--format=%ct', commit]);
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`SKILL_SOURCE_COMMIT_TIME_INVALID:${value}`);
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`SKILL_SOURCE_COMMIT_TIME_INVALID:${value}`);
  }
  return seconds;
}

async function runSkillTests() {
  await execFileAsync(
    process.execPath,
    ['--test', join(SKILL_ROOT, 'tests/validation.test.mjs')],
    {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
}

async function trackedSkillEntries() {
  const output = await gitText([
    'ls-tree',
    '-r',
    'HEAD',
    '--',
    SKILL_ROOT_RELATIVE,
  ]);
  if (!output) return [];
  return output
    .split('\n')
    .map((line) => {
      const match = line.match(/^(\d+) blob [0-9a-f]+\t(.+)$/u);
      if (!match || !['100644', '100755'].includes(match[1])) {
        throw new Error(`SKILL_ARCHIVE_ENTRY_UNSAFE:${line}`);
      }
      return {
        mode: match[1],
        path: match[2].slice(`${SKILL_ROOT_RELATIVE}/`.length),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function listRegularFiles(root) {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`SKILL_SYMLINK_NOT_ALLOWED:${relative(root, path)}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !(await stat(path)).isFile()) {
        throw new Error(`SKILL_NON_REGULAR_FILE:${relative(root, path)}`);
      }
      files.push(path);
    }
  };
  await visit(root);
  return files.sort((left, right) =>
    relative(root, left).localeCompare(relative(root, right)),
  );
}

async function gitText(args) {
  const { stdout } = await git(args);
  return stdout.trim();
}

async function git(args) {
  return execFileAsync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertCompatibleVersion(version, compatibilityRef, minimumVersion) {
  const prefix = `${compatibilityRef}.c`;
  const revision = parseRevision(version, prefix);
  const minimumRevision = parseRevision(minimumVersion, prefix);
  if (
    revision === null ||
    minimumRevision === null ||
    revision < minimumRevision
  ) {
    throw new Error(
      `SKILL_VERSION_NOT_COMPATIBLE:${version}:${compatibilityRef}:${minimumVersion ?? 'missing'}`,
    );
  }
}

function parseRevision(value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
  const suffix = value.slice(prefix.length);
  if (!/^(?:0|[1-9]\d*)$/u.test(suffix)) return null;
  const revision = Number(suffix);
  return Number.isSafeInteger(revision) ? revision : null;
}

function parseArguments(argv) {
  const parsed = {
    checkOnly: false,
    outputDirectory: join(REPOSITORY_ROOT, 'dist/openclaw-skills'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check-only') {
      parsed.checkOnly = true;
      continue;
    }
    if (argument === '--output-dir' && argv[index + 1]) {
      parsed.outputDirectory = resolve(REPOSITORY_ROOT, argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`UNKNOWN_ARGUMENT:${argument}`);
  }
  return parsed;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const result = options.checkOnly
    ? await inspectPublishLiteSource()
    : await buildPublishLitePackage(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
