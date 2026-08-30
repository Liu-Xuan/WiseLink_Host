import { spawnSync } from 'node:child_process';
import {
  access,
  constants as fsConstants,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const OCR_RUNTIME_SCHEMA = 'wiselink.host-pdf-ocr-runtime.v1';
const REQUIRED_LANGUAGES = ['eng', 'chi_sim'];
const TSV_HEADER =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
const MAX_COMMAND_BUFFER = 16 * 1024 * 1024;
const PREFLIGHT_TIMEOUT_MS = 30_000;
const LANGUAGE_FAILURE =
  /Failed loading language|Error opening data file|Could not initialize tesseract/iu;

export async function copyPinnedPdfOcrRuntime({ source, target }) {
  // deleteOutDir is false. Clear a prior successful runtime before validating
  // a newly supplied source so a failed deployment input cannot leave stale
  // OCR assets available for accidental packaging.
  await rm(target, { recursive: true, force: true });
  const sourceReal = await requiredRealpath(
    resolve(source),
    'OCR_RUNTIME_SOURCE_MISSING',
  );
  await assertTreeContained(sourceReal, sourceReal, 'SOURCE');
  const sourceRuntime = await resolveRuntimeAssets(sourceReal, 'SOURCE');

  await mkdir(resolve(target, '..'), { recursive: true });
  try {
    await cp(sourceReal, target, {
      recursive: true,
      force: true,
      dereference: true,
    });
    const targetParentReal = await requiredRealpath(
      resolve(target, '..'),
      'OCR_RUNTIME_TARGET_PARENT_MISSING',
    );
    const targetReal = await requiredRealpath(
      target,
      'OCR_RUNTIME_TARGET_MISSING',
    );
    assertContained(targetParentReal, targetReal, 'TARGET_ROOT');
    await assertTreeContained(targetReal, targetReal, 'TARGET');
    const targetRuntime = await resolveRuntimeAssets(targetReal, 'TARGET');
    runBilingualPreflight(targetRuntime);
    return {
      source: sourceReal,
      target: targetReal,
      sourceAssets: sourceRuntime.realpaths,
      targetAssets: targetRuntime.realpaths,
      preflightStatus: 'READY',
    };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

async function resolveRuntimeAssets(rootReal, scope) {
  const manifestPath = await containedExistingPath(
    rootReal,
    'manifest.json',
    scope,
  );
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error(`OCR_RUNTIME_${scope}_MANIFEST_INVALID`);
  }
  validateManifest(manifest, scope);

  const renderer = await containedExistingPath(
    rootReal,
    manifest.renderer.executable,
    scope,
  );
  const engine = await containedExistingPath(
    rootReal,
    manifest.engine.executable,
    scope,
  );
  const tessdata = await containedExistingPath(
    rootReal,
    manifest.tessdata.directory,
    scope,
  );
  const languageFiles = [];
  for (const language of REQUIRED_LANGUAGES) {
    languageFiles.push(
      await containedExistingPath(
        rootReal,
        join(manifest.tessdata.directory, `${language}.traineddata`),
        scope,
        `OCR_RUNTIME_${scope}_LANGUAGE_ASSET_MISSING:${language}`,
      ),
    );
  }
  await access(renderer, fsConstants.X_OK);
  await access(engine, fsConstants.X_OK);

  return {
    manifest,
    renderer,
    engine,
    tessdata,
    realpaths: {
      manifest: manifestPath,
      renderer,
      engine,
      tessdata,
      languages: languageFiles,
    },
  };
}

function validateManifest(manifest, scope) {
  const languages = manifest?.tessdata?.requiredLanguages;
  if (
    manifest?.schemaVersion !== OCR_RUNTIME_SCHEMA ||
    manifest?.renderer?.version !== '25.03.0' ||
    typeof manifest?.renderer?.executable !== 'string' ||
    manifest?.engine?.version !== '5.5.0' ||
    typeof manifest?.engine?.executable !== 'string' ||
    manifest?.tessdata?.distribution !== 'tessdata_fast' ||
    manifest?.tessdata?.revision !== '4.1.0' ||
    typeof manifest?.tessdata?.directory !== 'string' ||
    !Array.isArray(languages) ||
    languages.length !== REQUIRED_LANGUAGES.length ||
    !REQUIRED_LANGUAGES.every(
      (language, index) => languages[index] === language,
    )
  ) {
    throw new Error(`OCR_RUNTIME_${scope}_MANIFEST_CONTRACT_MISMATCH`);
  }
}

async function assertTreeContained(rootReal, current, scope, seen = new Set()) {
  const currentReal = await requiredRealpath(
    current,
    `OCR_RUNTIME_${scope}_ENTRY_MISSING`,
  );
  assertContained(rootReal, currentReal, `${scope}_REALPATH`);
  const metadata = await lstat(current);
  const followedMetadata = metadata.isSymbolicLink()
    ? await lstat(currentReal)
    : metadata;
  if (!followedMetadata.isDirectory() || seen.has(currentReal)) return;
  seen.add(currentReal);
  const entries = await readdir(current);
  for (const entry of entries) {
    await assertTreeContained(rootReal, join(current, entry), scope, seen);
  }
}

async function containedExistingPath(
  rootReal,
  child,
  scope,
  missingReason = `OCR_RUNTIME_${scope}_ASSET_MISSING`,
) {
  if (isAbsolute(child)) {
    throw new Error(`OCR_RUNTIME_${scope}_PATH_INVALID`);
  }
  const lexicalPath = resolve(rootReal, child);
  assertContained(rootReal, lexicalPath, `${scope}_PATH`);
  const childReal = await requiredRealpath(lexicalPath, missingReason);
  assertContained(rootReal, childReal, `${scope}_REALPATH`);
  return childReal;
}

function assertContained(rootReal, candidateReal, label) {
  const childRelative = relative(rootReal, candidateReal);
  if (
    childRelative === '..' ||
    childRelative.startsWith(`..${sep}`) ||
    isAbsolute(childRelative)
  ) {
    throw new Error(`OCR_RUNTIME_${label}_OUTSIDE_ROOT`);
  }
}

async function requiredRealpath(path, reason) {
  try {
    return await realpath(path);
  } catch {
    throw new Error(reason);
  }
}

function runBilingualPreflight(runtime) {
  const renderer = run(runtime.renderer, ['-v']);
  const rendererVersion = extractVersion(
    `${renderer.stderr}\n${renderer.stdout}`,
    /pdftoppm version\s+([0-9.]+)/iu,
  );
  if (
    renderer.status !== 0 ||
    rendererVersion !== runtime.manifest.renderer.version
  ) {
    throw new Error('OCR_RUNTIME_TARGET_PDFTOPPM_VERSION_MISMATCH');
  }

  const engine = run(runtime.engine, ['--version']);
  const engineVersion = extractVersion(
    `${engine.stdout}\n${engine.stderr}`,
    /tesseract\s+([0-9.]+)/iu,
  );
  if (
    engine.status !== 0 ||
    engineVersion !== runtime.manifest.engine.version
  ) {
    throw new Error('OCR_RUNTIME_TARGET_TESSERACT_VERSION_MISMATCH');
  }

  const languages = run(runtime.engine, [
    '--tessdata-dir',
    runtime.tessdata,
    '--list-langs',
  ]);
  const installedLanguages = languages.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^[a-z][a-z0-9_]*$/u.test(line));
  if (
    languages.status !== 0 ||
    !REQUIRED_LANGUAGES.every((language) =>
      installedLanguages.includes(language),
    )
  ) {
    throw new Error('OCR_RUNTIME_TARGET_LANGUAGE_ASSET_MISSING');
  }

  const languageProbe = run(
    runtime.engine,
    [
      'stdin',
      'stdout',
      '--tessdata-dir',
      runtime.tessdata,
      '-l',
      REQUIRED_LANGUAGES.join('+'),
      '--psm',
      '6',
      '--dpi',
      '300',
      '-c',
      'tessedit_create_tsv=1',
    ],
    blankPgmProbe(),
  );
  if (
    languageProbe.status !== 0 ||
    LANGUAGE_FAILURE.test(languageProbe.stderr) ||
    !languageProbe.stdout.startsWith(TSV_HEADER)
  ) {
    throw new Error('OCR_RUNTIME_TARGET_BILINGUAL_INITIALIZATION_FAILED');
  }
}

function run(command, args, input) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input,
    maxBuffer: MAX_COMMAND_BUFFER,
    timeout: PREFLIGHT_TIMEOUT_MS,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function extractVersion(output, pattern) {
  return output.match(pattern)?.[1] ?? null;
}

function blankPgmProbe() {
  return Buffer.concat([
    Buffer.from('P5\n32 32\n255\n', 'ascii'),
    Buffer.alloc(32 * 32, 255),
  ]);
}
