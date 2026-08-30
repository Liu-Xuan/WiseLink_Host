import assert from 'node:assert/strict';
import {
  chmod,
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
        schemaVersion: 'wiselink.host-pdf-ocr-runtime.v1',
        renderer: { executable: 'bin/pdftoppm', version: '25.03.0' },
        engine: { executable: 'bin/tesseract', version: '5.5.0' },
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
