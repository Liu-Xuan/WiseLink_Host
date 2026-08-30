import assert from 'node:assert/strict';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { copyPinnedPdfOcrRuntime } from '../../scripts/lib/pdf-ocr-runtime-deployment.mjs';
import {
  parseLinuxX64Elf,
  validateLinuxX64ElfRuntime,
} from '../../scripts/lib/linux-x64-elf-runtime.mjs';

const packagedRuntime = join(
  import.meta.dirname,
  '../../server/runtime-assets/professional-input/ocr-runtime',
);

for (const symlinkKind of ['absolute', 'relative']) {
  test(`OCR deployment rejects a ${symlinkKind} source symlink outside its real root`, async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'wl31-ocr-runtime-sync-'));
    const source = join(fixture, 'source');
    const target = join(fixture, 'deployment/ocr-runtime');
    const outsideExecutable = join(fixture, 'outside-pdftoppm');
    await mkdir(join(source, 'bin'), { recursive: true });
    await mkdir(join(source, 'share/tessdata'), { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'stale-runtime'), 'must be removed');
    await writeFile(outsideExecutable, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(outsideExecutable, 0o755);
    await symlink(
      symlinkKind === 'absolute' ? outsideExecutable : '../../outside-pdftoppm',
      join(source, 'bin/pdftoppm'),
    );
    await writeFile(join(source, 'bin/tesseract'), '#!/bin/sh\nexit 0\n');
    await chmod(join(source, 'bin/tesseract'), 0o755);
    await writeFile(join(source, 'share/tessdata/eng.traineddata'), 'eng');
    await writeFile(
      join(source, 'share/tessdata/chi_sim.traineddata'),
      'chi_sim',
    );
    await writeFile(
      join(source, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 'wiselink.host-pdf-ocr-runtime.v2',
        target: {
          platform: 'linux',
          arch: 'x64',
          libc: 'bundled-glibc',
        },
        renderer: { executable: 'libexec/pdftoppm', version: '25.03.0' },
        engine: { executable: 'libexec/tesseract', version: '5.5.0' },
        tessdata: {
          directory: 'share/tessdata',
          distribution: 'tessdata_fast',
          revision: '4.1.0',
          requiredLanguages: ['eng', 'chi_sim'],
        },
      }),
      'utf8',
    );

    try {
      await assert.rejects(
        copyPinnedPdfOcrRuntime({ source, target }),
        /OCR_RUNTIME_SOURCE_REALPATH_OUTSIDE_ROOT/u,
      );
      await assert.rejects(lstat(target));
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });
}

test('packaged Linux x64 OCR runtime has a complete in-root ELF and ABI closure', async () => {
  const result = await validateLinuxX64ElfRuntime({
    root: packagedRuntime,
    renderer: join(packagedRuntime, 'libexec/pdftoppm'),
    engine: join(packagedRuntime, 'libexec/tesseract'),
    loader: join(packagedRuntime, 'lib/ld-linux-x86-64.so.2'),
    libraryDirectory: join(packagedRuntime, 'lib'),
  });

  assert.ok(result.libraries.length > 0);
  assert.ok(result.edges.length > 0);
  assert.equal(result.renderer.runpath, '$ORIGIN/../lib');
  assert.equal(result.engine.runpath, '$ORIGIN/../lib');
  assert.ok(
    result.edges.every(
      (edge) =>
        edge.to.startsWith(`${result.root}/lib/`) &&
        !edge.to.includes('/opt/homebrew'),
    ),
  );
});

test('ELF verifier rejects a version-spoofing shell before execution', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'wl31-ocr-runtime-shell-'));
  const executable = join(fixture, 'tesseract');
  await writeFile(
    executable,
    '#!/bin/sh\nprintf "tesseract 5.5.0\\n"\n',
    'utf8',
  );
  await chmod(executable, 0o755);
  try {
    await assert.rejects(
      parseLinuxX64Elf(executable),
      /OCR_RUNTIME_ELF_NOT_ELF/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('ELF verifier rejects a missing first-level dependency', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'wl31-ocr-runtime-closure-'));
  const runtime = join(fixture, 'runtime');
  await mkdir(join(runtime, 'libexec'), { recursive: true });
  await mkdir(join(runtime, 'lib'), { recursive: true });
  for (const relativePath of [
    'libexec/pdftoppm',
    'libexec/tesseract',
    'lib/ld-linux-x86-64.so.2',
  ]) {
    const target = join(runtime, relativePath);
    await copyFile(join(packagedRuntime, relativePath), target);
    await chmod(target, 0o755);
  }
  try {
    await assert.rejects(
      validateLinuxX64ElfRuntime({
        root: runtime,
        renderer: join(runtime, 'libexec/pdftoppm'),
        engine: join(runtime, 'libexec/tesseract'),
        loader: join(runtime, 'lib/ld-linux-x86-64.so.2'),
        libraryDirectory: join(runtime, 'lib'),
      }),
      /OCR_RUNTIME_ELF_DEPENDENCY_MISSING/u,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('deployment rejects legacy v1 before copying or preflight', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'wl31-ocr-runtime-v1-'));
  const source = join(fixture, 'source');
  const target = join(fixture, 'target');
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'stale-runtime'), 'must be removed');
  await writeFile(
    join(source, 'manifest.json'),
    JSON.stringify({ schemaVersion: 'wiselink.host-pdf-ocr-runtime.v1' }),
    'utf8',
  );
  try {
    await assert.rejects(
      copyPinnedPdfOcrRuntime({ source, target }),
      /OCR_RUNTIME_SOURCE_MANIFEST_CONTRACT_MISMATCH/u,
    );
    await assert.rejects(lstat(target));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
