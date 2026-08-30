import { spawnSync } from 'node:child_process';
import {
  access,
  constants as fsConstants,
  cp,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { validateLinuxX64ElfRuntime } from './linux-x64-elf-runtime.mjs';

const OCR_RUNTIME_SCHEMA = 'wiselink.host-pdf-ocr-runtime.v2';
const OCR_RUNTIME_PLATFORM = 'linux';
const OCR_RUNTIME_ARCH = 'x64';
const OCR_RUNTIME_LIBC = 'bundled-glibc';
const OCR_RUNTIME_LOADER = 'lib/ld-linux-x86-64.so.2';
const OCR_RUNTIME_LIBRARY_DIRECTORY = 'lib';
const OCR_RUNTIME_POPPLER_DATA_DIRECTORY = 'share/poppler';
const OCR_RUNTIME_FONT_CONFIG = 'etc/fonts/fonts.conf';
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
    await runBilingualPreflight(targetRuntime);
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
  const loader = await containedExistingPath(
    rootReal,
    OCR_RUNTIME_LOADER,
    scope,
  );
  const libraryDirectory = await containedExistingPath(
    rootReal,
    OCR_RUNTIME_LIBRARY_DIRECTORY,
    scope,
  );
  const popplerDataDirectory = await containedExistingPath(
    rootReal,
    OCR_RUNTIME_POPPLER_DATA_DIRECTORY,
    scope,
  );
  const fontConfig = await containedExistingPath(
    rootReal,
    OCR_RUNTIME_FONT_CONFIG,
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
  await access(loader, fsConstants.X_OK);

  const closure = await validateLinuxX64ElfRuntime({
    root: rootReal,
    renderer,
    engine,
    loader,
    libraryDirectory,
  });

  return {
    root: rootReal,
    manifest,
    renderer,
    engine,
    tessdata,
    loader,
    libraryDirectory,
    popplerDataDirectory,
    fontConfig,
    closure,
    realpaths: {
      manifest: manifestPath,
      renderer,
      engine,
      tessdata,
      loader,
      libraryDirectory,
      popplerDataDirectory,
      fontConfig,
      languages: languageFiles,
    },
  };
}

function validateManifest(manifest, scope) {
  const languages = manifest?.tessdata?.requiredLanguages;
  if (
    manifest?.schemaVersion !== OCR_RUNTIME_SCHEMA ||
    manifest?.target?.platform !== OCR_RUNTIME_PLATFORM ||
    manifest?.target?.arch !== OCR_RUNTIME_ARCH ||
    manifest?.target?.libc !== OCR_RUNTIME_LIBC ||
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

async function runBilingualPreflight(runtime) {
  if (process.platform !== OCR_RUNTIME_PLATFORM) {
    throw new Error('OCR_RUNTIME_TARGET_PLATFORM_MISMATCH');
  }
  if (process.arch !== OCR_RUNTIME_ARCH) {
    throw new Error('OCR_RUNTIME_TARGET_ARCH_MISMATCH');
  }

  const renderer = runRuntime(runtime, runtime.renderer, ['-v']);
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

  const engine = runRuntime(runtime, runtime.engine, ['--version']);
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

  const languages = runRuntime(runtime, runtime.engine, [
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

  await runRendererProbe(runtime);

  const languageProbe = runRuntime(
    runtime,
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

async function runRendererProbe(runtime) {
  const directory = await mkdtemp(join(tmpdir(), 'wl31-ocr-preflight-'));
  const pdfPath = join(directory, 'probe.pdf');
  const outputPrefix = join(directory, 'probe');
  try {
    await writeFile(pdfPath, onePagePdfProbe());
    const render = runRuntime(runtime, runtime.renderer, [
      '-f',
      '1',
      '-l',
      '1',
      '-singlefile',
      '-r',
      '72',
      '-gray',
      pdfPath,
      outputPrefix,
    ]);
    if (render.status !== 0) {
      throw new Error('OCR_RUNTIME_TARGET_PDFTOPPM_RENDER_FAILED');
    }
    const raster = await readFile(`${outputPrefix}.pgm`);
    if (!/^P5\s+72\s+72\s+255\s/u.test(raster.subarray(0, 64).toString())) {
      throw new Error('OCR_RUNTIME_TARGET_PDFTOPPM_RENDER_INVALID');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runRuntime(runtime, program, args, input) {
  const loaderArguments = [
    '--inhibit-cache',
    '--library-path',
    runtime.libraryDirectory,
    '--argv0',
    program,
    program,
    ...args,
  ];
  const result = spawnSync(runtime.loader, loaderArguments, {
    cwd: runtime.root,
    encoding: 'utf8',
    env: cleanRuntimeEnvironment(runtime),
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

function cleanRuntimeEnvironment(runtime) {
  return {
    FONTCONFIG_FILE: basename(runtime.fontConfig),
    FONTCONFIG_PATH: dirname(runtime.fontConfig),
    HOME: tmpdir(),
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PATH: '/usr/bin:/bin',
    POPPLER_DATADIR: runtime.popplerDataDirectory,
    TMPDIR: tmpdir(),
    TZ: 'UTC0',
    XDG_CACHE_HOME: tmpdir(),
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

function onePagePdfProbe() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}
